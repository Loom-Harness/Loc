// The deployable side of the playground's message broker: a stand-in for the
// generated `ChannelTransport` (`src/generator/typescript/emit/channels.ts`)
// that holds no broker state.  Every publish, subscribe, ack and nack goes
// over the deployable's `InfraPort` to the one broker model in the infra
// worker, so the redis / rabbitmq / kafka drivers all sit on one facade —
// the generated code reaches the brokers only through `ChannelTransport`, so
// no client library needs mirroring.
//
// It plugs into the generated boot through `bootApp(db, { channelTransport })`.
// What the drivers do on a failed handler is done here the same way: the
// result of a `nack` says whether the broker retried or parked the message,
// and the facade logs `channel_dead_lettered` / `channel_consume_failed` as
// the driver would.

import type { InfraPort } from "./infra-port.js";
import type {
  BrokerDelivery,
  BrokerKind,
  BrokerNackResult,
  BrokerSubscribeResult,
} from "../../../src/emulation/broker-protocol.js";

/** The generated `LoomEventEnvelope`, as far as the facade reads it. */
interface Envelope {
  id: string;
  type: string;
  loomkey?: string;
}

/** The generated `ChannelTransport`. */
export interface ChannelTransport {
  publish(address: string, envelope: Envelope): Promise<void>;
  subscribe(
    address: string,
    group: string | null,
    handler: (envelope: Envelope) => Promise<void>,
    opts?: { fromBeginning?: boolean },
  ): Promise<() => void>;
  close(): Promise<void>;
}

/** The generated `ChannelBinding`, as far as the facade reads it. */
export interface ChannelBindingLike {
  csName: string;
  address: string;
  transport: string;
}

function isBroker(t: string): t is BrokerKind {
  return t === "redis" || t === "rabbitmq" || t === "kafka";
}

const errMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** One per deployable: routes the broker's deliveries to the subscribing
 *  handler, and builds a `ChannelTransport` per binding. */
export class BrokerClient {
  private readonly handlers = new Map<string, (envelope: Envelope) => Promise<void>>();
  /** Deliveries that overtook their `subscribe` reply, held until the
   *  handler is registered. */
  private readonly early = new Map<string, BrokerDelivery[]>();

  constructor(private readonly port: InfraPort) {
    port.onPush<BrokerDelivery>("broker", (d) => void this.receive(d));
  }

  private async receive(d: BrokerDelivery): Promise<void> {
    const handler = this.handlers.get(d.subId);
    if (!handler) {
      this.early.set(d.subId, [...(this.early.get(d.subId) ?? []), d]);
      return;
    }
    let envelope: Envelope;
    try {
      envelope = JSON.parse(d.body) as Envelope;
    } catch {
      const res = await this.nack(d.deliveryId, "malformed envelope", true);
      if (res?.outcome === "dead-lettered") {
        console.warn({ event: "channel_dead_lettered", error: "malformed envelope", parkedAt: res.parkedAt });
      }
      return;
    }
    try {
      await handler(envelope);
    } catch (err) {
      const error = errMessage(err);
      const res = await this.nack(d.deliveryId, error);
      if (res?.outcome === "dead-lettered") {
        console.warn({
          event: "channel_dead_lettered",
          type: envelope.type,
          id: envelope.id,
          attempts: res.attempts,
          parkedAt: res.parkedAt,
          error,
        });
      } else if (res?.outcome === "dropped") {
        console.warn({ event: "channel_consume_failed", type: envelope.type, id: envelope.id, error });
      }
      return;
    }
    await this.port.call({ service: "broker", op: "ack", params: { deliveryId: d.deliveryId } }).catch(() => undefined);
  }

  private nack(deliveryId: number, error: string, poison = false): Promise<BrokerNackResult | null> {
    return this.port
      .call<BrokerNackResult>({ service: "broker", op: "nack", params: { deliveryId, error, poison } })
      .catch(() => null);
  }

  /** `bootApp`'s `channelTransport` option. */
  transportFor(binding: ChannelBindingLike): ChannelTransport {
    const transport = binding.transport;
    if (!isBroker(transport)) {
      throw new Error(`channel binding '${binding.csName}': no emulated broker for transport "${transport}"`);
    }
    const mine = new Set<string>();
    const unsubscribe = (subId: string): void => {
      mine.delete(subId);
      this.handlers.delete(subId);
      this.early.delete(subId);
      void this.port.call({ service: "broker", op: "unsubscribe", params: { subId } }).catch(() => undefined);
    };
    return {
      publish: async (address, envelope) => {
        await this.port.call({
          service: "broker",
          op: "publish",
          // On the wire as the drivers put it: JSON text, so a consumer gets
          // what `JSON.parse` makes of it, never a shared object.
          params: { transport, address, body: JSON.stringify(envelope), key: envelope.loomkey ?? envelope.id },
        });
      },
      subscribe: async (address, group, handler, opts) => {
        const { subId } = await this.port.call<BrokerSubscribeResult>({
          service: "broker",
          op: "subscribe",
          params: { transport, address, group, fromBeginning: opts?.fromBeginning === true },
        });
        mine.add(subId);
        this.handlers.set(subId, handler);
        const early = this.early.get(subId) ?? [];
        this.early.delete(subId);
        for (const d of early) void this.receive(d);
        return () => unsubscribe(subId);
      },
      close: async () => {
        for (const subId of [...mine]) unsubscribe(subId);
      },
    };
  }
}

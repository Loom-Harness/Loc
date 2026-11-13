// Broker-binding resolution.
//
// The one decision tree every consumer of a deployable's `channels:` wiring
// shares: which of the deployable's channelSource bindings target a broker
// transport a shipped driver provisions, which channel/context each binds, the
// derived broker address + consumer group, and the carried event types.  Read
// by every backend's channel emitter, the per-deployable `channelPlan`, and the
// system compose renderer (sidecars + `LOOM_CHANNEL_*_URL` env).  It is a plan
// fact (pure over the IR), so it lives in `src/ir/plan/`;
// `src/generator/_channels/bindings.ts` re-exports it for the emitters.

import {
  channelAddress,
  channelSourceEnvVar,
  consumerGroup,
  SHIPPED_COMBOS,
} from "../../util/channels.js";
import type { DeployableIR, SystemIR } from "../types/loom-ir.js";

/** The transports a shipped broker driver provisions. */
export type BrokerTransport = "redis" | "rabbitmq" | "kafka";

/** One broker-bound channel wiring on a deployable. */
export interface BrokerBinding {
  /** The `channelSource` declaration's name (the `channels:` list entry). */
  csName: string;
  /** Bare channel name (`cs.channelName`). */
  channelName: string;
  /** The channel's owning bounded context. */
  contextName: string;
  /** The bound `storage` instance name (the compose service). */
  storageName: string;
  /** Which driver realises the binding (from the storage's type). */
  transport: BrokerTransport;
  /** The channel's declared delivery semantics — the binding only picks the
   *  machinery that enforces them (design §4). */
  delivery: "broadcast" | "queue";
  retention: "ephemeral" | "log" | "work";
  /** Derived broker address — `loom.<context>.<channel>`. */
  address: string;
  /** The consumer group this deployable's replicas share on the channel —
   *  `<address>.<deployable>`.  Replicas compete within the group (`queue`);
   *  distinct deployables get distinct groups. */
  group: string;
  /** `LOOM_CHANNEL_<NAME>_URL` — the env var carrying the broker URL. */
  envVar: string;
  /** Carried event type names (the channel's `carries:` list). */
  events: string[];
  /** The channel's declared partition/ordering key field (`key:`) — a
   *  field common to the carried events.  Kafka partitions by its value
   *  (`loomkey` ?? envelope id, design §4); other transports ignore it. */
  key?: string;
}

// The delivery/retention combos each shipped transport realises live in
// `src/util/channels.ts` (`SHIPPED_COMBOS`), so the language validator gates a
// compatible-but-not-yet-shipped binding off the same list this resolver
// skips on.

/** The deployable's broker-bound channel wirings across every shipped
 *  transport.  Unresolved names, non-broker storages, and not-yet-shipped
 *  delivery combos are skipped silently here: the validators
 *  (`loom.channelsource-*`) already surface them as diagnostics, and
 *  generation must not throw on a model that only carries warnings. */
export function brokerChannelBindings(deployable: DeployableIR, sys: SystemIR): BrokerBinding[] {
  const storageType = new Map(sys.storages.map((s) => [s.name, s.type] as const));
  const out: BrokerBinding[] = [];
  for (const csName of deployable.channelSourceNames ?? []) {
    const cs = sys.channelSources.find((c) => c.name === csName);
    if (!cs) continue;
    const type = storageType.get(cs.storageName);
    if (type !== "redis" && type !== "rabbitmq" && type !== "kafka") continue;
    const transport: BrokerTransport = type;
    for (const sub of sys.subdomains) {
      for (const ctx of sub.contexts) {
        const ch = (ctx.channels ?? []).find((c) => c.name === cs.channelName);
        if (!ch) continue;
        if (!SHIPPED_COMBOS[transport].has(`${ch.delivery}/${ch.retention}`)) continue;
        const address = channelAddress(ctx.name, ch.name);
        out.push({
          csName: cs.name,
          channelName: ch.name,
          contextName: ctx.name,
          storageName: cs.storageName,
          transport,
          delivery: ch.delivery,
          retention: ch.retention,
          address,
          group: consumerGroup(address, deployable.name),
          envVar: channelSourceEnvVar(cs.name),
          events: [...ch.carries],
          key: ch.key,
        });
      }
    }
  }
  return out;
}

/** Names of broker-type storages that back a channelSource some deployable
 *  actually wires — exactly the set the compose renderer provisions a
 *  sidecar for (design §6a: `valkey/valkey` for redis, the official
 *  `rabbitmq:` image (MPL 2.0) for rabbitmq; never the relicensed `redis:`
 *  images). */
export function channelTransportStorageNames(sys: SystemIR): Set<string> {
  const out = new Set<string>();
  for (const d of sys.deployables) {
    for (const b of brokerChannelBindings(d, sys)) out.add(b.storageName);
  }
  return out;
}

/** Where a NEW kafka consumer group starts reading.  A
 *  work-queue channel (`delivery: queue` / `retention: work`) starts at the
 *  EARLIEST offset, so an event published before the consuming deployable's
 *  group first joins is still delivered (envelope-id idempotency makes a
 *  replay of already-handled records safe).  A `retention: log` broadcast
 *  channel keeps the LATEST offset — a fresh deployable does not replay the
 *  whole log (the replay cursor is a separate, unshipped mission).  A group
 *  with committed offsets resumes from them either way, so this only decides
 *  the first join (or an offset-expired rejoin).  The single source every
 *  backend's kafka emitter reads. */
export function kafkaStartsAtEarliest(
  b: Pick<BrokerBinding, "transport" | "delivery" | "retention">,
): boolean {
  return b.transport === "kafka" && (b.retention === "work" || b.delivery === "queue");
}

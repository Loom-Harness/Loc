// The infra worker's request routing, apart from the worker globals so it can
// be driven in a test: `storage` first (the main thread only), then the
// worker's own `infra.*` ops, then the registered services by name.
//
// Requests arrive from the main thread (`client: null`) or from a connected
// deployable's `InfraPort` (`client: <slug>`), in the same `{ id, service,
// op, params }` envelope; each is answered `{ id, result | error }`.

import type { InfraRequest, InfraResponse, StorageOp } from "../infra-protocol.js";
import type { BlobStore } from "./persist.js";
import type { InfraPush, InfraService, InfraServiceHost } from "./service.js";

// biome-ignore lint/suspicious/noExplicitAny: each service narrows its own ops.
export type InfraServices = Map<string, InfraService<any>>;

export interface InfraRouterOptions {
  /** Build the registered services; `host` pushes to connected deployables. */
  createServices(host: InfraServiceHost): InfraServices;
  /** The storage service (it predates the registry); `attach` carries a
   *  transferred port. */
  storage(req: StorageOp, ports: readonly MessagePort[]): Promise<unknown>;
  /** Drop a deployable's storage clients, rolling back what they left open. */
  detachStorages?(client: string): Promise<void>;
  /** `infra.reset`: close every storage. */
  closeStorages(): Promise<void>;
  /** Open the durable store of a resource island (null: nothing durable). */
  openBlobStore?(island: string): Promise<BlobStore | null>;
}

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export class InfraRouter {
  /** Connected deployables, by slug: the infra end of each one's `InfraPort`. */
  private readonly clients = new Map<string, MessagePort>();
  readonly services: InfraServices;
  private store: BlobStore | null = null;

  constructor(private readonly opts: InfraRouterOptions) {
    this.services = opts.createServices({
      push: (client: string, message: InfraPush) => this.clients.get(client)?.postMessage(message),
    });
  }

  /** Answer one request on `reply`.  Never throws: a failure is the
   *  response's `error`. */
  async serve(
    req: InfraRequest,
    client: string | null,
    ports: readonly MessagePort[],
    reply: { postMessage(msg: InfraResponse): void },
  ): Promise<void> {
    const response: InfraResponse = { id: req.id };
    try {
      response.result = await this.handle(req, client, ports);
    } catch (err) {
      response.error = { message: errText(err) };
    }
    reply.postMessage(response);
  }

  private async handle(req: InfraRequest, client: string | null, ports: readonly MessagePort[]): Promise<unknown> {
    if (req.service === "storage") {
      if (client !== null) throw new Error("A deployable reaches its storage through its storage port, not the infra port.");
      return this.opts.storage(req, ports);
    }
    if (req.service === "infra") {
      if (client !== null) throw new Error(`infra.${req.op} is for the main thread only.`);
      switch (req.op) {
        case "reset":
          for (const slug of [...this.clients.keys()]) this.disconnect(slug);
          await this.opts.closeStorages();
          for (const svc of this.services.values()) await svc.reset();
          return { ok: true };
        case "configure": {
          const { island, fresh } = req.params;
          this.store = island ? ((await this.opts.openBlobStore?.(island)) ?? null) : null;
          if (fresh) await this.store?.clear();
          for (const svc of this.services.values()) await svc.persist?.(this.store);
          return { ok: true, persistent: this.store !== null };
        }
        case "wipeResources":
          await this.store?.clear();
          for (const svc of this.services.values()) await svc.reset();
          return { ok: true };
        case "connect": {
          const port = ports[0];
          if (!port) throw new Error("infra.connect needs a transferred MessagePort.");
          const slug = req.params.client;
          this.disconnect(slug);
          this.clients.set(slug, port);
          port.onmessage = (msg: MessageEvent<InfraRequest>) => void this.serve(msg.data, slug, [], port);
          return { ok: true };
        }
        case "disconnect":
          this.disconnect(req.params.client);
          await this.opts.detachStorages?.(req.params.client);
          return { ok: true };
      }
    }
    // A registered service's request (`never` while no service is registered).
    const own = req as { service: string; op: string; params: unknown };
    const svc = this.services.get(own.service);
    if (!svc) throw new Error(`Unknown infra service "${own.service}".`);
    return svc.handle(own, { client });
  }

  private disconnect(client: string): void {
    const port = this.clients.get(client);
    if (!port) return;
    this.clients.delete(client);
    port.close();
    for (const svc of this.services.values()) svc.disconnect?.(client);
  }
}

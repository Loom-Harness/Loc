// The contract every infra service implements — one module per service,
// listed in `services.ts`.  The infra worker routes each `{ service, op,
// params }` request to the service named, from the main thread (`client:
// null`) or from a deployable's `InfraPort` (`client: <slug>`).

import type { BlobStore } from "./persist.js";

/** Something a service pushes to one deployable without being asked (a
 *  broker delivery).  Plain data. */
export interface InfraPush {
  push: string;
}

export interface InfraServiceContext {
  /** The deployable that sent the request; null for the main thread. */
  client: string | null;
}

export interface InfraServiceHost {
  /** Push a message to a connected deployable.  Dropped when the deployable
   *  is no longer connected. */
  push(client: string, message: InfraPush): void;
}

export interface InfraService<Op extends { op: string; params: unknown }> {
  readonly name: string;
  handle(req: Op, ctx: InfraServiceContext): Promise<unknown> | unknown;
  /** A deployable disconnected (stopped, reset or respawned). */
  disconnect?(client: string): void;
  /** `infra.configure`: back this service with `store` (null → memory only) and
   *  load what the store holds.  Runs after `reset`. */
  persist?(store: BlobStore | null): Promise<void>;
  /** `infra.reset`: drop all in-memory state (the durable copy stays). */
  reset(): Promise<void> | void;
}

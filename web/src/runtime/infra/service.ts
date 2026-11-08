// The contract every infra service implements — one module per service,
// listed in `services.ts`.  The infra worker routes each `{ service, op,
// params }` request to the service named, from the main thread (`client:
// null`) or from a deployable's `InfraPort` (`client: <slug>`).

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
  /** `infra.reset`: drop all state. */
  reset(): Promise<void> | void;
}

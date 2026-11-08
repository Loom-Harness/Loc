// The infra worker's services, by name — one line per service.  `storage`
// predates the registry and is still routed by `infra.worker.ts` directly.

import { createBrokerService } from "./broker.service.js";
import type { InfraService, InfraServiceHost } from "./service.js";

// biome-ignore lint/suspicious/noExplicitAny: each service narrows its own ops.
export function createServices(host: InfraServiceHost): Map<string, InfraService<any>> {
  return new Map([["broker", createBrokerService(host)]]);
}

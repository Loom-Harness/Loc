// The infra worker's services, by name — one entry per service (see
// `service.ts`).  `storage` predates the registry and is routed by
// `router.ts` directly.

import { createBrokerService } from "./broker.service.js";
import type { InfraServices } from "./router.js";
import type { InfraServiceHost } from "./service.js";

export function createServices(host: InfraServiceHost): InfraServices {
  return new Map([["broker", createBrokerService(host)]]);
}

// The infra worker's services, by name — one entry per service (see
// `service.ts`).  `storage` predates the registry and is routed by
// `router.ts` directly.

import type { InfraServices } from "./router.js";
import type { InfraServiceHost } from "./service.js";

export function createServices(_host: InfraServiceHost): InfraServices {
  return new Map();
}

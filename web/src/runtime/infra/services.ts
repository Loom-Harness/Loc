// The infra worker's services, by name — one entry per service (see
// `service.ts`).  `storage` predates the registry and is routed by
// `router.ts` directly.

import { s3Service, sesService } from "./aws-fake.js";
import { createBrokerService } from "./broker.service.js";
import { cacheService } from "./cache.js";
import { diskService } from "./disk.js";
import { httpMockService } from "./http-mock.js";
import { mailboxService } from "./mailbox.js";
import { oidcService } from "./oidc.js";
import type { InfraServices } from "./router.js";
import type { InfraServiceHost } from "./service.js";

export function createServices(host: InfraServiceHost): InfraServices {
  return new Map([
    ["broker", createBrokerService(host)],
    ...[s3Service, sesService, mailboxService, diskService, httpMockService, oidcService, cacheService].map(
      (s): [string, typeof s] => [s.name, s],
    ),
  ]);
}

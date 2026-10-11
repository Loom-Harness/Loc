// The bundled dev Keycloak's demo TENANT (eval-closure item #26).
//
// Under `tenancy by user.<claim> of <Registry>` the demo user's tenancy claim
// used to be seeded `demo-<claim>` — not a uuid.  Every registry repository's
// self-scope reads `<registry>.id = <claim>` only when the claim parses as a
// uuid (else it matches nothing), so the demo user's registry list was
// permanently empty, and no amount of creating orgs could fix it: a created
// row gets a fresh server-side id that is never the claim.
//
// The fix has two halves that must agree on ONE value, so both read it here:
//
//   - `keycloak/realm.json` seeds the demo user's tenancy claim with
//     `DEMO_TENANT_ID` (`src/system/index.ts`);
//   - enrichment appends a first-boot `raw` seed row for the registry with that
//     same id (`src/ir/enrich/demo-tenant.ts`), which every backend's existing
//     seed-datasets path emits.  It lives in its own dataset
//     (`DEMO_TENANT_DATASET`), which — like every non-`default` dataset — runs
//     only when `LOOM_SEED` names it, and the generated dev compose sets that
//     only on a backend that hosts the registry.  A production boot never
//     inserts a demo tenant.
//
// Both halves exist only when the compose stack bundles the dev Keycloak.

import type { SystemIR } from "../types/loom-ir.js";

/** The demo tenant's id — a fixed, valid (v4-shaped) uuid, obviously synthetic. */
export const DEMO_TENANT_ID = "00000000-0000-4000-8000-00000000de40";

/** The seed dataset carrying the demo tenant's registry row. */
export const DEMO_TENANT_DATASET = "loomDemoTenant";

/** True when the generated compose stack bundles the dev Keycloak — an OIDC
 *  `auth { … }` block whose provider is self-hosted (keycloak / custom / a raw
 *  `oidc { issuer }`).  Hosted presets (google / auth0 / …) use their own IdP
 *  and get no bundled realm, so no demo user and no demo tenant. */
export function bundlesDevKeycloak(sys: Pick<SystemIR, "auth">): boolean {
  const a = sys.auth;
  if (!a) return false;
  return !a.provider || a.provider === "keycloak" || a.provider === "custom";
}

/** The tenancy claim field the demo user's realm attribute must carry as
 *  `DEMO_TENANT_ID`, or `undefined` when there is no demo tenant. */
export function demoTenantClaim(sys: Pick<SystemIR, "auth" | "tenancy">): string | undefined {
  return bundlesDevKeycloak(sys) ? sys.tenancy?.claimField : undefined;
}

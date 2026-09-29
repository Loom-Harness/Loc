// The bundled dev Keycloak's demo TENANT (eval-closure item #26).
//
// Under `tenancy by user.<claim> of <Registry>` the realm used to seed the demo
// user's tenancy claim as `demo-<claim>` — not a uuid — and ship no registry
// row.  Every registry repository's self-scope matches `<registry>.id = <claim>`
// only for a uuid claim, so the demo user's registry list was permanently
// empty, and creating an org could not fix it (a created row gets a fresh id).
//
// Pinned on the three halves that must agree on ONE id: the realm attribute,
// the first-boot registry row every backend's seeder writes, and the compose
// `LOOM_SEED` that opts the dev stack (and only the dev stack) into it.

import { describe, expect, it } from "vitest";
import { DEMO_TENANT_DATASET, DEMO_TENANT_ID } from "../../src/ir/util/demo-tenant.js";
import { generateSystemFiles } from "../_helpers/index.js";

const system = (platform: string, authBlock: string) => `
system Billing {
  user { id: string  orgId: string  role: string  permissions: string[] }
  ${authBlock}
  tenancy by user.orgId of Org
  subdomain Money {
    permissions { manageOrgs }
    context Invoicing {
      aggregate Org { name: string  seats: int  active: bool }
      aggregate Invoice with tenantOwned { number: string }
      repository Orgs for Org { }
      repository Invoices for Invoice { }
    }
  }
  storage primary { type: postgres }
  resource invState { for: Invoicing, kind: state, use: primary }
  api MoneyApi from Money
  deployable d {
    platform: ${platform}
    contexts: [Invoicing]
    serves: MoneyApi
    dataSources: [invState]
    port: 4000
    auth: required
  }
}`;

const KEYCLOAK = `auth {
    enforcement: opt
    provider: keycloak
    oidc { issuer: env("OIDC_ISSUER")  clientId: env("OIDC_CLIENT_ID")  audience: env("OIDC_AUDIENCE") }
    claims: { orgId: "org_id" }
  }`;

/** The raw registry INSERT each backend's seeder must carry. */
const ROW = `('${DEMO_TENANT_ID}', 'Demo Org', 0, FALSE`;

describe("the bundled Keycloak's demo tenant exists (#26)", () => {
  it("realm: the tenancy claim is the demo tenant's uuid; permissions stay unseeded", async () => {
    const files = await generateSystemFiles(system("node", KEYCLOAK));
    const realm = JSON.parse(files.get("keycloak/realm.json")!) as {
      users: { attributes?: Record<string, string[]> }[];
    };
    const attrs = realm.users[0]!.attributes ?? {};
    expect(attrs.orgId).toEqual([DEMO_TENANT_ID]);
    // The demo user is deliberately NOT granted permissions — denial must stay
    // demonstrable (keycloak-compose.test.ts carries the full rationale).
    expect(attrs.permissions).toBeUndefined();
    expect(files.get("docker-compose.yml")!).toContain(
      `LOOM_SEED: ${JSON.stringify(DEMO_TENANT_DATASET)}`,
    );
  });

  for (const platform of ["node", "dotnet", "java", "python", "elixir"]) {
    it(`${platform}: the seeder writes the matching registry row in its own dataset`, async () => {
      const all = [...(await generateSystemFiles(system(platform, KEYCLOAK))).values()].join("\n");
      expect(all).toContain(ROW);
      expect(all).toContain(DEMO_TENANT_DATASET);
    });
  }

  it("no bundled Keycloak (dev stub) ⇒ no demo tenant row and no LOOM_SEED", async () => {
    const files = await generateSystemFiles(system("node", ""));
    const all = [...files.values()].join("\n");
    expect(all).not.toContain(DEMO_TENANT_ID);
    expect(files.get("docker-compose.yml")!).not.toContain("LOOM_SEED");
  });

  it("a hosted IdP preset (google) bundles no realm ⇒ no demo tenant", async () => {
    const files = await generateSystemFiles(
      system(
        "node",
        `auth { enforcement: opt  provider: google  oidc { clientId: env("OIDC_CLIENT_ID")  audience: env("OIDC_AUDIENCE") } }`,
      ),
    );
    expect([...files.values()].join("\n")).not.toContain(DEMO_TENANT_ID);
  });
});

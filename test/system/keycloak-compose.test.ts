// Bundled dev Keycloak (D-AUTH-OIDC §4.2 — the zero-config quick-start).
// When a system declares a self-hosted OIDC `auth { … }` block, the generated
// docker-compose.yml adds a Keycloak service with a pre-provisioned realm +
// seeded demo user, and points the `auth: required` backend at it.  A hosted
// preset (e.g. google) uses its own IdP and gets no bundled service.

import { NodeFileSystem } from "langium/node";
import { parseHelper } from "langium/test";
import { describe, expect, it } from "vitest";
import { createDddServices } from "../../src/language/ddd-module.js";
import type { Model } from "../../src/language/generated/ast.js";
import { generateSystems } from "../../src/system/index.js";

const services = createDddServices(NodeFileSystem);
const parse = parseHelper<Model>(services.Ddd);

async function filesFor(src: string): Promise<Map<string, string>> {
  const doc = await parse(src, { validation: false });
  return generateSystems(doc.parseResult.value).files;
}

function system(authBlock: string): string {
  return `
system Helpdesk {
  user { id: string role: string }
  ${authBlock}
  subdomain Support {
    context Tickets {
      aggregate Ticket { open: bool  operation close() { requires currentUser.role == "agent"  open := false } }
      repository Tickets for Ticket { }
    }
  }
  storage primary { type: postgres }
  resource st { for: Tickets, kind: state, use: primary }
  api SApi from Support
  deployable api { platform: node contexts: [Tickets] serves: SApi dataSources: [st] port: 8080 auth: required }
}`;
}

/** Same system plus a react frontend that `targets:` the api — the shape every
 *  scaffolded project has, and the one the post-login redirect needs. */
function systemWithUi(authBlock: string): string {
  return `
system Helpdesk {
  user { id: string role: string }
  ${authBlock}
  subdomain Support {
    context Tickets {
      aggregate Ticket with crudish { open: bool  derived display: string = "t" }
      repository Tickets for Ticket { }
    }
  }
  storage primary { type: postgres }
  resource st { for: Tickets, kind: state, use: primary }
  api SApi from Support
  ui Web with scaffold(subdomains: [Support]) { framework: react  api Support: SApi }
  deployable api { platform: node contexts: [Tickets] serves: SApi dataSources: [st] port: 8080 auth: required }
  deployable web { platform: react targets: api ui: Web { Support: api } port: 3007 auth: ui }
}`;
}

const KEYCLOAK = `auth { provider: keycloak  oidc { issuer: env("OIDC_ISSUER")  clientId: env("OIDC_CLIENT_ID") } }`;

describe("bundled dev Keycloak compose", () => {
  it("adds the Keycloak service + realm import + OIDC env under a self-hosted auth block", async () => {
    const files = await filesFor(system(KEYCLOAK));
    const compose = files.get("docker-compose.yml")!;
    expect(compose).toContain("keycloak:");
    expect(compose).toContain("quay.io/keycloak/keycloak");
    expect(compose).toContain("--import-realm");
    // backend points at the bundled IdP via the host-reachable issuer
    expect(compose).toContain('OIDC_ISSUER: "http://host.docker.internal:8081/realms/helpdesk"');
    expect(compose).toContain('OIDC_CLIENT_ID: "helpdesk-app"');
    expect(compose).toContain("host.docker.internal:host-gateway");
    // realm import: a client + a seeded demo user
    const realm = JSON.parse(files.get("keycloak/realm.json")!) as {
      realm: string;
      clients: { clientId: string }[];
      users: { username: string }[];
    };
    expect(realm.realm).toBe("helpdesk");
    expect(realm.clients[0]!.clientId).toBe("helpdesk-app");
    expect(realm.users[0]!.username).toBe("demo");
  });

  it("moves Keycloak off a host port a deployable already publishes (no bind collision)", async () => {
    // Regression: Keycloak defaulted to host 8081, which is also the Java
    // backend's default port — a system with auth + a deployable on 8081 mapped
    // both services to 8081 and `docker compose up` failed ("port is already
    // allocated").  Keycloak must skip used ports; here it lands on 8082.
    const src = `
system Helpdesk {
  user { id: string role: string }
  ${KEYCLOAK}
  subdomain Support {
    context Tickets {
      aggregate Ticket { open: bool  operation close() { requires currentUser.role == "agent"  open := false } }
      repository Tickets for Ticket { }
    }
  }
  storage primary { type: postgres }
  resource st { for: Tickets, kind: state, use: primary }
  api SApi from Support
  deployable api { platform: java contexts: [Tickets] serves: SApi dataSources: [st] port: 8081 auth: required }
}`;
    const compose = (await filesFor(src)).get("docker-compose.yml")!;
    // Keycloak relocated to 8082; the Java backend keeps 8081.
    expect(compose).toContain('- "8082:8080"');
    expect(compose).toContain("KC_HOSTNAME: http://host.docker.internal:8082");
    expect(compose).toContain('OIDC_ISSUER: "http://host.docker.internal:8082/realms/helpdesk"');
    expect(compose).toContain('- "8081:8080"'); // java_api's own mapping
    // No host port is published by two services.
    const hostPorts = [...compose.matchAll(/- "(\d+):\d+"/g)].map((m) => m[1]);
    expect(new Set(hostPorts).size).toBe(hostPorts.length);
  });

  it("injects a declared literal audience into access tokens via a protocol mapper", async () => {
    // The generated verifiers VALIDATE the declared `audience:` (jose
    // `jwtVerify({ audience })`, .NET `ValidateAudience`) — Keycloak's
    // default `aud` is `account`, so without a mapper every token from the
    // bundled dev realm 401s (caught live by the parity 403 test).
    const files = await filesFor(
      system(
        `auth { provider: keycloak  oidc { issuer: env("OIDC_ISSUER")  clientId: env("OIDC_CLIENT_ID")  audience: "helpdesk-api" } }`,
      ),
    );
    const realm = JSON.parse(files.get("keycloak/realm.json")!) as {
      clients: { protocolMappers?: { protocolMapper: string; config: Record<string, string> }[] }[];
    };
    // Select the audience mapper by TYPE rather than by position/count: the
    // realm also carries one user-attribute mapper per declared `user { … }`
    // claim now (F-022), so `toHaveLength(1)` pinned an incidental total rather
    // than the property under test.
    const mappers = realm.clients[0]!.protocolMappers ?? [];
    const aud = mappers.filter((m) => m.protocolMapper === "oidc-audience-mapper");
    expect(aud).toHaveLength(1);
    expect(aud[0]!.config["included.custom.audience"]).toBe("helpdesk-api");
    expect(aud[0]!.config["access.token.claim"]).toBe("true");
  });

  it("emits no audience mapper when the auth block declares none", async () => {
    const files = await filesFor(system(KEYCLOAK));
    const realm = JSON.parse(files.get("keycloak/realm.json")!) as {
      clients: { protocolMappers?: { protocolMapper: string; name: string }[] }[];
    };
    const mappers = realm.clients[0]!.protocolMappers ?? [];
    expect(mappers.filter((m) => m.protocolMapper === "oidc-audience-mapper")).toEqual([]);
    // The claim mappers ARE expected here — this fixture declares
    // `user { id role }`, and `role` is a claim Keycloak mints only with one.
    expect(mappers.map((m) => m.name)).toEqual(["loom-claim-role"]);
  });

  // ---------------------------------------------------------------------------
  // F-022 — the dev realm could not exercise the authorization model the same
  // `.ddd` declares: one demo user, no attributes, no claim mappers.  So the
  // stack authenticated and then denied everything, silently.
  // ---------------------------------------------------------------------------

  it("emits NO mapper for a claim the IdP already provides", async () => {
    // The defect this pins cost four CI legs.  `auth-oidc-e2e.ddd` declares
    //
    //     user { id: string  roles: string[]  email: string }
    //     claims: { roles: "realm_access.roles", email: "email" }
    //
    // and `realm_access.roles` is KEYCLOAK'S OWN realm-role claim — the demo
    // user's `user` / `agent` roles, which the gated finds split on.  Emitting a
    // user-attribute mapper onto that path does not ADD the claim, it OVERWRITES
    // the real one with whatever attribute is seeded: the four native
    // `*-oidc-e2e` legs failed with `expected [ 'demo-roles' ] to include
    // 'agent'` — a synthetic seed standing where the IdP's own roles belong.
    //
    // An explicit `claims:` mapping means "the IdP already mints this, here is
    // where"; a mapper for it is by construction wrong.
    const files = await filesFor(`
system Helpdesk {
  user { id: string  roles: string[]  tenantId: string  email: string }
  auth {
    provider: keycloak
    oidc { issuer: env("I")  clientId: env("C") }
    claims: { roles: "realm_access.roles", email: "email" }
  }
  subdomain Support {
    context Tickets {
      aggregate Ticket with crudish { subject: string  derived display: string = subject }
      repository Tickets for Ticket { }
    }
  }
  storage p { type: postgres }
  resource r { for: Tickets, kind: state, use: p }
  api SApi from Support
  deployable api { platform: node contexts: [Tickets] dataSources: [r] serves: SApi auth: required port: 3000 }
}`);
    const realm = JSON.parse(files.get("keycloak/realm.json")!) as {
      clients: { protocolMappers?: { name: string; config: Record<string, string> }[] }[];
      users: { attributes?: Record<string, string[]> }[];
    };
    const mappers = realm.clients[0]!.protocolMappers ?? [];
    const claimNames = mappers.map((m) => m.config["claim.name"]);

    // The explicitly-mapped claim gets NO mapper and NO seeded attribute.
    expect(claimNames, "a mapper was emitted onto the IdP's own claim path").not.toContain(
      "realm_access.roles",
    );
    expect(mappers.map((m) => m.name)).not.toContain("loom-claim-roles");
    expect(realm.users[0]!.attributes ?? {}).not.toHaveProperty("roles");

    // …and no mapper writes into a NESTED path at all — a dotted claim
    // addresses a structure the IdP owns, however it was reached.
    expect(claimNames.filter((c) => c?.includes("."))).toEqual([]);

    // The unmapped claim still gets one: this must not become "emit nothing",
    // which is the original F-022 defect.
    expect(claimNames).toContain("tenantId");
  });

  it("emits a mapper + a seeded attribute for every declared claim", async () => {
    const files = await filesFor(`
system FieldOps {
  user { id: string  email: string  role: string  permissions: string[]  tenantId: string }
  auth { provider: keycloak  oidc { issuer: env("I")  clientId: env("C") } }
  subdomain Ops {
    permissions { workOrderWrite }
    context Work {
      aggregate Job with crudish { title: string  derived display: string = title }
      repository Jobs for Job { }
    }
  }
  storage p { type: postgres }
  resource r { for: Work, kind: state, use: p }
  api OpsApi from Ops
  deployable api { platform: node contexts: [Work] dataSources: [r] serves: OpsApi auth: required port: 3000 }
}`);
    const realm = JSON.parse(files.get("keycloak/realm.json")!) as {
      clients: { protocolMappers?: { name: string; config: Record<string, string> }[] }[];
      users: { attributes?: Record<string, string[]>; realmRoles?: string[] }[];
    };
    const byClaim = new Map(
      (realm.clients[0]!.protocolMappers ?? []).map((m) => [m.config["claim.name"], m.config]),
    );
    const attrs = realm.users[0]!.attributes ?? {};

    // `id` and `email` are Keycloak's to mint (`sub`, the built-in email
    // scope) — a mapper for those would be redundant at best.
    expect([...byClaim.keys()].sort()).toEqual(["permissions", "role", "tenantId"]);

    // An ARRAY claim must be multivalued, or Keycloak mints the list as a
    // single joined string and `permissions.contains(...)` never matches —
    // which looks exactly like a correct denial.
    expect(byClaim.get("permissions")!.multivalued).toBe("true");
    expect(byClaim.get("role")!.multivalued).toBeUndefined();

    // IDENTITY claims are seeded with stable synthetic values — a tenant id
    // that is the same on every boot is what makes tenant-scoped reads return
    // rows, which is the half of F-022 that made multi-tenancy undemonstrable.
    expect(attrs.tenantId).toEqual(["demo-tenant-id"]);

    // AUTHORITY claims are NOT seeded with the widest value the realm knows.
    // My first version of this fix seeded `permissions` with every declared
    // permission and `role` with `admin`, on the reasoning that a demo user
    // denied everything demonstrates nothing.  That made the shipped dev
    // principal a SUPERUSER, and the cross-backend runtime-authorization gate
    // caught it: showcase's `registerProject` guards on
    // `permissions.contains(manageProjects)`, the demo user held it, and
    // node/.NET/python answered 204 where that gate exists to prove 403.
    //
    // A seed that grants every permission cannot demonstrate DENIAL — the
    // property an authorization model exists to provide.  The demo user's
    // authority is now exactly what its realm roles give it.
    expect(attrs.permissions, "the demo user must not be seeded a permission").toBeUndefined();
    expect(attrs.role, "`admin` is not a role the demo user holds").toEqual(["user"]);
    expect(realm.users[0]!.realmRoles).not.toContain("admin");

    // …and the MAPPER is still emitted for the unseeded claim: an absent
    // mapper is the original F-022 defect (the claim never appears at all, so
    // a backend reading it sees `null` rather than an empty list).  Present
    // mapper + no grant is a clean denial; no mapper is a silent one.
    expect(byClaim.has("permissions")).toBe(true);
  });

  it("the realm names the same claim the backends read", async () => {
    // The realm and the verifiers are emitted by the same tool from the same
    // declaration; if they disagree on the claim NAME the mapper is inert and
    // the claim still decodes to null.  Derived from the emitted verifier, not
    // hard-coded, so the two halves cannot drift apart.
    const files = await filesFor(`
system FieldOps {
  user { id: string  technicianId: string }
  auth { provider: keycloak  oidc { issuer: env("I")  clientId: env("C") } }
  subdomain Ops {
    context Work {
      aggregate Job with crudish { title: string  derived display: string = title }
      repository Jobs for Job { }
    }
  }
  storage p { type: postgres }
  resource r { for: Work, kind: state, use: p }
  api OpsApi from Ops
  deployable api { platform: node contexts: [Work] dataSources: [r] serves: OpsApi auth: required port: 3000 }
}`);
    const verifier = files.get("api/auth/oidc.ts")!;
    const read = /technicianId: claim\(payload, "([^"]+)"\)/.exec(verifier);
    expect(read, `verifier does not read the claim:\n${verifier}`).not.toBeNull();

    const realm = JSON.parse(files.get("keycloak/realm.json")!) as {
      clients: { protocolMappers?: { config: Record<string, string> }[] }[];
    };
    const minted = (realm.clients[0]!.protocolMappers ?? []).map((m) => m.config["claim.name"]);
    expect(minted, "the realm mints a claim the verifier does not read").toContain(read![1]!);
  });

  it("does not bundle Keycloak for a hosted provider (google)", async () => {
    const files = await filesFor(
      system(`auth { provider: google  oidc { clientId: env("OIDC_CLIENT_ID") } }`),
    );
    expect(files.get("docker-compose.yml")!).not.toContain("keycloak:");
    expect(files.has("keycloak/realm.json")).toBe(false);
  });

  it("does not bundle Keycloak without an auth block", async () => {
    const files = await filesFor(system(""));
    expect(files.get("docker-compose.yml")!).not.toContain("keycloak:");
    expect(files.has("keycloak/realm.json")).toBe(false);
  });
  // ---------------------------------------------------------------------------
  // F-024 — the two halves of the login flow are emitted by the same tool and
  // disagreed with each other.  Both assertions below are derived from the
  // OTHER half rather than hard-coded, so they cannot drift back apart.
  // ---------------------------------------------------------------------------

  it("the realm grants every scope the emitted handshake asks for", async () => {
    const files = await filesFor(system(KEYCLOAK));
    const handshake = files.get("api/auth/handshake.ts");
    expect(handshake, "no handshake emitted").toBeDefined();

    // Read the scope list OUT OF THE EMITTED CODE.  Hard-coding
    // `["openid", "offline_access"]` here would pin today's string and say
    // nothing about the invariant: whatever the handshake asks for, the dev
    // realm has to grant.
    const m = /const SCOPES = "([^"]+)"/.exec(handshake!);
    expect(m, `handshake does not declare SCOPES:\n${handshake}`).not.toBeNull();
    const scopes = m![1]!.split(/\s+/).filter(Boolean);
    expect(scopes).toContain("openid");

    const realm = JSON.parse(files.get("keycloak/realm.json")!) as {
      roles: { realm: { name: string }[] };
      users: { realmRoles: string[] }[];
    };
    const declared = realm.roles.realm.map((r) => r.name);
    const granted = realm.users[0]!.realmRoles;

    // The OIDC standard scopes Keycloak serves from its BUILT-IN default client
    // scopes — they need no realm role, and the emitted handshake adds
    // `email`/`profile` whenever the `user { }` block declares those claims.
    // Anything outside this set, Keycloak gates on a realm role the import has
    // to declare AND grant.
    const STANDARD = new Set(["openid", "profile", "email", "address", "phone"]);
    const roleGated = scopes.filter((x) => !STANDARD.has(x));

    // Today that is exactly `offline_access` — the scope the handshake appends
    // unconditionally so `/refresh` has a token to rotate.  Without the role,
    // the FIRST login the tool's own compose stack can perform dies at token
    // exchange with
    //   CODE_TO_TOKEN_ERROR … "Offline tokens not allowed for the user or client"
    // which reaches the browser as {"error":"token_exchange_failed"} (F-024).
    for (const scope of roleGated) {
      expect(declared, `realm does not declare the '${scope}' role`).toContain(scope);
      expect(granted, `seeded demo user is not granted '${scope}'`).toContain(scope);
    }
    // Non-vacuity: an empty `roleGated` would make the loop above assert
    // nothing, which is how a check like this reads as a pass while covering
    // no scope at all.
    expect(roleGated, "no role-gated scope to check — the loop asserted nothing").toContain(
      "offline_access",
    );
  });

  it("post-login lands on the frontend, not the api root", async () => {
    const files = await filesFor(systemWithUi(KEYCLOAK));
    const compose = files.get("docker-compose.yml")!;
    // The callback runs on the API origin and the handshake's fallback is
    // `?? "/"`, so an unset value redirects a SUCCESSFUL login to the api root
    // — which answers 404.  The frontend's port is known at compose time: it is
    // the deployable that `targets:` this api.
    expect(compose).toContain('OIDC_POST_LOGIN_REDIRECT: "http://localhost:3007/"');
    // …and it must be the FRONTEND's port, not the api's.  Asserting only
    // "contains OIDC_POST_LOGIN_REDIRECT" would pass on the broken value.
    expect(compose).not.toContain('OIDC_POST_LOGIN_REDIRECT: "http://localhost:8080/"');
  });

  it("stays silent when no single frontend targets the api", async () => {
    // No ui at all — there is nothing better than the handshake's own default,
    // and inventing one would be a guess.  The absence is the honest answer.
    const files = await filesFor(system(KEYCLOAK));
    expect(files.get("docker-compose.yml")!).not.toContain("OIDC_POST_LOGIN_REDIRECT:");
  });
});

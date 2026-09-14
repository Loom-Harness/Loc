// `keycloak/realm.json` — the bundled dev IdP's realm import (D-AUTH-OIDC
// §4.2), mounted read-only into the compose `keycloak` service and loaded by
// its `--import-realm` on first boot.
//
// The job this file exists to do (finding F-016): the realm must mint a token
// the SAME RUN's verifier can actually read.  Every field of the system's
// `user { … }` block becomes a `claim(payload, "<path>")` read in the generated
// verifier, so every one of them needs a protocol mapper here, a seeded value
// on the demo user, and a realm user-profile policy that lets the value survive
// the import.  Get any of the three wrong and `docker compose up` yields a
// login that works and an application that cannot authorize anything: reads
// fail closed to empty, writes hit a NOT NULL tenant column.
//
// Previously only two mappers were ever emitted — an audience mapper, and a
// `role` mapper gated on an EXPLICIT `claims { }` entry.  A model that simply
// declares `user { id email role tenantId permissions: string[] }` (the common
// shape — no `claims` block, because the field names already match the claim
// names) got `protocolMappers: []` while its verifier read five claims.
//
// Three things were learned by booting Keycloak 26 against candidate realms,
// and all three are load-bearing:
//
//  1. An `oidc-usermodel-attribute-mapper` reads `user.attribute`, which covers
//     both real user attributes and the model properties Keycloak exposes under
//     the same names (`email`, `firstName`, `lastName`, `username`) — so ONE
//     mapper type serves every declared claim.
//  2. A `string[]` claim needs `multivalued: "true"`, or the array arrives as a
//     single joined string and `permissions.contains(…)` never matches.
//  3. Seeding user attributes WITHOUT the declarative user-profile policy below
//     does not merely drop them — it makes the demo user un-loginable:
//     Keycloak 26 disables unmanaged attributes by default, and the imported
//     user is then "not fully set up", so even the password grant fails with
//     `invalid_grant`.  The `components` block is what makes the attributes
//     both accepted and readable.

import type { AuthIR, FieldIR, SystemIR, TypeIR } from "../ir/types/loom-ir.js";

/** The tenant id the demo user's tenancy claim carries, when the system
 *  declares `tenancy by`.  A fixed, obviously-synthetic UUID rather than a
 *  slug: the tenancy claim is compared against the registry aggregate's id, and
 *  a `string` claim bound against a `guid` id is parsed at each backend's
 *  accessor site — a non-UUID value binds NULL and matches nothing, which is
 *  the very empty-read symptom this file exists to avoid.
 *
 *  It deliberately does NOT correspond to a pre-seeded registry row, and cannot:
 *  the registry table does not exist until the backend's migrations run, long
 *  after `db-init/` and the realm import, and a create mints its own id rather
 *  than accepting one.  `docs/tenancy.md`'s claim-less signup bootstrap is the
 *  supported way to make the matching row — every `tenantOwned` aggregate reads
 *  and writes correctly under this claim from the first request; only the
 *  registry's own self-scoped list is empty until a row is created. */
export const DEMO_TENANT_ID = "11111111-1111-4111-8111-111111111111";

/** Deterministic filler for a `guid`/`X id`-typed claim that is not the tenancy
 *  claim.  Same reasoning as {@link DEMO_TENANT_ID}: UUID-shaped so a typed
 *  backend can parse it. */
const DEMO_GUID = "22222222-2222-4222-8222-222222222222";

/** The IdP claim path a `user { }` field reads from — an explicit
 *  `claims { <field> from "<path>" }` mapping when the source declared one,
 *  else the field's own name, with `id` defaulting to the OIDC `sub`.
 *
 *  Must stay in step with the per-backend verifier emitters' own `claimPathFor`
 *  (`src/platform/hono/v4/auth-emit.ts` and siblings): the mapper emitted here
 *  is what fills the claim the verifier there reads, and a divergence is
 *  precisely the silent empty-claim bug. */
export function claimPathForField(field: string, auth: AuthIR): string {
  const mapped = auth.claims.find((c) => c.field === field);
  if (mapped) return mapped.path;
  return field === "id" ? "sub" : field;
}

/** Unwrap `optional` to the type underneath; arrays are left alone (their
 *  arrayness is what drives `multivalued`). */
function unwrapOptional(t: TypeIR): TypeIR {
  return t.kind === "optional" ? unwrapOptional(t.inner) : t;
}

/** Keycloak's `jsonType.label` for a claim — what the mapper coerces the stored
 *  string attribute to before putting it in the token.  Anything unrecognised
 *  stays `String`, which every backend's verifier can at least decode. */
function jsonTypeLabel(t: TypeIR): string {
  const inner = unwrapOptional(t);
  const scalar = inner.kind === "array" ? unwrapOptional(inner.element) : inner;
  if (scalar.kind !== "primitive") return "String";
  switch (scalar.name) {
    case "int":
      return "int";
    case "long":
      return "long";
    case "bool":
      return "boolean";
    default:
      return "String";
  }
}

/** A plausible demo value for one declared claim, as the string(s) Keycloak
 *  stores in the user attribute.  "Plausible" means the generated app can
 *  actually be exercised with it: the tenancy claim gets a parseable tenant id,
 *  a `role` claim gets `admin`, and a `permissions` array gets the system's
 *  whole declared catalogue, so every gate the model wrote is reachable from
 *  the shipped login instead of 403-ing out of the box. */
function demoAttributeValue(field: FieldIR, sys: SystemIR): string[] {
  const inner = unwrapOptional(field.type);
  const isArray = inner.kind === "array";
  const scalar = isArray ? unwrapOptional(inner.element) : inner;

  if (sys.tenancy?.claimField === field.name) return [DEMO_TENANT_ID];
  if (field.name === "email") return ["demo@example.com"];
  if (field.name === "role") return ["admin"];
  if (field.name === "permissions" && isArray) {
    const all = sys.subdomains.flatMap((s) => s.permissions.map((p) => p.runtimeString));
    // Deduplicated and ordered so the realm file is diff-stable across runs.
    const unique = [...new Set(all)].sort();
    return unique.length > 0 ? unique : ["demo"];
  }
  if (scalar.kind === "id") return [DEMO_GUID];
  if (scalar.kind === "primitive") {
    switch (scalar.name) {
      case "guid":
        return [DEMO_GUID];
      case "int":
      case "long":
        return ["1"];
      case "decimal":
        return ["1.0"];
      case "bool":
        return ["true"];
      default:
        return [`demo-${field.name}`];
    }
  }
  return [`demo-${field.name}`];
}

interface ProtocolMapper {
  name: string;
  protocol: string;
  protocolMapper: string;
  consentRequired: boolean;
  config: Record<string, string>;
}

/** One attribute mapper per declared `user { }` field, minus the ones Keycloak
 *  already puts in the token itself.
 *
 * `sub` is skipped: it is the token's subject, present unconditionally, and a
 *  mapper claiming that name would collide with it. */
function claimMappers(sys: SystemIR, auth: AuthIR): ProtocolMapper[] {
  const out: ProtocolMapper[] = [];
  for (const f of sys.user?.fields ?? []) {
    const path = claimPathForField(f.name, auth);
    if (path === "sub") continue;
    const multivalued = unwrapOptional(f.type).kind === "array";
    out.push({
      name: `loom-claim-${f.name}`,
      protocol: "openid-connect",
      protocolMapper: "oidc-usermodel-attribute-mapper",
      consentRequired: false,
      config: {
        "user.attribute": f.name,
        "claim.name": path,
        "jsonType.label": jsonTypeLabel(f.type),
        ...(multivalued ? { multivalued: "true" } : {}),
        // Both tokens: the access token is what the API verifier reads, the id
        // token what a browser-flow frontend decodes for its own session.
        "access.token.claim": "true",
        "id.token.claim": "true",
      },
    });
  }
  return out;
}

/** The declared claims as the demo user's stored attributes, so the mappers
 *  above have something to project. */
function demoAttributes(sys: SystemIR, auth: AuthIR): Record<string, string[]> {
  const attrs: Record<string, string[]> = {};
  for (const f of sys.user?.fields ?? []) {
    if (claimPathForField(f.name, auth) === "sub") continue;
    attrs[f.name] = demoAttributeValue(f, sys);
  }
  return attrs;
}

/**
 * The realm's declarative user profile, carrying
 * `unmanagedAttributePolicy: ENABLED`.
 *
 * This is the piece a hand-written realm most often misses, and its absence is
 * not a soft failure.  Keycloak 24+ validates user attributes against the user
 * profile; with unmanaged attributes disabled (the 26 default) an imported user
 * carrying attributes the profile does not declare is considered incompletely
 * set up, and EVERY login — including the direct password grant — is refused
 * with `invalid_grant: Account is not fully set up`.  Enabling the policy both
 * admits the seeded attributes and keeps the demo user loginable.
 *
 * `username` and `email` are declared explicitly because a declarative profile
 * replaces the built-in one wholesale; omitting them drops the two fields
 * Keycloak's own registration and account flows require.
 */
function userProfileComponents(): Record<string, unknown> {
  const profile = {
    attributes: [
      { name: "username", displayName: "${username}", permissions: { view: [], edit: ["admin"] } },
      { name: "email", displayName: "${email}", permissions: { view: [], edit: ["admin"] } },
    ],
    unmanagedAttributePolicy: "ENABLED",
  };
  return {
    "org.keycloak.userprofile.UserProfileProvider": [
      {
        providerId: "declarative-user-profile",
        subComponents: {},
        config: { "kc.user.profile.config": [JSON.stringify(profile)] },
      },
    ],
  };
}

/** Keycloak realm-import JSON: a public client carrying one protocol mapper per
 *  declared claim, a user-profile policy that admits them, and a seeded
 *  `demo`/`demo` user holding a plausible value for every one.  Mounted
 *  read-only into the container's import dir; `--import-realm` loads it on first
 *  boot. */
export function renderKeycloakRealm(
  sys: SystemIR,
  ids: { realm: string; clientId: string },
): string {
  const { realm, clientId } = ids;
  const auth = sys.auth;
  // When the auth block declares a literal `audience:`, the generated verifiers
  // VALIDATE it (jose `jwtVerify({ audience })`, .NET `ValidateAudience`, …) —
  // so the dev realm must mint tokens that carry it, or every
  // password-grant/redirect token 401s out of the box (Keycloak's default `aud`
  // is `account`).  An audience protocol mapper on the client injects the
  // declared value into access tokens.
  const audience = auth?.oidc.audience;
  const audienceMappers: ProtocolMapper[] =
    audience?.kind === "literal"
      ? [
          {
            name: "loom-declared-audience",
            protocol: "openid-connect",
            protocolMapper: "oidc-audience-mapper",
            consentRequired: false,
            config: {
              "included.custom.audience": audience.value,
              "access.token.claim": "true",
              "id.token.claim": "false",
            },
          },
        ]
      : [];
  const clientMappers = [...audienceMappers, ...(auth ? claimMappers(sys, auth) : [])];
  // Realm roles stay `[user, agent]` on the demo user.  A scalar `role` claim is
  // served by its own attribute mapper above (Keycloak emits realm roles as the
  // `realm_access.roles` ARRAY, which nothing projects onto a singular claim
  // path), so the two are independent: role-gated operations are exercisable
  // via the claim, while a gate written against `realm_access.roles` still sees
  // a non-admin principal.
  const doc = {
    realm,
    enabled: true,
    sslRequired: "none",
    roles: { realm: [{ name: "user" }, { name: "agent" }, { name: "admin" }] },
    ...(auth ? { components: userProfileComponents() } : {}),
    clients: [
      {
        clientId,
        enabled: true,
        publicClient: true,
        standardFlowEnabled: true,
        // Dev realm: allow the password grant so tokens can be scripted
        // (tests / curl) without driving the browser redirect flow.
        directAccessGrantsEnabled: true,
        redirectUris: ["http://localhost:*", "http://127.0.0.1:*"],
        webOrigins: ["*"],
        ...(clientMappers.length > 0 ? { protocolMappers: clientMappers } : {}),
      },
    ],
    users: [
      {
        username: "demo",
        enabled: true,
        email: "demo@example.com",
        firstName: "Demo",
        lastName: "User",
        emailVerified: true,
        // Explicitly empty: an imported user with a pending required action
        // cannot complete the password grant, and the failure reads as a bad
        // credential rather than an unfinished profile.
        requiredActions: [],
        credentials: [{ type: "password", value: "demo", temporary: false }],
        realmRoles: ["user", "agent"],
        ...(auth ? { attributes: demoAttributes(sys, auth) } : {}),
      },
    ],
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

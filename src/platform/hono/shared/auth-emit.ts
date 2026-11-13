import { audienceDeclared, audienceUnsetReason } from "../../../generator/_auth/audience.js";
import { bootRequiredAuthEnv } from "../../../generator/_auth/boot-required.js";
import { claimShapes, UUID_PATTERN } from "../../../generator/_auth/claim-decode.js";
import { claimEnumNames, claimsReferenceIds } from "../../../generator/_auth/claim-types.js";
import {
  DEV_AUTH_ENV,
  DEV_CLAIMS_HEADER,
  MALFORMED_DEV_CLAIMS_DETAIL,
} from "../../../generator/_auth/dev-claims.js";
import { devStubIdExpr } from "../../../generator/_auth/dev-stub-id.js";
import { renderHonoStoreLogCall } from "../../../generator/_obs/render-hono.js";
import { renderTsType } from "../../../generator/typescript/render-expr.js";
import { wireCode } from "../../../ir/enrich/wire-policy.js";
import type {
  AuthIR,
  AuthValueIR,
  FieldIR,
  SystemIR,
  TypeIR,
  UserIR,
} from "../../../ir/types/loom-ir.js";
import { type OrgContextPlan, orgContextPlan } from "../../../ir/util/org-context.js";
import { AUTH_BASE_PATH } from "../../../util/api-base.js";
import { lines } from "../../../util/code-builder.js";
import { ORG_CONTEXT_HEADER } from "../../../util/principal.js";
import {
  SECURE_TRANSPORT_ENV,
  SECURE_TRANSPORT_OFF_VALUES,
} from "../../../util/security-headers.js";
import { TEST_RESET_PATH } from "../../../util/test-reset.js";

// ---------------------------------------------------------------------------
// Hono-side auth scaffolding emitted per deployable when `auth: required`.
// Three small files always, two more under an OIDC `auth { … }` block:
//
//   auth/user-types.ts — strongly-typed User shape (matches the C#
//                        record one-for-one; cross-platform contract
//                        check verifies)
//   auth/verifier.ts   — registry + helper for the user-supplied
//                        verifier function
//   auth/middleware.ts — Hono middleware mounted in http/index.ts
//   auth/oidc.ts       — (OIDC only) the generated `jose`-backed token
//                        verifier filling the verifier seam (D-AUTH-OIDC)
//   auth/handshake.ts  — (OIDC only) the /auth/login|callback|logout
//                        redirect handlers
//
// Without an `auth { … }` block the user calls `registerUserVerifier(fn)`
// by hand (index.ts ships a permissive dev stub).  With one, the
// generated OIDC verifier is registered automatically.  The middleware
// bypass list mirrors the .NET side: /health, /ready, /metrics,
// /openapi.json, /swagger (plus /auth for the OIDC handshake).
// ---------------------------------------------------------------------------

export function emitAuthFiles(
  sys: SystemIR,
  out: Map<string, string>,
  hostedContextNames: readonly string[] = [],
): void {
  if (!sys.user) return;
  const oidc = sys.auth;
  // The tenancy claim field, when the system declares `tenancy by …`.
  const tenantClaim = sys.tenancy?.claimField;
  // The operating-scope facts (`organizationContext`): the switch gate is
  // emitted only when the system declares tenancy and something in it reads
  // the operating scope (a `tenantOwned` floor does).  Otherwise the header is
  // never consulted and the principal is exactly the declared claims.
  const plan = orgContextPlan(sys, hostedContextNames);
  out.set("auth/user-types.ts", renderUserTypes(sys.user, plan));
  out.set("auth/verifier.ts", renderVerifier());
  out.set("auth/middleware.ts", renderMiddleware(sys.user, !!oidc, tenantClaim, plan));
  // The session routes (always `/auth/me`, plus the OIDC redirect handshake
  // when an `auth { oidc }` block is present) are emitted whenever a
  // backend has auth — the frontend `auth: ui` guard probes `/auth/me`,
  // which works for both the OIDC verifier and the dev stub.
  out.set("auth/handshake.ts", renderHandshake(sys.user, oidc));
  if (oidc) out.set("auth/oidc.ts", renderOidcVerifier(sys.user, oidc));
  // The dev stub gets its own module for the same reason the OIDC verifier
  // does: anything that boots this project WITHOUT running `index.ts` — the
  // behavioural harness and the playground preview boot `createApp` directly —
  // must be able to register the SAME identity instead of hand-writing a copy
  // (a hand-written `{ id, tenantId }` copy that ignored the declared
  // `user { … }` shape is how a recorded `/api/auth/me` once carried a
  // principal no generated backend produces).
  //
  // Emitted under `auth { oidc }` as well, for the playground preview alone:
  // it runs this backend in a browser worker with no IdP reachable, so the
  // OIDC verifier cannot verify anything there and the preview registers the
  // stub instead.  `index.ts` registers ONLY the OIDC verifier in that case,
  // so the stub is inert in every real run — the compose stack's bundled dev
  // IdP is what local testing signs in with.
  out.set("auth/dev-stub.ts", renderDevStubVerifier(sys.user, !!oidc));
}

/** The permissive dev-stub verifier: accepts every request as a built-in
 *  identity filling every field the `user { … }` block declares, with an
 *  optional base64-JSON `x-loom-dev-claims` override merged over it. */
function renderDevStubVerifier(user: UserIR, oidc: boolean): string {
  const usage = oidc
    ? ` *  PREVIEW-ONLY under this system's \`auth { oidc }\` block: \`bootApp\` registers
 *  the OIDC verifier and calls this only under \`verifier: "dev-stub"\`, which
 *  \`index.ts\` never passes, so a running server ignores \`x-loom-dev-claims\`.
 *  The Loom playground preview passes it, because no identity provider is
 *  reachable from its browser worker.  Locally,
 *  sign in through the compose stack's bundled dev IdP.`
    : ` *  Dev-only: the Loom playground (or curl) can override the claims by sending a
 *  base64-encoded JSON object in \`x-loom-dev-claims\`; absent the header the
 *  built-in identity is used, and a header that is present but does not decode
 *  to a JSON object is refused with 400.
 *
 *  REPLACE for production by calling \`registerUserVerifier(...)\` with a real
 *  JWT-decoding implementation, or declare an \`auth { oidc { … } }\` block to
 *  get the generated OIDC verifier instead.`;
  return `// Auto-generated.
${idsImport(user).join("\n")}import type { UserClaims } from "./user-types";
import { registerUserVerifier } from "./verifier";

/** Register the DEV-STUB verifier.  \`enabled\` (\`bootApp\` passes it from
 *  ${DEV_AUTH_ENV}=1 or the host's \`verifier: "dev-stub"\`): accept every request
 *  as a built-in identity carrying one value per field the system's
 *  \`user { … }\` block declares, so \`/auth/me\` answers the full declared
 *  shape.  Not enabled: refuse every request.
 *
${usage} */
export function registerDevStubVerifier(enabled: boolean): void {
  registerUserVerifier((req) => {
    // Off: refuse every request (401), a forged dev-claims header included.
    if (!enabled) return null;
    const base = devStubClaims();
    const injected = req.headers.get("x-loom-dev-claims");
    if (!injected) return base;
    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(injected, "base64").toString("utf8"));
    } catch {
      throw new MalformedDevClaimsError();
    }
    // A present header that does not decode to a JSON OBJECT is refused (400,
    // see the auth middleware) rather than ignored: falling back to the
    // built-in identity let a test that meant to run as a narrow principal
    // run as this one instead.
    if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) {
      throw new MalformedDevClaimsError();
    }
    return { ...base, ...decoded };
  });
}

/** The built-in dev-stub identity: one value per declared \`user { … }\` field.
 *  Also the principal a context integration test runs as, with its
 *  \`as { … }\` claims spread over it.
 *
 *  ANNOTATED on purpose: the verifier spreads \`JSON.parse(...)\` over this, and
 *  that \`any\` would otherwise swallow the check of the literal entirely — a raw
 *  \`"0000…"\` string in a \`customerId: Ids.CustomerId\` slot passed
 *  \`tsc --noEmit\` that way.  The return type puts the declared claim shape back
 *  in the checker's way. */
export function devStubClaims(): UserClaims {
  return ${indentBy(renderStubUserLiteral(user), "  ")};
}

/** Thrown by the dev stub for a present-but-undecodable \`x-loom-dev-claims\`
 *  header; the auth middleware answers it 400, not 401. */
export class MalformedDevClaimsError extends Error {
  constructor() {
    super(${JSON.stringify(MALFORMED_DEV_CLAIMS_DETAIL)});
    this.name = "MalformedDevClaimsError";
  }
}
`;
}

/** Re-indent a multi-line literal's continuation lines under `pad`. */
function indentBy(s: string, pad: string): string {
  return s.split("\n").join(`\n${pad}`);
}

/** The principal's id key — the claim named `id`, else the first declared
 *  field.  Stamped onto the carrier as `actorId` (the who-computed slice
 *  audit / provenance read); only the id rides it, the full principal stays
 *  on `currentUser`. */
function actorIdField(user: UserIR): string | null {
  const field = user.fields.find((f) => f.name === "id") ?? user.fields[0];
  return field ? field.name : null;
}

/** Render an `AuthValueIR` (literal | env reference) as a TS expression. */
function authValueExpr(v: AuthValueIR | undefined, fallback = '""'): string {
  if (!v) return fallback;
  if (v.kind === "literal") return JSON.stringify(v.value);
  // Dot access when the env-var name is a valid identifier (biome's
  // useLiteralKeys prefers it); bracket otherwise.
  const access = /^[A-Za-z_$][\w$]*$/.test(v.env)
    ? `process.env.${v.env}`
    : `process.env[${JSON.stringify(v.env)}]`;
  return `${access} ?? ""`;
}

/** `process.env.<canonical var> ?? <declared>` — the deploy environment
 *  overrides the declared auth value (12-factor: the generated compose
 *  repoints OIDC_ISSUER / OIDC_CLIENT_ID at the bundled dev Keycloak, so a
 *  literal must not be baked un-overridably — with it baked, every token
 *  from the bundled IdP fails `iss` validation).  A declared env-kind value
 *  reading the same var stays a single read. */
function envOverridableExpr(envVar: string, v: AuthValueIR | undefined): string {
  if (v?.kind === "env" && v.env === envVar) return authValueExpr(v);
  return `process.env.${envVar} ?? ${authValueExpr(v)}`;
}

/** The `Ids` namespace import an auth module needs when the claim shape names
 *  a strong id (`customerId: Customer id?` renders as `Ids.CustomerId`).  The
 *  id classes live in `domain/ids.ts`, the auth modules in `auth/`, so without
 *  this the generated project fails `tsc` with
 *  `TS2503: Cannot find namespace 'Ids'` (D6/P2).  Empty when no claim is
 *  id-typed, so the common shape keeps its current byte-for-byte output. */
function idsImport(user: UserIR, ancestors = false): string[] {
  return claimsReferenceIds(user.fields) || ancestors
    ? ['import * as Ids from "../domain/ids";', ""]
    : [];
}

/** The enum types a claim shape names live in `domain/value-objects.ts`;
 *  `auth/user-types.ts` only spells them as types. */
function enumsImport(user: UserIR): string[] {
  const names = claimEnumNames(user.fields);
  if (names.length === 0) return [];
  return [`import type { ${names.join(", ")} } from "../domain/value-objects";`, ""];
}

function renderUserTypes(user: UserIR, plan: OrgContextPlan): string {
  const orgContext = plan.gate;
  // User shape lives in its own module so any per-aggregate file (or
  // workflow route) can `import type { User }` without
  // pulling the verifier registry alongside.
  const fields = user.fields.map((f) => {
    // FieldIR.optional is already encoded via the type when the source
    // wrote `T?`.  For simplicity we surface the raw declared type and
    // let renderTsType handle `optional` / `array`.
    const t = f.optional ? renderTsType({ kind: "optional", inner: f.type }) : renderTsType(f.type);
    return `  ${f.name}: ${t};`;
  });
  // `UserClaims` is the raw token→field projection the verifier returns; the
  // request principal `User` extends it with the derived, per-request
  // `operatingOrg` when the operating-scope switch gate is emitted.  The split
  // keeps the verifier free of the derived member (the token does not carry
  // it) while every domain-code `import { User }` sees it.
  // The system principal's two built-in slots (ruling D1): OPTIONAL, so a
  // request principal is built and serialized exactly as before (`/auth/me`
  // is unchanged) — only `systemPrincipal()` (auth/middleware.ts) sets them.
  const systemSlots = [
    "  /** `currentUser.isSystem` — true only on the system principal an event",
    "   *  reactor runs as; absent (false) on every request principal. */",
    "  isSystem?: boolean;",
    "  /** The originating user's id on the system principal — audit and logs",
    "   *  only, never read by a gate. */",
    "  causedBy?: string | null;",
  ];
  const userDecl = [
    "export interface User extends UserClaims {",
    ...systemSlots,
    ...(orgContext
      ? [
          "  /** The request's OPERATING org (`organizationContext.org`) — the",
          `   *  caller's home org (the tenancy claim), or the org a \`${ORG_CONTEXT_HEADER}\``,
          "   *  header names when the caller can read that registry row.  Set once,",
          "   *  by the auth middleware's fail-closed switch gate; never read off the token. */",
          "  operatingOrg: string;",
        ]
      : []),
    ...(plan.ancestors && user.registry
      ? [
          "  /** `organizationContext.ancestors` — the operating org and every org",
          "   *  above it on the registry tree, resolved once per request. */",
          `  operatingAncestors: ${renderTsType({ kind: "array", element: { kind: "id", targetName: user.registry } })};`,
        ]
      : []),
    "}",
  ];
  return (
    lines(
      "// Auto-generated.",
      "// User-claim shape decoded from the inbound JWT.  The verifier",
      "// hook (auth/verifier.ts) returns `UserClaims`; the auth middleware",
      "// derives the request principal `User` from it.  Downstream route",
      "// handlers / workflow handlers reference `User` via the magic",
      "// `currentUser` identifier.",
      ...idsImport(user, plan.ancestors),
      ...enumsImport(user),
      "export interface UserClaims {",
      ...fields,
      "}",
      "",
      ...userDecl,
    ) + "\n"
  );
}

function renderVerifier(): string {
  return `// Auto-generated.
import type { UserClaims } from "./user-types";

/** Verifier hook the user implements: decode the inbound request's
 *  JWT, return the populated claim shape on success, return null (or
 *  throw) to reject with a 401.  Register your implementation at app
 *  startup, BEFORE calling \`serve(...)\`.  The auth middleware derives
 *  the request principal (\`User\`) from the returned claims. */
export type UserVerifier = (req: Request) => Promise<UserClaims | null> | UserClaims | null;

let registered: UserVerifier | null = null;

/** Register the verifier.  Calling more than once overwrites. */
export function registerUserVerifier(fn: UserVerifier): void {
  registered = fn;
}

/** Internal — called by the middleware on every authenticated request. */
export async function verifyUserOrThrow(req: Request): Promise<UserClaims> {
  if (!registered) {
    throw new Error(
      "No user verifier is registered.  Call registerUserVerifier(...) " +
        "with a function that decodes the request's JWT into a User " +
        "before serving.",
    );
  }
  const result = await registered(req);
  if (result === null || result === undefined) {
    throw new Error("unauthorized");
  }
  return result;
}

/** Verify the verifier was registered.  The HTTP composer calls this
 *  at startup so a missing registration surfaces as a clear error
 *  instead of a 401 storm on the first request. */
export function assertUserVerifierRegistered(): void {
  if (!registered) {
    throw new Error(
      "No user verifier is registered.  Call registerUserVerifier(...) " +
        "with a JWT-decoding function before booting the HTTP server.",
    );
  }
}
`;
}

function renderMiddleware(
  user: UserIR,
  oidc: boolean,
  tenantClaim: string | undefined,
  plan: OrgContextPlan,
): string {
  const orgContext = plan.gate;
  const host = !!plan.registry;
  const ancestors = plan.ancestors;
  const idField = actorIdField(user);
  const stampActorId = idField ? `\n  if (ctx) ctx.actorId = String(user.${idField});` : "";
  // The caller's home org: the tenancy claim value, "" when absent.  Read only
  // by the operating-scope switch gate.
  const homeOrgExpr = tenantClaim ? `String(claims.${tenantClaim} ?? "")` : `""`;
  // A declared NON-OPTIONAL array claim absent from the token is the EMPTY SET,
  // not `undefined`.  The verifier projects claims with a bare cast
  // (`permissions: claim(payload, "permissions") as string[]`), so a token that
  // simply omits the claim — routine: an IdP emits `permissions` only for users
  // who have any — produced a principal whose declared `string[]` field was
  // undefined.  Everything that consumes it calls a method on it (`mask unless
  // currentUser.permissions.contains(…)` → `.includes(…)`, the same for a
  // `requires` gate or a policy), so the read answered **500** instead of
  // redacting: the fail-OPEN-shaped crash of the one feature whose failure is a
  // data leak.  Normalising here covers every verifier — the OIDC one, the dev
  // stub, and any hand-written registration — because it is the single place
  // the request principal is built.  Found by field-mask's first runtime
  // caller.
  const arrayClaimDefaults = user.fields
    .filter((f) => !f.optional && f.type.kind === "array")
    .map((f) => `${f.name}: claims.${f.name} ?? []`);
  const claimsSpread =
    arrayClaimDefaults.length > 0 ? `...claims, ${arrayClaimDefaults.join(", ")}` : "...claims";
  // The operating-scope switch gate runs BEFORE the principal is attached: a
  // refused switch answers 403 before any handler — and no write — runs.  The
  // admission check reads the registry under the HOME principal (the caller's
  // own read scope), so it is bound to the ambient frame first.
  const ancestorsSlot = ancestors ? ", operatingAncestors: [] " : " ";
  const buildUser = orgContext
    ? [
        `const homeOrg = ${homeOrgExpr};`,
        `  const requestedOrgContext = c.req.header("${ORG_CONTEXT_HEADER}");`,
        `  const homeUser: User = { ${claimsSpread}, operatingOrg: homeOrg${ancestorsSlot}};`,
        "  const frame = requestContext();",
        "  if (frame) frame.currentUser = homeUser;",
        "  const operatingOrg = await orgContextFor(homeOrg, requestedOrgContext);",
        '  if (operatingOrg === null) return orgContextForbidden(c, requestedOrgContext ?? "", homeOrg);',
        ancestors
          ? "  const user: User = { ...homeUser, operatingOrg, operatingAncestors: await operatingAncestorsOf(operatingOrg) };"
          : "  const user: User = { ...homeUser, operatingOrg };",
      ].join("\n")
    : arrayClaimDefaults.length > 0
      ? `const user: User = { ${claimsSpread} };`
      : `const user: User = claims;`;
  // The same derivation for a principal built OUTSIDE a request (a context
  // integration test): no header, so the operating org is the home org.
  const buildPrincipal = orgContext
    ? `const user: User = { ${claimsSpread}, operatingOrg: ${homeOrgExpr}${ancestorsSlot}};${
        ancestors
          ? "\n  user.operatingAncestors = await operatingAncestorsOf(user.operatingOrg);"
          : ""
      }`
    : arrayClaimDefaults.length > 0
      ? `const user: User = { ${claimsSpread} };`
      : `const user: User = claims;`;
  // The operating-scope switch gate (`organizationContext`).  A request-level
  // fact: the `x-org-context` header names the org the request operates
  // in.  Absent (or empty) ⇒ the caller's home org (the tenancy claim).
  // Present ⇒ admitted when it names the home org, or — on the deployable
  // that hosts the registry — a registry row the caller can read through the
  // registry's own read scope.  Refused outright when the principal has no
  // home org.  Refusal is a pre-body 403, logged through the neutral catalog
  // (`org_context_denied`).
  const registrySeam = host
    ? `
/** The registry reads the switch gate needs, bound to the database at boot
 *  (boot.ts).  \`canRead\` loads the requested registry row through the
 *  registry's read scope under the ambient (home) principal; \`ancestors\` walks
 *  \`parent\` upward with set semantics, so it terminates on a cycle. */
export interface OrgRegistry {
  canRead(org: string): Promise<boolean>;
  ancestors(org: string): Promise<string[]>;
}

let orgRegistry: OrgRegistry | null = null;

/** Bind the registry reads (boot.ts).  Unbound, only the home org is admitted
 *  and the ancestor set is empty — fail-closed. */
export function registerOrgRegistry(registry: OrgRegistry): void {
  orgRegistry = registry;
}
${
  ancestors
    ? `
/** \`organizationContext.ancestors\` for \`org\` — the org and every org above
 *  it.  Called once per request; the principal carries the result. */
async function operatingAncestorsOf(org: string): Promise<User["operatingAncestors"]> {
  if (orgRegistry === null || org === "") return [];
  return (await orgRegistry.ancestors(org)) as User["operatingAncestors"];
}
`
    : ""
}`
    : "";
  const orgContextSeam = orgContext
    ? `${registrySeam}
/** The request's operating org (\`organizationContext.org\`): the caller's
 *  home org when none is requested or the request names it, ${
   host
     ? "the requested org when the caller can read that registry row,"
     : "no other org (this deployable does not host the registry),"
}
 *  and \`null\` (refuse) otherwise — fail-closed. */
async function orgContextFor(homeOrg: string, requested: string | undefined): Promise<string | null> {
  if (requested === undefined || requested === "") return homeOrg;
  if (homeOrg === "") return null;
  if (requested === homeOrg) return requested;
  ${host ? "return orgRegistry !== null && (await orgRegistry.canRead(requested)) ? requested : null;" : "return null;"}
}

/** RFC 7807 403 for a refused operating-scope switch — answered before the
 *  principal is attached, so no handler runs and nothing is written. */
function orgContextForbidden(c: Context, requested: string, homeOrg: string) {
  ${renderHonoStoreLogCall("orgContextDenied", 'org_context: requested, reason: homeOrg === "" ? "no_principal_scope" : "outside_scope", status: 403')}
  return c.body(
    JSON.stringify({
      type: "about:blank",
      title: "Forbidden",
      status: 403,
      detail: "the requested organization context is outside the caller's organization scope",
      instance: c.req.path,
      code: ${JSON.stringify(wireCode("forbidden"))},
    }),
    403,
    { "content-type": "application/problem+json" },
  );
}
`
    : "";
  // Only the handshake's redirect endpoints bypass auth — they must be
  // reachable without a verified principal.  `/metrics` is on the list for
  // the same reason `/health` and `/ready` are, and because the compose stack
  // this generator ALSO emits scrapes it: `monitoring/prometheus.yml` carries
  // no credentials, so a gated `/metrics` made the two generated halves
  // disagree — every scrape 401'd (finding F-022).  `/api/auth/me` (the session probe
  // the frontend guard reads) is deliberately NOT bypassed, so the
  // middleware populates `currentUser` or rejects with 401.
  //
  // The dev-only state reset (`src/util/test-reset.ts`) is bypassed for the
  // same reason as the probes: it is infra, not domain surface, and an
  // auth-bearing system's e2e suite would otherwise have to mint a principal
  // just to empty a table.  Bypassing the middleware is not bypassing
  // authentication: the route is registered only with an explicit
  // LOOM_TEST_RESET=1 AND a LOOM_TEST_RESET_TOKEN, and refuses (403) any
  // request whose `x-loom-test-reset` header does not match that secret.
  // Ruling D6 (#23): the dev stub refuses a present-but-undecodable
  // `x-loom-dev-claims` header; this is the 400 it answers with.  Not emitted
  // under OIDC — there is no dev stub to throw it.
  const malformedDevClaimsFn = `
/** RFC 7807 400 for a present-but-undecodable \`${DEV_CLAIMS_HEADER}\` header
 *  (dev stub only).  Refused rather than ignored: ignoring it ran the request
 *  as the built-in identity, so a test meant for a narrow principal could pass
 *  as the broad one. */
function malformedDevClaims(c: Context, detail: string) {
  return c.body(
    JSON.stringify({
      type: "about:blank",
      title: "Bad Request",
      status: 400,
      detail,
      instance: c.req.path,
      code: ${JSON.stringify(wireCode("malformed-body"))},
    }),
    400,
    { "content-type": "application/problem+json" },
  );
}
`;
  const bypass = oidc
    ? `["/health", "/ready", "/metrics", "/openapi.json", "/swagger", "${TEST_RESET_PATH}", "${AUTH_BASE_PATH}/login", "${AUTH_BASE_PATH}/callback", "${AUTH_BASE_PATH}/logout", "${AUTH_BASE_PATH}/refresh"]`
    : `["/health", "/ready", "/metrics", "/openapi.json", "/swagger", "${TEST_RESET_PATH}"]`;
  return `// Auto-generated.
import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { matchedRoutes } from "hono/route";
import { ${orgContext ? "requestContext, requestContextStore, requestLog" : "requestContext, requestContextStore"} } from "../obs/als";
import { baseLogger } from "../obs/log";
${oidc ? "" : 'import { MalformedDevClaimsError } from "./dev-stub";\n'}import type { User, UserClaims } from "./user-types";
import { verifyUserOrThrow } from "./verifier";

const BYPASS_PREFIXES = ${bypass} as const;

${orgContextSeam}
/** Whether a ROUTE (not just middleware) answers this request, read off the
 *  router's own match for it — the exact match the dispatcher runs, so the
 *  gate and the handler can never disagree about which route a spelling of
 *  the path reaches.  Middleware registers under \`ALL\`, which matches every
 *  path; a handler route carries its verb.
 *
 *  The RFC puts ROUTING before authentication.  §15.5.4 names 404 as the code
 *  for an origin server that wishes to hide a resource's existence — 404 is the
 *  sanctioned concealment tool, not 401 — and §15.5.2 defines 401 as missing
 *  credentials FOR THE TARGET RESOURCE, which invites a retry that can never
 *  succeed when there is no such resource.  So a path nothing serves falls
 *  through to the 404 handler rather than being challenged.
 *
 *  Keyed on (METHOD, path), because that is what a router resolves: a wrong
 *  VERB on a path that exists is a ROUTING outcome, answered by the 405
 *  handler ahead of authentication.  Disclosing the served methods to an
 *  anonymous caller is consistent with answering 404 honestly for an unknown
 *  path: concealment has its own sanctioned tool (§15.5.4) and this API does
 *  not use it. */
function routeMatched(c: Context): boolean {
  return matchedRoutes(c).some((r) => r.method !== "ALL");
}

/** Hono middleware that decodes the request's JWT into a User, attaches it
 *  to the ambient RequestContext (the one source of truth, readable by
 *  non-HTTP code via \`requireCurrentUser()\`), and also stashes it on the
 *  Hono request scope under "currentUser" for HTTP-layer reads.  Bypass
 *  list matches the .NET side — framework endpoints stay anonymous so
 *  smoke tests + the OpenAPI cross-check don't need tokens. */
/** RFC 7807 for a request that carried no valid credentials — the same envelope
 *  every other error on this API sends, rather than
 *  \`{"error":"unauthorized"}\` — a shape appearing nowhere else.
 *
 *  \`WWW-Authenticate\` is not decoration: RFC 9110 §15.5.2 makes it a MUST on
 *  every 401 ("at least one challenge applicable to the target resource"), and
 *  it is what tells a client HOW to authenticate rather than merely that it
 *  failed.  The challenge is the RFC 6750 §3 bearer form. */
function unauthorized(c: Context) {
  const detail = \`no valid credentials for \${c.req.method} \${c.req.path}\`;
  return c.body(
    JSON.stringify({
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
      detail,
      instance: c.req.path,
      code: ${JSON.stringify(wireCode("unauthenticated"))},
    }),
    401,
    {
      "content-type": "application/problem+json",
      "www-authenticate": 'Bearer realm="api", error="invalid_token"',
    },
  );
}
${oidc ? "" : malformedDevClaimsFn}
export const authMiddleware = createMiddleware<{
  Variables: { currentUser: User };
}>(async (c, next) => {
  // \`c.req.path\` is the path the router dispatched on (percent-decoded);
  // the raw pathname is how the client spelled it.  A bypass prefix matches
  // only its canonical spelling — an encoded spelling of one is gated like
  // any other route.
  const path = c.req.path;
  if (path === new URL(c.req.url).pathname) {
    for (const prefix of BYPASS_PREFIXES) {
      if (path.startsWith(prefix)) {
        await next();
        return;
      }
    }
  }
  if (!routeMatched(c)) {
    await next();
    return;
  }
  let claims: UserClaims;
  try {
    claims = await verifyUserOrThrow(c.req.raw);
  } catch${oidc ? "" : " (err)"} {
${oidc ? "" : "    if (err instanceof MalformedDevClaimsError) return malformedDevClaims(c, err.message);\n"}    return unauthorized(c);
  }
  ${buildUser}
  // Attach the principal to the ambient frame (read by non-HTTP code via
  // requireCurrentUser) and to the Hono context (read by route handlers
  // that hold \`c\`).
  const ctx = requestContext();
  if (ctx) ctx.currentUser = user;${stampActorId}
  c.set("currentUser", user);
  await next();
});

/** The verified principal for the current request, read from the ambient
 *  RequestContext — the analogue of .NET's ICurrentUserAccessor.User.
 *  Throws when no principal is bound, so anonymous / bypassed paths must
 *  not call it. */
export function requireCurrentUser(): User {
  const user = requestContext()?.currentUser;
  if (user == null) {
    throw new Error(
      "currentUser is not available — ensure authMiddleware ran for this route.",
    );
  }
  return user as User;
}

/** Run \`fn\` in a fresh ambient frame whose principal is built from \`claims\`
 *  exactly as the middleware builds a request's — the seam a context
 *  integration test binds its principal through, so every
 *  \`requireCurrentUser()\` reader under it (tenant stamps, scope filters,
 *  gates) sees that principal. */
export async function runAsUser<T>(claims: UserClaims, fn: () => Promise<T>): Promise<T> {
  ${buildPrincipal}
  return requestContextStore.run(
    {
      correlationId: randomUUID(),
      currentUser: user,
      actorId: ${idField ? `String(user.${idField})` : "null"},
      locale: "en",
      startedAt: Date.now(),
      scopeId: randomUUID(),
      parentId: null,
      traceId: "",
      spanId: "",
      log: baseLogger,
    },
    fn,
  );
}

/** Rebind the principal of the CURRENT ambient frame (opened by
 *  \`runAsUser\`) — a test body's \`as { … }\` line, after which every
 *  ambient-principal reader sees the new principal. */
export async function actAsUser(claims: UserClaims): Promise<void> {
  ${buildPrincipal}
  const ctx = requestContext();
  if (ctx == null) throw new Error("actAsUser needs an ambient frame — call it inside runAsUser.");
  ctx.currentUser = user;${
    idField
      ? `
  ctx.actorId = String(user.${idField});`
      : ""
  }
}
${renderSystemPrincipal(user, tenantClaim, plan)}`;
}

/** `systemPrincipal()` — the principal an event reactor runs as (ruling D1,
 *  `docs/decisions.md` D-REACTOR-SYSTEM-PRINCIPAL).  Every claim is EMPTY (so
 *  a claims gate cannot pass by accident — the dev stub's `"admin"` strings
 *  are deliberately not reused), `isSystem` is true, the tenant claim (and the
 *  operating org, when the switch gate is emitted) is the triggering event's
 *  tenant (read off the dispatching request's principal — the event was raised
 *  inside it), and `causedBy` is
 *  that request's user id (or its own `causedBy` when the dispatcher is itself
 *  a reactor).  With no dispatching principal (a timer tick) the tenant is
 *  empty, which matches no tenant-owned row. */
function renderSystemPrincipal(
  user: UserIR,
  tenantClaim: string | undefined,
  plan: OrgContextPlan,
): string {
  const orgContext = plan.gate;
  const ancestors = plan.ancestors;
  const idField = actorIdField(user);
  const entries = user.fields.map((f) => {
    const v =
      f.name === tenantClaim
        ? `(origin?.tenant ?? "") as unknown as UserClaims["${f.name}"]`
        : systemValueFor(f);
    return `    ${snakeToCamel(f.name)}: ${v},`;
  });
  const tenantSlots = [
    ...(orgContext ? ['    operatingOrg: origin?.tenant ?? "",'] : []),
    // A reactor reading the ancestors is refused at phase ⑦
    // (`loom.org-context-ancestors-in-reactor`): the system principal has none.
    ...(ancestors ? ["    operatingAncestors: [],"] : []),
  ];
  // The event's tenant is the OPERATING org of the raising request: a reactor
  // runs in the org the triggering write happened in, switched or not.
  const tenantOf = orgContext
    ? `user.operatingOrg === "" ? null : user.operatingOrg`
    : tenantClaim
      ? `user.${tenantClaim} == null || String(user.${tenantClaim}) === "" ? null : String(user.${tenantClaim})`
      : "null";
  const causedByOf = idField
    ? `user.isSystem ? (user.causedBy ?? null) : String(user.${idField})`
    : "user.causedBy ?? null";
  return lines(
    "",
    "/** Where an event came from (ruling D1): the raising principal's tenant",
    " *  claim and the originating user id (`causedBy`, audit only).  Captured",
    " *  onto the outbox row and the channel envelope (`tenantid` /",
    " *  `loomcausedby`) so a reactor that runs",
    " *  after the request is gone — on the outbox relay, or in another",
    " *  deployable — still runs as the system principal OF THAT TENANT. */",
    "export interface EventOrigin {",
    "  tenant: string | null;",
    "  causedBy: string | null;",
    "}",
    "",
    "/** The ambient frame's event origin — null outside any principal (a timer",
    " *  tick, boot).  A system principal propagates its own origin, so an event",
    " *  a reactor raises keeps the first user as `causedBy`. */",
    "export function currentEventOrigin(): EventOrigin | null {",
    "  const user = (requestContext()?.currentUser ?? null) as User | null;",
    "  if (user === null) return null;",
    "  return {",
    `    tenant: ${tenantOf},`,
    `    causedBy: ${causedByOf},`,
    "  };",
    "}",
    "",
    "/** The system principal for an event origin: no claims, `isSystem`, the",
    " *  origin's tenant, `causedBy` for audit.  Gates are evaluated against it",
    " *  normally — a gate that admits it says `currentUser.isSystem || …`.  No",
    " *  origin (a timer tick) ⇒ an empty tenant, which matches no tenant-owned",
    " *  row. */",
    "export function systemPrincipalFor(origin: EventOrigin | null): User {",
    "  return {",
    ...entries,
    ...tenantSlots,
    "    isSystem: true,",
    "    causedBy: origin?.causedBy ?? null,",
    "  };",
    "}",
    "",
    "/** The system principal an event reactor binds `currentUser` to — built",
    " *  from the dispatching frame's origin: the request that raised the event",
    " *  in-process, or the frame `runAsEventOrigin` opened for a relayed or",
    " *  broker-consumed one. */",
    "export function systemPrincipal(): User {",
    "  return systemPrincipalFor(currentEventOrigin());",
    "}",
    "",
    "/** Run `fn` in a fresh ambient frame whose principal is the system",
    " *  principal of `origin`.  The outbox relay and the channel consumer open",
    " *  one per delivered event, so the reactor (and every ambient-principal",
    " *  reader under it) sees the triggering event's tenant.  No origin ⇒ `fn`",
    " *  runs as before: no frame, tenant-less, fail-closed. */",
    "export function runAsEventOrigin<T>(",
    "  origin: EventOrigin | null | undefined,",
    "  fn: () => Promise<T>,",
    "): Promise<T> {",
    "  if (origin == null) return fn();",
    "  return requestContextStore.run(",
    "    {",
    "      correlationId: randomUUID(),",
    "      currentUser: systemPrincipalFor(origin),",
    "      actorId: origin.causedBy,",
    '      locale: "en",',
    "      startedAt: Date.now(),",
    "      scopeId: randomUUID(),",
    "      parentId: null,",
    '      traceId: "",',
    '      spanId: "",',
    "      log: baseLogger,",
    "    },",
    "    fn,",
    "  );",
    "}",
    "",
    "/** Run `fn` with the event origin of a tenant-owned ROW: the outbox capture,",
    " *  the channel envelope and a tenant-scoped fold read the ambient origin, so",
    " *  an event raised on a row of another org (a write share) is recorded and",
    " *  dispatched in the row tenant's frame.  Same tenant: the request's own. */",
    "export function runInRowTenant<T>(tenant: unknown, fn: () => Promise<T>): Promise<T> {",
    "  const origin = currentEventOrigin();",
    "  if (tenant == null || (origin?.tenant ?? null) === String(tenant)) return fn();",
    "  return runAsEventOrigin({ tenant: String(tenant), causedBy: origin?.causedBy ?? null }, fn);",
    "}",
  );
}

/** The EMPTY value of one claim on the system principal: the zero of its
 *  type, never a value a gate would read as a grant. */
function systemValueFor(f: FieldIR): string {
  if (f.optional) return "null";
  const t = f.type;
  if (t.kind === "primitive" && t.name === "string") return `""`;
  // An id claim is a branded string: the empty id, cast to the claim's own
  // type — `middleware.ts` has no `Ids` import, and the dev stub's zero GUID
  // would be a real-looking id rather than "no claim".
  if (t.kind === "id") return `"" as UserClaims["${snakeToCamel(f.name)}"]`;
  if (t.kind === "enum") return noEnumClaim(f);
  return stubValueForType(t);
}

// ---------------------------------------------------------------------------
// OIDC verifier (D-AUTH-OIDC) — the batteries-included fill-in for the
// verifier seam.  Validates the bearer token's signature against the
// issuer's JWKS (discovered lazily), checks `iss` / `exp` (and `aud` only
// when the model declares `auth { oidc { audience: … } }` — see the
// conditional below), and
// projects the configured claims onto the typed User shape.  Loom owns no
// auth runtime beyond "validate a token"; the IdP owns everything else.
// ---------------------------------------------------------------------------

function renderOidcVerifier(user: UserIR, auth: AuthIR): string {
  const bootRequired = bootRequiredAuthEnv(auth);
  // Deploy env overrides the declared value — see envOverridableExpr (the
  // 401-from-the-bundled-IdP failure mode caught live by the parity 403 test).
  const issuerExpr = envOverridableExpr("OIDC_ISSUER", auth.oidc.issuer);
  // Audience is ALWAYS env-reachable, declared or not (CR1-b / P0-4).  The
  // other four backends read OIDC_AUDIENCE even with no `audience:` in the
  // `.ddd`, so node used to be the one deployment where an operator could set
  // OIDC_AUDIENCE in compose and get no `aud` check, no error, no log line —
  // the same model shipping enforceable isolation on four backends and an
  // unenforceable one on the fifth.  `envOverridableExpr` already collapses
  // both cases: declared → `process.env.OIDC_AUDIENCE ?? "<declared>"`,
  // undeclared → `process.env.OIDC_AUDIENCE ?? ""`.  An EMPTY value skips the
  // `aud` check only when nothing is declared; under a declared `audience:` it
  // rejects every token (see `_auth/audience.ts`).
  const declared = audienceDeclared(auth);
  const audienceConst = `\nconst AUDIENCE = ${envOverridableExpr("OIDC_AUDIENCE", auth.oidc.audience)};`;
  // The doc comment must describe the options actually emitted above — a
  // comment asserting a control the file does not implement is worse than no
  // comment, and reading the generated source is how an engineer audits this.
  // The "not verified" wording is deliberately the thing a reviewer greps for.
  //
  // COMPOSED with the honesty fix that landed on main while this branch was
  // open (both sides answered the same finding; neither alone is right now).
  // That fix split the doc on `auth.oidc.audience` — a COMPILE-time question —
  // because when it was written an undeclared audience meant the check could
  // not be turned on at all.  CR1-b made it a RUNTIME one: `AUDIENCE` is now
  // always emitted, so an undeclared audience is off *by default* rather than
  // off *by construction*, and the remedy is no longer only "edit the .ddd".
  // Keeping main's two arms verbatim would now state something false on the
  // undeclared arm — it would send an operator to the `.ddd` when setting
  // OIDC_AUDIENCE in the deploy env is enough.
  const verifierDoc = auth.oidc.audience
    ? `/** Generated OIDC verifier — validates signature (JWKS), issuer and
 *  audience, then maps claims onto User.  Returns null to reject (→ 401).
 *
 *  \`audience:\` is declared, so the \`aud\` check is always ON —
 *  \`OIDC_AUDIENCE\` replaces the declared value, and an audience that
 *  resolves EMPTY rejects every token (fail closed), it never skips the check. */`
    : `/** Generated OIDC verifier — validates signature (JWKS) and issuer, then
 *  maps claims onto User.  Returns null to reject (→ 401).
 *
 *  The \`aud\` claim is NOT verified BY DEFAULT: this system's
 *  \`auth { oidc { … } }\` block declares no \`audience:\`, so unless the deploy
 *  env sets one, any token this issuer minted is accepted here — including one
 *  issued to a DIFFERENT client of the same realm, carrying that client's
 *  roles.  Where one IdP realm serves several applications (the shape the
 *  generated Keycloak realm sets up), turn the check on EITHER by setting
 *  \`OIDC_AUDIENCE\` in this service's environment — no regeneration needed,
 *  \`AUDIENCE\` above already reads it — or by declaring
 *  \`audience: env("OIDC_AUDIENCE")\` in the \`oidc { … }\` block. */`;
  // One `field: <read> as <T>` line per user field.
  //
  // `claim()` answers `undefined` for a claim the token does not carry, and a
  // bare cast would let that `undefined` sit in a `T | null` slot that every
  // gate reads with `!== null` — so an absent optional claim folds onto `null`.
  // An identifier claim (`guid`, `X id`) is also checked against its wire
  // format (`claimShapes`): a malformed optional one is `null` too, and a list
  // drops its malformed elements.  A REQUIRED scalar claim that is absent or
  // malformed does not describe a principal the model declares, so the verifier
  // rejects the token (→ 401).  A required ARRAY claim stays out of that check:
  // an IdP omits an empty list routinely, and the middleware reads it as `[]`.
  const shapes = claimShapes(user.fields, auth);
  const formatted = shapes.some((s) => s.format !== null);
  const toUserLines = shapes.map(({ field: f, path, optional, list, format }) => {
    const t = f.optional ? renderTsType({ kind: "optional", inner: f.type }) : renderTsType(f.type);
    const raw = `claim(payload, ${JSON.stringify(path)})`;
    if (format !== null && list) {
      const read = `claimList(${raw}, ${JSON.stringify(format)})`;
      return optional
        ? `    ${f.name}: (${raw} == null ? null : ${read}) as ${t},`
        : `    ${f.name}: ${read} as ${t},`;
    }
    const read = format !== null ? `claimAs(${raw}, ${JSON.stringify(format)})` : raw;
    return optional
      ? `    ${f.name}: (${read} ?? null) as ${t},`
      : `    ${f.name}: ${read} as ${t},`;
  });
  const requiredClaims = shapes
    .filter((s) => !s.optional && !s.list)
    .map(
      (s) =>
        `[${JSON.stringify(s.path)}, ${s.format === null ? "null" : JSON.stringify(s.format)}]`,
    );
  const formatHelpers = formatted
    ? `
const CLAIM_FORMATS = {
  uuid: /${UUID_PATTERN}/,
} as const;
type ClaimFormat = keyof typeof CLAIM_FORMATS;

/** A claim value in its declared wire format (a UUID for a guid id), or null
 *  when it is absent or does not match. */
function claimAs(value: unknown, format: ClaimFormat): string | null {
  return typeof value === "string" && CLAIM_FORMATS[format].test(value) ? value : null;
}

/** A list claim with its malformed elements dropped; not a list → empty. */
function claimList(value: unknown, format: ClaimFormat): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => claimAs(v, format)).filter((v): v is string => v !== null);
}
`
    : "";
  const requiredType = formatted
    ? "readonly (readonly [string, ClaimFormat | null])[]"
    : "readonly (readonly [string, null])[]";
  const requiredCheck = formatted
    ? "(format === null ? claim(payload, path) : claimAs(claim(payload, path), format)) == null"
    : "claim(payload, path) == null";
  return `// Auto-generated.
import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";
${idsImport(user).join("\n")}import { requestLog } from "../obs/als";${bootRequired.length > 0 ? `\nimport { baseLogger } from "../obs/log";` : ""}
import type { UserClaims } from "./user-types";
import { registerUserVerifier } from "./verifier";

// Resolved from the system \`auth { oidc { … } }\` block.  Env-bound values
// read process.env at boot; an empty issuer fails loudly at first verify.
const ISSUER = ${issuerExpr};${audienceConst}
${
  bootRequired.length > 0
    ? `
// The model binds these settings to env(…), so there is no fallback: refuse to
// boot without them rather than answer every request with a 401.
const REQUIRED_AUTH_ENV: readonly (readonly [string, readonly string[]])[] = ${JSON.stringify(bootRequired.map((r) => [r.setting, r.vars]))};
for (const [setting, vars] of REQUIRED_AUTH_ENV) {
  if (!vars.some((v) => process.env[v])) {
    baseLogger.error({ event: "config_missing", setting, vars: vars.join(", ") });
    process.exit(1);
  }
}
`
    : ""
}
${
  declared
    ? `// The model declares an audience, so \`aud\` is always validated: a token minted
// for a DIFFERENT client of the same issuer is rejected, and an EMPTY AUDIENCE
// (OIDC_AUDIENCE unset or "") rejects every token rather than skip the check.
const VERIFY_OPTIONS = { issuer: ISSUER, audience: AUDIENCE };`
    : `// \`aud\` is validated only when an audience is actually configured — an empty
// AUDIENCE (nothing declared and OIDC_AUDIENCE unset, or an explicit
// OIDC_AUDIENCE="") skips the check, which is the documented opt-out.  With one
// set, a token minted for a DIFFERENT client of the same issuer is rejected.
const VERIFY_OPTIONS = AUDIENCE ? { issuer: ISSUER, audience: AUDIENCE } : { issuer: ISSUER };`
}

// Lazily discover the issuer's JWKS endpoint via the OIDC discovery
// document, then cache a remote JWK set (jose refreshes + caches keys).
// Only a SUCCESSFUL discovery is cached: a failed fetch resets the slot so
// the next request retries — caching the rejected promise would poison
// every later verify with a permanent 401 (e.g. one request racing the
// IdP's boot/realm import; caught live by the parity 403 test).
let jwksPromise: Promise<ReturnType<typeof createRemoteJWKSet>> | null = null;
async function getJwks(): Promise<ReturnType<typeof createRemoteJWKSet>> {
  if (!jwksPromise) {
    jwksPromise = (async () => {
      const base = ISSUER.replace(/\\/$/, "");
      const res = await fetch(\`\${base}/.well-known/openid-configuration\`);
      if (!res.ok) throw new Error(\`OIDC discovery failed: \${res.status}\`);
      const doc = (await res.json()) as { jwks_uri: string };
      return createRemoteJWKSet(new URL(doc.jwks_uri));
    })();
    jwksPromise.catch(() => {
      jwksPromise = null;
    });
  }
  return jwksPromise;
}

/** The token from the \`Authorization: Bearer\` header, or the HttpOnly
 *  \`session\` cookie /auth/callback issues (the browser flow).  Null when
 *  neither is present.
 *
 *  The cookie arm is not a convenience: the browser NEVER sees the raw token
 *  (it is HttpOnly), so a same-origin fetch and — crucially — the realtime SSE
 *  stream can only present the cookie.  \`EventSource\` cannot set a header by
 *  construction, so a header-only verifier 401s every generated SPA's realtime
 *  connection.  The other four backends already read this cookie; the rule is
 *  stated once in the shared realtime plan (RULE 2,
 *  src/ir/util/realtime-rooms.ts). */
function bearer(req: Request): string | null {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  const match = header ? /^Bearer\\s+(.+)$/i.exec(header) : null;
  if (match) return match[1]!;
  const cookies = req.headers.get("cookie");
  if (!cookies) return null;
  for (const pair of cookies.split(";")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    if (pair.slice(0, eq).trim() !== "session") continue;
    const value = decodeURIComponent(pair.slice(eq + 1).trim());
    return value.length > 0 ? value : null;
  }
  return null;
}

/** Read a dotted claim path (e.g. \`realm_access.roles\`) off a payload. */
function claim(payload: JWTPayload, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc !== null && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, payload);
}

${formatHelpers}
/** The claim path (and wire format, for an identifier claim) of every REQUIRED
 *  scalar field — a verified token where one is absent or malformed does not
 *  describe a principal, so it is rejected (→ 401). */
const REQUIRED_CLAIMS: ${requiredType} = [${requiredClaims.join(", ")}];

/** Project verified claims onto the typed claim shape, or null when a required
 *  claim is absent or malformed.  An absent OPTIONAL claim is \`null\`, never
 *  \`undefined\`: gates compare with \`!== null\`, which \`undefined\` would
 *  pass.  The auth middleware derives the request principal from this. */
function toUser(payload: JWTPayload): UserClaims | null {
  if (REQUIRED_CLAIMS.some(([path, format]) => ${requiredCheck})) return null;
  return {
${toUserLines.join("\n")}
  };
}

${verifierDoc}
export const oidcVerifier = async (req: Request): Promise<UserClaims | null> => {
  const token = bearer(req);
  if (!token) return null;${
    declared
      ? `
  // A declared audience that resolves empty fails closed: jose skips the
  // \`aud\` check for an empty \`audience\` option, so refuse here instead.
  if (!AUDIENCE) {
    ${renderHonoStoreLogCall("authTokenRejected", `reason: ${JSON.stringify(audienceUnsetReason(auth))}`)}
    return null;
  }`
      : ""
  }
  try {
    const { payload } = await jwtVerify(token, await getJwks(), VERIFY_OPTIONS);
    return toUser(payload);
  } catch (err) {
    // A rejected token is a 401, never a 500 — but say WHY at debug, so a
    // misconfigured issuer / audience is diagnosable from the log stream.
    ${renderHonoStoreLogCall("authTokenRejected", "reason: err instanceof Error ? err.message : String(err)")}
    return null;
  }
};

/** Register the generated verifier.  Called from index.ts at boot,
 *  BEFORE \`serve(...)\`.  Override by registering your own afterwards. */
export function registerOidcVerifier(): void {
  registerUserVerifier(oidcVerifier);
}
`;
}

// ---------------------------------------------------------------------------
// OIDC redirect handshake (D-AUTH-OIDC) — /auth/login starts the
// authorization-code flow, /auth/callback exchanges the code and issues a
// local session cookie, /auth/logout clears it.  No login form: the IdP
// hosts the credential pages.
// ---------------------------------------------------------------------------

function renderHandshake(user: UserIR, auth?: AuthIR): string {
  // `/auth/me` (the session probe the frontend guard reads) is always
  // emitted when a backend has auth — it works for both the OIDC verifier
  // and the dev stub.  The OIDC redirect handshake (login/callback/logout)
  // is added only when an `auth { oidc }` block is present; the dev-stub
  // path (e.g. the in-browser playground, where no IdP is reachable) has
  // no IdP to redirect to.
  // The DECLARED `user { … }` shape, by declared name — nothing else.  The
  // principal object also carries server-side members (the derived
  // `operatingOrg`, the system principal's slots) that are not part of the
  // contract.  The projection is the same rule the dev-stub identity follows —
  // the declared shape is the contract, and a derived member is not part of it.
  // Field names are grammar identifiers, so dot access + a bare key keep the
  // emitted object Biome-clean (useLiteralKeys / complexity.useLiteralKeys).
  const meProjection = user.fields
    .map((f) => `      ${f.name}: user.${f.name} ?? null,`)
    .join("\n");
  const meRoute = `  // Session probe for the frontend guard — NOT bypassed, so the auth
  // middleware has already verified the principal (or returned 401) by
  // the time this runs.  Answers the declared \`user { … }\` shape as plain
  // JSON — a per-request derived member (operatingOrg) is server-side scoping
  // state, not part of the declared principal.
  app.get("/me", (c) => {
    const user = (c as unknown as { get(k: "currentUser"): Record<string, unknown> | undefined }).get(
      "currentUser",
    );
    if (!user) return c.json(null);
    return c.json({
${meProjection}
    });
  });`;

  if (!auth) {
    return `// Auto-generated.
import { Hono } from "hono";

/** Auth session routes.  Mounted at "/auth" by createApp. */
export function authRoutes(): Hono {
  const app = new Hono();

${meRoute}

  return app;
}
`;
  }

  // Env override first (12-factor) — same contract as the verifier's ISSUER:
  // the generated compose repoints OIDC_ISSUER at the bundled dev Keycloak.
  const issuerExpr = envOverridableExpr("OIDC_ISSUER", auth.oidc.issuer);
  const clientIdExpr = envOverridableExpr("OIDC_CLIENT_ID", auth.oidc.clientId);
  // A client secret is only present for confidential clients; omit the
  // const + the token-request line entirely for public (PKCE-less) ones
  // so the generated code carries no always-falsy constant.
  const hasSecret = !!auth.oidc.clientSecret;
  const clientSecretConst = hasSecret
    ? `const CLIENT_SECRET = ${authValueExpr(auth.oidc.clientSecret)};\n`
    : "";
  const secretBodyLine = hasSecret ? '\n    body.set("client_secret", CLIENT_SECRET);' : "";
  const refreshSecretLine = hasSecret ? '\n    body.set("client_secret", CLIENT_SECRET);' : "";
  const scopes = (auth.oidc.scopes.length ? auth.oidc.scopes : ["openid"]).join(" ");
  // `offline_access` asks the IdP for a refresh token; add it (idempotently)
  // so the /refresh rotation below has something to rotate.  Confidential and
  // public clients both benefit — refresh rotation is the "session depth"
  // this handshake was missing (M-T3.5).
  const scopeList = scopes.split(/\s+/).filter(Boolean);
  if (!scopeList.includes("offline_access")) scopeList.push("offline_access");
  const finalScopes = scopeList.join(" ");
  return `// Auto-generated.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

const ISSUER = ${issuerExpr};
const CLIENT_ID = ${clientIdExpr};
${clientSecretConst}const SCOPES = ${JSON.stringify(finalScopes)};
const REDIRECT_URI = process.env.OIDC_REDIRECT_URI ?? "http://localhost:3000${AUTH_BASE_PATH}/callback";
const POST_LOGIN = process.env.OIDC_POST_LOGIN_REDIRECT ?? "/";

// HttpOnly cookie options shared by the session + refresh + transient PKCE
// cookies.  SameSite=Lax so the IdP's cross-site redirect back to /callback
// still carries them.  Secure unless ${SECURE_TRANSPORT_ENV} is off (the local
// compose stack serves plain http), so the tokens never ride cleartext in a
// TLS deployment.
const SECURE_TRANSPORT = ![${SECURE_TRANSPORT_OFF_VALUES.map((v) => JSON.stringify(v)).join(", ")}].includes(
  (process.env.${SECURE_TRANSPORT_ENV} ?? "").trim().toLowerCase(),
);
const COOKIE = { httpOnly: true, secure: SECURE_TRANSPORT, sameSite: "Lax", path: "/" } as const;

interface Endpoints {
  authorization_endpoint: string;
  token_endpoint: string;
}

let discoPromise: Promise<Endpoints> | null = null;
async function disco(): Promise<Endpoints> {
  if (!discoPromise) {
    discoPromise = (async () => {
      const base = ISSUER.replace(/\\/$/, "");
      const res = await fetch(\`\${base}/.well-known/openid-configuration\`);
      if (!res.ok) throw new Error(\`OIDC discovery failed: \${res.status}\`);
      return (await res.json()) as Endpoints;
    })();
  }
  return discoPromise;
}

/** Base64url with no padding — the encoding PKCE (RFC 7636) mandates for the
 *  verifier and the challenge. */
function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
}

/** The tokens an authorization-code / refresh exchange returns.  \`refresh_token\`
 *  is present only when the IdP grants one (the \`offline_access\` scope). */
interface TokenResponse {
  access_token: string;
  refresh_token?: string;
}

/** Persist the access token as the browser session and the refresh token (when
 *  present) for the /refresh rotation.  Both are HttpOnly — the SPA never sees
 *  the raw tokens, it only rides the session cookie as a Bearer. */
function storeTokens(c: Context, tokens: TokenResponse): void {
  setCookie(c, "session", tokens.access_token, COOKIE);
  if (tokens.refresh_token) setCookie(c, "refresh", tokens.refresh_token, COOKIE);
}

/** The /auth/* redirect handshake + session probe.  Mounted at "/auth"
 *  by createApp. */
export function authRoutes(): Hono {
  const app = new Hono();

  // Start the authorization-code flow — redirect to the IdP's login page.
  // PKCE (RFC 7636): mint a per-login code verifier, send only its SHA-256
  // challenge to the IdP, and stash the verifier in an HttpOnly cookie so the
  // /callback exchange can prove possession.  Unconditional (OAuth 2.1 makes
  // PKCE mandatory) — it costs nothing for confidential clients and closes the
  // authorization-code-interception hole for public ones.
  app.get("/login", async (c) => {
    const { authorization_endpoint } = await disco();
    const state = randomUUID();
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash("sha256").update(verifier).digest());
    setCookie(c, "oidc_state", state, COOKIE);
    setCookie(c, "oidc_verifier", verifier, COOKIE);
    const url = new URL(authorization_endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", CLIENT_ID);
    url.searchParams.set("redirect_uri", REDIRECT_URI);
    url.searchParams.set("scope", SCOPES);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return c.redirect(url.toString());
  });

  // Exchange the code for tokens and issue the local session.
  app.get("/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const verifier = getCookie(c, "oidc_verifier");
    if (!code || !state || state !== getCookie(c, "oidc_state") || !verifier) {
      return c.json({ error: "invalid_state" }, 400);
    }
    const { token_endpoint } = await disco();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    });${secretBodyLine}
    const res = await fetch(token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) return c.json({ error: "token_exchange_failed" }, 401);
    const tokens = (await res.json()) as TokenResponse;
    // Session: stash the access token in an HttpOnly cookie; the SPA
    // forwards it as a Bearer that auth/oidc.ts verifies.  The refresh
    // token (when granted) rides its own HttpOnly cookie for /refresh.
    storeTokens(c, tokens);
    deleteCookie(c, "oidc_state", { path: "/" });
    deleteCookie(c, "oidc_verifier", { path: "/" });
    return c.redirect(POST_LOGIN);
  });

  // Silent renewal — exchange the stored refresh token for a fresh access
  // token WITHOUT another IdP round-trip, and ROTATE the refresh token (the
  // IdP hands back a new one; storeTokens overwrites the cookie so a stolen
  // token is single-use).  The SPA calls this on a 401 to extend the session.
  // Bypassed by the auth middleware — the caller has no valid access token yet.
  app.post("/refresh", async (c) => {
    const refresh = getCookie(c, "refresh");
    if (!refresh) return c.json({ error: "no_refresh_token" }, 401);
    const { token_endpoint } = await disco();
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: CLIENT_ID,
    });${refreshSecretLine}
    const res = await fetch(token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      // The refresh token is spent or revoked — clear both cookies so the
      // SPA falls back to a full /login rather than looping on a dead token.
      deleteCookie(c, "session", { path: "/" });
      deleteCookie(c, "refresh", { path: "/" });
      return c.json({ error: "refresh_failed" }, 401);
    }
    const tokens = (await res.json()) as TokenResponse;
    storeTokens(c, tokens);
    return c.json({ ok: true });
  });

  // Clear the local session.  The IdP's own session is ended at its
  // end-session endpoint, which the SPA can link to directly.
  app.get("/logout", (c) => {
    deleteCookie(c, "session", { path: "/" });
    deleteCookie(c, "refresh", { path: "/" });
    return c.redirect(POST_LOGIN);
  });

${meRoute}

  return app;
}
`;
}

/** Build a TS object literal matching the system's `user {}` shape, with
 *  sensible defaults per primitive type — used as the body of the dev-stub
 *  user verifier so a generated app boots without the caller having to wire
 *  a JWT decoder. */
function renderStubUserLiteral(userShape: UserIR): string {
  const entries = userShape.fields.map((f) => `  ${snakeToCamel(f.name)}: ${stubValueFor(f)}`);
  return `{\n${entries.join(",\n")},\n}`;
}

/** "No claim" for an enum-typed field: the declared type has no null member,
 *  so the null is cast to the claim's own type.  A gate comparing the claim to
 *  an enum value never matches it. */
function noEnumClaim(f: FieldIR): string {
  return `null as unknown as UserClaims["${snakeToCamel(f.name)}"]`;
}

function stubValueFor(f: FieldIR): string {
  if (f.optional) return "null";
  if (f.type.kind === "enum") return noEnumClaim(f);
  return stubValueForType(f.type);
}

function stubValueForType(t: TypeIR): string {
  switch (t.kind) {
    case "primitive":
      switch (t.name) {
        case "string":
          return `"admin"`;
        case "int":
        case "long":
          return "0";
        case "decimal":
        case "money":
          return `"0"`;
        case "bool":
          return "false";
        case "datetime":
          return `new Date(0)`;
        case "date":
          return `"1970-01-01"`;
        case "guid":
          return `"00000000-0000-0000-0000-000000000000"`;
        default:
          return `""`;
      }
    // The id is a BRANDED string (`domain/ids.ts`), so a raw literal is
    // `TS2322: Type 'string' is not assignable to type 'CustomerId'` — it must
    // go through the emitted factory.
    case "id":
      return devStubIdExpr(t, "ts");
    case "array":
      return "[]";
    default:
      return "null";
  }
}

function snakeToCamel(name: string): string {
  return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

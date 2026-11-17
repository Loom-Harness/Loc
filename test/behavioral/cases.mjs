// Shared behavioural case assembly — the ONE place that decides WHICH sources a
// backend runner boots.  Replaces the per-backend `corpus-*.json` allowlists and
// forked `.ddd`s: every runner derives its cases from the SAME two sources of
// truth, token-swapped to its platform:
//
//   1. featureCases  — the typed corpus manifest (test/fixtures/corpus): every
//      feature that declares the runner's backend AND carries a behavioural
//      block (`test e2e` / `test`).
//   2. sharedSystemCases — the tokenized broad systems under systems/*.ddd
//      (e.g. sales), run on every backend.
//
// A case is `{ name, source, locales }`; `source` has `__PLATFORM__` already
// swapped and `locales` is the translator tree beside the `.ddd` (the rule texts
// of a migrated model — see case-source.mjs), or undefined.

import { build } from "esbuild";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { localesBeside } from "./case-source.mjs";
// The pure registers live in a dependency-free module so the fast suite can
// read them without test/behavioral/node_modules (see registers.mjs).
import { ADAPTER_ONLY_CASES, BEHAVIOURAL_SKIP, BEHAVIOURAL_XFAIL, declaresE2e, hasBehaviouralBlock, mountsFileRoutes } from "./registers.mjs";

export { BEHAVIOURAL_SKIP, declaresE2e, hasBehaviouralBlock, mountsFileRoutes };

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

/** Parse a JUnit-XML report string into `{ tier: "unit", name, status, error }`
 *  rows — the shared shape every runner's unit tier returns.  Passing cases
 *  self-close (`<testcase … />`); a failure/error nests a `<failure>`/`<error>`
 *  child.  Emitted by pytest (`--junitxml`) and gradle (`build/test-results`). */
export function parseJUnitXml(xml) {
  const results = [];
  const re = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const name = /\bname="([^"]*)"/.exec(m[1])?.[1] ?? "(unknown)";
    const inner = m[2] ?? "";
    const failed = /<(?:failure|error)\b/.test(inner);
    const failMsg = /<(?:failure|error)\b[^>]*\bmessage="([^"]*)"/.exec(inner)?.[1];
    results.push({ tier: "unit", name, status: failed ? "fail" : "pass", error: failed ? (failMsg ?? "assertion failed") : undefined });
  }
  return results;
}

/** Parse a VS Test `.trx` report (`dotnet test --logger trx`) into the same
 *  `{ tier: "unit", name, status, error }` rows.  TRX carries one
 *  `<UnitTestResult testName="…" outcome="Passed|Failed">` per test; a failure
 *  nests `<Output><ErrorInfo><Message>…`. */
export function parseTrx(xml) {
  const results = [];
  const re = /<UnitTestResult\b([^>]*?)(?:\/>|>([\s\S]*?)<\/UnitTestResult>)/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const name = /\btestName="([^"]*)"/.exec(m[1])?.[1] ?? "(unknown)";
    const outcome = /\boutcome="([^"]*)"/.exec(m[1])?.[1] ?? "";
    const failed = outcome !== "Passed";
    const msg = /<Message>([\s\S]*?)<\/Message>/.exec(m[2] ?? "")?.[1]?.trim();
    results.push({ tier: "unit", name, status: failed ? "fail" : "pass", error: failed ? (msg ?? outcome) : undefined });
  }
  return results;
}
const CORPUS_DIR = join(REPO, "test/fixtures/corpus");
const SYSTEMS_DIR = join(HERE, "systems");

/** Load the typed corpus manifest via a one-shot esbuild bundle — the same
 *  single source of truth the generation and compile tiers iterate. */
export async function loadCorpusFeatures(workDir) {
  mkdirSync(workDir, { recursive: true });
  const bundled = join(workDir, "_manifest.mjs");
  await build({
    entryPoints: [join(CORPUS_DIR, "manifest.ts")],
    outfile: bundled,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
  });
  // The bundle lives in workDir, so the manifest cannot find its sidecars
  // from its own URL; it reads the corpus dir from here instead.
  process.env.LOOM_CORPUS_DIR = CORPUS_DIR;
  const { CORPUS } = await import(pathToFileURL(bundled).href);
  return CORPUS;
}

/** Corpus-feature cases for one backend: every manifest feature that declares
 *  `backendKey` and carries a behavioural block, source-swapped to
 *  `platformClause` (e.g. key "vanilla" → clause "elixir") — plus every case
 *  `leg` boots as a tracked expected failure (`BEHAVIOURAL_XFAIL`), declared or
 *  not. */
export async function featureCases(backendKey, platformClause, workDir, leg) {
  const cases = [];
  const skip = BEHAVIOURAL_SKIP[platformClause] ?? {};
  // Armed on this ADAPTER's leg beyond the manifest's backend set (registers.mjs).
  const armed = ADAPTER_ONLY_CASES[platformClause] ?? {};
  const xfail = BEHAVIOURAL_XFAIL[leg] ?? {};
  if (!(leg in BEHAVIOURAL_XFAIL)) throw new Error(`featureCases: unknown runner leg ${JSON.stringify(leg)}`);
  for (const f of await loadCorpusFeatures(workDir)) {
    if (!f.backends.includes(backendKey) && !(f.id in armed) && !(f.id in xfail)) continue;
    if (f.id in skip) continue; // known runtime gap on this backend — see the bug register
    const raw = readFileSync(join(CORPUS_DIR, `${f.id}.ddd`), "utf8");
    if (!hasBehaviouralBlock(raw)) continue;
    cases.push({
      name: f.id,
      source: raw.replaceAll("__PLATFORM__", platformClause),
      locales: localesBeside(join(CORPUS_DIR, `${f.id}.ddd`)),
    });
  }
  return cases;
}

/** The canonical dev-stub principal every behavioural runner authenticates as.
 *  Injected via `E2E_DEV_CLAIMS` → the emitted `__authHeaders` base64-encodes it
 *  into the `x-dev-claims` header that each backend's dev-stub auth verifier
 *  merges over its built-in identity (the exact mechanism tenancy-e2e uses).
 *  Claim TYPES: `string` and `string[]` are carried on all five backends (the
 *  shared `devClaimKind` classifier — the four non-node stubs used to filter to
 *  strings alone and silently drop an array, which is why `lifecycle-guard` sat
 *  in `E2E_LESS_CORPUS_FIXTURES`).  Anything else still keeps its built-in stub
 *  value, so keep this to those two shapes, keyed by the declared `user` field
 *  name.  Inert for auth-less systems
 *  (no middleware reads it).  Fixtures in the tenancy/auth cluster assert against
 *  THIS principal — an in-tenant row uses `tenantId: "acme"`, an out-of-tenant
 *  row any other value; a `requires currentUser.role == "agent"` op is satisfied.
 *  `orgId` carries the same value under a second name, for the fixture whose
 *  tenancy claim is deliberately NOT called `tenantId` (tenancy-claim-name):
 *  each backend maps only the claims its own `user { … }` block declares, so an
 *  extra key is inert everywhere else. */
export const DEV_CLAIMS = JSON.stringify({
  tenantId: "acme",
  orgId: "acme",
  role: "agent",
  // `lifecycle-guard`'s gates read `currentUser.permissions.contains(...)`.
  // The value is the lowered runtime string for `permissions { manage }` under
  // `subdomain Ops` — `<subdomain lowercased>.<name>` (`lower.ts`), NOT the
  // source spelling.  Inert on every fixture that declares no `permissions`
  // field, since each backend maps only its own declared claims.
  permissions: ["ops.manage"],
});

/** The SECOND dev-stub principal: **authenticated but not authorized** (M-T9.28).
 *
 *  Until this existed the behavioural tier had exactly ONE identity, so the only
 *  authz arm it could assert was "the gate lets the satisfying principal
 *  through" — a gate emitted as a no-op passes that just as well.  Three
 *  consumers are on record as blocked on the gap: M-T9.28's authz-surface
 *  census, M-T9.25 round 2's 401/403 problem-arm sweep, and M-T9.11's 4xx wire
 *  goldens.
 *
 *  Same SHAPE as `DEV_CLAIMS` — same tenancy claims, so a probe with it stays
 *  inside the tenant and the only thing that differs is the authorization
 *  predicate — but `role` is deliberately a value no fixture's `requires`
 *  accepts.  Keep it that way: a fixture that starts granting `"visitor"`
 *  silently turns every 403 arm into a 2xx and the ladder stops proving
 *  anything.  Strings and string LISTS only, for the same reason `DEV_CLAIMS`
 *  is — see the claim-type note there.
 *
 *  The OIDC twin is `oidc.unauthorizedToken` (oidc-mock.mjs) — same issuer, same
 *  signing key, `realm_access.roles` set to the same non-granting value. */
export const DEV_CLAIMS_UNAUTHORIZED = JSON.stringify({
  tenantId: "acme",
  orgId: "acme",
  role: "visitor",
  // Present but GRANTING NOTHING — the array twin of `role: "visitor"`.  An
  // absent key would also deny, but it would deny by having no claim at all;
  // this denies through the predicate itself, which is what the 403 arm is
  // supposed to prove.  Never add a permission a fixture's `requires` accepts.
  permissions: ["ops.none"],
});

/** The THIRD dev-stub principal: **authenticated, authorized, and in a
 *  DIFFERENT TENANT** (wave-3 row 3.3 / M-T9.13).
 *
 *  Why a third one is needed at all.  `DEV_CLAIMS_UNAUTHORIZED` is a PERMISSION
 *  second identity, not a TENANCY one — it deliberately shares `tenantId:
 *  "acme"` so that the only thing separating it from the authorized principal
 *  is the authorization predicate.  That isolation is right for the 403 arm and
 *  useless for a tenancy statement: with one tenant in play the behavioural tier
 *  can prove "denied by predicate" but NOT "row hidden because it belongs to
 *  another tenant", which is what every scope-filter cell actually claims.  A
 *  tenancy filter emitted as a no-op passes the existing ladder unharmed.
 *
 *  So this principal inverts the isolation: `role` and `permissions` are the
 *  GRANTING values, byte-identical to `DEV_CLAIMS`, and the tenancy claims are
 *  the only difference.  A refusal under it is therefore attributable to the
 *  scope filter alone — an authorization denial would have shown up on this
 *  principal's granting claims too.
 *
 *  Keep `tenantId` and `orgId` in step (the second name is for
 *  `tenancy-claim-name`, whose claim is deliberately not called `tenantId`) and
 *  keep the value different from `DEV_CLAIMS`'s.  A fixture that starts seeding
 *  rows under THIS tenant turns every hidden-row arm into a visible-row arm and
 *  the rung stops proving anything. */
export const DEV_CLAIMS_OTHER_TENANT = JSON.stringify({
  tenantId: "globex",
  orgId: "globex",
  // Identical to `DEV_CLAIMS` ON PURPOSE — see the note above.  If a refusal
  // under this principal could also be explained by a failing `requires`, the
  // arm would not isolate the tenancy filter.
  role: "agent",
  permissions: ["ops.manage"],
});

/** The cross-tenant credential for one case, in that system's auth flavour —
 *  the twin of `unauthorizedCredentials`, and the ONE place all five runner legs
 *  derive it.
 *
 *  dev-stub: the same `x-dev-claims` channel, carrying the other tenant's
 *  granting claims.
 *
 *  OIDC: `null`, and that is a real limitation rather than an oversight.  The
 *  emitted OIDC verifier's `toUser` projects `sub` / `realm_access.roles` /
 *  `email` / `permissions` — there is no tenancy claim in the mock issuer's
 *  token at all, so a second token would differ from the first in nothing a
 *  scope filter reads.  Minting one anyway would produce an arm that passes
 *  because both principals are in the same (absent) tenant, which is exactly
 *  the false green this rung exists to prevent.  `null` makes the ladder report
 *  the rung as SKIPPED — unavailable, not green.  Giving OIDC a tenancy claim
 *  is its own piece of work (the verifier projection, not the harness). */
export function otherTenantCredentials(authMode) {
  if (authMode === "devstub") {
    return { "x-dev-claims": Buffer.from(DEV_CLAIMS_OTHER_TENANT).toString("base64") };
  }
  return null;
}

/** The authenticated-but-unauthorized credential for one case, in that system's
 *  auth flavour — the ONE place all five runner legs derive it, so "what
 *  unauthorized means" cannot drift between them.
 *
 *  dev-stub: the same `x-dev-claims` channel the authorized principal
 *  rides, carrying the non-granting claims.  OIDC: a second mock-issuer token —
 *  same key and same issuer, so it VERIFIES and the ONLY thing separating it
 *  from the authorized principal by the time a request reaches a route is the
 *  authorization predicate.  That is what makes a 403 here mean "the gate
 *  denied" rather than "the verifier rejected" (which would be a 401).
 *
 *  `null` (no auth, or OIDC without a mock issuer) means the ladder cannot run
 *  at all and the runner skips it. */
export function unauthorizedCredentials(authMode, unauthorizedToken) {
  if (authMode === "oidc") {
    return unauthorizedToken ? { authorization: `Bearer ${unauthorizedToken}` } : null;
  }
  if (authMode === "devstub") {
    return { "x-dev-claims": Buffer.from(DEV_CLAIMS_UNAUTHORIZED).toString("base64") };
  }
  return null;
}

/** Per-case authorization-ladder probes (M-T9.28).
 *
 *  Keyed by case name; the runner hands the matching entry to `__authzLadder`
 *  in the shared recorder preamble.
 *
 *  Slice 1 called this map a placeholder that slice 2 would "replace with a
 *  census DERIVED from the enriched IR … at which point this map goes away".
 *  Slice 2 landed and did the opposite, deliberately: the map STAYS and the
 *  census (`test/ir/authz-gate-census.test.ts`) READS it.  Deriving the probes
 *  would have made the instrument unable to fail — the same derivation that
 *  found the gate would have written the arm that "proves" it, so a gate
 *  emitted as a no-op would have produced a matching probe and a green ladder.
 *  What the census derives instead is the QUESTION (every gated surface, from
 *  `deriveContextOperations` ∪ `apiSurfaceCoverage.notLifted`); each ANSWER is
 *  hand-written here or explicitly pinned with a reason, and the census fails
 *  when a gate has neither.  Two consequences worth knowing before editing:
 *  deleting an arm below fails the census, and adding a gate to any corpus
 *  fixture fails it until an arm or a pin exists.
 *
 *  A probe may also be a CONTROL (`unauthorized` expecting a 2xx) — see
 *  `field-mask` — which is what stops the refusal arms from passing for the
 *  wrong reason.  The census does not count a control as a refusal.
 *
 *  Shape:
 *    seed    — what the AUTHORIZED principal performs first, so the gated
 *              surface has a row to address.  `{ path, body }` (method defaults
 *              to POST), or an ARRAY of those to run in order — the first id
 *              any of them returns is what `{id}` substitutes.  A non-2xx seed
 *              step fails the ladder rather than being measured as denial.
 *    gated   — the `requires`-guarded surface, `{ method, path, body }`, or an
 *              ARRAY of them when one system gates several.  `{id}` in `path`
 *              is substituted with the seeded id; `label` names the surface in
 *              the arm output and a per-surface `arms` overrides the spec-level
 *              one.
 *    arms    — expected status per identity.  `null` means "not expressible on
 *              this system's auth flavour" and the arm is SKIPPED (see
 *              `anonymousNote`), never silently passed.
 *
 *  `anonymous: null` on the dev-stub cases is not an oversight: the emitted
 *  dev-stub verifier (`index.ts`, `registerUserVerifier`) accepts EVERY request
 *  and falls back to its built-in identity when no `x-dev-claims` header is
 *  present.  Under the dev stub there is therefore no anonymous caller to
 *  express — omitting credentials yields the built-in admin, not a 401.  Only
 *  the OIDC flavour, whose verifier rejects a missing/invalid bearer, can assert
 *  that rung. */
export { AUTHZ_LADDERS } from "./registers.mjs";

/** Reset a shared Postgres to a pristine state before a case boots.  The backend
 *  runners (java/dotnet/python/elixir) boot against ONE external DB and each
 *  case emits its own migrations at a FIXED version — so running more than one
 *  case per DB collides (Flyway/EF/Ecto checksum mismatch, or "relation already
 *  exists") unless the DB is wiped between them.  Generated backends put each
 *  bounded context in its OWN schema (named after the context, e.g. `orders`,
 *  `sales`), so dropping `public` alone is not enough — this drops EVERY
 *  non-system schema and recreates `public`.  `pgUrl` is a standard
 *  `postgresql://user:pass@host/db`.  (The node tier needs none — PGlite is a
 *  fresh in-process DB per case.) */
export async function resetDatabase(pgUrl) {
  const client = new pg.Client({ connectionString: pgUrl });
  await client.connect();
  try {
    await client.query(`
      DO $$
      DECLARE s text;
      BEGIN
        FOR s IN SELECT nspname FROM pg_namespace
                 WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
        LOOP
          EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', s);
        END LOOP;
        EXECUTE 'CREATE SCHEMA IF NOT EXISTS public';
      END $$;
    `);
  } finally {
    await client.end();
  }
}


const { OUTBOX_PENDING_PREDICATE } = await import(new URL("../../out/util/channels.js", import.meta.url).href);

/** Wait (bounded) until no outbox row in the shared Postgres is still owed
 *  delivery.  A durable event reaches its broker through the backend's relay,
 *  on the relay's own poll, after the request that raised it has answered; a
 *  runner reads the broker effects only once that relay has caught up, as the
 *  node leg does in process.  Every table with the outbox's `dispatched_at` /
 *  `dead_at` columns counts, whichever schema the backend put it in; a database
 *  with none returns at once.  On the bound it returns, and the effects diff
 *  names what never arrived. */
export async function awaitOutboxDrained(pgUrl, { timeoutMs = 15_000 } = {}) {
  const client = new pg.Client({ connectionString: pgUrl });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT table_schema AS s, table_name AS t FROM information_schema.columns
      WHERE column_name IN ('dispatched_at', 'dead_at')
      GROUP BY table_schema, table_name HAVING count(*) = 2`);
    if (rows.length === 0) return;
    const q = rows
      .map((r) => `SELECT count(*)::int AS n FROM ${pg.escapeIdentifier(r.s)}.${pg.escapeIdentifier(r.t)} WHERE ${OUTBOX_PENDING_PREDICATE}`)
      .join(" UNION ALL ");
    const until = Date.now() + timeoutMs;
    for (;;) {
      const pending = (await client.query(q)).rows.reduce((n, r) => n + r.n, 0);
      if (pending === 0 || Date.now() > until) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  } finally {
    await client.end();
  }
}

/** Filter a case-name list against the platform's behavioural skip set. */
function notSkipped(names, platformClause) {
  const skip = BEHAVIOURAL_SKIP[platformClause] ?? {};
  return names.filter((name) => !(name in skip));
}

/** Shared broad-system cases (systems/*.ddd), source-swapped to `platformClause`.
 *  Run on every backend — the tokenized replacement for the forked sales.ddd. */
export function sharedSystemCases(platformClause) {
  const names = readdirSync(SYSTEMS_DIR)
    .filter((p) => p.endsWith(".ddd"))
    .map((file) => file.replace(/\.ddd$/, ""))
    .sort();
  return notSkipped(names, platformClause).map((name) => ({
    name,
    source: readFileSync(join(SYSTEMS_DIR, `${name}.ddd`), "utf8").replaceAll("__PLATFORM__", platformClause),
    locales: localesBeside(join(SYSTEMS_DIR, `${name}.ddd`)),
  }));
}

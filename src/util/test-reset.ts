// ---------------------------------------------------------------------------
// The dev-only state-reset seam.
//
// The emitted `e2e/` suite drives a REAL database through a RUNNING backend,
// so without a reset it is not idempotent: an exact count assertion is green
// on a fresh database and red on the second run of the same one, and every
// `it()` is coupled to the blocks that ran before it.  The audit measured
// exactly that (`docs/audits/2026-09-13-testability-audit.md` F3) — and since
// the generated `docker-compose.yml` uses a named `pgdata` volume, the
// DOCUMENTED run recipe was red on its second run.
//
// Three mechanisms were on the table (D-1 in the fleet plan).  Per-test
// TRANSACTIONS are structurally unavailable: the suite talks HTTP to a
// separate process, so it cannot share a transaction with the request
// handler.  That leaves a reset the suite calls between tests, plus a
// documented contract where the reset cannot reach.
//
// WHY AN ENDPOINT RATHER THAN A DATABASE CONNECTION.  The emitted suite is
// deliberately decoupled from the backend project — it imports no DTOs and
// opens no database handle, because it talks HTTP to a service that may not
// even be the backend the types would come from (see the `__WireBody` note in
// `src/system/e2e-render.ts`, and the multi-backend replay that runs ONE test
// body against EVERY compatible deployable).  A `db:reset` script in `e2e/`
// would need a pg driver and credentials in a project that deliberately has
// neither, and would need one connection string per replayed deployable.  An
// endpoint keeps the suite pure `fetch`.
//
// WHY NOT RESET THROUGH THE DOMAIN API ITSELF (list every aggregate, destroy
// every row) — it needs no backend change at all, which is tempting, but it
// is wrong rather than merely slow: a capability `filter` hides rows from the
// very `all()` read that would have to find them (see
// `test/fixtures/corpus/prefix-filter.ddd`, where five of six rows are
// invisible outside the `root` prefix), an aggregate whose `destroy` is
// guarded by an invariant refuses, foreign keys make it order-dependent, and
// it never reaches the outbox, the projections or the sequences.  A reset
// that silently leaves rows behind is worse than no reset.
//
// ── THE SAFETY CONTRACT ────────────────────────────────────────────────────
//
// The endpoint truncates every table of every tenant, so it is treated as what
// it is — a remote "erase the database" button — and is closed unless an
// operator opens it ON PURPOSE, with a secret.  Three INDEPENDENT gates:
//
//   1. OPT-IN, NEVER INFERRED — the backend serves the reset only when
//      `LOOM_TEST_RESET=1` is set explicitly.  No profile marker (`NODE_ENV`,
//      `ASPNETCORE_ENVIRONMENT`, `MIX_ENV`) turns it on, and the generated
//      `docker-compose.yml` does not set it.  Finding H-30 (helpdesk eval) is
//      why: it used to be on by default in `npm run dev` and forced on by the
//      compose file (published on 0.0.0.0), and running the generated e2e
//      suite against a dev stack holding real data silently erased it.
//
//   2. A SHARED SECRET — enabling it also requires `LOOM_TEST_RESET_TOKEN`,
//      and every request must carry that value in the `x-loom-test-reset`
//      header, compared in constant time.  Enabled WITHOUT a token, the
//      backend refuses to serve the route at all (and says so at boot where
//      it registers routes at boot).  A wrong or missing header is a 403,
//      having touched nothing.  The route sits outside the auth middleware
//      (an auth-bearing suite need not mint a principal to empty a table),
//      so the token IS its authentication — it is never an open bypass.
//
//   3. CLIENT — the emitted suite only SENDS a reset when it was handed the
//      token (`LOOM_TEST_RESET_TOKEN` in the suite's environment) AND the
//      resolved base URL is a loopback address.  Without the token it warns
//      once and runs against shared state; `E2E_API_BASE=https://staging…`
//      disables it by construction, with deliberately no remote override.
//      See `__isLoopbackBase` in the emitted preamble.
//
// Node, python and .NET do not REGISTER the route unless gates 1 and 2 hold,
// so there the surface does not exist; Phoenix and Spring build their routes
// at compile time and at context refresh respectively, so an environment
// variable read at boot cannot add or drop one — there the route is always
// defined and the HANDLER answers 404 having touched nothing.
//
// A harness that wants the reset (a CI tier, a developer's own loop) sets the
// same token on both sides: `LOOM_TEST_RESET=1 LOOM_TEST_RESET_TOKEN=<t>` on
// the backend, `LOOM_TEST_RESET_TOKEN=<t>` on the suite.
// ---------------------------------------------------------------------------

/** Where the reset endpoint mounts.  Under `/__loom/`, NOT under
 *  {@link API_BASE_PATH}: it is infra, same class as `/health` and `/ready`,
 *  it is not part of the domain contract, and it must not appear in the
 *  OpenAPI document or behind the auth middleware. */
export const TEST_RESET_PATH = "/__loom/test-reset";

/** The switch every backend honours: exactly `1` allows the reset (together
 *  with {@link TEST_RESET_TOKEN_ENV}); anything else, unset included, refuses
 *  it.  Never derived from a production-profile marker. */
export const TEST_RESET_ENV = "LOOM_TEST_RESET";

/** The shared secret the reset requires.  Read by the backend (the expected
 *  value — empty means the route is not served even with the switch on) and
 *  by the emitted suite (the value it sends; absent means it never resets). */
export const TEST_RESET_TOKEN_ENV = "LOOM_TEST_RESET_TOKEN";

/** The request header that carries {@link TEST_RESET_TOKEN_ENV}.  Lower-case
 *  so every backend's header lookup (several are case-sensitive on the key
 *  they are handed) spells it the same way. */
export const TEST_RESET_HEADER = "x-loom-test-reset";

/**
 * Postgres schemas whose tables a reset must NOT touch, on any backend.
 *
 * These hold runtime bookkeeping the process depends on, not application
 * state a test produced:
 *
 *   • `pg_catalog` / `information_schema` — the server's own catalogue.
 *   • `pgboss` — pg-boss's job store.  Truncating it destroys queued jobs;
 *     with two replicas one boot would pull them out from under the other
 *     (the same hazard the MikroORM `safe: true` note in
 *     `src/generator/typescript/emit/mikroorm-config.ts` describes).
 *   • `drizzle` — the node backend's `__drizzle_migrations` ledger.  Losing
 *     it re-applies the whole migration chain on the next boot.
 */
export const RESET_PRESERVED_SCHEMAS = [
  "pg_catalog",
  "information_schema",
  "pgboss",
  "drizzle",
] as const;

/**
 * Individual tables a reset must not touch, wherever they live.
 *
 * EVERY BACKEND'S MIGRATION LEDGER IS HERE, not just the one whose backend you
 * happen to be testing.  Only the node backend keeps its ledger in a schema of
 * its own (`drizzle.__drizzle_migrations`, covered by
 * {@link RESET_PRESERVED_SCHEMAS}); the other four keep theirs in an ordinary
 * table beside the domain tables, so a schema-level exclusion misses them:
 *
 *   • `__loom_migrations`     — python (`generator/python/emit/migrations.ts`)
 *   • `__EFMigrationsHistory` — .NET / EF Core
 *   • `schema_migrations`     — elixir / Ecto
 *   • `flyway_schema_history` — java / Flyway
 *
 * Truncating one does not break the RUNNING process — the schema it describes
 * is still there — which is exactly what makes it dangerous: the damage shows
 * up on the NEXT boot, as the whole migration chain replaying against a
 * database that already has it.  The list is shared rather than per-backend
 * because naming a table a given backend does not have costs nothing, while
 * forgetting one costs a corrupted database one restart later.  (Measured:
 * the first python run reported `tables: 2`, and the second was
 * `public.__loom_migrations`.)
 *
 * `loom_timer_runs` is the timer scheduler's watermark (`scheduling.md`).
 * Truncating it does not lose test data — it makes the next tick write a
 * fresh baseline instead of replaying the boundary it missed, silently
 * disabling the cron coalesce-once catch-up.
 *
 * `__loom_seed` is NOT here, and deliberately so: the marker is truncated
 * WITH the domain tables so that a backend carrying `seed` data can re-apply
 * it afterwards.  A reset restores the just-migrated-and-seeded state, not an
 * empty database — a suite whose fixtures assume seeded rows must still find
 * them.  See the per-backend reset handlers.
 */
export const RESET_PRESERVED_TABLES = [
  "loom_timer_runs",
  "__loom_migrations",
  "__EFMigrationsHistory",
  "schema_migrations",
  "flyway_schema_history",
] as const;

/**
 * The table-discovery query every backend's reset handler runs.
 *
 * Discovery is at RUNTIME rather than a table list baked in at generation
 * time, so the reset also reaches tables the model does not describe but the
 * backend creates — the transactional outbox, projection read models, the
 * seed marker — and cannot drift from a migration chain that has moved on.
 *
 * Returns `schemaname` / `tablename` pairs; the caller quotes them and issues
 * one `TRUNCATE ... RESTART IDENTITY CASCADE`.  A single statement, not one
 * per table: `CASCADE` needs to see the whole set at once or a foreign key
 * makes the order significant, and `RESTART IDENTITY` puts sequences back so
 * a generated id is stable across runs.
 */
export function resetTableDiscoverySql(): string {
  const schemas = RESET_PRESERVED_SCHEMAS.map((s) => `'${s}'`).join(", ");
  const tables = RESET_PRESERVED_TABLES.map((t) => `'${t}'`).join(", ");
  return (
    "select schemaname, tablename from pg_tables " +
    `where schemaname not in (${schemas}) and tablename not in (${tables})`
  );
}

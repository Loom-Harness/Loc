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
// A suite pointed at staging must NEVER truncate.  Two INDEPENDENT gates, and
// the one that matters needs no configuration:
//
//   1. CLIENT — the emitted suite only SENDS a reset when the resolved base
//      URL is a loopback address.  `E2E_API_BASE=https://staging.example.com`
//      disables it by construction: there is no flag to forget, and
//      deliberately no remote override to copy into CI.  See
//      `__isLoopbackBase` in the emitted preamble.
//
//   2. SERVER — the backend does not REGISTER the route unless it is told to.
//      Where it is not, the surface does not exist; the request 404s through
//      the ordinary not-found path, having touched nothing.
//
// Gate 1 alone would miss a loopback port-forward into a remote database;
// gate 2 alone would miss a dev-profile backend on a shared host.  Together
// both readings are covered, which is why neither is dropped.
//
// Registration is one explicit switch with a profile-derived default:
//
//     LOOM_TEST_RESET=1   → registered
//     LOOM_TEST_RESET=0   → not registered
//     unset               → registered iff the host platform's own profile is
//                           not production
//
// The default means the audit's recipe (run the backend straight out of the
// tree) keeps working with nothing new to set, while a real deployment is
// closed BY DEFAULT rather than by remembering to close it.  The explicit `1`
// exists because the generated container image pins a production profile —
// correctly, it is a production image — so the generated `docker-compose.yml`,
// which is a LOCAL dev stack built from that same image, opts in by name.
// That is a line a reader can see in the compose file and delete, which is
// worth more here than an invisible inference from the profile alone.
// ---------------------------------------------------------------------------

/** Where the reset endpoint mounts.  Under `/__loom/`, NOT under
 *  {@link API_BASE_PATH}: it is infra, same class as `/health` and `/ready`,
 *  it is not part of the domain contract, and it must not appear in the
 *  OpenAPI document or behind the auth middleware. */
export const TEST_RESET_PATH = "/__loom/test-reset";

/** The switch every backend honours: `1` registers the route, `0` keeps it
 *  unregistered, unset falls back to "not a production profile". */
export const TEST_RESET_ENV = "LOOM_TEST_RESET";

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
export const RESET_PRESERVED_TABLES = ["loom_timer_runs"] as const;

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

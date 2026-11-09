// ---------------------------------------------------------------------------
// The runtime's migration bookkeeping — pure over a minimal SQL handle, so the
// node-side tests drive it without a worker.
//
// `__loom.schema_meta` (key/value) records the id of the last migration unit
// the database applied (`chain_head`).  A boot measures the database against
// the plan the build worker rendered from the recorded chain:
//
//   - the model has unrecorded changes  → nothing is written;
//   - the head is a unit of the chain   → the units after it are applied;
//   - the head is not in the chain, or the database carries only the
//     `ddl_hash` row of an earlier playground → nothing is written, and the
//     database is reported as unknown.
//
// Nothing here drops a schema except `dropUserSchemas`, which only the
// explicit reset actions call.
// ---------------------------------------------------------------------------

import type {
  BlockingMigrationState,
  MigrationPlan,
  MigrationState,
  MigrationUnitPlan,
} from "./protocol.js";

/** The slice of PGlite the bookkeeping uses. */
export interface SqlHandle {
  exec(sql: string): Promise<unknown>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** Key of the last applied migration unit's id. */
export const HEAD_KEY = "chain_head";
/** Key of the Drizzle-derived DDL's hash — a source without a system, and
 *  every database an earlier playground created. */
export const DDL_HASH_KEY = "ddl_hash";

/** The bookkeeping rows, read without creating anything: empty when the
 *  table does not exist. */
export async function readSchemaMeta(db: SqlHandle): Promise<Map<string, string>> {
  const probe = await db.query(
    "SELECT to_regclass('__loom.schema_meta') IS NOT NULL AS present",
  );
  const meta = new Map<string, string>();
  if (probe.rows[0]?.["present"] !== true) return meta;
  const res = await db.query("SELECT key, value FROM __loom.schema_meta");
  for (const row of res.rows) meta.set(String(row["key"]), String(row["value"]));
  return meta;
}

/** The database (its bookkeeping rows) measured against a chain plan. */
export function chainState(
  meta: ReadonlyMap<string, string>,
  plan: Extract<MigrationPlan, { kind: "chain" }>,
): MigrationState {
  const head = meta.get(HEAD_KEY) ?? null;
  if (head === null && meta.has(DDL_HASH_KEY)) {
    return { kind: "unknown-database", reason: "legacy", head };
  }
  const ids = plan.units.map((u) => u.id);
  const at = head === null ? 0 : ids.indexOf(head) + 1;
  if (head !== null && at === 0) return { kind: "unknown-database", reason: "diverged", head };
  if (plan.unrecorded) return { kind: "unrecorded", head, ...plan.unrecorded };
  const units = ids.slice(at);
  return units.length > 0
    ? { kind: "recorded-not-applied", head, units }
    : { kind: "up-to-date", head };
}

/** The state of a database for a source without a system, whose schema is the
 *  bundle's Drizzle-derived DDL (`ddlHash` is its hash).  An empty database
 *  reads `recorded-not-applied`: applying the DDL creates it. */
export function unversionedState(
  meta: ReadonlyMap<string, string>,
  ddlHash: string,
): MigrationState {
  if (meta.size === 0) return { kind: "recorded-not-applied", head: null, units: [] };
  if (meta.get(DDL_HASH_KEY) === ddlHash && !meta.has(HEAD_KEY)) {
    return { kind: "up-to-date", head: null };
  }
  return { kind: "unknown-database", reason: "schema-changed", head: meta.get(HEAD_KEY) ?? null };
}

/** Whether a boot must stop at `state` rather than start the app. */
export function blocksBoot(state: MigrationState): state is BlockingMigrationState {
  return state.kind === "unrecorded" || state.kind === "unknown-database";
}

async function ensureMeta(db: SqlHandle): Promise<void> {
  await db.exec(
    "CREATE SCHEMA IF NOT EXISTS __loom; " +
      "CREATE TABLE IF NOT EXISTS __loom.schema_meta (key text PRIMARY KEY, value text NOT NULL);",
  );
}

const UPSERT_META =
  "INSERT INTO __loom.schema_meta (key, value) VALUES ($1, $2) " +
  "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value";

/** Apply `units` in order, recording each as the head once it lands.  A
 *  transactional unit runs with its head update in one transaction, so a
 *  failure leaves the database at the previous unit.  Returns the ids
 *  applied; throws `MigrationApplyError` naming the unit that failed. */
export async function applyUnits(
  db: SqlHandle,
  units: readonly MigrationUnitPlan[],
): Promise<string[]> {
  if (units.length === 0) return [];
  await ensureMeta(db);
  const applied: string[] = [];
  for (const unit of units) {
    try {
      if (unit.transactional) {
        await db.exec("BEGIN");
        try {
          for (const stmt of unit.statements) await db.exec(stmt);
          await db.query(UPSERT_META, [HEAD_KEY, unit.id]);
          await db.exec("COMMIT");
        } catch (err) {
          await db.exec("ROLLBACK").catch(() => undefined);
          throw err;
        }
      } else {
        for (const stmt of unit.statements) await db.exec(stmt);
        await db.query(UPSERT_META, [HEAD_KEY, unit.id]);
      }
    } catch (err) {
      throw new MigrationApplyError(unit.id, err);
    }
    applied.push(unit.id);
  }
  return applied;
}

/** Bring the database to the recorded chain's head: apply the units after
 *  the one `__loom.schema_meta` records.  Writes nothing when the model has
 *  unrecorded changes or the database is not one the chain describes — it
 *  returns that state instead. */
export async function migrateChain(
  db: SqlHandle,
  plan: Extract<MigrationPlan, { kind: "chain" }>,
  onApply?: (units: readonly string[]) => void,
): Promise<{ blocked: BlockingMigrationState } | { applied: string[] }> {
  const measured = chainState(await readSchemaMeta(db), plan);
  if (blocksBoot(measured)) return { blocked: measured };
  if (measured.kind !== "recorded-not-applied") return { applied: [] };
  onApply?.(measured.units);
  const todo = new Set(measured.units);
  return { applied: await applyUnits(db, plan.units.filter((u) => todo.has(u.id))) };
}

/** The explicit reset: drop every user schema, forget the applied head, and
 *  rebuild the schema from every unit of the chain.  The `__loom` schema
 *  stays. */
export async function rebuildChain(
  db: SqlHandle,
  units: readonly MigrationUnitPlan[],
): Promise<string[]> {
  await db.exec(dropUserSchemasSql(false));
  await clearSchemaMeta(db);
  return applyUnits(db, units);
}

/** Record `ddlHash` as the schema of a source without a system. */
export async function recordDdlHash(db: SqlHandle, ddlHash: string): Promise<void> {
  await ensureMeta(db);
  await db.query(UPSERT_META, [DDL_HASH_KEY, ddlHash]);
}

/** Forget every bookkeeping row — the database is about to be rebuilt. */
export async function clearSchemaMeta(db: SqlHandle): Promise<void> {
  const meta = await readSchemaMeta(db);
  if (meta.size > 0) await db.exec("DELETE FROM __loom.schema_meta");
}

/** Drop every user-defined schema — `public` and every generated per-context
 *  schema (`sales`, …) — and recreate `public`.  `includeLoom` also drops the
 *  `__loom` bookkeeping.  Only the explicit reset actions call this. */
export function dropUserSchemasSql(includeLoom: boolean): string {
  const loomFilter = includeLoom ? "" : " AND nspname <> '__loom'";
  return (
    "DO $$ DECLARE s text; BEGIN " +
    "FOR s IN SELECT nspname FROM pg_namespace " +
    `WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'${loomFilter} ` +
    "LOOP EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', s); END LOOP; " +
    "EXECUTE 'CREATE SCHEMA IF NOT EXISTS public'; END $$;"
  );
}

/** The SQL a chain plan builds the schema from — every unit, in order. */
export function chainDdl(units: readonly MigrationUnitPlan[]): string {
  return units
    .map((u) => `-- ${u.id}\n${u.statements.map((s) => s.trim().replace(/;?$/, ";")).join("\n")}`)
    .join("\n\n");
}

/** One plain sentence for a state a boot cannot migrate past — what the
 *  Runtime panel shows and the agent reads. */
export function blockingMessage(state: BlockingMigrationState): string {
  if (state.kind === "unknown-database") {
    switch (state.reason) {
      case "legacy":
        return "This database was created before the playground tracked migrations, so which of them it holds is unknown. It was left as it is; reset the database to rebuild it from the recorded migrations.";
      case "diverged":
        return `This database is at migration ${state.head}, which the recorded chain no longer has. It was left as it is; reset the database to rebuild it from the recorded migrations.`;
      case "schema-changed":
        return "The schema changed since this database was created, and a source without a system records no migrations. It was left as it is; reset the database to create the new schema.";
    }
  }
  if (state.initial) {
    return "Migration required — the database is created from recorded migrations, and none are recorded yet. Record the initial migration (Record migration… beside Boot, or the Migrations tab), then apply it.";
  }
  const steps = `${state.steps} unrecorded schema change${state.steps === 1 ? "" : "s"}`;
  const where = `module${state.modules.length === 1 ? "" : "s"} ${state.modules.join(", ")}`;
  const destructive = state.destructive ? " One of them is destructive and needs the destructive acknowledgement." : "";
  return `Migration required — ${steps} in ${where}. The database was left as it is. Record the migration (Record migration… beside Boot, or the Migrations tab), then apply it.${destructive}`;
}

/** A migration unit that failed to apply. */
export class MigrationApplyError extends Error {
  constructor(
    readonly unit: string,
    cause: unknown,
  ) {
    super(`migration ${unit} failed: ${errText(cause)}`);
    this.name = "MigrationApplyError";
  }
}

/** PGlite/Postgres can reject with a plain object (a serialised protocol
 *  error: `{ message, severity, code, … }`) rather than an `Error`, which
 *  `String(err)` prints as "[object Object]".  Dig out a real message,
 *  falling back to a JSON dump so nothing is swallowed. */
export function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg.length > 0) return msg;
    try {
      return JSON.stringify(err);
    } catch {
      /* circular / non-serialisable — fall through */
    }
  }
  return String(err);
}

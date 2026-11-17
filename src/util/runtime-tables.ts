// The tables the generated runtime owns — one spelling for every backend.
//
// Generated code carries no tool name (docs/decisions/D-NO-TOOL-NAME.md).  A
// runtime-owned table takes the reserved `_` prefix; a user declaration whose
// derived table (or `tablePrefix:`) starts with `_` is refused as
// `loom.persisted-table-reserved`, so none of these can collide with a model's
// own table.  Every emitter, the migration builder and the test-reset handler
// read the names from here; `test/system/runtime-table-name-census.test.ts`
// refuses a spelled-out copy anywhere else in `src/`.

/** The runtime tables, by role. */
export const RUNTIME_TABLES = {
  /** The transactional outbox (one per module carrying a durable channel). */
  outbox: "_outbox",
  /** The outbox's partial index over the rows a relay still owes delivery. */
  outboxPendingIdx: "_outbox_pending_idx",
  /** The consumer inbox: one row per `(consumer, event_id)` a consumer applied. */
  inbox: "_inbox",
  /** The `every:` timer claim: each timer's last claimed period. */
  timer: "_timer",
  /** The `cron:` timer watermark the scheduler creates itself. */
  timerRuns: "_timer_runs",
  /** The migration ledger a runner keeps itself (python, Dapper). */
  migrations: "_migrations",
  /** The ship-once seed-dataset marker. */
  seed: "_seed",
} as const;

/** Whether a table name is in the runtime's reserved `_` namespace. */
export function isRuntimeTable(name: string): boolean {
  return name.startsWith("_");
}

/** The suffix a per-table name (an Ecto `Create<Table>` migration module)
 *  takes for a runtime table: `CreateOutboxTable`, kept apart from the
 *  `CreateOutboxes` of a user aggregate called `Outbox`. */
export const RUNTIME_TABLE_MODULE_SUFFIX = "Table";

/** The .NET entity class mapped onto the Dapper migration ledger. */
export const MIGRATION_LEDGER_ENTITY = "SchemaMigration";

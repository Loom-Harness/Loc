import type { EnrichedBoundedContextIR, SystemIR } from "../../../ir/types/loom-ir.js";
import type { MigrationsIR } from "../../../ir/types/migrations-ir.js";
import { resolveDataSourceConfig } from "../../../ir/util/resolve-datasource.js";
import { plural, snake } from "../../../util/naming.js";
import { renderPgStep } from "../../sql-pg.js";

// ---------------------------------------------------------------------------
// Hono / Drizzle migration emitter.
//
// One .sql file per `MigrationsIR.steps`, with statements separated by
// the `--> statement-breakpoint` sentinel Drizzle's runtime migrator
// (`drizzle-orm/node-postgres/migrator`) splits on.  A
// `meta/_journal.json` index lists every migration ever emitted so
// `drizzle-kit migrate` / runtime `migrate()` can apply them in order.
//
// Application:
//   - `npm run db:migrate` → `drizzle-kit migrate` (reads the journal,
//     applies pending migrations against the `__drizzle_migrations`
//     tracking table the runtime creates on first run).
//   - The generated `index.ts` calls `migrate(...)` from
//     `drizzle-orm/node-postgres/migrator` at boot so deployments
//     (`node dist/index.js`) self-heal without a separate pre-start
//     command.
//
// Every generation of the migration chain arrives as its own
// `MigrationsIR`, so the files and the journal are rebuilt from the
// chain on every generate, never read back off disk.
// ---------------------------------------------------------------------------

const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

/** Migration file/journal tag.  Qualified with the module: the version
 *  alone is unique, but every module's first generation is named
 *  "Initial", and the module keeps the tag saying which one it is. */
function migrationTag(version: string, module: string, name: string): string {
  return `${version}_${snake(module)}_${snake(name)}`;
}

/** Anchor for the journal's `when` values — epoch millis of the chain's base version
 *  (2026-01-01T00:00:00Z), the canonical first-migration instant.  `when` itself
 *  is `WHEN_BASE + ordinal * 2` (see `renderJournal`): drizzle treats it as an
 *  opaque monotonic integer, and anchoring it here keeps it readable as a
 *  plausible timestamp rather than a bare counter. */
const WHEN_BASE = Date.UTC(2026, 0, 1, 0, 0, 0);

export function emitTypescriptMigrations(
  migrations: MigrationsIR[],
  out: Map<string, string>,
  // Additional (version, tag) rows to fold into the journal alongside the
  // platform-neutral migrations — used for the LATE provenance migration
  // (`emitTypescriptProvenanceMigration`), which is hand-emitted outside
  // `MigrationsIR` so it is no entry of the migration chain.
  extraHistory: ReadonlyArray<{ version: string; tag: string }> = [],
): void {
  let anyEmitted = false;
  for (const m of migrations) {
    if (m.steps.length === 0) continue;
    const tag = migrationTag(m.version, m.module, m.name);
    const sql = m.steps.map(renderPgStep).join(`\n${STATEMENT_BREAKPOINT}\n`);
    out.set(`db/migrations/${tag}.sql`, sql + "\n");
    anyEmitted = true;
  }
  if (!anyEmitted && extraHistory.length === 0) return;

  // Multiple modules per deployable contribute one combined journal;
  // their entries interleave by version, which is chain order.
  const journal = renderJournal(migrations, extraHistory);
  out.set("db/migrations/meta/_journal.json", journal);
}

function renderJournal(
  migrations: MigrationsIR[],
  extraHistory: ReadonlyArray<{ version: string; tag: string }> = [],
): string {
  // One row per emitted generation, in chain order (ascending version), then
  // any always-last extra (the provenance migration).  Rows are keyed on the
  // resolved tag, so two modules of one deployable never collapse into one.
  const ordered = migrations
    .filter((m) => m.steps.length > 0)
    .map((m) => ({ version: m.version, tag: migrationTag(m.version, m.module, m.name) }))
    .sort((a, b) => {
      const d = BigInt(a.version) - BigInt(b.version);
      return d !== 0n ? (d < 0n ? -1 : 1) : a.tag < b.tag ? -1 : 1;
    });
  const ordinals = ordered.map((_, i) => i + 1);
  const entries: {
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }[] = ordered.map((row, idx) => ({
    idx,
    version: "7",
    // `when` is the ordering key drizzle's runtime migrator compares against
    // the database: it applies an entry only when
    // `lastApplied.created_at < entry.when`, STRICTLY.  So the key must be
    //
    //   (1) strictly increasing down the journal — a tie or a decrease silently
    //       skips an entry, and its tables are never created;
    //   (2) unchanged for an entry that has already been applied — a bumped
    //       `when` re-runs it and the re-run dies on "already exists";
    //   (3) greater, for a newly recorded entry, than for every entry already
    //       applied — otherwise the watermark hides it forever.
    //
    // The position in chain order meets all three: the chain only ever grows
    // at its head, with a version above every existing one, so an entry's
    // position never moves and a new entry always lands last.
    //
    // Pairs of slots per ordinal: the EVEN slot carries the chain entry, and
    // the ODD slot immediately above the newest one is reserved for the
    // always-last provenance migration below, so it sorts after this
    // generation's entries without sitting above the next generation's.
    when: WHEN_BASE + ordinals[idx] * 2,
    tag: row.tag,
    breakpoints: true,
  }));
  // The LATE provenance migration (`29991231000000_provenance`) is re-derived
  // from scratch every generation rather than diffed, so it has no ordinal of
  // its own and must stay last.  A fixed far-future `when` would sit above
  // every later entry and hide it behind the watermark (requirement 3), so it
  // takes the odd slot just above the newest chain entry: last within its own
  // generation, below the next generation's entries.  Its SQL is emitted with
  // `ADD COLUMN IF NOT EXISTS`, so re-applying it is a no-op — and a field
  // newly marked `provenanced` actually gets its column.
  const maxOrdinal = ordinals.reduce((mx, o) => Math.max(mx, o), 0);
  for (const extra of extraHistory) {
    entries.push({
      idx: entries.length,
      version: "7",
      when: WHEN_BASE + maxOrdinal * 2 + 1,
      tag: extra.tag,
      breakpoints: true,
    });
  }
  // Drizzle journal envelope.  Version "7" matches what drizzle-kit
  // 0.30.x emits for the postgresql dialect; if a future drizzle-kit
  // bumps this, the runtime migrator stays compatible (it doesn't read
  // the envelope version) but `drizzle-kit migrate` warns.
  return (
    JSON.stringify(
      {
        version: "7",
        dialect: "postgresql",
        entries,
      },
      null,
      2,
    ) + "\n"
  );
}

// ---------------------------------------------------------------------------
// LATE provenance migration (provenance.md) — the Hono/Drizzle counterpart of
// `emitDotnetProvenanceAuditMigration` / `emitPythonProvenanceMigration` /
// elixir-vanilla's `create_provenance` migration.  Carries the CO-LOCATED
// `<field>_provenance` columns only: they hang off the aggregate tables
// `MigrationsIR` owns, so they must be ALTERed in after those exist, and a
// version far in the future sorts this after every module's initial + delta
// migrations (parity with the `29991231235959` / `29991231000000` siblings)
// regardless of module count.  The `provenance_records` history table is NOT
// created here — it is a shared `MigrationsIR` companion table
// (`provenanceTableShape`), like the outbox and the audit log.
// ---------------------------------------------------------------------------

const PROVENANCE_MIGRATION_VERSION = "29991231000000";

/** The LATE migration's tag (sorts after every module migration). */
export function provenanceMigrationTag(): string {
  return `${PROVENANCE_MIGRATION_VERSION}_provenance`;
}

/** Snake-cased name of the co-located backing column for a provenanced field
 *  (`total` → `total_provenance`) — must agree with `schema.ts` /
 *  `aggregate.ts` / the repository builders, which all derive it the same
 *  way. */
function provColumn(fieldName: string): string {
  return `${snake(fieldName)}_provenance`;
}

/** Emit `db/migrations/<version>_provenance.sql`: ADD the co-located
 *  `<field>_provenance` jsonb column per provenanced aggregate table.  No-op
 *  (nothing emitted, `undefined` returned) when no served aggregate declares a
 *  provenanced field. Returns the `(version, tag)` pair so the caller can fold
 *  it into the Drizzle journal — a `.sql` file that's absent from the journal
 *  is never applied by the runtime migrator. */
export function emitTypescriptProvenanceMigration(
  contexts: readonly EnrichedBoundedContextIR[],
  sys: SystemIR | undefined,
  out: Map<string, string>,
): { version: string; tag: string } | undefined {
  const steps: string[] = [];
  for (const ctx of contexts) {
    for (const agg of ctx.aggregates) {
      if (agg.isAbstract) continue;
      const fields = agg.fields.filter((f) => f.provenanced);
      if (fields.length === 0) continue;
      const ds = sys ? resolveDataSourceConfig(agg, ctx, sys) : undefined;
      const base = snake(plural(agg.name));
      const table = ds?.tablePrefix ? `${ds.tablePrefix}${base}` : base;
      for (const f of fields) {
        steps.push(
          renderPgStep({
            op: "addColumn",
            table,
            schema: ds?.schema,
            column: { name: provColumn(f.name), type: { kind: "json" }, nullable: true },
            // Re-derived from scratch on every generation, and (unlike the
            // diffed steps) re-applied whenever this migration is re-homed above
            // the newest history entry — so it has to tolerate the columns it
            // already added.  It also means a field newly marked `provenanced`
            // finally receives its column: before, this migration either
            // re-ran and died on "already exists", or never ran again at all.
            ifNotExists: true,
          }),
        );
      }
    }
  }
  if (steps.length === 0) return undefined;

  // The `provenance_records` history table itself is NOT emitted here: it moved
  // to the shared MigrationsIR (`provenanceTableShape`), so all five backends
  // derive one definition.  What stays is the per-aggregate half above — the
  // co-located `<field>_provenance` columns, which hang off tables MigrationsIR
  // already owns and so must be ALTERed in after them.
  const tag = provenanceMigrationTag();
  out.set(`db/migrations/${tag}.sql`, `${steps.join(`\n${STATEMENT_BREAKPOINT}\n`)}\n`);
  return { version: PROVENANCE_MIGRATION_VERSION, tag };
}

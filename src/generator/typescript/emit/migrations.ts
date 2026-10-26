import type { MigrationsIR } from "../../../ir/types/migrations-ir.js";
import { snake } from "../../../util/naming.js";
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
): void {
  let anyEmitted = false;
  for (const m of migrations) {
    if (m.steps.length === 0) continue;
    const tag = migrationTag(m.version, m.module, m.name);
    const sql = m.steps.map(renderPgStep).join(`\n${STATEMENT_BREAKPOINT}\n`);
    out.set(`db/migrations/${tag}.sql`, sql + "\n");
    anyEmitted = true;
  }
  if (!anyEmitted) return;

  // Multiple modules per deployable contribute one combined journal;
  // their entries interleave by version, which is chain order.
  out.set("db/migrations/meta/_journal.json", renderJournal(migrations));
}

function renderJournal(migrations: MigrationsIR[]): string {
  // One row per emitted generation, in chain order (ascending version).  Rows
  // are keyed on the resolved tag, so two modules of one deployable never
  // collapse into one.
  const ordered = migrations
    .filter((m) => m.steps.length > 0)
    .map((m) => ({ version: m.version, tag: migrationTag(m.version, m.module, m.name) }))
    .sort((a, b) => {
      const d = BigInt(a.version) - BigInt(b.version);
      return d !== 0n ? (d < 0n ? -1 : 1) : a.tag < b.tag ? -1 : 1;
    });
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
    // Entries take the EVEN slots (`ordinal * 2`).  Requirement (2) is why the
    // factor stays: databases already deployed carry these values, and an odd
    // slot one of them may hold (an entry no longer in the journal) sits below
    // the next even one, so it never hides a new entry.
    when: WHEN_BASE + (idx + 1) * 2,
    tag: row.tag,
    breakpoints: true,
  }));
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

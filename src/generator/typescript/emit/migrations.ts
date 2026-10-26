import type { MigrationsIR } from "../../../ir/types/migrations-ir.js";
import { splitTransactionalSteps } from "../../../ir/util/migration-steps.js";
import { snake } from "../../../util/naming.js";
import { NO_TRANSACTION_MARKER, renderPgStep, splitPgStatements } from "../../sql-pg.js";

// ---------------------------------------------------------------------------
// Hono / Drizzle migration emitter.
//
// One .sql file per `MigrationsIR.steps`, with statements separated by
// the `--> statement-breakpoint` sentinel Drizzle's runtime migrator
// (`drizzle-orm/node-postgres/migrator`) splits on.  A
// `meta/_journal.json` index lists every migration ever emitted so
// the runtime `migrate()` can apply them in order.
//
// Application: the generated `index.ts` calls `migrate(...)` from
// `db/migrate.ts` at boot, so deployments (`node dist/index.js`) self-heal
// without a separate pre-start command.  That runner keeps Drizzle's
// own ledger (`drizzle.__drizzle_migrations`, the `when` watermark) and
// applies consecutive pending files in one transaction exactly like
// `drizzle-orm/node-postgres/migrator` — except a file marked
// `-- loom:no-transaction` (a `CREATE INDEX CONCURRENTLY` unit), which it
// applies outside any transaction.  `npm run db:migrate` runs the same
// runner out of band through `db/migrate-cli.ts`.  `drizzle-kit migrate` is
// not wired: it wraps every pending file in one transaction, so it cannot
// apply such a file.
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

/** One migration file: a generation's transactional unit (`<tag>.sql`), or
 *  its non-transactional one (`<tag>_concurrent.sql`, which sorts right after
 *  it and is marked with {@link NO_TRANSACTION_MARKER} on its first line). */
interface MigrationUnit {
  version: string;
  tag: string;
  sql: string;
}

function migrationUnits(migrations: readonly MigrationsIR[]): MigrationUnit[] {
  const units: MigrationUnit[] = [];
  for (const m of migrations) {
    if (m.steps.length === 0) continue;
    const tag = migrationTag(m.version, m.module, m.name);
    const { transactional, nonTransactional } = splitTransactionalSteps(m.steps);
    if (transactional.length > 0) {
      const sql = transactional.map(renderPgStep).join(`\n${STATEMENT_BREAKPOINT}\n`);
      units.push({ version: m.version, tag, sql: `${sql}\n` });
    }
    if (nonTransactional.length > 0) {
      // One statement per breakpoint chunk: node-postgres sends a chunk as one
      // simple query, and a multi-statement query is an implicit transaction.
      const statements = nonTransactional.flatMap((s) => splitPgStatements(renderPgStep(s)));
      units.push({
        version: m.version,
        tag: `${tag}_concurrent`,
        sql: `${NO_TRANSACTION_MARKER}\n${statements.join(`\n${STATEMENT_BREAKPOINT}\n`)}\n`,
      });
    }
  }
  return units;
}

export function emitTypescriptMigrations(
  migrations: MigrationsIR[],
  out: Map<string, string>,
): void {
  // The runner ships whenever the project migrates at boot — `index.ts`
  // imports it on exactly that condition.
  out.set("db/migrate.ts", MIGRATE_TS);
  out.set("db/migrate-cli.ts", MIGRATE_CLI_TS);
  const units = migrationUnits(migrations);
  if (units.length === 0) return;
  for (const u of units) out.set(`db/migrations/${u.tag}.sql`, u.sql);

  // Multiple modules per deployable contribute one combined journal;
  // their entries interleave by version, which is chain order.
  out.set("db/migrations/meta/_journal.json", renderJournal(units));
}

function renderJournal(units: readonly MigrationUnit[]): string {
  // One row per emitted file, in chain order (ascending version, then the
  // transactional unit before its `_concurrent` companion).  Rows are keyed
  // on the resolved tag, so two modules of one deployable never collapse
  // into one.
  const ordered = units
    .map((u) => ({ version: u.version, tag: u.tag }))
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

/** `db/migrate.ts` — the boot-time runner.  It is Drizzle's own
 *  `node-postgres` migrator (same `drizzle.__drizzle_migrations` ledger, same
 *  `created_at < when` watermark, so a database migrated by either one is
 *  current for the other) with one difference: a file whose first line is the
 *  no-transaction marker runs outside any transaction, each statement on its
 *  own, and its ledger row is written after its last statement.  Consecutive
 *  ordinary files still share one transaction, as Drizzle's do.  A failed
 *  non-transactional file is retried whole on the next boot; its statements
 *  are written to be re-runnable (`DROP INDEX CONCURRENTLY IF EXISTS` first). */
const MIGRATE_TS = `// Auto-generated.  Boot-time migration runner over the Drizzle journal.
//
// Applies db/migrations/meta/_journal.json in order against Drizzle's ledger
// (drizzle.__drizzle_migrations), exactly as drizzle-orm's node-postgres
// migrator does — consecutive pending files share one transaction — except a
// file whose first line is \`${NO_TRANSACTION_MARKER}\`.  Postgres refuses
// CREATE INDEX CONCURRENTLY inside a transaction block, so such a file runs
// statement by statement outside one, and is recorded after its last
// statement.
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

const NO_TRANSACTION = ${JSON.stringify(NO_TRANSACTION_MARKER)};

type Migration = ReturnType<typeof readMigrationFiles>[number];

function inTransaction(m: Migration): boolean {
  return !(m.sql[0] ?? "").trimStart().startsWith(NO_TRANSACTION);
}

function record(m: Migration) {
  return sql\`insert into "drizzle"."__drizzle_migrations" ("hash", "created_at") values (\${m.hash}, \${m.folderMillis})\`;
}

// Same signature as drizzle-orm's migrate(): any schema the app was built with.
export async function migrate(db: NodePgDatabase<any>, config: { migrationsFolder: string }): Promise<void> {
  const migrations = readMigrationFiles(config);
  await db.execute(sql\`CREATE SCHEMA IF NOT EXISTS "drizzle"\`);
  await db.execute(
    sql\`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)\`,
  );
  const last = await db.execute<{ created_at: string | number | null }>(
    sql\`select created_at from "drizzle"."__drizzle_migrations" order by created_at desc limit 1\`,
  );
  const watermark = last.rows[0] ? Number(last.rows[0].created_at) : undefined;
  const pending = migrations.filter((m) => watermark === undefined || watermark < m.folderMillis);
  for (let i = 0; i < pending.length; ) {
    const head = pending[i]!;
    if (!inTransaction(head)) {
      for (const stmt of head.sql) {
        if (stmt.trim().length > 0) await db.execute(sql.raw(stmt));
      }
      await db.execute(record(head));
      i++;
      continue;
    }
    let end = i;
    while (end < pending.length && inTransaction(pending[end]!)) end++;
    const batch = pending.slice(i, end);
    await db.transaction(async (tx) => {
      for (const m of batch) {
        for (const stmt of m.sql) await tx.execute(sql.raw(stmt));
        await tx.execute(record(m));
      }
    });
    i = end;
  }
}
`;

/** `db/migrate-cli.ts` — the out-of-band entry `npm run db:migrate` runs
 *  (via `tsx`).  It opens a pool from `DATABASE_URL` and calls the same
 *  `migrate` the boot path calls, so the ledger, the watermark and the
 *  no-transaction handling are the boot runner's.  A separate file for the
 *  same reason as `db/seed-cli.ts`: `db/migrate.ts` is bundled into
 *  `dist/index.js` and must carry no self-executing entry. */
const MIGRATE_CLI_TS = `// Auto-generated.  Do not edit by hand.
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { migrate } from "./migrate";

// Standalone migration (npm run db:migrate).  The server boot path calls the
// same migrate() from index.ts.
async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run migrations.");
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./db/migrations" });
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
`;

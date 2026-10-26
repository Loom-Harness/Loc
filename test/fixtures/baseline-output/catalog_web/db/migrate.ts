// Auto-generated.  Boot-time migration runner over the Drizzle journal.
//
// Applies db/migrations/meta/_journal.json in order against Drizzle's ledger
// (drizzle.__drizzle_migrations), exactly as drizzle-orm's node-postgres
// migrator does — consecutive pending files share one transaction — except a
// file whose first line is `-- loom:no-transaction`.  Postgres refuses
// CREATE INDEX CONCURRENTLY inside a transaction block, so such a file runs
// statement by statement outside one, and is recorded after its last
// statement.
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

const NO_TRANSACTION = "-- loom:no-transaction";

type Migration = ReturnType<typeof readMigrationFiles>[number];

function inTransaction(m: Migration): boolean {
  return !(m.sql[0] ?? "").trimStart().startsWith(NO_TRANSACTION);
}

function record(m: Migration) {
  return sql`insert into "drizzle"."__drizzle_migrations" ("hash", "created_at") values (${m.hash}, ${m.folderMillis})`;
}

// Same signature as drizzle-orm's migrate(): any schema the app was built with.
export async function migrate(db: NodePgDatabase<any>, config: { migrationsFolder: string }): Promise<void> {
  const migrations = readMigrationFiles(config);
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
  );
  const last = await db.execute<{ created_at: string | number | null }>(
    sql`select created_at from "drizzle"."__drizzle_migrations" order by created_at desc limit 1`,
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

// The ONE way a PGlite-backed harness gives a generated Hono deployable its
// database: apply the deployable's EMITTED migrations (`db/migrations/*.sql`
// + `meta/_journal.json`) through drizzle's runtime migrator — exactly what
// the generated `index.ts` does at boot (`migrate(db, { migrationsFolder:
// "./db/migrations" })`, node-postgres flavour there, pglite flavour here;
// both read the same journal + SQL).
//
// It replaces `synthDDL(schema)` (web/src/runtime/ddl.ts), which derived DDL
// from the drizzle SCHEMA OBJECT — a second description of the database that
// no deployed app ever applies.  It dropped every FK, unique constraint,
// unique index, composite PK and CHECK (#2773), and it read `pgEnum` as a
// real enum type while the migration beside it created TEXT (#2988).  The
// node leg is the oracle every wire golden is captured on, so a schema only
// the harness had made the answer key describe an app nobody ships.
// `synthDDL` stays the playground's (browser-worker) DDL source; harnesses
// must not use it — test/behavioral/harness-schema-source.test.ts pins that.

import { existsSync } from "node:fs";
import { join } from "node:path";

/** The deployable's emitted migrations folder; throws when there is none
 *  (a node deployable with a database always emits one — a missing folder is
 *  a generator defect, never a reason to fall back to a synthesised schema). */
export function migrationsFolderOf(deplDir) {
  const dir = join(deplDir, "db", "migrations");
  if (!existsSync(join(dir, "meta", "_journal.json"))) {
    throw new Error(
      `no emitted migrations at ${dir} (meta/_journal.json missing) — the harness applies the shipped migrations and has no fallback`,
    );
  }
  return dir;
}

/** Import line for a generated entry module (string-templated harness entry).
 *  `readMigrationFiles` is drizzle's own journal + `.sql` reader — the one the
 *  shipped `migrate()` calls — so ordering, file set and the
 *  `--> statement-breakpoint` split cannot drift from the boot path. */
export const MIGRATOR_IMPORT = 'import { readMigrationFiles as __readEmittedMigrations } from "drizzle-orm/migrator";';

/** Statement applying the emitted migrations to `pgliteVar`.  Each chunk goes
 *  through `exec` (the simple query protocol), which is what node-postgres
 *  uses for the shipped `migrate()` (a parameterless `client.query`), so a
 *  multi-statement migration file applies here exactly as it does there.
 *  (drizzle's pglite `migrate()` uses the extended protocol, which rejects a
 *  multi-statement chunk — a harness-only failure the shipped app never has.) */
export function applyMigrationsStmt(deplDir, pgliteVar = "pglite") {
  const folder = JSON.stringify(migrationsFolderOf(deplDir));
  return `for (const __m of __readEmittedMigrations({ migrationsFolder: ${folder} })) for (const __q of __m.sql) if (__q.trim()) await ${pgliteVar}.exec(__q);`;
}

// The shared-database leg (`LOOM_BH_ELIXIR_SCHEMA=shared`).
//
// Deployables bound to one postgres storage share its database, and only the
// first of them applies migrations: every other backend reads and writes
// tables a DIFFERENT backend created.  So every backend must map the shared
// migration schema column for column.  The SQL backends render that schema
// through one renderer (`src/generator/sql-pg.ts`), so their own boots already
// prove it; the Ecto emitter renders it in its own DSL, so this leg proves
// Elixir in both directions, on every behavioural case:
//
//   1. the case gains a node deployable, declared FIRST on the same storage, so
//      node owns the database's migrations and the elixir deployable is a
//      non-owner — exactly the topology a user writes;
//   2. the database is created by the node project's SQL chain, and the elixir
//      app boots on it without migrating and runs the case's emitted api suite
//      (reads and writes on tables Ecto did not create);
//   3. the elixir project's own `mix ecto.migrate` runs into a second database,
//      and the two catalogs must be identical — so the other four backends,
//      proven on the shared schema by their own legs, also map the schema
//      elixir creates when it is the owner.
//
// Every case runs; a refusal of the topology fails the case at generation.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

/** The emitted suite repeats a `test e2e` against every deployable serving its
 *  api, so it carries a copy against the node owner too; the leg dispatches
 *  every request to the elixir app, so it drops those copies by this name. */
export const OWNER_TEST_NAME = / against \w+_schema_owner$/;

/** `source` with a node deployable that owns the database declared before the
 *  elixir one: a copy of the elixir deployable's block, renamed, on platform
 *  node and its own port.  Declared first, it is the database's migrator. */
export function withSchemaOwner(source) {
  const block = /\n([ \t]*)deployable\s+(\w+)\s*\{[^{}]*platform:\s*elixir\b[^{}]*\}/.exec(source);
  if (!block) throw new Error("shared-schema: no `platform: elixir` deployable block to copy");
  const [whole, indent, name] = block;
  const owner = whole
    .replace(`deployable ${name}`, `deployable ${name}SchemaOwner`)
    .replace(/platform:\s*elixir\b/, "platform: node")
    .replace(/port:\s*\d+/, "port: 4999");
  if (owner === whole) throw new Error(`shared-schema: could not copy deployable ${name}`);
  return source.replace(whole, `${owner}\n${indent}${whole.slice(1)}`);
}

/** Apply the node project's migration chain (the shared schema, rendered by
 *  `sql-pg.ts`) to `pgUrl`, in journal order. */
export async function applySharedSchema(nodeProjectDir, pgUrl) {
  const dir = join(nodeProjectDir, "db", "migrations");
  const journal = JSON.parse(readFileSync(join(dir, "meta", "_journal.json"), "utf8"));
  const client = new pg.Client({ connectionString: pgUrl });
  await client.connect();
  try {
    for (const entry of journal.entries) {
      const sql = readFileSync(join(dir, `${entry.tag}.sql`), "utf8");
      for (const stmt of sql.split("--> statement-breakpoint")) {
        if (stmt.trim()) await client.query(stmt);
      }
    }
  } finally {
    await client.end();
  }
}

/** Create database `name` on the server `pgUrl` points at, if missing. */
export async function ensureDatabase(pgUrl, name) {
  const admin = new URL(pgUrl);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (rowCount === 0) await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
}

/** Every user table's columns, constraints and indexes, as sorted lines — the
 *  schema a backend maps.  Each migrator's own bookkeeping (Ecto's
 *  `schema_migrations`, Drizzle's `drizzle` schema) is not part of it. */
export async function schemaFingerprint(pgUrl) {
  const client = new pg.Client({ connectionString: pgUrl });
  await client.connect();
  const notOurs = `NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'drizzle')`;
  try {
    const columns = await client.query(`
      SELECT format('column %s.%s.%s %s%s %s default=%s', table_schema, table_name, column_name,
                    udt_name, coalesce('(' || numeric_precision || ',' || numeric_scale || ')', ''),
                    CASE WHEN is_nullable = 'YES' THEN 'null' ELSE 'not null' END,
                    coalesce(column_default, '-')) AS line
      FROM information_schema.columns
      WHERE table_schema ${notOurs} AND table_name <> 'schema_migrations'`);
    const constraints = await client.query(`
      SELECT format('constraint %s %s %s', c.conrelid::regclass, c.conname, pg_get_constraintdef(c.oid)) AS line
      FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname ${notOurs} AND c.conrelid::regclass::text NOT LIKE '%schema_migrations'`);
    const indexes = await client.query(`
      SELECT format('index %s', indexdef) AS line FROM pg_indexes
      WHERE schemaname ${notOurs} AND tablename <> 'schema_migrations'`);
    return [...columns.rows, ...constraints.rows, ...indexes.rows].map((r) => r.line).sort();
  } finally {
    await client.end();
  }
}

/** The lines only one of two fingerprints has, `-` for `expected`, `+` for
 *  `actual`; empty when they agree. */
export function fingerprintDiff(expected, actual) {
  const a = new Set(expected);
  const b = new Set(actual);
  return [...expected.filter((l) => !b.has(l)).map((l) => `- ${l}`), ...actual.filter((l) => !a.has(l)).map((l) => `+ ${l}`)];
}

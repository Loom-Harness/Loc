import type { MigrationsIR } from "../../ir/types/migrations-ir.js";

/** The Postgres `search_path` for a connection that names its tables
 *  unqualified (the Dapper and MikroORM repositories): `public` first (where
 *  the migration ledger, the seed marker and the outbox live, and where an
 *  unqualified `CREATE` lands), then every schema the migration chain puts this
 *  deployable's tables in, sorted. */
export function searchPathSchemas(migrations: readonly MigrationsIR[]): string[] {
  const schemas = new Set<string>();
  for (const m of migrations) {
    for (const t of m.next.tables) if (t.schema && t.schema !== "public") schemas.add(t.schema);
  }
  return ["public", ...[...schemas].sort()];
}

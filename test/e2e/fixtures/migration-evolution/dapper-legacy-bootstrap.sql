-- The database a PRE-MIGRATION Dapper deployable of base.ddd provisioned.
--
-- Verbatim the `DbSchema.Sql` constant the toolchain emitted for
-- `base.ddd` with `platform: dotnet { persistence: dapper }` before Dapper
-- applied the migration chain (stack base 5e440413b, #3204).  Its
-- `DbSchema.EnsureAsync` ran this on every boot: `CREATE TABLE IF NOT EXISTS`
-- in the UNQUALIFIED (`public`) schema, with no history table.
--
-- `runDapperLegacyBaselineGate` loads it into an empty database, adds one row,
-- and boots the migration-aware app against it: the first boot must baseline
-- this database (move the table into its context schema, record the Initial as
-- applied) and then apply the v1 -> v2 delta on top, keeping the row.
CREATE TABLE IF NOT EXISTS products (
    id uuid primary key,
    name text not null,
    price numeric not null,
    status text not null,
    version integer not null
);

// ---------------------------------------------------------------------------
// Database topology — which Postgres database each backend deployable runs on,
// and which deployable migrates it.
//
// A database belongs to a `storage`, not to a deployable: every `needsDb`
// deployable whose `state` data source binds a postgres storage runs on that
// storage's database, so two deployables bound to one storage read and write
// the same rows.  A deployable that binds no postgres storage keeps a database
// of its own, named after itself.
//
// Each database has exactly ONE migrator — the first `needsDb` deployable on
// it in declaration order — and only it applies migrations at boot.  Every
// deployable on the database carries the migrations of every module any of
// them hosts (the database's whole schema), so the migrator lands the union of
// the tables and the others still know the schema they read.  One migrator per
// database is what keeps the migration-history tables sound:
// each backend's runner (Drizzle, EF Core, Dapper, Flyway, Alembic-style,
// Ecto) records applied ids in one table and expects to own it, so two
// runners on one database would race the same DDL or refuse each other's
// history.
//
// The compose file (`DATABASE_URL`, `db-init/`), the migration slice each
// backend receives, and the playground's storage plan all read this module,
// so they cannot disagree about which deployables share data.
// ---------------------------------------------------------------------------

import { descriptorFor } from "../../platform/metadata.js";
import { serviceSlug } from "../../util/service-slug.js";
import type { DeployableIR } from "../types/deployment.js";
import type { SystemIR } from "../types/system.js";

type Topology = Pick<SystemIR, "deployables" | "dataSources" | "storages" | "subdomains">;

/** A deployable's database: its name in Postgres and, when it is a storage's
 *  database, that storage. */
export interface DatabaseBinding {
  /** The Postgres database name (`CREATE DATABASE <name>`). */
  readonly name: string;
  /** The postgres `storage` this database belongs to; undefined for a
   *  deployable's own database. */
  readonly storage?: string;
}

/** The postgres storage a deployable's `state` data sources bind — the first
 *  in `dataSources:` order. */
export function boundPostgresStorage(sys: Topology, d: DeployableIR): string | undefined {
  const postgres = new Set(
    (sys.storages ?? []).filter((s) => s.type === "postgres").map((s) => s.name),
  );
  for (const dsName of d.dataSourceNames ?? []) {
    const ds = (sys.dataSources ?? []).find((x) => x.name === dsName);
    if (ds?.kind === "state" && postgres.has(ds.storageName)) return ds.storageName;
  }
  return undefined;
}

/** The database a `needsDb` deployable runs on; undefined for a deployable
 *  whose platform has no database. */
export function databaseOf(sys: Topology, d: DeployableIR): DatabaseBinding | undefined {
  if (!d.platform || !descriptorFor(d.platform).needsDb) return undefined;
  const storage = boundPostgresStorage(sys, d);
  return storage !== undefined
    ? { name: serviceSlug(storage), storage }
    : { name: serviceSlug(d.name) };
}

/** Every database the system provisions, in first-use (declaration) order. */
export function systemDatabases(sys: Topology): string[] {
  const out: string[] = [];
  for (const d of sys.deployables) {
    const db = databaseOf(sys, d);
    if (db && !out.includes(db.name)) out.push(db.name);
  }
  return out;
}

/** The `needsDb` deployables on database `name`, in declaration order. */
export function deployablesOnDatabase(sys: Topology, name: string): DeployableIR[] {
  return (sys.deployables ?? []).filter((d) => databaseOf(sys, d)?.name === name);
}

/** The deployable that migrates database `name`. */
export function databaseMigrator(sys: Topology, name: string): DeployableIR | undefined {
  return deployablesOnDatabase(sys, name)[0];
}

/** The modules (subdomains) whose contexts a deployable hosts. */
export function hostedModules(sys: Pick<SystemIR, "subdomains">, d: DeployableIR): Set<string> {
  const hosted = new Set(d.contextNames);
  const out = new Set<string>();
  for (const sd of sys.subdomains) {
    if (sd.contexts.some((c) => hosted.has(c.name))) out.add(sd.name);
  }
  return out;
}

/** The modules whose tables live in database `name` — every module any
 *  deployable on it hosts. */
export function databaseModules(sys: Topology, name: string): Set<string> {
  const out = new Set<string>();
  for (const d of deployablesOnDatabase(sys, name)) {
    for (const m of hostedModules(sys, d)) out.add(m);
  }
  return out;
}

/** The modules whose migrations deployable `d` carries: every module of its
 *  database, so each deployable on a shared database knows the whole schema
 *  it reads and its test suites can build that schema in a scratch database.
 *  Only the database's migrator RUNS them at boot ({@link migratesAtBoot}). */
export function carriedModules(sys: Topology, d: DeployableIR): Set<string> {
  const db = databaseOf(sys, d);
  return db ? databaseModules(sys, db.name) : new Set();
}

/** Whether `d` applies its migrations at boot: true for a database's migrator
 *  (and for a deployable alone on its database), false for a deployable whose
 *  storage's database an earlier deployable migrates. */
export function migratesAtBoot(sys: Topology, d: DeployableIR): boolean {
  return awaitedMigrator(sys, d) === undefined;
}

/** The deployable a non-migrating deployable waits for before it boots: its
 *  database's migrator.  Undefined for the migrator itself and for a
 *  deployable without a database. */
export function awaitedMigrator(sys: Topology, d: DeployableIR): DeployableIR | undefined {
  const db = databaseOf(sys, d);
  if (!db) return undefined;
  const migrator = databaseMigrator(sys, db.name);
  return migrator && migrator.name !== d.name ? migrator : undefined;
}

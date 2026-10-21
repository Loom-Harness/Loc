import type { EnrichedSystemIR } from "../ir/types/loom-ir.js";
import type { MigrationsIR } from "../ir/types/migrations-ir.js";
import type { MigrationArtifactIndex } from "./migration-artifacts.js";
import { diffSchema } from "./migrations-builder.js";

// ---------------------------------------------------------------------------
// Re-rooting an output tree written by the pre-migration Dapper toolchain.
//
// Before D-DAPPER-ALTER's chain landed, `persistence: dapper` emitted NO
// migration files: `DbSchema.cs` ran `CREATE TABLE IF NOT EXISTS` at boot.
// Phase ⑨ still derived the chain and wrote the module snapshot, so such a tree
// carries a snapshot whose `migrationHistory` names versions that were never
// written to disk.  The migration-baseline guard (b) refuses exactly that
// shape ("history entry with no file"), which is why the old toolchain could
// only ever generate ONCE into a Dapper tree: every later generate failed
// there.  So the history of every such tree is a single `Initial`, and the
// snapshot it carries IS the schema that Initial describes — the schema the old
// bootstrap provisioned.
//
// The first generate with the migration-aware toolchain re-roots the module: it
// re-emits that Initial (a pure function of the snapshot's tables, under the
// version the history already records), followed by this run's delta, and the
// snapshot history is rewritten to name only those two.  At boot, the Dapper
// runner then baselines the existing database against the re-emitted Initial
// (`DbSchema.cs`, `BaselineLegacyAsync`), and the delta applies on top.
//
// Recognised by its exact signature, and only on a Dapper-owned module: a
// non-empty snapshot history of which NOT ONE version has a file on disk.  A
// migration-aware tree always has its Initial on disk; any other backend in
// that state is genuine drift, and guard (b) still refuses it.
// ---------------------------------------------------------------------------

export interface RerootResult {
  /** The migrations to emit — the input, with each re-rooted module's
   *  re-emitted Initial inserted ahead of its delta. */
  migrations: MigrationsIR[];
  /** module → the version the re-emitted Initial will occupy on disk, so the
   *  baseline guard sees the tree as it will be after this run's writes. */
  rerooted: Map<string, string>;
}

export function rerootLegacyDapperModules(
  sys: EnrichedSystemIR,
  migrations: readonly MigrationsIR[],
  onDisk: MigrationArtifactIndex | undefined,
): RerootResult {
  const rerooted = new Map<string, string>();
  if (!onDisk) return { migrations: [...migrations], rerooted };
  const out: MigrationsIR[] = [];
  for (const m of migrations) {
    const owner = sys.subdomains.find((s) => s.name === m.module)?.migrationsOwner;
    const ownerDep = sys.deployables.find((d) => d.name === owner);
    const history = m.baseline?.migrationHistory ?? [];
    const files = new Set(onDisk.versions(m.module));
    if (
      ownerDep?.persistence !== "dapper" ||
      m.baseline === null ||
      history.length === 0 ||
      history.some((h) => files.has(h.version))
    ) {
      out.push(m);
      continue;
    }
    const root = history[0]!;
    const initial: MigrationsIR = {
      module: m.module,
      storageName: m.storageName,
      baseline: null,
      next: { ...m.baseline, migrationHistory: [root] },
      steps: diffSchema(null, m.baseline),
      version: root.version,
      name: "Initial",
    };
    // This run's snapshot keeps the re-emitted Initial and, when there is one,
    // this run's own delta — the history entries in between never had a file
    // and never will.
    const appended = m.steps.length > 0 ? (m.next.migrationHistory ?? []).slice(-1) : [];
    out.push(initial, { ...m, next: { ...m.next, migrationHistory: [root, ...appended] } });
    rerooted.set(m.module, root.version);
  }
  return { migrations: out, rerooted };
}

/** `index` plus the versions this run is about to write for re-rooted modules. */
export function withRerootedVersions(
  index: MigrationArtifactIndex,
  rerooted: ReadonlyMap<string, string>,
): MigrationArtifactIndex {
  return {
    versions: (module) => {
      const v = rerooted.get(module);
      return v === undefined ? index.versions(module) : [...index.versions(module), v];
    },
  };
}

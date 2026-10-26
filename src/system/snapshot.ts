import type { SchemaSnapshot, TableShape } from "../ir/types/migrations-ir.js";

// ---------------------------------------------------------------------------
// Snapshot store — the per-module baseline `buildMigrations` diffs against.
//
// Production callers build one from the migration chain's head
// (`headSnapshots` in `migration-chain.ts`); tests and the playground pass an
// in-memory map.  The interface keeps the derivation free of where the
// baseline came from.
// ---------------------------------------------------------------------------

export interface SnapshotStore {
  /** The module's baseline schema, or `null` when it has none yet. */
  read(module: string): SchemaSnapshot | null;
}

export function memorySnapshotStore(initial: Record<string, SchemaSnapshot> = {}): SnapshotStore {
  return {
    read(module: string): SchemaSnapshot | null {
      return initial[module] ?? null;
    },
  };
}

/** A snapshot in the form it is committed: tables sorted by name (the builder
 *  already does this; re-sorted defensively), columns and indexes in declared
 *  order, derivation-only stamps dropped. */
export function canonicalSnapshot(snapshot: SchemaSnapshot): SchemaSnapshot {
  const tables = [...snapshot.tables]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(stripDerivationOnlyFields);
  return { ...snapshot, tables };
}

/** Drop the column stamps that describe the SOURCE rather than the database.
 *
 *  A committed snapshot records the schema a generation leaves behind.
 *  `ColumnShape.capability` (which built-in capability contributed the column
 *  — read only by the destructive gate's explanation) is a source stamp, and
 *  so is `ColumnShape.lineageOf` (the `provenanced` field a lineage column
 *  backs — read only by the add-column diff).  `ColumnShape.addColumnDefault` (the `.ddd` field default lent to an
 *  add-column diff) is not part of that schema in any sense: no `CREATE TABLE`
 *  renders it, the diff never compares it, and the one step that consumes it
 *  drops the DEFAULT again in the same migration — so the column it describes
 *  provably has no default.  Every generation re-derives all three from source, so
 *  nothing reads the baseline's copy.
 *
 *  Contrast `savingShape` and `valueArrayChildTable`, which stay: both ARE
 *  read back from the baseline (reshape detection; the value-collection diff
 *  filter), so they are part of what the snapshot is for. */
function stripDerivationOnlyFields(t: TableShape): TableShape {
  if (
    !t.columns.some(
      (c) =>
        c.addColumnDefault !== undefined || c.capability !== undefined || c.lineageOf !== undefined,
    )
  ) {
    return t;
  }
  return {
    ...t,
    columns: t.columns.map(({ addColumnDefault: _d, capability: _c, lineageOf: _l, ...c }) => c),
  };
}

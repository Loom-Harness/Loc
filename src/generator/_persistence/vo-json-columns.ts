import type {
  ColumnShape,
  ColumnType,
  MigrationStep,
  MigrationsIR,
  SchemaSnapshot,
} from "../../ir/types/migrations-ir.js";

// ---------------------------------------------------------------------------
// Value objects stored as ONE json column — the shared projection.
//
// The canonical MigrationsIR flattens a value-object field into its LEAF
// columns (`price_amount`, `price_currency`, both `voGroup: "price"`), which is
// the shape the EF / Drizzle / JPA / SQLAlchemy mappings query.  Two
// persistence layers instead store the whole value object as ONE json column
// named for the field: Phoenix (an Ecto `:map`) and the .NET Dapper adapter
// (`jsonb`, serialised with System.Text.Json).  Both regroup the canonical
// columns and steps through these two functions, so the two never disagree on
// what a value-object add / drop / rename / nullability flip becomes.
// ---------------------------------------------------------------------------

/** Regroup the flattened leaf columns of a value-object field
 *  (`price_amount`, `price_currency`, both `voGroup: "price"`) back into a
 *  single `:map` column named for the group.  The canonical migration
 *  flattens value objects into columns (the relational/DDD shape the
 *  Drizzle / EF ORMs query); the Phoenix Ecto schema stores an embedded
 *  value object as one `:map`, so Phoenix collapses each group here.  A group's `:map` is
 *  nullable iff every leaf is (i.e. the value-object field itself was
 *  optional).  Columns without a `voGroup` pass through unchanged. */
export function collapseVoGroups(columns: readonly ColumnShape[]): ColumnShape[] {
  const out: ColumnShape[] = [];
  const handled = new Set<string>();
  for (const c of columns) {
    if (!c.voGroup) {
      out.push(c);
      continue;
    }
    if (handled.has(c.voGroup)) continue;
    handled.add(c.voGroup);
    const group = columns.filter((x) => x.voGroup === c.voGroup);
    out.push({ name: c.voGroup, type: { kind: "json" }, nullable: group.every((x) => x.nullable) });
  }
  return out;
}

/** The DELTA twin of {@link collapseVoGroups}.  The canonical diff speaks in
 *  flattened value-object LEAF columns (`price_amount`, `price_currency`), but
 *  an Ecto schema stores the whole value object as ONE `:map` column named for
 *  the field — which is what every create-table path here already emits.  A
 *  value-object field that arrives LATER used to reach the delta file leaf by
 *  leaf, so the table grew `price_amount` / `price_currency` columns the
 *  schema's `field :price, :map` never reads, and `:price` itself did not
 *  exist (eval follow-up B-A3b).
 *
 *  Only `addColumn` carries its `ColumnShape` (and so its `voGroup`); every
 *  other column step names a bare column, so a leaf is recognised by looking
 *  the column up in the snapshot it lives in — `next` for an add / flip,
 *  `baseline` for a drop / the old side of a rename.  Per `(table, group)`:
 *
 *  - `addColumn` of a leaf whose group is NEW in this migration → one
 *    `add :<group>, :map` (nullable iff every leaf add in the group is, which
 *    keeps the destructive gate's add-nullable-then-SET-NOT-NULL sequence);
 *    a leaf added to a group the baseline already has (the value object grew a
 *    field) needs nothing — the map already holds the value object.
 *  - `alterColumnNullable` of a leaf → one `modify :<group>, :map`, null iff
 *    every leaf of the group is nullable in `next` (the same rule the create
 *    path applies).
 *  - `dropColumn` of a leaf → one `remove :<group>` when the group is gone from
 *    `next`; nothing when it survives (the value object only lost a field).
 *  - `renameColumn` between two groups (the field was renamed) → one rename of
 *    the map column; a leaf rename inside a surviving group needs no DDL.
 *  - `alterColumnType` / `alterColumnDefault` of a leaf → nothing: the column
 *    is the map, whose type and (absent) default do not change.
 *
 *  Every other step passes through unchanged. */
export function collapseVoSteps(m: MigrationsIR): MigrationStep[] {
  const groupOf = (
    snap: SchemaSnapshot | null,
    table: string,
    schema: string | undefined,
    column: string,
  ): string | undefined =>
    snap?.tables
      .find((t) => t.name === table && t.schema === schema)
      ?.columns.find((c) => c.name === column)?.voGroup;
  const groupLeaves = (
    snap: SchemaSnapshot | null,
    table: string,
    schema: string | undefined,
    group: string,
  ): ColumnShape[] =>
    snap?.tables
      .find((t) => t.name === table && t.schema === schema)
      ?.columns.filter((c) => c.voGroup === group) ?? [];
  const MAP: ColumnType = { kind: "json" };
  const done = new Set<string>();
  const once = (op: string, table: string, schema: string | undefined, group: string): boolean => {
    const key = `${op}|${schema ?? ""}|${table}|${group}`;
    if (done.has(key)) return false;
    done.add(key);
    return true;
  };
  const out: MigrationStep[] = [];
  for (const step of m.steps) {
    switch (step.op) {
      case "addColumn": {
        const group = step.column.voGroup;
        if (!group) {
          out.push(step);
          break;
        }
        if (groupLeaves(m.baseline, step.table, step.schema, group).length > 0) break;
        if (!once("add", step.table, step.schema, group)) break;
        const adds = m.steps.filter(
          (s): s is Extract<MigrationStep, { op: "addColumn" }> =>
            s.op === "addColumn" &&
            s.table === step.table &&
            s.schema === step.schema &&
            s.column.voGroup === group,
        );
        out.push({
          op: "addColumn",
          table: step.table,
          ...(step.schema !== undefined ? { schema: step.schema } : {}),
          column: { name: group, type: MAP, nullable: adds.every((s) => s.column.nullable) },
        });
        break;
      }
      case "alterColumnNullable": {
        const group = groupOf(m.next, step.table, step.schema, step.name);
        if (!group) {
          out.push(step);
          break;
        }
        if (!once("nullable", step.table, step.schema, group)) break;
        out.push({
          ...step,
          name: group,
          type: MAP,
          nullable: groupLeaves(m.next, step.table, step.schema, group).every((c) => c.nullable),
        });
        break;
      }
      case "dropColumn": {
        const group = groupOf(m.baseline, step.table, step.schema, step.name);
        if (!group) {
          out.push(step);
          break;
        }
        if (groupLeaves(m.next, step.table, step.schema, group).length > 0) break;
        if (!once("drop", step.table, step.schema, group)) break;
        out.push({ ...step, name: group });
        break;
      }
      case "renameColumn": {
        const from = groupOf(m.baseline, step.table, step.schema, step.from);
        const to = groupOf(m.next, step.table, step.schema, step.to);
        if (!from && !to) {
          out.push(step);
          break;
        }
        if (from === to || !from || !to) break;
        if (!once("rename", step.table, step.schema, from)) break;
        out.push({ ...step, from, to, type: MAP });
        break;
      }
      case "alterColumnType":
      case "alterColumnDefault":
        if (!groupOf(m.next, step.table, step.schema, step.name)) out.push(step);
        break;
      default:
        out.push(step);
    }
  }
  return out;
}

import type { AggregateIR, FieldIR } from "../types/loom-ir.js";

/** The aggregate-root fields whose column carries a plain covering index in the
 *  shared migration schema — the ORM-side mirror of the FK index
 *  `schemaFromModule` derives (`<table>_<column>_idx`) for every `X id` column.
 *
 *  An ORM schema that declares indexes (Drizzle `index(...)`, EF `HasIndex`)
 *  must declare exactly the set the migrations create, or `drizzle-kit` /
 *  EF model diffs disagree with the migrated database.  Loom never auto-emits a
 *  performance index for a filtered column (D-INDEX-SUGGEST): a find's `where`
 *  columns get the advisory `loom.index-suggestion` lint and the manual
 *  `resource index:` hatch, not an index here.
 *
 *  When the table carries the aggregate's `unique (...)` indexes (`uniqueIndexed`
 *  — the relational root does, the embedded root does not), a column an
 *  unconditional single-column unique key already covers is left out, matching
 *  the migration's drop of a plain index a unique index provides.  Under
 *  `softDeletable` the unique index is partial, so the plain one stays. */
export function fkIndexedFields(agg: AggregateIR, uniqueIndexed: boolean): FieldIR[] {
  const softDeletable = agg.capabilities?.includes("softDeletable") ?? false;
  const uniqueCovered = new Set(
    softDeletable || !uniqueIndexed
      ? []
      : (agg.uniqueKeys ?? []).filter((uk) => uk.columns.length === 1).map((uk) => uk.columns[0]),
  );
  return agg.fields.filter((f) => {
    const base = f.type.kind === "optional" ? f.type.inner : f.type;
    return base.kind === "id" && !uniqueCovered.has(f.name);
  });
}

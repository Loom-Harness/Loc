// -------------------------------------------------------------------------
// The name of Loom's built-in optimistic-concurrency counter.
//
// The `versioned` capability (spliced by default onto every state-persisted
// aggregate, `src/macros/prelude.ts`) contributes exactly one field: this
// counter.  It is named `rowVersion` — not `version` — so that `version` stays
// an ordinary domain name a model can declare as plain data (a rule set's
// version, a document revision) without silently aliasing the concurrency
// column.  A user field that would land on the same member or column is the
// `loom.version-field-collision` error instead.
//
// Every spelling a target needs derives from these constants, so the member,
// the wire key, the SQL column and each backend's property name cannot drift
// apart:
//   - DSL / IR member and JSON wire key: `rowVersion`
//   - SQL column (the normal snake-casing): `row_version`
//   - PascalCase property (.NET / Java accessors): `RowVersion`
//
// Lives in `src/util/` because it is consumed at every pipeline layer (the
// macro prelude, the IR, the system migrations builder, every generator).
// -------------------------------------------------------------------------

/** The counter's member name in the DSL, the IR and the JSON wire. */
export const ROW_VERSION_FIELD = "rowVersion";

/** The counter's SQL column — `snake(ROW_VERSION_FIELD)`. */
export const ROW_VERSION_COLUMN = "row_version";

/** The counter's PascalCase spelling (.NET properties, Java accessors). */
export const ROW_VERSION_PASCAL = "RowVersion";

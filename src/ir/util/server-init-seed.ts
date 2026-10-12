// ---------------------------------------------------------------------------
// The language-defined value a SERVER-OWNED field takes when nothing writes it.
//
// A `managed` / `internal` field is off the create input, so the create factory
// must still name it in its all-fields state literal.  For most scalar types
// there is an obvious, universally-agreed value to put there — and the question
// "is there one?" is the whole of `loom.unconstructible-server-field`: a field
// WITH a seed is constructible and every backend can emit the same one; a field
// WITHOUT one has no input anywhere and the aggregate genuinely cannot be
// created.
//
// MEASURED, not assumed.  On `main`, the same model
// (`loginCount: int managed`, `adminNotes: string internal`,
// `total: money managed`) emitted:
//
//   | field                      | node          | python          | java / dotnet    |
//   |----------------------------|---------------|-----------------|------------------|
//   | `loginCount: int managed`  | `0`           | `0`             | unassigned → 0   |
//   | `adminNotes: string internal` | `""`       | `""`            | unassigned → NULL|
//   | `total: money managed`     | `null` into a non-nullable `Decimal`       |     |
//
// Two different failures hide in that table.  The `money` row is the real
// unconstructible one — there is no zero for a `Decimal`, so `null` goes into a
// non-nullable slot on EVERY backend.  The `string` row is a PARITY defect:
// node and python fabricate `""` while java and dotnet leave the field
// unassigned and insert NULL into a NOT NULL column.  The first is refused
// here; the second is closed by having every backend render the same seed,
// which is why this table lives at the IR layer instead of inside one emitter.
//
// The kinds are NEUTRAL (`"now"`, not `new Date()`): each backend spells them
// in its own language, and no backend may add a kind of its own — a type
// absent from this table is a refusal, not an emitter's private default.
// ---------------------------------------------------------------------------

import type { TypeIR } from "../types/loom-ir.js";

/** The language-defined absent value for a server-owned field, or `null` when
 *  the type has none. */
export type ServerInitSeed = "now" | "zero" | "false" | "empty-string" | "empty-collection";

/** The seed for `t`, or `null` when the type has no language-defined absent
 *  value — `money` (no `Decimal` zero anyone agreed on), `json`, an enum (no
 *  member is privileged), a value object, an `X id` (there is no null id).
 *
 *  An OPTIONAL type never reaches here: `T?` already says absent is `null`, and
 *  the constructibility gate exempts it before asking. */
export function serverInitSeed(t: TypeIR): ServerInitSeed | null {
  const base = t.kind === "optional" ? t.inner : t;
  // An absent collection is the empty collection — every backend already lands
  // `[]` there, and `party: Pokemon id[] managed` built up by later operations
  // is ordinary modelling.
  if (base.kind === "array") return "empty-collection";
  if (base.kind !== "primitive") return null;
  switch (base.name) {
    case "datetime":
      return "now";
    case "int":
    case "long":
    case "decimal":
      return "zero";
    case "bool":
      return "false";
    case "string":
    case "guid":
      return "empty-string";
    default:
      // `money`, `json`, and anything the primitive vocabulary grows later.
      // Defaulting to a seed would be the fabrication this module exists to
      // avoid, so a new primitive is unconstructible-as-server-owned until
      // someone decides what its absent value IS.
      return null;
  }
}

import {
  type ValueObjectScope,
  type VoLeaf,
  voLeaves,
} from "../../ir/plan/value-object-columns.js";
import type { TypeIR } from "../../ir/types/loom-ir.js";

// When an OPTIONAL value object stored as leaf columns reads back as absent.
//
// One rule, on every reader: the value object is absent when every column of a
// leaf it REQUIRES is NULL.  A value object with no required leaf cannot be
// told apart from one whose leaves are all unset, so it is absent when every
// leaf is NULL (the validator hints at that shape).  The shared
// null-consistency CHECK (`valueObjectChecks`, `migrations-builder.ts`) makes
// the rule exact: when the required leaves are NULL, so is every other leaf.
// Each reader renders "absent when every probed leaf is NULL" in its own
// language; none re-derives which leaves to probe.

/** The leaves of the optional value-object field `prop` (of value-object type
 *  `t`, with or without its `optional`) whose all-NULL reads as absent: its
 *  required leaves, else all of them. */
export function absenceProbe(prop: string, t: TypeIR, scope: ValueObjectScope): VoLeaf[] {
  const inner = t.kind === "optional" ? t.inner : t;
  // Leaves of the PRESENT value object: `nullable` is then the leaf's own
  // optionality (or an optional value object inside it).
  const leaves = voLeaves(prop, inner, scope);
  const required = leaves.filter((l) => !l.nullable);
  return required.length > 0 ? required : leaves;
}

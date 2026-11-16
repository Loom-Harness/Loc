import {
  type ValueObjectScope,
  type VoLeaf,
  voLeaves,
} from "../../ir/plan/value-object-columns.js";

// When an OPTIONAL value object stored as leaf columns reads back as absent.
//
// Every mapping that composes an optional value object from its leaf columns
// asks this one table which leaves to probe, and renders "absent when every
// probed leaf is NULL" in its own language.  The readers still answer
// differently for one row the shared null-consistency CHECK admits — required
// leaves NULL while an optional leaf is set — and that difference lives only
// here: settling it is a change to `ABSENT_RULE`, nothing else.

/** Which leaves decide absence.
 *  - `first-declared-leaf` — the first leaf in declaration order.
 *  - `first-required-leaf` — the first leaf the value object requires; with
 *    none, the value object is never read as absent.
 *  - `every-leaf` — all of them. */
export type AbsentRule = "first-declared-leaf" | "first-required-leaf" | "every-leaf";

/** Each read path that composes a stored optional value object. */
export type AbsenceReader =
  /** node, both adapters: an aggregate, part or TPH row hydrated into the domain. */
  | "node-row-hydrate"
  /** node, both adapters: a projection or saga row projected straight to the wire. */
  | "node-raw-row"
  /** .NET Dapper: any row hydrated into the domain (EF Core's optional owned
   *  type is null when all its columns are). */
  | "dapper-row";

export const ABSENT_RULE: Readonly<Record<AbsenceReader, AbsentRule>> = {
  "node-row-hydrate": "first-declared-leaf",
  "node-raw-row": "first-required-leaf",
  "dapper-row": "every-leaf",
};

/** The leaves of the optional value-object field `prop` (of value-object type
 *  `t`, with or without its `optional`) whose all-NULL reads as absent for
 *  `reader`.  Empty means the value object is never read as absent. */
export function absenceProbe(
  reader: AbsenceReader,
  prop: string,
  t: Parameters<typeof voLeaves>[1],
  scope: ValueObjectScope,
): VoLeaf[] {
  const inner = t.kind === "optional" ? t.inner : t;
  // Leaves of the PRESENT value object: `nullable` is then the leaf's own
  // optionality (or an optional ancestor inside the value object).
  const leaves = voLeaves(prop, inner, scope);
  switch (ABSENT_RULE[reader]) {
    case "first-declared-leaf":
      return leaves.slice(0, 1);
    case "first-required-leaf": {
      const required = leaves.find((l) => !l.nullable);
      return required ? [required] : [];
    }
    case "every-leaf":
      return leaves;
  }
}

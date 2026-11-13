// A value-object collection crossing into a new owner — `.NET` spelling.
//
// A value object has value semantics, but EF Core maps a `List<VO>` as OWNED
// entities: each element INSTANCE is tracked with its owner's key.  Assigning
// a list loaded from another aggregate (`RuleSet.create(conditions:
// src.conditions)`, `conditions := src.conditions`) attaches those tracked
// instances to the new owner, and SaveChanges fails ("… is part of a key and so
// cannot be modified") — a 500.  Copying each record (`x with { }`) gives the
// new owner fresh instances, which is what the value semantics promised.

import type { ExprIR, TypeIR } from "../../ir/types/loom-ir.js";

/** Is `t` (through `?`) a list of value objects? */
export function isVoList(t: TypeIR): boolean {
  const u = t.kind === "optional" ? t.inner : t;
  return u.kind === "array" && u.element.kind === "valueobject";
}

/** `expr`, element-copied when it is a value-object list read from somewhere
 *  else.  A list literal already builds fresh instances and stays as written. */
export function csVoListCopy(t: TypeIR, value: ExprIR | undefined, expr: string): string {
  if (!isVoList(t) || value?.kind === "list") return expr;
  const nullable = t.kind === "optional";
  return `${expr}${nullable ? "?" : ""}.Select(__vo => __vo with { }).ToList()`;
}

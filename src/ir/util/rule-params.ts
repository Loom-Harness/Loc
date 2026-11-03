// ---------------------------------------------------------------------------
// The identifiers a rule reads — the candidate `{x}` placeholders of its
// message.
//
// A named rule's text (`locales/en/<Ctx>.json`) may name the values the rule
// judges: `"Product.rule.inStock": "Only {stock} left, asked for {qty}"`.  The
// candidates are exactly the fields and parameters the predicate (and its
// `when` guard) READ — never a `let`, a lambda binding or an enum value, which
// have no value at the point the rule trips that a response could carry.  The
// wire `params` (the values of the placeholders a message actually uses) and
// the `ddd i18n check` placeholder validation both read this set.
// ---------------------------------------------------------------------------

import type { ExprIR, RefKind } from "../types/loom-ir.js";
import { walkExprDeep } from "./walk.js";

/** Ref kinds that name a value the rule judges: a parameter, or a field of the
 *  owner (entity field, value-object field, derived field). */
const PARAM_REF_KINDS: ReadonlySet<RefKind> = new Set<RefKind>([
  "param",
  "this-prop",
  "this-vo-prop",
  "this-derived",
]);

/** The identifiers `rule` reads, deduplicated and sorted. */
export function ruleParams(rule: { expr: ExprIR; guard?: ExprIR }): string[] {
  const names = new Set<string>();
  const visit = (e: ExprIR): void => {
    if (e.kind === "ref" && PARAM_REF_KINDS.has(e.refKind)) names.add(e.name);
  };
  walkExprDeep(rule.expr, visit);
  walkExprDeep(rule.guard, visit);
  return [...names].sort();
}

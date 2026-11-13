// ---------------------------------------------------------------------------
// The identifiers a rule reads — the candidate `{x}` placeholders of its
// message.
//
// A named rule's text (`locales/en/<Ctx>.json`) may name the values the rule
// judges: `"Product.rule.inStock": "Only {stock} left, asked for {qty}"`.  The
// candidates are exactly the scalar / id / enum / value-object fields and
// parameters the predicate (and its `when` guard) READ — never a `let`, a
// lambda binding or an enum value, which have no value at the point the rule
// trips that a response could carry, and never a collection or entity part,
// which is internal state a response must not carry.  The
// wire `params` (the values of the placeholders a message actually uses) and
// the `ddd i18n check` placeholder validation both read this set.
// ---------------------------------------------------------------------------

import type { ExprIR, RefKind, TypeIR } from "../types/loom-ir.js";
import { walkExprDeep } from "./walk.js";

/** Ref kinds that name a value the rule judges: a parameter, or a field of the
 *  owner (entity field, value-object field, derived field). */
const PARAM_REF_KINDS: ReadonlySet<RefKind> = new Set<RefKind>([
  "param",
  "this-prop",
  "this-vo-prop",
  "this-derived",
]);

/** True when a value of type `t` can stand in a message placeholder and ride
 *  the wire `params`: a scalar, an id, an enum or a value object (optionally
 *  nullable).  A collection or an entity part is internal aggregate state — a
 *  backend that serializes it whole puts every part's private fields (and
 *  other rows' data) into the 422 body — so a rule reading `coverages` or
 *  `tasks` judges it but never echoes it.  An untyped ref is kept: lowering
 *  types every data member and parameter it resolves. */
function isEchoable(t: TypeIR | undefined): boolean {
  if (t === undefined) return true;
  switch (t.kind) {
    case "optional":
      return isEchoable(t.inner);
    case "primitive":
    case "id":
    case "enum":
    case "valueobject":
      return true;
    default:
      return false;
  }
}

/** A ref naming a value the rule judges AND may echo on the wire. */
function isParamRef(e: ExprIR): e is ExprIR & { kind: "ref" } {
  return e.kind === "ref" && PARAM_REF_KINDS.has(e.refKind) && isEchoable(e.type);
}

/** The identifiers `rule` reads, deduplicated and sorted. */
export function ruleParams(rule: { expr: ExprIR; guard?: ExprIR }): string[] {
  const names = new Set<string>();
  const visit = (e: ExprIR): void => {
    if (isParamRef(e)) names.add(e.name);
  };
  walkExprDeep(rule.expr, visit);
  walkExprDeep(rule.guard, visit);
  return [...names].sort();
}

/** One reference per identifier `rule` reads (`ruleParams` order) — the
 *  expression a backend renders to carry that identifier's VALUE on the wire
 *  `params` when the rule trips. */
export function ruleParamRefs(rule: {
  expr: ExprIR;
  guard?: ExprIR;
}): { name: string; ref: ExprIR & { kind: "ref" } }[] {
  const byName = new Map<string, ExprIR & { kind: "ref" }>();
  const visit = (e: ExprIR): void => {
    if (isParamRef(e) && !byName.has(e.name)) byName.set(e.name, e);
  };
  walkExprDeep(rule.expr, visit);
  walkExprDeep(rule.guard, visit);
  return ruleParams(rule).map((name) => ({ name, ref: byName.get(name)! }));
}

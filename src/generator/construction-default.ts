// Construction-seedable defaults — which `= default` the domain `create`
// factory materializes itself.
//
// A `field: T = <expr>` the create input does not carry — kept off it by its
// access modifier (`managed` / `internal` / `token`) or left out of a narrowed
// declared `create(…)` — still carries a declared default, and a default is a
// CONSTRUCTION rule: no client param carries the field, so the public `create`
// factory is the only place its value can be materialized.  Miss it and the
// field falls to the type zero (`0`, `""`, a CLR/`BigDecimal` zero-or-null) —
// silently wrong for a counter, an insert failure for a NOT NULL money column.
//
// The question is "is this a compile-time constant every domain expression
// renderer can emit" — the frontend's client-evaluable seed subset PLUS money
// literals, which need a runtime carrier (`Decimal` / `decimal` /
// `BigDecimal`) a JS form seed cannot spell but every backend renders natively.
//
// Still excluded, deliberately: `now()` / `currentUser.*` (server-sourced — the
// audit/prepare path stamps them, see `isServerSourcedDefault`) and sequences /
// cross-aggregate lookups (no construction-time value exists yet). Both keep
// falling through to each backend's type-correct seed.
//
// Elixir does not consume this: it carries a server-owned default on the Ecto
// schema field (`field :mm, :decimal, default: Decimal.new("2.50")`), which is
// already correct for every case in this module's remit.

import type { WithAccess } from "../ir/enrich/wire-projection.js";
import { forCreateInput } from "../ir/enrich/wire-projection.js";
import type { ExprIR } from "../ir/types/loom-ir.js";
import { isConstantDefault } from "../ir/util/constant-default.js";
import type { FieldWithDefault } from "./_frontend/server-default.js";

/** Whether the `create` factory can seed this default directly — i.e. it is a
 *  compile-time constant (literal incl. money, enum member, or a paren/unary
 *  over one) rather than a server stamp or a deferred lookup.  The predicate
 *  lives at the IR layer (`isConstantDefault`) because the narrowed-create gate
 *  asks the same question. */
export function isConstructionSeedableDefault(e: ExprIR): boolean {
  return isConstantDefault(e);
}

/**
 * Fields the `create` factory must seed with their declared default because
 * they are outside the create-input set (`inputNames` — the aggregate's
 * `createInputFields`: `forCreateInput` drops `token`/`managed`/`internal`,
 * and a narrowed declared `create(…)` drops every field its list leaves out)
 * yet their default is {@link isConstructionSeedableDefault}.
 *
 * The predicate identifies the fields; each backend renders the VALUE with its
 * own domain-expression renderer (`renderTsExpr`/`renderPyExpr`/`renderCsExpr`/
 * `renderJavaExpr`), all of which handle a superset of this subset, so a
 * matched field always renders.
 */
export function constructionSeededFields<T extends WithAccess & FieldWithDefault>(
  fields: readonly T[],
  inputNames: ReadonlySet<string> = new Set(forCreateInput(fields).map((f) => f.name)),
): (T & { default: ExprIR })[] {
  return fields.filter(
    (f): f is T & { default: ExprIR } =>
      !inputNames.has(f.name) &&
      f.default !== undefined &&
      isConstructionSeedableDefault(f.default),
  );
}

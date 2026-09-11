// Construction-seedable defaults — the DOMAIN-factory sibling of
// `_frontend/server-default.ts`'s `constructionSeededDefaults`.
//
// A `field: T = <expr>` whose access modifier keeps it OFF the create input
// (`managed` / `internal` / `token`) still carries a declared default, and a
// default is a CONSTRUCTION rule: no client param carries the field, so the
// public `create` factory is the only place its value can be materialized.
// Miss it and the field falls to the type zero (`0`, `""`, a CLR/`BigDecimal`
// zero-or-null) — silently wrong for a counter, an insert failure for a
// NOT NULL money column.
//
// Which defaults qualify used to be decided by `renderDefaultSeed` — the
// FRONTEND's *client-evaluable* subset, written for `useForm({ defaultValues })`
// seeding. That is the wrong question to ask about a domain factory, and it is
// exactly why `money` defaults were dropped on four of five backends: a money
// literal needs a runtime carrier (`Decimal` / `decimal` / `BigDecimal`) that a
// plain JS form seed has no way to spell, but every backend's DOMAIN expression
// renderer emits one natively. The right question is "is this a compile-time
// constant the domain renderer can emit", so this module asks that instead:
// the client-evaluable subset PLUS money literals.
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
import { renderDefaultSeed } from "./_frontend/default-seed.js";
import type { FieldWithDefault } from "./_frontend/server-default.js";

/** A `money("2.50")` default.  Lowered as a plain literal (`lit: "money"`),
 *  outside `renderDefaultSeed`'s client subset because a JS form seed has no
 *  decimal carrier — but a compile-time constant every backend's domain
 *  expression renderer emits (`new Decimal(…)` / `2.50m` / `new BigDecimal(…)`). */
function isMoneyLiteral(e: ExprIR): boolean {
  return e.kind === "literal" && e.lit === "money";
}

/** Whether the `create` factory can seed this default directly — i.e. it is a
 *  compile-time constant (literal incl. money, enum member, or a paren/unary
 *  over one) rather than a server stamp or a deferred lookup. */
export function isConstructionSeedableDefault(e: ExprIR): boolean {
  return isMoneyLiteral(e) || renderDefaultSeed(e) !== null;
}

/**
 * Fields the `create` factory must seed with their declared default because
 * they are outside the create-input set (`forCreateInput` drops
 * `token`/`managed`/`internal`, so no client param carries them) yet their
 * default is {@link isConstructionSeedableDefault}.
 *
 * The predicate identifies the fields; each backend renders the VALUE with its
 * own domain-expression renderer (`renderTsExpr`/`renderPyExpr`/`renderCsExpr`/
 * `renderJavaExpr`), all of which handle a superset of this subset, so a
 * matched field always renders.
 */
export function constructionSeededFields<T extends WithAccess & FieldWithDefault>(
  fields: readonly T[],
): (T & { default: ExprIR })[] {
  const inputNames = new Set(forCreateInput(fields).map((f) => f.name));
  return fields.filter(
    (f): f is T & { default: ExprIR } =>
      !inputNames.has(f.name) &&
      f.default !== undefined &&
      isConstructionSeedableDefault(f.default),
  );
}

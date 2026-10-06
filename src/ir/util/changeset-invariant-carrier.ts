// ---------------------------------------------------------------------------
// Can the Elixir (Ecto/Phoenix) changeset carrier enforce a given aggregate
// invariant?  The PURE judgement, with no renderer attached.
//
// Lives in `ir/util` rather than beside the emitter for the same reason
// `sql-renderable-expr.ts` does: TWO layers need the same answer and the
// dependency may only point one way.  The elixir emitter
// (`src/generator/elixir/vanilla/changeset-invariant-emit.ts`) asks "do I emit a
// check for this rule?", and the phase-⑦ IR validator
// (`src/ir/validate/checks/backend-syntax-checks.ts` →
// `validateElixirInvariantCoverage`) asks the complement — "is there a rule
// this backend will enforce NOWHERE?" — so it can say so instead of letting it
// vanish.  One judgement, two readers: a shape cannot be silently dropped by
// the emitter while the validator believes it is covered.
//
// Why the validator half exists at all (#3023): a rule matching neither the
// native `validate_*` path nor this carrier used to fall through BOTH with no
// diagnostic, so `invariant lines.count > 0` was enforced on node/.NET/java/
// python and nowhere on elixir, at `0 error(s), 0 warning(s)`.
// ---------------------------------------------------------------------------

import type { AggregateIR, ExprIR, InvariantIR } from "../types/loom-ir.js";
import { singleFieldConstraints } from "../validate/invariant-classify.js";

/** Reads that resolve against the applied struct (`data.<col>`).
 *
 *  WIDENED (#3023).  This judgement used to stop at scalar `this`-props, and
 *  every richer shape fell through BOTH carriers — the native path (which
 *  answers null for anything not single-field) and this one — so it was
 *  enforced NOWHERE while node/.NET/java/python all emit it at their domain
 *  floor.  Measured: an aggregate carrying `sku.trim().length > 0`,
 *  `lines.count > 0` and `isBig == false` alongside two single-field rules
 *  enforced 2 of 5 on Elixir and 5 of 5 everywhere else, at
 *  `0 error(s), 0 warning(s)`.
 *
 *  The renderer was never the blocker: `validate_invariants/1` renders through
 *  the SAME `renderExpr` the operation/derived bodies use, which already emits
 *  `String.length(String.trim(data.sku))`, `Enum.count(data.lines)` and an
 *  INLINED derived expression.  So the three shapes below are admitted, each
 *  with the one precondition that makes it safe on the applied struct — see
 *  `extendedShape` for the carrier those preconditions need.
 *
 *  What is still refused is refused because a changeset validator genuinely
 *  cannot reproduce it (`currentUser`, a resource op, a helper call, a
 *  cross-aggregate read).  Those no longer vanish: `unrenderableInvariants`
 *  reports them as `loom.elixir-invariant-unenforced`, so every invariant on
 *  this backend is now either ENFORCED or DIAGNOSED — never dropped. */
export function structEvaluable(
  e: ExprIR,
  scope: ReadonlySet<string> = new Set(),
  /** Field names that are NOT readable off the applied struct even though they
   *  look like ordinary props — the un-cast association collections.  See
   *  `unreadableCollections`: reading one yields an empty list on every write
   *  path, so a rule over it would pass VACUOUSLY.  Empty set ⇒ nothing is
   *  excluded (the judgement's behaviour before this parameter existed). */
  opaque: ReadonlySet<string> = new Set(),
): boolean {
  const rec = (x: ExprIR, s: ReadonlySet<string> = scope): boolean => structEvaluable(x, s, opaque);
  switch (e.kind) {
    case "literal":
      // `now()` is non-deterministic in a validator; every other literal
      // (incl. money — the changeset runs server-side with Decimal) reads fine.
      return e.lit !== "now";
    case "id":
      return true; // `data.id` is a real column
    case "ref":
      switch (e.refKind) {
        case "this-prop":
          // An un-cast association collection reads as `[]` here regardless of
          // the request, so enforcing over it would be enforcement in NAME
          // ONLY.  Refused, and therefore diagnosed.
          return !opaque.has(e.name);
        case "this-vo-prop":
        case "enum-value":
          return true;
        // A derived is a pure function of stored fields and is NOT a column, so
        // `data.<name>` would be a missing struct key (`KeyError` at runtime).
        // `renderExpr`'s `this-derived` arm inlines the defining expression
        // instead — but ONLY when `ctx.agg` carries the derived index, which is
        // why `renderInvariantValidatorFn` now threads it (without that the
        // accessor fallback ships the KeyError).  Admitted here; the ctx is the
        // other half.
        case "this-derived":
          return true;
        case "let":
        case "lambda":
          return scope.has(e.name);
        default:
          // helper-fn, current-user, resource, param, unknown — not readable
          // off the applied struct.
          return false;
      }
    case "paren":
      return rec(e.inner);
    case "unary":
      return rec(e.operand);
    case "binary":
      return rec(e.left) && rec(e.right);
    case "ternary":
      return rec(e.cond) && rec(e.then) && rec(e.otherwise);
    // A member READ off a struct-evaluable receiver: an array's `.count` /
    // `.length` (→ `Enum.count/1`), a string's `.length` (→ the code-point
    // count), a VO property.  The receiver carries the whole judgement — a
    // `currentUser.x` or helper receiver still rejects through it.
    case "member":
      return rec(e.receiver);
    // A method call whose receiver AND every argument read off the struct:
    // scalar intrinsics (`sku.trim()`, `n.abs()`, `m.round(2)`) and the
    // collection ops (`lines.any(l => …)` → `Enum.any?/2`).  A collection op's
    // lambda binds its parameter, so the param joins `scope` for that arg —
    // the same mechanism the `lambda` refKind above already reads.
    case "method-call":
      return rec(e.receiver) && e.args.every((a) => structEvaluableArg(a, scope, opaque));
    // All REJECT: domain logic, a constructor, or a shape a changeset cannot
    // reproduce.  `false` is the conservative answer — the invariant simply is
    // not lifted into the changeset, never emitted wrongly.
    //
    // NAMED rather than left to a `default:`, and closed with the `never` check
    // below, because a `default:` here answers for kinds that do not exist yet:
    // the next `ExprIR` kind would be silently REJECTED, so an invariant using
    // it would go quietly undiagnosed instead of failing this file's typecheck.
    // (CLAUDE.md's no-hand-rolled-IR-walks rule; `ir-walk-census.test.ts` pins
    // it.)  This drain was applied by wave CR1 to the judgement's previous home
    // in `elixir/vanilla/changeset-invariant-emit.ts`; #3023 relocated the
    // function here and the `default:` came with it, so it is re-applied where
    // the code now lives.
    case "call":
    case "match":
    case "new":
    case "object":
    case "list":
    case "convert":
    case "this":
    case "action-ref":
    case "lambda":
    case "authz-filter":
    case "duration":
      return false;
    // `i18nFormat` is a TRANSPARENT wrapper (`` `{total, currency}` ``): its
    // `inner` carries the real expression, so the consistent answer here is
    // `rec(e.inner)` the way `paren` is handled — rejecting it refuses an
    // invariant this seam could lift.  Left as a rejection anyway, because
    // changing it changes EMISSION (a currently-diagnosed invariant would start
    // being enforced) and that is not a rebase conflict's business.
    //
    // Recorded rather than silently inherited: this is the third instance of the
    // same hole wave CR1 found in `loom.method-call-unresolved-receiver`, where
    // a missing `i18nFormat` arm made every gate that module raises blind to
    // anything inside a `{x, format}` hole. A corpus without `, format` holes
    // cannot see it, which is why it keeps surviving. Follow-up, deliberately
    // not bundled here.
    case "i18nFormat":
      return false;
    default: {
      const never: never = e;
      void never;
      return false;
    }
  }
}

/** An argument position, which may be a LAMBDA (a collection op's predicate).
 *  A lambda's parameter is in scope for its own body and nowhere else. */
function structEvaluableArg(
  e: ExprIR,
  scope: ReadonlySet<string>,
  opaque: ReadonlySet<string>,
): boolean {
  if (e.kind === "lambda") {
    // Block-bodied lambdas run statements, which this carrier cannot host;
    // only the single-expression form is evaluable.
    if (e.body === undefined) return false;
    return structEvaluable(e.body, new Set([...scope, e.param]), opaque);
  }
  return structEvaluable(e, scope, opaque);
}

/** `singleFieldConstraints` with the GUARD gate lifted.
 *
 *  The classifier refuses a guarded invariant outright (`if (inv.guard) return
 *  null`) because a native `validate_number`/`validate_length`/`validate_format`
 *  line has nowhere to put the implication — and that is the right answer for
 *  the NATIVE path.  It is the wrong question here: this module renders the
 *  predicate through `renderExpr`, where `.length` / `.matches(…)` / a numeric
 *  bound come out as `String.length(data.x)` / `Regex.match?(…)` /
 *  `Decimal.compare(…)` and an `if <guard> do … end` wraps them fine.
 *
 *  Asking the native question of a guarded rule is what dropped
 *  `invariant note.length > 0 when taxRate > 0` on the floor (M-T6.55 F15):
 *  the native path skipped it because it is guarded, and this one skipped it
 *  because `singleFieldConstraints` answered null — so NOTHING enforced it,
 *  while node/.NET/java/python all emit the implication. */
export function structRenderableShape(inv: InvariantIR): boolean {
  return singleFieldConstraints(inv.guard ? { ...inv, guard: undefined } : inv) !== null;
}

/** Collection fields that read as `[]` off the applied struct on EVERY write
 *  path, so a rule over one would pass vacuously.
 *
 *  A `Target id[]` field lowers to a `many_to_many` whose join rows the
 *  repository writes AFTER the changeset runs — the changeset only carries a
 *  `foreign_key_constraint`, never a `cast_assoc`.  So `data.<field>` is
 *  `%NotLoaded{}` on create and (absent a preload) on update, and the `[]` this
 *  module normalises it to is not "the request sent none", it is "the changeset
 *  cannot see them".  `invariant party.count <= 6` over such a field would
 *  therefore be TRUE for a 7-member party — enforcement in name only, which is
 *  strictly worse than the silent drop it replaced, because it also looks
 *  enforced.
 *
 *  Refused here and reported by `unrenderableInvariants` instead.  Contained
 *  collections are a different story and stay enforceable: `cast_assoc` puts
 *  them in the changeset, so `apply_changes/1` materialises exactly what the
 *  request sent. */
export function unreadableCollections(
  agg: Pick<AggregateIR, "invariants"> & Partial<Pick<AggregateIR, "associations">>,
): ReadonlySet<string> {
  return new Set((agg.associations ?? []).map((a) => a.fieldName));
}

/** True when this rule's predicate AND guard can both be rendered against the
 *  applied struct — a struct-evaluable cross-field comparison, or a recognised
 *  single-field shape (`.length` / `.matches` / numeric bound). */
export function renderableHere(inv: InvariantIR, opaque: ReadonlySet<string>): boolean {
  return (
    (structEvaluable(inv.expr, new Set(), opaque) || structRenderableShape(inv)) &&
    (inv.guard === undefined || structEvaluable(inv.guard, new Set(), opaque))
  );
}

/** Invariants this backend can enforce on NEITHER carrier — the residual after
 *  the widening above.  Measured, not guessed: after #3023 the shapes that
 *  actually land here are a REFERENCE-collection read (`X id[]`, see
 *  `unreadableCollections`) and a `domainService` / resource call.
 *
 *  Deliberately NOT in that list, because they never arrive:
 *    • a `currentUser` read — already a hard error anywhere in an invariant
 *      (`loom.currentuser-not-in-request-scope`);
 *    • a top-level `function` call — those INLINE at lowering, so no `call`
 *      node survives and the rule is simply enforced.
 *
 *  They used to be dropped in silence.  They are now REPORTED
 *  (`loom.elixir-invariant-unenforced`), which is the whole point of #3023:
 *  after it, an invariant on Elixir is either enforced or diagnosed, and the
 *  set of silently-missing rules is empty BY CONSTRUCTION rather than by
 *  enumeration — a shape nobody thought of lands here too. */
export function unrenderableInvariants(
  agg: Pick<AggregateIR, "invariants"> & Partial<Pick<AggregateIR, "associations">>,
): InvariantIR[] {
  const opaque = unreadableCollections(agg);
  return (agg.invariants ?? []).filter(
    (inv) => singleFieldConstraints(inv) === null && !renderableHere(inv, opaque),
  );
}

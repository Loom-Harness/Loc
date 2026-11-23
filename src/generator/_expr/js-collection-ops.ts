// Shared JavaScript collection-op renderer table — the JS half of the
// `isCollectionOp` seam, consumed by BOTH the Hono/TypeScript backend
// (`typescript/render-expr.ts`) and the four JS-embedding frontend walkers
// (React / Vue / Svelte / Angular, through `_walker/js-expr-leaves.ts`).
//
// It lives here for the same reason `js-intrinsics.ts` does: those five
// surfaces emit the SAME language, so one table is what makes
// `orders.where(o => o.open).count` mean the same thing in an aggregate
// `derived` as it does in a page body.  It also means the money and
// value-object special-cases below — which took several audit findings to get
// right (A14, F2-EXPR-4) — are not re-derived, and re-broken, per frontend.
//
// The table was previously `TS_COLLECTION_RENDERERS` inside
// `typescript/render-expr.ts`, which still re-exports it under that name.
// Moved verbatim: the frontends' first emission of every op is byte-identical
// to what the backend has been emitting.
//
// NOTE the arms are keyed by catalogue op name, and the completeness pin
// (`test/generator/collection-op-completeness.test.ts`) asserts every
// catalogue op has a key — so a future op is a compile-time-caught omission
// rather than a silent fall-through to a verbatim `.member(...)`.

import { type SortKey, sortKeyOf } from "../../ir/plan/sort-order.js";
import type { ExprIR, TypeIR } from "../../ir/types/loom-ir.js";
import { isDescendingSort } from "../../ir/util/collection-op-site.js";
import { bodyTypeOf } from "../../util/expr-body-type.js";
import { FRONTEND_DECIMAL } from "./js-decimal.js";

// Re-exported under the path `typescript/render-expr.ts` has always used.
export { isDescendingSort };

/** Keyed renderer table — one entry per collection op.  The completeness pin
 *  (`test/generator/collection-op-completeness.test.ts`) asserts every catalogue
 *  op has a key here, so a future op is a compile-time-caught omission rather
 *  than a silent fall-through. */
export type JsCollectionRenderers = Record<
  string,
  (recv: string, args: string[], e?: Extract<ExprIR, { kind: "method-call" }>) => string
>;

/** The collection-op table with decimal.js's `Decimal` class spelled `decimal`
 *  (the caller's hook, `js-decimal.ts`). */
export function jsCollectionRenderers(decimal: string): JsCollectionRenderers {
  return {
    count: (recv) => `${recv}.length`,
    // `sum` over MONEY (decimal.js `Decimal`) must fold with `.plus` from a
    // `new Decimal(0)` seed — a native `0 + Decimal` coerces to a string.  int/
    // long/decimal are plain `number` on this backend, so they keep the native
    // `+`/`0`-seed form.  Numeric type is the λ-body type (lambda form) or the
    // receiver's element type (no-arg `money[]` sum).
    sum: (recv, args, e) =>
      sumBodyIsMoney(e)
        ? args.length === 1
          ? `${recv}.reduce((acc, x) => acc.plus((${args[0]})(x)), new ${decimal}(0))`
          : `${recv}.reduce((acc, x) => acc.plus(x), new ${decimal}(0))`
        : args.length === 1
          ? `${recv}.reduce((acc, x) => acc + (${args[0]})(x), 0)`
          : `${recv}.reduce((acc, x) => acc + x, 0)`,
    all: (recv, args) => `${recv}.every(${args[0] ?? "() => true"})`,
    any: (recv, args) => `${recv}.some(${args[0] ?? "() => true"})`,
    // Array membership.  For value types this is JS's `.includes(value)` (===).
    // For an OBJECT element — money (decimal.js `Decimal`) or a value object —
    // `===` is reference identity and two value-equal elements never match, so
    // the membership test dispatches to a value-equality scan through the
    // element's own equality method (`.eq` / `.equals`), the same reason min/max/
    // sum special-case money.
    contains: (recv, args, e) => {
      const eqm = receiverElementEqMethod(e);
      return eqm
        ? `${recv}.some((__x) => __x.${eqm}(${args[0] ?? "undefined"}))`
        : `${recv}.includes(${args[0] ?? "undefined"})`;
    },
    where: (recv, args) => `${recv}.filter(${args[0] ?? "() => true"})`,
    // `first` is PARTIAL (D-FIRST-ON-EMPTY / RS-36): its declared type is a
    // non-optional `T`, so an empty receiver must FAIL rather than hand back the
    // `undefined` a bare `[0]` yields — which then flows onto the wire, or dies
    // later somewhere that never mentions the collection.  The guard is an arrow
    // IIFE so the receiver is evaluated ONCE (a `recv.length > 0 ? recv[0] : …`
    // ternary would emit the whole receiver chain twice), and it is still an
    // expression, which is what every emission site here requires.
    first: (recv) =>
      `((__c) => { if (__c.length === 0) throw new Error("'.first' on an empty collection — use '.firstOrNull' for the total form"); return __c[0]; })(${recv})`,
    firstOrNull: (recv) => `(${recv}[0] ?? null)`,
    map: (recv, args) => `${recv}.map(${args[0]})`,
    // The one sort order (`src/ir/plan/sort-order.ts`): `Array.prototype.sort`
    // is stable; text and enum keys (strings here) compare by CODE POINT, not
    // by UTF-16 unit; money keys are decimal.js `Decimal`s, whose `<` coerces
    // through a string, so they compare with `.lt` / `.gt`; an absent key sorts
    // last ascending.  Descending negates the comparison, so ties keep order.
    sortBy: (recv, args, e) => {
      const desc = e ? isDescendingSort(e) : false;
      const key = sortByKey(e);
      const cmp =
        key.cls === "money"
          ? "ka.lt(kb) ? -1 : ka.gt(kb) ? 1 : 0"
          : key.cls === "text" || key.cls === "enum"
            ? JS_CODE_POINT_COMPARE
            : "ka < kb ? -1 : ka > kb ? 1 : 0";
      const ordered = key.optional
        ? `ka == null || kb == null ? (ka == null ? (kb == null ? 0 : 1) : -1) : ${cmp}`
        : cmp;
      return `[...${recv}].sort((__a, __b) => { const ka = (${args[0]})(__a), kb = (${args[0]})(__b); const c = ${ordered}; return ${desc ? "-c" : "c"}; })`;
    },
    // `new Set` dedupes by SameValueZero — reference identity for objects — so a
    // `money[]` (decimal.js `Decimal` instances) or a value-object collection
    // never dedupes at all: two value-equal elements are distinct references.
    // Fall back to an equality-keyed first-occurrence filter for both, the same
    // object-element special-case the `contains`/`sum`/`sortBy`/`min`/`max` rows
    // already carry (audit A14; F2-EXPR-4 for the value-object half).
    distinct: (recv, _args, e) => {
      const eqm = receiverElementEqMethod(e);
      return eqm
        ? `${recv}.filter((__x, __i, __a) => __a.findIndex((__y) => __y.${eqm}(__x)) === __i)`
        : `[...new Set(${recv})]`;
    },
    take: (recv, args) => `${recv}.slice(0, ${args[0]})`,
    skip: (recv, args) => `${recv}.slice(${args[0]})`,
    join: (recv, args) => `${recv}.join(${args[0]})`,
    // min/max return the PROJECTED value, empty → null.  Uniform comparator-
    // reduce works for number/string/Date via `<`/`>`.  Money is decimal.js
    // `Decimal` — its `<`/`>` operators don't compare, so a money projection
    // dispatches to the `.lt`/`.gt` method form (bodyTypeOf on the lambda body).
    min: (recv, args, e) =>
      projectionBodyIsMoney(e)
        ? `(${recv}.length ? ${recv}.map(${args[0]}).reduce((__a, __b) => (__b.lt(__a) ? __b : __a)) : null)`
        : `(${recv}.length ? ${recv}.map(${args[0]}).reduce((__a, __b) => (__b < __a ? __b : __a)) : null)`,
    max: (recv, args, e) =>
      projectionBodyIsMoney(e)
        ? `(${recv}.length ? ${recv}.map(${args[0]}).reduce((__a, __b) => (__b.gt(__a) ? __b : __a)) : null)`
        : `(${recv}.length ? ${recv}.map(${args[0]}).reduce((__a, __b) => (__b > __a ? __b : __a)) : null)`,
  };
}

/** The frontends' table — the class spelled bare. */
export const JS_COLLECTION_RENDERERS: JsCollectionRenderers =
  jsCollectionRenderers(FRONTEND_DECIMAL);

/** Code-point comparison of two strings `ka` / `kb` — spreading iterates by
 *  code point, so an astral character is one element.  Plain JS that also
 *  type-checks under strict indexed access (the generated apps'
 *  `noUncheckedIndexedAccess`), as it renders into TS, Vue and Svelte alike. */
export const JS_CODE_POINT_COMPARE =
  "(() => { const x = [...ka], y = [...kb]; for (let i = 0; i < x.length && i < y.length; i++) { const p = x[i]?.codePointAt(0) ?? 0, q = y[i]?.codePointAt(0) ?? 0; if (p !== q) return p - q; } return x.length - y.length; })()";

/** How a `sortBy` call's projected key compares — the one sort order
 *  (`src/ir/plan/sort-order.ts`) — for every frontend's `sortBy` arm. */
export function sortByKey(e?: Extract<ExprIR, { kind: "method-call" }>): SortKey {
  return sortKeyOf(projectionBodyType(e));
}

/** The type of a collection op's lambda body (its projected key). */
function projectionBodyType(e?: Extract<ExprIR, { kind: "method-call" }>): TypeIR | undefined {
  const lam = e?.args[0];
  return lam?.kind === "lambda" && lam.body ? bodyTypeOf(lam.body) : undefined;
}

/** True iff a `min`/`max` reduction's lambda body types as `money` — its
 *  projected values are decimal.js `Decimal`s, which need `.lt`/`.gt` rather
 *  than the native `<`/`>` comparators. */
function projectionBodyIsMoney(e?: Extract<ExprIR, { kind: "method-call" }>): boolean {
  const lam = e?.args[0];
  const bodyT = lam?.kind === "lambda" && lam.body ? bodyTypeOf(lam.body) : undefined;
  return bodyT?.kind === "primitive" && bodyT.name === "money";
}

/** The VALUE-equality method a collection op's element type carries, or null
 *  when the element compares correctly with JS identity (`===`).
 *
 *  Both element kinds here are OBJECTS on this backend, so `.includes` /
 *  `new Set` compare references and silently answer wrong: `money` elements are
 *  decimal.js `Decimal`s (`.eq`), and a `valueobject` element is a generated
 *  class carrying the field-wise `equals` every VO emits (emit/value-objects.ts
 *  — a VO's defining property).  The validator ADMITS both element types on
 *  `distinct`/`contains` (`loom.distinct-non-scalar` reads "requires a scalar or
 *  value-object element"), and every other backend is structural by
 *  construction — python frozen dataclass, .NET/java records, elixir maps —
 *  so node was alone in returning duplicates from a dedupe and `false` from a
 *  membership test (F2-EXPR-4). */
function receiverElementEqMethod(
  e?: Extract<ExprIR, { kind: "method-call" }>,
): "eq" | "equals" | null {
  const rt = e?.receiverType;
  if (!rt) return null;
  const unwrapped = rt.kind === "optional" ? rt.inner : rt;
  const elem = unwrapped.kind === "array" ? unwrapped.element : undefined;
  if (elem?.kind === "primitive" && elem.name === "money") return "eq";
  if (elem?.kind === "valueobject") return "equals";
  return null;
}

/** True iff a `sum` reduction's numeric type is `money` — the λ-body type for
 *  `sum(λ)`, the receiver's element type for a no-arg `money[]` sum.  A money
 *  sum folds decimal.js `Decimal`s (`.plus` from a `new Decimal(0)` seed); a
 *  numeric sum stays native `+`/`0`. */
function sumBodyIsMoney(e?: Extract<ExprIR, { kind: "method-call" }>): boolean {
  if (!e) return false;
  const lam = e.args[0];
  if (lam?.kind === "lambda" && lam.body) {
    const bodyT = bodyTypeOf(lam.body);
    return bodyT?.kind === "primitive" && bodyT.name === "money";
  }
  const rt = e.receiverType;
  const unwrapped = rt.kind === "optional" ? rt.inner : rt;
  const elem = unwrapped.kind === "array" ? unwrapped.element : undefined;
  return elem?.kind === "primitive" && elem.name === "money";
}

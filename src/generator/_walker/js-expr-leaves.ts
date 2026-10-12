// Shared JavaScript expression-leaf table for the JSX-family frontends
// (React / Vue / Svelte / Angular).  Every one of those frontends embeds
// JavaScript in its markup, so the pure-syntax `ExprIR` arms (operators,
// literals, list/object spelling, the `convert` cast) render identically —
// they were a single hardcoded block inside `emitExpr` until Feliz (the first
// non-JS-embedding frontend) forced the `WalkerTarget` expr-leaf seam.
//
// This is the JS half of that seam: the four JS targets spread it in, Feliz
// supplies `FS_LEAVES` (F#).  `emitExpr` now delegates every divergent arm to
// the target with NO fallback — one dispatcher, one leaf table per embedded
// language, mirroring the backend `_expr/target.ts` design.  The strings below
// are byte-for-byte what `emitExpr` produced inline before the extraction.

import type { BinOp, ExprIR, LiteralKind, PrimitiveName, TypeIR } from "../../ir/types/loom-ir.js";
import { FRONTEND_RENDERED_COLLECTION_OPS } from "../../ir/util/collection-op-site.js";
import { JS_COLLECTION_RENDERERS } from "../_expr/js-collection-ops.js";
import { renderJsIntrinsic } from "../_expr/js-intrinsics.js";
import type { WalkerTarget } from "./target.js";

/** The seven expression-leaf methods every `WalkerTarget` supplies, plus the
 *  optional scalar-intrinsic and collection-op seams — the JS family shares
 *  the TypeScript backend's snippet tables, since it emits the same language. */
type ExprLeaves = Pick<
  WalkerTarget,
  | "exprLiteral"
  | "exprBinary"
  | "exprMoneyBinary"
  | "exprUnary"
  | "exprTernary"
  | "exprConvert"
  | "exprList"
  | "exprObject"
  | "renderIntrinsic"
  | "renderCollectionOp"
>;

/** The JS leaf formatters — pure string→string, sub-expressions pre-rendered. */
export const jsExprLeaves: ExprLeaves = {
  exprLiteral(lit: LiteralKind, value: string): string {
    if (lit === "string") return JSON.stringify(value);
    if (lit === "bool") return value;
    if (lit === "null") return "null";
    // `money` is a decimal.js `Decimal` on this surface, NOT a number — the
    // same representation the TS backend uses (`typescript/render-expr.ts`'s
    // `renderLiteral`), and the one `exprConvert` below already assumes when it
    // emits `new Decimal(…)` for a cast to money.  This leaf had diverged and
    // emitted the bare numeric literal, so a money `state {}` field seeded with
    // `money("12.50")` produced `ref(12.50)` / `$state<Decimal>(12.50)` — a
    // type error on Vue and Svelte.  (React never reaches here: its state-init
    // path renders the money literal itself, which is why the divergence hid.)
    // Quoted, so the decimal string is parsed exactly rather than round-tripped
    // through a float.
    if (lit === "money") return `new Decimal(${JSON.stringify(value)})`;
    // int / decimal / now → emit as numeric literal verbatim.
    return String(value);
  },
  exprBinary(left: string, right: string, op: BinOp | string): string {
    // Strict equality on the wire — mirrors the backend renderer and keeps
    // emitted TSX clean under Biome's `noDoubleEquals`.
    const o = op === "==" ? "===" : op === "!=" ? "!==" : op;
    return `(${left} ${o} ${right})`;
  },
  // `money` is a decimal.js `Decimal` here, and the host operators on one are
  // wrong in a way nothing reports: `===` compares REFERENCES (`10` vs `10.00`
  // is unequal, and so is `10` vs `10`), `<`/`>` coerce through `valueOf()` to
  // STRINGS and order lexicographically (`9 < 10` is false), and an absent
  // `money?` coerces to `0`.  See `renderJsMoneyBinary`.
  exprMoneyBinary(left, right, e) {
    return renderJsMoneyBinary(left, right, e);
  },
  exprUnary(op: string, operand: string): string {
    return `(${op}${operand})`;
  },
  exprTernary(cond: string, then: string, otherwise: string): string {
    return `(${cond} ? ${then} : ${otherwise})`;
  },
  exprConvert(
    value: string,
    target: PrimitiveName | string,
    from: PrimitiveName | string | undefined,
  ): string {
    // Mirrors `generator/typescript/render-expr.ts`'s renderTsConvert, with
    // ONE deliberate divergence: `datetime`.  The backend holds a `Date` and
    // so converts with `.toISOString()`; on this surface a datetime has
    // already crossed the wire as `z.string()`, so it IS the ISO text and
    // `String(value)` is the identity.  Copying the backend's arm here would
    // emit `.toISOString()` on a `string` — TS2339.  Same Loom expression,
    // different host representation either side of the wire.
    if (target === "string") {
      if (from === "money") return `${value}.toString()`;
      return `String(${value})`;
    }
    if (target === "long" || target === "decimal") {
      if (from === "money") return `${value}.toNumber()`;
      return value;
    }
    if (target === "money") {
      if (from === "money") return value;
      return `new Decimal(${value})`;
    }
    return value;
  },
  exprList(elements: string[]): string {
    return `[${elements.join(", ")}]`;
  },
  exprObject(fields: ReadonlyArray<{ name: string; value: string }>): string {
    return `{ ${fields.map((f) => `${f.name}: ${f.value}`).join(", ")} }`;
  },
  // The JS frontends and the Hono/TypeScript backend emit the SAME language,
  // so they share ONE intrinsic snippet table — that shared table is what makes
  // `s.replace(a, b)` mean replace-ALL in a page body exactly as it does in an
  // aggregate `derived`.  See `_expr/js-intrinsics.ts`.
  renderIntrinsic: renderJsIntrinsic,
  // …and ONE collection-op table, for the same reason: `orders.where(o =>
  // o.open).count` means what it means in an aggregate `derived`, money and
  // value-object equality special-cases included.  See
  // `_expr/js-collection-ops.ts`.
  renderCollectionOp: renderJsCollectionOp,
};

/** `""` for a `money` stamp, `"?"` for a `money?`, null for anything else. */
function jsMoneyOperand(t: TypeIR | undefined): "" | "?" | null {
  if (t?.kind === "primitive" && t.name === "money") return "";
  if (t?.kind === "optional" && t.inner.kind === "primitive" && t.inner.name === "money") return "?";
  return null;
}

const JS_MONEY_ORDERING: Partial<Record<BinOp, string>> = {
  "<": "lt",
  "<=": "lte",
  ">": "gt",
  ">=": "gte",
};

/** A money comparison on the JS frontends, by VALUE and null-safe, or `null`
 *  to fall through to `exprBinary` (no money side, the `null` literal on one
 *  side — `x == null` is already a null check — or a non-comparison operator).
 *
 *  Every form goes through the STATIC `Decimal.sub(a, b)`, never `new
 *  Decimal(…)` or an arrow: Angular's template grammar admits neither, and the
 *  page shells already hoist the `Decimal` binding for a `Decimal.<member>`
 *  reference (`usesDecimalBinding`).  The static form also accepts a wire
 *  STRING as well as a `Decimal`, so it does not depend on which side of the
 *  `moneySchema` transform a value came from.
 *
 *  An absent operand becomes `"NaN"` (a string: Angular's template grammar
 *  has no `NaN` global, and decimal.js parses the string to its NaN value),
 *  and decimal.js orders `NaN` against nothing
 *  and `NaN.isZero()` is false, so an ordering with an absent side answers
 *  false (SQL's UNKNOWN — the backends' rule) and an equality with exactly one
 *  absent side answers unequal.  Both sides nullable: both absent are equal,
 *  the null-safe equality every backend uses. */
export function renderJsMoneyBinary(
  left: string,
  right: string,
  e: Extract<ExprIR, { kind: "binary" }>,
): string | null {
  const lt = jsMoneyOperand(e.leftType);
  const rt = jsMoneyOperand(e.rightType);
  if (lt === null && rt === null) return null;
  const isNull = (x: ExprIR) => x.kind === "literal" && x.lit === "null";
  if (isNull(e.left) || isNull(e.right)) return null;
  // The other side of a money comparison is money too (`comparable` keeps
  // money closed); a non-money side here is an operator this arm does not own.
  if (lt === null || rt === null) return null;
  const side = (text: string, t: "" | "?") => (t === "?" ? `(${text}) ?? "NaN"` : text);
  const diff = `Decimal.sub(${side(left, lt)}, ${side(right, rt)})`;
  if (e.op === "==" || e.op === "!=") {
    const eq =
      lt === "?" && rt === "?"
        ? `((${left}) == null ? (${right}) == null : ${diff}.isZero())`
        : `${diff}.isZero()`;
    return e.op === "==" ? `(${eq})` : `(!${eq})`;
  }
  const method = JS_MONEY_ORDERING[e.op];
  return method === undefined ? null : `${diff}.${method}(0)`;
}

/** Render a collection op to JavaScript, or `undefined` when the frontends
 *  don't render this op (`FRONTEND_RENDERED_COLLECTION_OPS` — the ONE
 *  definition, shared with the gate that refuses the rest).  The receiver is
 *  parenthesised exactly as the TypeScript backend parenthesises it before
 *  calling the same table, so a page body and a `derived` produce the same
 *  string for the same node. */
export function renderJsCollectionOp(spec: {
  op: string;
  recv: string;
  args: readonly string[];
  call?: Extract<ExprIR, { kind: "method-call" }>;
}): string | undefined {
  if (!FRONTEND_RENDERED_COLLECTION_OPS.has(spec.op)) return undefined;
  const render = JS_COLLECTION_RENDERERS[spec.op];
  return render?.(`(${spec.recv})`, [...spec.args], spec.call);
}

/** Fail-loud expression leaves for a target that FORKS `emitExpr` (HEEx runs a
 *  parallel walker and never reaches the shared dispatcher).  Satisfies the
 *  required interface while asserting the fork invariant: if one is ever
 *  called, the fork regressed and the output would be wrong — throw instead. */
const unreachedExprLeaf = (name: string) => (): never => {
  throw new Error(
    `${name}: this target forks emitExpr (parallel walker) and must never reach the shared expression dispatcher`,
  );
};
export const unreachableExprLeaves: ExprLeaves = {
  // HEEx forks the dispatcher entirely; it renders intrinsics and collection
  // ops in its own engine, so it never consults either seam.
  renderIntrinsic: undefined,
  renderCollectionOp: undefined,
  exprMoneyBinary: undefined,
  exprLiteral: unreachedExprLeaf("exprLiteral"),
  exprBinary: unreachedExprLeaf("exprBinary"),
  exprUnary: unreachedExprLeaf("exprUnary"),
  exprTernary: unreachedExprLeaf("exprTernary"),
  exprConvert: unreachedExprLeaf("exprConvert"),
  exprList: unreachedExprLeaf("exprList"),
  exprObject: unreachedExprLeaf("exprObject"),
};

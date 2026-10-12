// Best-effort type of a lambda's expression body — shared leaf helper.
//
// Used to type `map(λ)` / `min(λ)` / `max(λ)`'s result element at the
// lowering call site (the structural `memberType` pass never sees the
// lambda) AND by the .NET renderer to spell the nullable body-type of a
// `min`/`max` reduction.  Reads the type carried on the common terminal
// ExprIR shapes; returns `undefined` for anything it can't type cheaply,
// so callers fall back to the collection's element type.
//
// Pure data over the shared IR vocabulary: the `ExprIR`/`TypeIR` imports
// are TYPE-ONLY (`import type`), which carries no runtime edge, so this
// leaf under src/util/ stays layering-exempt (consumed by ir/ and
// generator/ alike).

import type { ExprIR, TypeIR } from "../ir/types/loom-ir.js";

/** The static type of an expression ONLY when it is *provably* a `string`
 *  from its own syntactic structure — a string literal, an explicit `→ string`
 *  convert, or a conditional whose branches are each provably string.  Returns
 *  `undefined` for everything else, INCLUDING `member`/`ref` reads.
 *
 *  Why not `bodyTypeOf` for this?  A scaffold-synthesized accessor
 *  (`row.<field>`) is an untyped lambda param, so its `memberType` currently
 *  resolves to `string` for EVERY field (money/bool/int included).  A consumer
 *  that acts on "is this a string?" (the Feliz `Html.text` cast elision) must
 *  therefore not trust a member's type until the accessor-typing work lands —
 *  it can only trust a structurally-guaranteed string.  Once accessors carry
 *  real field types, callers can widen from this to `bodyTypeOf`. */
export function provableStringType(e: ExprIR): TypeIR | undefined {
  const stringType: TypeIR = { kind: "primitive", name: "string" };
  switch (e.kind) {
    case "literal":
      return e.lit === "string" ? stringType : undefined;
    case "paren":
      return provableStringType(e.inner);
    case "convert":
      return e.target === "string" ? stringType : undefined;
    case "ternary":
      return provableStringType(e.then) && provableStringType(e.otherwise) ? stringType : undefined;
    // NOT provably a string from the node alone.  `undefined` is the
    // conservative answer — callers fall back to their own inference rather
    // than assuming `string` — so a missing arm narrows a claim, it never
    // widens one.  Named rather than left to a `default:` so a new `ExprIR`
    // kind that DOES carry a provable string type is a `tsc` error here.
    case "action-ref":
    case "authz-filter":
    case "binary":
    case "call":
    case "duration":
    case "i18nFormat":
    case "id":
    case "lambda":
    case "list":
    case "match":
    case "member":
    case "method-call":
    case "new":
    case "object":
    case "ref":
    case "this":
    case "unary":
      return undefined;
    default: {
      const _exhaustive: never = e;
      void _exhaustive;
      return undefined;
    }
  }
}

/** Best-effort type of a lambda's expression body.  Returns `undefined`
 *  for shapes it can't type cheaply. */
export function bodyTypeOf(e: ExprIR): TypeIR | undefined {
  switch (e.kind) {
    case "ref":
      return e.type;
    case "member":
      return e.memberType;
    case "paren":
      return bodyTypeOf(e.inner);
    // The ICU-format wrapper (M-T1.11) is documented as TRANSPARENT — every
    // backend renders `inner` and drops the format — so it must be transparent
    // to type probing too.  Without this arm the wrapper hides its operand's
    // type from every consumer that asks what an expression is, which is how
    // the Python backend came to emit `"on " + <datetime>` (a request-time
    // `TypeError`) for `` `on {startAt, date}` ``.
    case "i18nFormat":
      return bodyTypeOf(e.inner);
    case "convert":
      return { kind: "primitive", name: e.target };
    case "ternary":
      return bodyTypeOf(e.then);
    // An ARITHMETIC lambda body — `sum(l => l.price * l.qty)`, the canonical
    // order total.  `resultType` already carries the type-system's
    // closed-money / numeric-widening verdict (`money * int → money`); fall
    // back to the left operand's type for the synthetic binary nodes that
    // leave `resultType` unpopulated (walker-primitive-expander & friends).
    //
    // Without this arm every money fold with an arithmetic body degraded to
    // "not money" — node emitted `reduce(… , 0)` (tsc: `number + Decimal`),
    // elixir `Enum.sum` over `%Decimal{}` (runtime ArithmeticError) and a
    // `&<=/2` structural sorter (silently wrong ordering), python a
    // `Decimal`-less `sum(...)`.  Audit finding A5.
    //
    // NOTE — no `method-call` arm: `MethodCallExpr` carries `receiverType`
    // but no result type, so an intrinsic body (`l.price.abs()`) cannot be
    // typed here without re-running inference.  Callers keep their element-
    // type fallback for that shape.
    case "binary":
      return e.resultType ?? e.leftType;
    // `-x` keeps `x`'s type; `!x` is `bool`.  Also the probe the money-aware
    // unary arms (A11) read to decide `Decimal.neg()`/`BigDecimal.negate()`
    // over a bare `-`.
    case "unary":
      return e.op === "!" ? { kind: "primitive", name: "bool" } : bodyTypeOf(e.operand);
    case "literal":
      switch (e.lit) {
        case "string":
        case "int":
        case "long":
        case "decimal":
        case "money":
        case "bool":
          return { kind: "primitive", name: e.lit };
        default:
          return undefined;
      }
    // No type derivable from the node alone.  `undefined` means "ask your own
    // fallback", not "untyped": `method-call` is the documented example (see
    // the NOTE above — `MethodCallExpr` carries no result type), and the rest
    // either need the surrounding declaration (`this`, `id`, `action-ref`) or
    // are container shapes whose element type the caller already knows
    // (`list`, `new`, `object`, `match`, `lambda`).  Named rather than left to
    // a `default:` so a new `ExprIR` kind that DOES carry a result type is a
    // `tsc` error here — the arm `i18nFormat` needed, and did not have, until
    // the Python `"on " + <datetime>` TypeError found it.
    case "action-ref":
    case "authz-filter":
    case "call":
    case "duration":
    case "id":
    case "lambda":
    case "list":
    case "match":
    case "method-call":
    case "new":
    case "object":
    case "this":
      return undefined;
    default: {
      const _exhaustive: never = e;
      void _exhaustive;
      return undefined;
    }
  }
}

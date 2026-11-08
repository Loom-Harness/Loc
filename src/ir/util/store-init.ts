// ---------------------------------------------------------------------------
// Which store-field initializers the shared JS-family store renderer can emit.
//
// A `store { state { f: T = <init> } }` initializer is evaluated once, when the
// store object is constructed, so it cannot read store state, params or any
// runtime value — it must be a CONSTANT.  React, Vue, Svelte and Angular share
// one renderer for it (`src/generator/_frontend/store-field-init.ts`), and this
// predicate is the single statement of what that renderer accepts.  The IR
// check `loom.store-init-not-constant` refuses everything else, and the
// renderer throws that same code for anything outside it, so the two cannot
// disagree and no initializer silently boots at the type's zero.
//
// Admitted, recursively: literals (but not `now`, which is a runtime read),
// lists, parentheses, unary and binary operators, ternaries, enum values, and
// a conversion to `string`.
// ---------------------------------------------------------------------------

import type { ExprIR } from "../types/loom-ir.js";

/** The first sub-expression of a store-field initializer that is not a
 *  renderable constant, or `undefined` when the whole tree is one. */
export function storeInitNonConstant(e: ExprIR): ExprIR | undefined {
  const first = (...xs: ExprIR[]): ExprIR | undefined => {
    for (const x of xs) {
      const bad = storeInitNonConstant(x);
      if (bad) return bad;
    }
    return undefined;
  };
  switch (e.kind) {
    case "literal":
      return e.lit === "now" ? e : undefined;
    case "list":
      return first(...e.elements);
    case "paren":
      return first(e.inner);
    case "unary":
      return first(e.operand);
    case "binary":
      return first(e.left, e.right);
    case "ternary":
      return first(e.cond, e.then, e.otherwise);
    case "ref":
      return e.refKind === "enum-value" ? undefined : e;
    case "convert":
      return e.target === "string" ? first(e.value) : e;
    case "this":
    case "id":
    case "member":
    case "method-call":
    case "call":
    case "lambda":
    case "new":
    case "object":
    case "match":
    case "duration":
    case "i18nFormat":
    case "modelText":
    case "action-ref":
    case "authz-filter":
      return e;
    default: {
      const _exhaustive: never = e;
      return _exhaustive;
    }
  }
}

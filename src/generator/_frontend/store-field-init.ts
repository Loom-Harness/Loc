// ---------------------------------------------------------------------------
// `store { state { … } }` field initial values — one definition for every
// JS-family frontend (react / vue / svelte / angular).
//
// Why it exists: the four store builders each carried their own
// `storeFieldInit`, and three of them took the field's TYPE only — so a
// declared `store Prefs { state { mode: string = "dark" } }` booted as `""`,
// `pageSize: int = 25` booted as `0`, and nothing warned.  Page `state {}`
// initializers were honoured all along, so the divergence was store-only and
// read as a runtime data bug.  Every shipped example happens to declare
// zero-equal defaults, which is why no fixture caught it.
//
// The URL tier consumes the same value twice: it is the decoder's fallback
// when the query string carries no param for the field, and the encoder's
// "this is the default, drop it from the URL" test — so an absent param and
// the declared default mean the same thing in both directions.
// ---------------------------------------------------------------------------

import { diagMessage } from "../../diagnostics/messages.js";
import type { ExprIR, StateFieldIR } from "../../ir/types/loom-ir.js";
import { storeInitNonConstant } from "../../ir/util/store-init.js";
import { defaultInitForJs } from "../_walker/js-target-helpers.js";

/** Render a store-field `= <init>` as JS.  The admitted set is exactly
 *  `storeInitNonConstant`'s (literals, lists, parentheses, operators,
 *  ternaries, enum values, a conversion to string — trees that reference
 *  nothing, so they are safe to evaluate when the store is constructed), and
 *  the IR check `loom.store-init-not-constant` has already refused the rest;
 *  reaching another kind here throws that same code rather than booting the
 *  field at its type's zero.
 *
 *  No per-frontend renderer is needed: this subset is plain JS operator syntax,
 *  identical on react / vue / svelte / angular. */
function renderStoreInit(e: ExprIR, field: string): string {
  const r = (x: ExprIR): string => renderStoreInit(x, field);
  switch (e.kind) {
    case "literal":
      if (e.lit === "string") return JSON.stringify(e.value);
      if (e.lit === "null") return "null";
      if (e.lit === "now") break;
      return e.value;
    case "list":
      return `[${e.elements.map(r).join(", ")}]`;
    case "paren":
      return `(${r(e.inner)})`;
    case "unary":
      return `${e.op}${r(e.operand)}`;
    case "binary": {
      const op = e.op === "==" ? "===" : e.op === "!=" ? "!==" : e.op;
      return `(${r(e.left)} ${op} ${r(e.right)})`;
    }
    case "ternary":
      return `(${r(e.cond)} ? ${r(e.then)} : ${r(e.otherwise)})`;
    case "ref":
      // An enum is a string union on the wire.
      if (e.refKind === "enum-value") return JSON.stringify(e.name);
      break;
    case "convert":
      if (e.target === "string") return `String(${r(e.value)})`;
      break;
    // Not constants: refused by `loom.store-init-not-constant`.
    case "exists":
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
      break;
    default: {
      const _exhaustive: never = e;
      return _exhaustive;
    }
  }
  const bad = storeInitNonConstant(e) ?? e;
  throw new Error(diagMessage("loom.store-init-not-constant", { name: field, kind: bad.kind }));
}

/** Initial value for a store field — its declared `= init` when it has one,
 *  else the type's zero value (`[]` for arrays, `defaultInitForJs` for
 *  scalars).
 *
 *  A `money` field lowers to `Decimal`, so its initializer is CONSTRUCTED
 *  rather than assigned raw (a bare number is a TS2322 against the
 *  `Decimal`-typed slot): a literal by its exact text, any other constant by
 *  its computed value. */
export function storeFieldInitJs(field: StateFieldIR): string {
  if (field.init === undefined) return defaultInitForJs(field.type);
  const init = renderStoreInit(field.init, field.name);
  if (field.type.kind === "primitive" && field.type.name === "money") {
    const literal = field.init.kind === "literal" ? JSON.stringify(init) : init;
    return `new Decimal(${literal})`;
  }
  return init;
}

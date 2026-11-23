// A create form's client prefill (D-FORM-PREFILL): which create fields the form
// computes when it opens, and how the JS-family create forms (React, Vue,
// Svelte, Angular) spell the value.
//
// The decision is `clientPrefillDefault`: a create-request field whose declared
// default is one the server would otherwise fill (`isServerSourcedDefault`).
// The shared form model records it as `FormPrefill.client` (`formFieldSpec`),
// and a target that renders its create form off the declared fields without
// building a spec (LiveView) asks it here.  No target classifies on its own.
//
// The JS spelling of the two sources:
//
//   * the clock — `now()` read when the form opens, in the format the field's
//     input holds (`<input type="datetime-local">`: `YYYY-MM-DDTHH:mm` in the
//     browser's local time; `<input type="date">`: `YYYY-MM-DD`);
//   * the session — a `currentUser` expression the target's own walker renders
//     through its `renderCurrentUserAccess` seam (`currentUser.<claim>`),
//     evaluated against the session user the app already holds.  The read is
//     bound right at the seed: a page shell binds its `currentUser` local after
//     the form is declared, so the seed cannot lean on that binding.  A missing
//     session reads as `{}`, the claim as `undefined`, and the field falls back
//     to its zero.

import type { ExprIR } from "../../ir/types/loom-ir.js";
import { isServerSourcedDefault } from "./server-default.js";

/** The default a create form computes when it opens, or undefined.  Only a
 *  create-request field (`createInput`) qualifies: an operation or workflow
 *  param arrives as sent and is never filled by the server. */
export function clientPrefillDefault(f: {
  default?: ExprIR;
  createInput?: boolean;
}): ExprIR | undefined {
  return f.createInput === true && f.default !== undefined && isServerSourcedDefault(f.default)
    ? f.default
    : undefined;
}

/** What a client prefill reads: the clock (`now()`) or the session (an
 *  expression over `currentUser`). */
export function clientPrefillSource(expr: ExprIR): "clock" | "session" {
  return expr.kind === "literal" && expr.lit === "now" ? "clock" : "session";
}

/** The JS expression for `now()` as the input of `kind` holds it. */
export function clockInputJs(kind: string): string {
  // The browser's local wall-clock time, as the input shows what a user types.
  const local = "new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString()";
  if (kind === "datetime") return `${local}.slice(0, 16)`;
  if (kind === "date") return `${local}.slice(0, 10)`;
  return "new Date().toISOString()";
}

/** How each JS-family framework reads the session user where a form seeds:
 *  inside the page component's render / setup / class-field scope. */
const SESSION_USER_JS: Readonly<Record<string, string>> = {
  react: "useSession().user",
  svelte: "useSession().user",
  vue: "useSession().user.value",
  angular: "inject(SessionService).user()",
};

/** The seed of a session-prefilled field: `exprJs` (rendered with `currentUser`
 *  as the session user) evaluated against the session `framework` holds, or
 *  `zeroJs` when there is no value.  Undefined for a framework with no session
 *  read here. */
export function sessionPrefillJs(
  framework: string,
  exprJs: string,
  zeroJs: string,
): string | undefined {
  const session = SESSION_USER_JS[framework];
  if (!session) return undefined;
  return `(((currentUser: Record<string, any>) => ${exprJs})(${session} ?? {}) ?? ${zeroJs})`;
}

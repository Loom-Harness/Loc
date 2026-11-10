// `Money { …, format: "locale" }` presence — one predicate, two consumers.
//
// The IR validator refuses the opt-in locale-formatted display on a frontend
// whose `Money` cannot render it (`loom.target-unsupported#money-locale-format`),
// and the walker reads the same argument to pick the locale path.  The
// recogniser lives here, in `ir/util`, which both sit above.  Sibling of
// `chart.ts` and `data-grid.ts`.

import type { ExprIR } from "../types/loom-ir.js";
import { walkExprDeep } from "./walk.js";

/** True when `call` is a `Money` call carrying `format: "locale"` — spelled as
 *  the string or as the bare vocabulary word (`format: locale`), which the type
 *  elaborator accepts as the same closed-vocabulary symbol and lowers to an
 *  unresolved name. */
export function isMoneyLocaleFormatCall(call: ExprIR): boolean {
  if (call.kind !== "call" || call.name !== "Money") return false;
  const argNames = call.argNames ?? [];
  return call.args.some((a, i) => {
    if (argNames[i] !== "format") return false;
    if (a.kind === "literal") return a.lit === "string" && a.value === "locale";
    return a.kind === "ref" && a.name === "locale" && a.refKind === "unknown";
  });
}

/** True when a page/component body contains a `Money { format: "locale" }`
 *  anywhere. */
export function bodyUsesMoneyLocaleFormat(body: ExprIR | undefined): boolean {
  let found = false;
  walkExprDeep(body, (e) => {
    if (isMoneyLocaleFormatCall(e)) found = true;
  });
  return found;
}

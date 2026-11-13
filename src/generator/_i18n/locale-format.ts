// "Does this ui render a locale-formatted date?" — the one predicate
// for the targets whose number/date formatting is a LIBRARY rather than the
// platform (Phoenix: CLDR through `ex_cldr_*`).  The browsers format through
// `Intl` at no cost, so only a server-rendering target needs to know whether
// shipping the formatter is worth it.
//
// The call-site spelling it recognises is the primitive whose output depends on
// the active locale: `DateDisplay`.  Interpolated `{x, number}` / `{d, date}` holes are not read
// here — an interpolated message already carries the ICU runtime, which formats
// them.  Rides `walkExprDeep`, so a primitive inside a `match` arm, a `list`
// literal or a `style:` entry is seen too.

import type { ComponentIR, ExprIR, UiIR } from "../../ir/types/loom-ir.js";
import { walkExprDeep } from "../../ir/util/walk.js";

/** True when `e` is a primitive call whose rendering depends on the locale. */
function isLocaleFormattedCall(e: ExprIR): boolean {
  return e.kind === "call" && e.name === "DateDisplay";
}

function bodyUsesLocaleFormat(body: ExprIR | undefined): boolean {
  let found = false;
  walkExprDeep(body, (e) => {
    if (isLocaleFormattedCall(e)) found = true;
  });
  return found;
}

/** True when any page or ui-scoped component of `ui` renders a locale-formatted
 *  date. */
export function uiUsesLocaleFormat(
  ui: UiIR,
  topLevelComponents: readonly ComponentIR[] = [],
): boolean {
  return (
    ui.pages.some((p) => bodyUsesLocaleFormat(p.body)) ||
    ui.components.some((c) => bodyUsesLocaleFormat(c.body)) ||
    topLevelComponents.some((c) => bodyUsesLocaleFormat(c.body))
  );
}

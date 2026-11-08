// "Does this ui render a `LocaleSwitcher`?" — one predicate for the frontends
// that must ship the locale runtime for it even when the app has no other
// translatable text.  Rides `walkExprDeep`, so a switcher inside a `match` arm,
// a `list` literal or a `style:` entry is seen too.

import type { ComponentIR, ExprIR, UiIR } from "../../ir/types/loom-ir.js";
import { walkExprDeep } from "../../ir/util/walk.js";

/** True when a page/component body contains a `LocaleSwitcher` call. */
function bodyUsesLocaleSwitcher(body: ExprIR | undefined): boolean {
  let found = false;
  walkExprDeep(body, (e) => {
    if (e.kind === "call" && e.name === "LocaleSwitcher") found = true;
  });
  return found;
}

/** True when any page, ui-scoped component or workspace-wide top-level
 *  component reachable from the ui renders a `LocaleSwitcher`. */
export function uiUsesLocaleSwitcher(
  ui: UiIR,
  topLevelComponents: readonly ComponentIR[] = [],
): boolean {
  return (
    ui.pages.some((p) => bodyUsesLocaleSwitcher(p.body)) ||
    ui.components.some((c) => bodyUsesLocaleSwitcher(c.body)) ||
    topLevelComponents.some((c) => bodyUsesLocaleSwitcher(c.body))
  );
}

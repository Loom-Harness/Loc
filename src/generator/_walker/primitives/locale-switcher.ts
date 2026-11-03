// LocaleSwitcher {} — the language picker, placeable anywhere in a page body.
//
// Takes no arguments: which locales exist is a fact about the SYSTEM (the
// translator tree plus the source language), not about the call site, and the
// app shell already mounts the same control in its header when two or more
// locales ship.  The primitive exists so a layout without the default header (a
// `layout: none` page, a custom header slot) can still offer the choice.
//
// React, Vue, Svelte and Angular render their generated `LocaleSwitcher`
// component (emitted whenever the ui is i18n-enabled), which lists each shipped
// locale under its own name.  The frontends without a runtime binding yet render
// an inert placeholder comment rather than a broken reference, so a page that
// uses the primitive still compiles on every target.

import type { ExprIR } from "../../../ir/types/loom-ir.js";
import { addImport } from "../render-primitive.js";
import type { WalkContext } from "../walker-core.js";

export function emitLocaleSwitcher(
  _call: ExprIR & { kind: "call" },
  ctx: WalkContext,
  depth: number,
): string {
  void depth;
  switch (ctx.target.framework) {
    case "react":
      addImport(ctx, "../lib/locale-switcher", "LocaleSwitcher");
      return "<LocaleSwitcher />";
    // Vue/Svelte components and Angular standalone components are not named
    // exports the walker's import map can express; the page shell imports them
    // off this marker tag (the `LoomChart` discipline).
    case "vue":
    case "svelte":
      return "<LocaleSwitcher />";
    case "angular":
      return "<loom-locale-switcher />";
    default:
      return ctx.target.renderComment(
        `LocaleSwitcher: not yet supported on ${ctx.target.framework}`,
      );
  }
}

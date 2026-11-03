// LocaleSwitcher {} — the language picker, placeable anywhere in a page body.
//
// Takes no arguments: which locales exist is a fact about the SYSTEM (the
// translator tree plus the source language), not about the call site, and the
// app shell already mounts the same control in its header when two or more
// locales ship.  The primitive exists so a layout without the default header (a
// `layout: none` page, a custom header slot) can still offer the choice.
//
// Every `walkBody` target binds it through the REQUIRED `renderLocaleSwitcher`
// seam (`_walker/target.ts`) into its generated locale runtime, which lists each
// shipped locale under its own name: React imports `src/lib/locale-switcher.tsx`,
// Vue/Svelte render a `<LocaleSwitcher />` marker tag and Angular a
// `<loom-locale-switcher />` selector that their page shells import, Feliz calls
// `I18n.localeSwitcher ()` and Flutter builds `const LocaleSwitcher()`.  The seam
// is required so a new target cannot silently degrade the picker.

import type { ExprIR } from "../../../ir/types/loom-ir.js";
import type { WalkContext } from "../walker-core.js";

export function emitLocaleSwitcher(
  call: ExprIR & { kind: "call" },
  ctx: WalkContext,
  depth: number,
): string {
  return ctx.target.renderLocaleSwitcher(call, ctx, depth);
}

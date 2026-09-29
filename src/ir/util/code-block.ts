// `CodeBlock` presence in a page/component body — one predicate, four consumers.
//
// The primitive renders `<pre><code class="language-…">`, which is inert
// markup until a highlighter is loaded.  Every static-bundle frontend
// (react/vue/svelte/angular) therefore needs the same answer — "does this ui
// render a CodeBlock anywhere?" — to decide whether the emitted project
// carries the `highlight.js` dependency and the `src/lib/highlight.ts` module
// that arms it.  For a long while only the React orchestrator asked, and the
// other three hardcoded `false`: their apps emitted the markup and loaded no
// highlighter at all.  One predicate, in `ir/util` (which every generator
// sits above), is the fix — exact sibling of `chart.ts` / `data-grid.ts`.
//
// It rides `walkExprDeep` rather than a hand-rolled `ExprIR` recursion (the
// shape it replaced), so a `CodeBlock` inside a `list` literal, a `match`
// variant arm, a `style:` entry or an `i18nFormat` hole is seen too — slots
// the hand-rolled copy silently dropped.

import type { ComponentIR, ExprIR, UiIR } from "../types/loom-ir.js";
import { walkExprDeep } from "./walk.js";

/** True when a page/component body contains a `CodeBlock(...)` primitive call
 *  anywhere. */
export function bodyUsesCodeBlock(body: ExprIR | undefined): boolean {
  let found = false;
  walkExprDeep(body, (e) => {
    if (e.kind === "call" && e.name === "CodeBlock") found = true;
  });
  return found;
}

/** True when ANY page, ui-scoped component, or workspace-wide top-level
 *  component reachable from a ui uses `CodeBlock`. */
export function uiUsesCodeBlock(
  ui: UiIR,
  topLevelComponents: readonly ComponentIR[] = [],
): boolean {
  return (
    ui.pages.some((p) => bodyUsesCodeBlock(p.body)) ||
    ui.components.some((c) => bodyUsesCodeBlock(c.body)) ||
    topLevelComponents.some((c) => bodyUsesCodeBlock(c.body))
  );
}

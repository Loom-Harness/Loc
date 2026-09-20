// The framework-neutral `toast(<msg>)` page effect — the emitted DOM module
// plus the IR predicates that decide when a project needs it.
//
// `toast("Draft saved")` is an ordinary page-language call
// (docs/page-metamodel.md §15), legal in a named `action` body and in an
// `Action { …, then: … }` slot.  Every walker target renders it verbatim as
// `toast(<args>);`, exactly like `navigate(…)` — so without an emitted module
// and a matching import the generated project references an identifier it
// never declares and its typecheck fails with TS2304 (F3 of the 2026-09-03
// language-docs audit on React; F50, its Svelte twin).
//
// WHY THE MODULE SELF-MOUNTS.  Routing the effect through each pack's NATIVE
// notification widget (`notifications.show` on mantine, sonner on shadcn, the
// `realtime-toast` micro-template the realtime handler path already uses)
// needs a `renderToast` seam on `WalkerTarget` plus a call arm in walker-core
// — recorded as M-T1.28 residue 1.  Until that lands the surface has to work
// with no host component and no pack template change, so the first call
// appends its own live region to `document.body`.  That is also why this is
// ONE module shared by the JSX frontends rather than a per-framework copy:
// there is nothing framework-shaped in it, and two copies would drift.
//
// The Svelte project already has a SEPARATE `src/lib/toast.svelte.ts` — a
// runes-backed `{ items, success, error }` store the pack's `realtime-toast`
// template renders.  That one is not callable and is mounted only on the
// realtime path, so the page effect gets this module beside it rather than
// being folded into it.

import type { ActionIR, ExprIR, UiIR } from "../../ir/types/loom-ir.js";
import { walkExprDeep, walkStmtExprsDeep, walkStmtsDeep } from "../../ir/util/walk.js";

/** The emitted module's source — a dependency-free, self-mounting
 *  `toast(message)`.  Identical bytes on every frontend that emits it. */
export const DOM_TOAST_SOURCE = `// Auto-generated.  Do not edit by hand.
//
// The \`toast(<msg>)\` page effect.  Self-mounting: the first call appends its
// own live region to \`document.body\`, so no root component has to host it.

const CONTAINER_ID = "loom-toast-root";
const DISMISS_MS = 4000;

function container(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const existing = document.getElementById(CONTAINER_ID);
  if (existing !== null) return existing;
  const el = document.createElement("div");
  el.id = CONTAINER_ID;
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.style.cssText = [
    "position:fixed",
    "z-index:9999",
    "right:1rem",
    "bottom:1rem",
    "display:flex",
    "flex-direction:column",
    "gap:0.5rem",
    "pointer-events:none",
  ].join(";");
  document.body.appendChild(el);
  return el;
}

/**
 * Show a transient message.  The page-language \`toast(<expr>)\` effect — in an
 * \`action\` body or an \`Action { …, then: … }\` slot — lowers to this call.
 */
export function toast(message: unknown): void {
  const root = container();
  if (root === null) return;
  const item = document.createElement("div");
  item.dataset.testid = "loom-toast";
  item.textContent = String(message);
  item.style.cssText = [
    "max-width:22rem",
    "padding:0.625rem 0.875rem",
    "border-radius:0.5rem",
    "background:#1f2937",
    "color:#f9fafb",
    "font-size:0.875rem",
    "line-height:1.25rem",
    "box-shadow:0 4px 12px rgba(0,0,0,0.18)",
    "pointer-events:auto",
  ].join(";");
  root.appendChild(item);
  window.setTimeout(() => {
    item.remove();
    if (root.childElementCount === 0) root.remove();
  }, DISMISS_MS);
}
`;

/** True when a page/component reaches the `toast(<msg>)` effect — from a named
 *  `action` body, an inline handler block, or an `Action { …, then: … }` slot.
 *
 *  Read off the IR rather than off the rendered TSX: chakra v2's form
 *  templates bind their own `const toast = useToast()` and call `toast({…})`
 *  in the same page, so a text scan would import a second `toast` over a
 *  binding the pack already owns.  A ui that declares an extern
 *  `function toast(...)` owns the name too — the walker binds the extern shim
 *  there, and the caller passes it in `externFunctions` so this returns false.
 */
export function usesToastEffect(
  body: ExprIR | undefined,
  actions: readonly ActionIR[],
  externFunctions: ReadonlySet<string> = new Set(),
): boolean {
  if (externFunctions.has("toast")) return false;
  let found = false;
  const seeExpr = (e: ExprIR): void => {
    if (e.kind === "call" && e.name === "toast") found = true;
  };
  walkExprDeep(body, seeExpr);
  for (const a of actions) {
    for (const st of a.body) {
      walkStmtsDeep(st, (s) => {
        if (s.kind === "call" && s.name === "toast") found = true;
      });
      walkStmtExprsDeep(st, seeExpr);
    }
  }
  return found;
}

/** True when any page or component of this ui reaches the `toast(<msg>)`
 *  effect — the gate on emitting `src/lib/toast.ts` at all.  A ui whose only
 *  toast is a realtime `on <chan>.<Event>(e) { toast(…) }` handler is NOT
 *  included: that path is pack-shaped and already wired
 *  (`realtime-handlers-builder.ts`). */
export function uiUsesToastEffect(ui: UiIR): boolean {
  const externs = new Set((ui.functions ?? []).map((f) => f.name));
  return (
    ui.pages.some((p) => usesToastEffect(p.body, p.actions, externs)) ||
    ui.components.some((c) => usesToastEffect(c.body, c.actions, externs))
  );
}

/** The Svelte project's path for this module.  It sits BESIDE
 *  `src/lib/toast.svelte.ts` (the runes store the pack's `realtime-toast`
 *  template renders) rather than inside it: that export is an object, not a
 *  callable, and its container mounts only on the realtime path. */
export const SVELTE_LIB_TOAST_EFFECT_PATH = "src/lib/toast-effect.ts";

/** The `<script>` import line a Svelte page/component emits for it. */
export const SVELTE_LIB_TOAST_EFFECT_IMPORT = `  import { toast } from "$lib/toast-effect";\n`;

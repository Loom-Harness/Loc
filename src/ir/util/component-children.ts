// Call sites that pass CHILDREN to an EXTERN user component — the extra
// positional argument every JSX-family frontend renders between the open and
// close tags.
//
//   component Panel(label: string) extern from "./Panel"
//   page P { body: Panel("a", Text { "child" }) }
//
// React emits `<Panel label="a"><Text>child</Text></Panel>`.  Angular has no
// PascalCase component tag, and an EXTERN component's class is hand-written —
// its `@Component({ selector })` is the author's, so Loom cannot spell a tag
// for it.  Its call site is therefore `<ng-container [ngComponentOutlet]="Panel"
// [ngComponentOutletInputs]='{ label: "a" }'></ng-container>`, and
// `ngComponentOutlet` cannot project content from a template at all
// (`ngComponentOutletContent` takes pre-built DOM nodes, which is TS-side
// only).  So the extra positional argument has nowhere to go and
// `renderAngularUserComponent` drops it — with a degradation comment beside the
// outlet in the emitted template, and this diagnostic at compile time.
//
// A WALKED component is NO LONGER here.  Loom emits its class and stamps its
// selector (`angularComponentSelector`), so its call site is
// `<app-panel [label]='"a"'>…children…</app-panel>` with the class in the
// page's standalone `imports: []` — a real content-projection channel, landing
// the children in the body's `Slot { }` (`<ng-content></ng-content>`, from
// `angularTarget.renderChildrenSlot`).  That is why `componentChildrenHosts`
// keys on `c.extern`: the gate narrowed to the one flavour that still drops.

import type { ExprIR, UiIR } from "../types/loom-ir.js";
import { walkExprDeep } from "./walk.js";

/** True when `call` supplies more arguments than `paramCount` names can
 *  absorb — mirrors the arg→param cursor in `renderAngularUserComponent`,
 *  whose `paramName === undefined` branch is the drop this predicate detects
 *  (on the outlet arm; on the tag arm the same overflow is PROJECTED). Named arguments always land on
 *  a param, so only the positional overflow counts. */
function hasOverflowArgs(call: Extract<ExprIR, { kind: "call" }>, paramCount: number): boolean {
  const argNames = call.argNames ?? [];
  let positional = 0;
  for (let i = 0; i < call.args.length; i++) {
    if (argNames[i] === undefined) positional += 1;
  }
  const named = call.args.length - positional;
  // Named args consume distinct params; the positional ones fill what is left.
  return positional > Math.max(0, paramCount - named);
}

/** Every user-component call site in a body that passes children (a positional
 *  argument with no param to land on), labelled for a diagnostic. */
export function componentChildrenCallSites(
  body: ExprIR | undefined,
  paramCountByComponent: ReadonlyMap<string, number>,
): string[] {
  const out: string[] = [];
  walkExprDeep(body, (e) => {
    if (e.kind !== "call") return;
    const paramCount = paramCountByComponent.get(e.name);
    if (paramCount === undefined) return;
    if (hasOverflowArgs(e, paramCount)) out.push(e.name);
  });
  return out;
}

/** Every page/component of a ui that invokes an EXTERN user component WITH
 *  children, labelled `page 'X'` / `component 'Y'` alongside the invoked name.
 *
 *  Walked components are excluded by construction (the `c.extern` filter): on
 *  Angular they are tag-addressed and project children correctly, so keeping
 *  them here would be a false refusal. */
export function componentChildrenHosts(ui: UiIR): { what: string; component: string }[] {
  const paramCount = new Map<string, number>(
    ui.components.filter((c) => c.extern).map((c) => [c.name, c.params.length]),
  );
  const out: { what: string; component: string }[] = [];
  for (const p of ui.pages) {
    for (const name of componentChildrenCallSites(p.body, paramCount)) {
      out.push({ what: `page '${p.name}'`, component: name });
    }
  }
  for (const c of ui.components) {
    for (const name of componentChildrenCallSites(c.body, paramCount)) {
      out.push({ what: `component '${c.name}'`, component: name });
    }
  }
  return out;
}

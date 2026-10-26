// Page-body primitives that need HOST-LIVEVIEW state, used inside a `component`
// on a phoenixLiveView ui.
//
// A HEEx function component is a pure render function.  It owns no process, so
// anything it needs at render time must be supplied by the LiveView that renders
// it: an assign, an `allow_upload/3`, a `handle_event/3` clause.  A component's
// `state { … }` and named `action`s are lifted to the host page by assign
// namespacing (`hostStateAssign`) and `ComponentActionInfo`; the primitives
// below fill the walker's `formBindings` / `queryBindings` / `uploadBindings` /
// `tableControls` accumulators, which only a LiveView can serve.  So a component
// that (transitively) renders one is INLINED into its caller by the HEEx walker
// — its bindings register straight into the host page's accumulators — and no
// function component is emitted for it.
//
//   CreateForm / OperationForm  `@form` assign + `handle_event` submit clause
//   WorkflowForm                same, `phx-submit="run_<workflow>"`
//   DestroyForm                 `phx-value-id={@id}` + destroy handler
//   QueryView / Table           `rows={@items}` assign loaded in handle_params
//   FileUpload                  `allow_upload/3` in mount + progress consumer
//   Chart                       the projection assign
//
// NOT in the set, and deliberately: `Modal` (a bare one is self-contained; a
// form INSIDE one is caught because the scan is a deep walk and sees the form),
// `Action` and `state { … }` (lifted by namespacing), and every display
// primitive.
//
// This is a NAME scan rather than a walk of the real HEEx accumulators because
// `src/ir/` sits below the generator and cannot import it.  The set is pinned by
// `test/generator/elixir/heex-component-host-state.test.ts`, which generates
// each member inside a component and asserts its binding reaches the host.

import type { ExprIR, UiIR } from "../types/loom-ir.js";
import { walkExprDeep } from "./walk.js";

/** Page-body primitives whose HEEx rendering needs the host LiveView to supply
 *  an assign, an upload or a `handle_event` clause. */
export const HEEX_HOST_STATE_PRIMITIVES: ReadonlySet<string> = new Set([
  "CreateForm",
  "OperationForm",
  "WorkflowForm",
  "DestroyForm",
  "QueryView",
  "Table",
  "FileUpload",
  "Chart",
]);

/** Does this body use a host-state primitive directly? */
function usesHostStatePrimitive(body: ExprIR | undefined): boolean {
  let found = false;
  walkExprDeep(body, (e) => {
    if (e.kind === "call" && HEEX_HOST_STATE_PRIMITIVES.has(e.name)) found = true;
  });
  return found;
}

/** Names of the components a phoenixLiveView host must INLINE: those whose body
 *  uses a host-state primitive, plus (transitively) every component that
 *  renders one — an intermediate function component cannot hand its caller's
 *  LiveView a binding it never registered. */
export function hostStatefulComponents(ui: UiIR): ReadonlySet<string> {
  const stateful = new Set<string>();
  const callees = new Map<string, Set<string>>();
  for (const c of ui.components) {
    if (c.extern) continue;
    if (usesHostStatePrimitive(c.body)) stateful.add(c.name);
    const names = new Set<string>();
    walkExprDeep(c.body, (e) => {
      if (e.kind === "call") names.add(e.name);
    });
    callees.set(c.name, names);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, called] of callees) {
      if (stateful.has(name)) continue;
      if ([...called].some((n) => stateful.has(n))) {
        stateful.add(name);
        changed = true;
      }
    }
  }
  return stateful;
}

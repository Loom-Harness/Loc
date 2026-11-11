// A call to a user `component` on a Phoenix LiveView page.
//
// A component renders as a remote HEEx function component
// (`<App>Web.Components.UiComponents.<name> … />`) with its lifted state
// threaded through as attributes, an `extern` one as a `<.live_component>`,
// and one whose body needs host-LiveView state (a form, a QueryView, a table,
// an upload, a chart) inline into the caller, so its assigns and
// `handle_event` clauses land in the host LiveView.  `heexTarget` reaches
// these through the `renderUserComponent` seam.

import type { ComponentIR, ExprIR, PageIR } from "../../ir/types/loom-ir.js";
import { hostStatefulComponents } from "../../ir/util/heex-component-host-state.js";
import { snake, upperFirst } from "../../util/naming.js";
import { inlineComponentKeyPrefix } from "../_walker/i18n-extract.js";
import { seedHoistedHandlers } from "./heex-handlers.js";
import { liftedStateAttrs, renderChild, renderExpr, type WalkContext } from "./heex-walker-core.js";

/** Bind a component call's arguments to its params: a named argument binds by
 *  name; a positional one binds to the next param NOT already bound by name;
 *  a positional with no param left is a child (the component's `Slot()`). */
function bindCallArgs(
  expr: Extract<ExprIR, { kind: "call" }>,
  comp: ComponentIR,
): { params: Map<string, ExprIR>; children: ExprIR[] } {
  const named = new Set((expr.argNames ?? []).filter((n): n is string => !!n));
  const free = comp.params.map((p) => p.name).filter((n) => !named.has(n));
  const params = new Map<string, ExprIR>();
  const children: ExprIR[] = [];
  let pos = 0;
  for (let i = 0; i < expr.args.length; i++) {
    const argName = expr.argNames?.[i];
    const paramName = argName ?? free[pos++];
    if (!paramName) children.push(expr.args[i]!);
    else params.set(paramName, expr.args[i]!);
  }
  return { params, children };
}

/** A call to a component whose body needs host-LiveView state, rendered INLINE.
 *
 *  The component body is walked again under a context that shares the caller's
 *  binding accumulators (`formBindings`, `queryBindings`, `uploadBindings`,
 *  `tableControls`, option/label sets, the chart/table/tab counters), so the
 *  assigns, `allow_upload/3` and `handle_event` clauses its primitives need land
 *  in the host page's LiveView by construction.  What stays per-walk is what the
 *  component-level hoisting already owns (`handlers`, `actionBindings`,
 *  `usedComponents`, `usedStores`, `slotUsed`): those reach the host through
 *  `ComponentActionInfo`, and a fresh set here makes the lambda handler names this
 *  walk mints match the ones that hoisting emits.
 *
 *  Params are substituted by the caller's argument expressions (re-rendered per
 *  position, see `WalkContext.inlineParams`), and the `Slot()` renders the call's
 *  children in the caller's scope.  Rendering a component twice registers its
 *  bindings twice; the emitters dedupe identical bindings. */
function renderInlinedComponent(
  expr: Extract<ExprIR, { kind: "call" }>,
  comp: ComponentIR,
  ctx: WalkContext,
): string {
  const bound = bindCallArgs(expr, comp);
  const children = bound.children;
  const params = new Map<string, { expr: ExprIR; ctx: WalkContext }>(
    [...bound.params].map(([name, arg]) => [name, { expr: arg, ctx }]),
  );
  const page = {
    name: comp.name,
    params: comp.params,
    state: comp.state,
    derived: comp.derived,
    actions: comp.actions,
    body: comp.body,
  } as PageIR;
  const instanceTypes = new Map<string, string>();
  for (const p of comp.params) {
    if (p.type.kind === "entity" && ctx.aggregatesByName.has(p.type.name)) {
      instanceTypes.set(p.name, p.type.name);
    }
  }
  const inner: WalkContext = {
    ...ctx,
    page,
    stateNames: new Set(comp.state.map((f) => snake(f.name))),
    stateFields: new Map(comp.state.map((f) => [snake(f.name), f] as const)),
    stateOwner: comp.name,
    instanceTypes,
    i18nPrefix: ctx.i18nPrefix ? inlineComponentKeyPrefix(ctx.i18nPrefix, comp.name) : undefined,
    inlineParams: params,
    inlineSlot: () => children.map((c) => renderChild(c, ctx)).join(""),
    varRemapping: undefined,
    actionArgSubst: undefined,
    rowTypes: undefined,
    listTypes: undefined,
    handlers: [],
    actionBindings: [],
    usedComponents: new Set(),
    componentUses: new Map(),
    usedStores: new Set(),
    slotUsed: { value: false },
  };
  seedHoistedHandlers(inner, page, comp.body);
  return comp.body ? renderExpr(comp.body, inner) : "<!-- empty body -->";
}

/** A call to a user-defined `component` → a fully-qualified HEEx
 *  function-component invocation.  Positional args bind to the
 *  component's declared params in order; named args bind by name.
 *  Values render in template position (refs become `@assign`). */
export function renderHeexUserComponent(
  expr: Extract<ExprIR, { kind: "call" }>,
  comp: ComponentIR,
  ctx: WalkContext,
): string {
  ctx.usedComponents.add(comp.name);
  ctx.componentUses.set(comp.name, (ctx.componentUses.get(comp.name) ?? 0) + 1);
  // A component that (transitively) renders a form / QueryView / Table /
  // FileUpload / Chart needs the HOST LiveView to supply its assigns, uploads
  // and `handle_event` clauses, which a function component cannot — so it is
  // rendered inline, into the caller, rather than invoked.
  if (!comp.extern && hostStatefulComponents(ctx.ui).has(comp.name)) {
    return renderInlinedComponent(expr, comp, ctx);
  }
  const attrs: string[] = [];
  // A positional argument with no param left to land on is a CHILD: it renders
  // between the open and close tags, into the component's `Slot {}`
  // (`render_slot(@inner_block)`).
  const bound = bindCallArgs(expr, comp);
  const children = bound.children;
  for (const [paramName, arg] of bound.params) {
    const value = renderExpr(arg, { ...ctx, position: "template" });
    attrs.push(`${snake(paramName)}={${value}}`);
  }
  // Extern component (extern-component-escape-hatch.md) → a hand-written
  // Phoenix LiveComponent the user owns, embedded via the built-in
  // `<.live_component>`.  The MODULE reference is the binding — Elixir's native
  // module system, no import/alias needed (the framework-mismatch analogue of
  // the JSX frontends' `tsc` fail-fast: a wrong module fails to compile).
  // `id` is required by `live_component`; the snake component name is stable.
  if (comp.extern) {
    const mod = externModuleFromPath(comp.externPath ?? "");
    const rest = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
    return `<.live_component module={${mod}} id="${snake(comp.name)}"${rest} />`;
  }
  // Lifted state — the callee's own `state { … }` plus that of every component
  // it renders, threaded down from the host LiveView's assigns under the same
  // namespaced name at every level (see `hostStateAssign`).  Rendered in
  // template position because a call site always sits inside a `~H` body.
  for (const { assign } of liftedStateAttrs(comp, ctx.ui)) {
    attrs.push(`${assign}={@${assign}}`);
  }
  const tag = `${ctx.appModule}Web.Components.UiComponents.${snake(comp.name)}`;
  const open = attrs.length > 0 ? `<${tag} ${attrs.join(" ")}` : `<${tag}`;
  if (children.length === 0) return `${open} />`;
  return `${open}>${children.map((c) => renderChild(c, ctx)).join("")}</${tag}>`;
}

/** Derive the Elixir module reference for an `extern` component from its
 *  `from "<path>"` clause.  Elixir binds by MODULE, not by file path, so the
 *  path segments (split on `/` or `.`) are PascalCased and joined with `.` —
 *  e.g. `"widgets/order-chart"` → `Widgets.OrderChart`.  The user writes a
 *  `Phoenix.LiveComponent` under exactly that module. */
export function externModuleFromPath(path: string): string {
  const pascalSeg = (seg: string): string =>
    seg
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((w) => upperFirst(w))
      .join("");
  return path
    .replace(/^\.?\//, "")
    .split(/[/.]/)
    .filter(Boolean)
    .map(pascalSeg)
    .join(".");
}

// ---------------------------------------------------------------------------
// The data-access seam — "this body reads X / calls op Y".
//
// A page body reaches the domain through a handful of IR shapes
// (`Sales.Customer.all`, `Order.byId(id)`, `Sales.SalesTotals`, …;
// `api-hook-detector.ts` lists them).  The shared walker core only ever says
// THAT a body reads or calls something; what that becomes is the target's:
//
//   - a client-state target with an HTTP API client binds it as a query /
//     mutation handle declared once per component (React Query, vue-query,
//     svelte-query, an Angular `toSignal` factory, a Riverpod provider);
//   - a client-state target with hoisted handlers binds it to a Model field
//     an init `Cmd` fills and a `Msg` delivers (Elmish);
//   - a server-session target calls the context module in-process, from the
//     process that holds the session (a LiveView `handle_params` /
//     `handle_event` body).
//
// So `walker-core.ts` and the shared primitives talk to this module, never to
// the detector, a binding record's per-target fields, or an HTTP client
// module.  `test/system/walker-core-framework-census.test.ts` holds that line.
// ---------------------------------------------------------------------------

import { pagedReturn } from "../../ir/stdlib/generics.js";
import type { ExprIR } from "../../ir/types/loom-ir.js";
import { type DetectedApiCall, tryDetectApiHook } from "./api-hook-detector.js";
import type { DataBinding } from "./target.js";
import type { WalkContext } from "./walker-core.js";

/** A detected read or operation call: which aggregate / workflow / projection
 *  the body reaches, which operation, with which argument expressions. */
export type DataAccess = DetectedApiCall;

/** The compiler-owned repository verbs a `<handle>.<Agg>.<verb>` read can name.
 *  A caller resolving the AGGREGATE out of such a read has to recognise the
 *  verb to look past it: `Ops.Item.all` is a MEMBER chain whose last hop is the
 *  verb, not the aggregate. */
export const STANDARD_AGG_OPS: ReadonlySet<string> = new Set([
  "all",
  "byId",
  "create",
  "update",
  "delete",
]);

/** The read or call `expr` makes, or `null` when it reaches no data. */
export function detectDataAccess(expr: ExprIR, ctx: WalkContext): DataAccess | null {
  return tryDetectApiHook(expr, ctx);
}

/** Record `binding` on the walk.  De-dupes by local name: the same read named
 *  twice in one body is bound once. */
function recordBinding(binding: DataBinding, ctx: WalkContext): void {
  if (!ctx.dataBindings.has(binding.varName)) ctx.dataBindings.set(binding.varName, binding);
}

/** How `bindAccess` shapes the binding's arguments. */
export interface BindOptions {
  /** Collapse a user find's positional args into its query bag (the default).
   *  A method-call receiver binds its handle as declared, without the bag. */
  shapeFindArgs?: boolean;
  /** Replace the rendered binding-time arguments outright — an awaited
   *  instance operation binds with the route id, and its call arguments go to
   *  the invocation instead. */
  bindingArgs?: readonly string[];
}

/** Bind `access` for this body through the target and record the binding.
 *  `renderArg` is the caller's context-aware expression renderer, so a param
 *  or state ref inside an argument propagates to the walk's flags. */
export function bindAccess(
  access: DataAccess,
  ctx: WalkContext,
  renderArg: (e: ExprIR) => string,
  opts: BindOptions = {},
): DataBinding {
  const bound = ctx.target.bindDataAccess(access, renderArg, ctx);
  const binding =
    opts.bindingArgs !== undefined
      ? { ...bound, argsRendered: opts.bindingArgs }
      : opts.shapeFindArgs === false
        ? bound
        : shapeFindArgs(access, bound, ctx);
  recordBinding(binding, ctx);
  return binding;
}

/** The expression a body writes where it reads `access` through `binding`. */
export function renderAccessSite(
  access: DataAccess,
  binding: DataBinding,
  ctx: WalkContext,
): string {
  return ctx.target.renderApiCall(
    {
      apiHandle: "",
      aggregateName: access.aggregateName,
      operation: access.operation,
      kind: "query",
      args: access.args,
      varName: binding.varName,
    },
    "",
    ctx,
  );
}

/** A method invoked on a bound handle (`<binding>.mutate(args)`). */
export function renderBoundMethodCall(
  binding: DataBinding,
  member: string,
  renderedArgs: string,
): string {
  return `${binding.varName}.${member}(${renderedArgs})`;
}

/** Register the error type an awaited call's error arms narrow on, for a
 *  target whose data access raises one. */
export function noteAccessErrorType(
  ctx: WalkContext,
  addImport: (ctx: WalkContext, from: string, name: string) => void,
): void {
  const errorType = ctx.target.dataErrorType;
  if (errorType) addImport(ctx, errorType.from, errorType.name);
}

/** Rewrite a user find's rendered args from positional to the object shape
 *  its binding takes (`<find><Agg>(query: <Find>Query)` — see
 *  `_frontend/api-module.ts`).  The find's param names come from the owning
 *  context's repository via `bcByAggregate`; paged finds gain the backend's
 *  page/pageSize defaults.  Standard ops (`all`/`byId`/`create`/`update`/
 *  `delete`) and unknown names pass through untouched. */
function shapeFindArgs(access: DataAccess, binding: DataBinding, ctx: WalkContext): DataBinding {
  if (access.kind !== "aggregate") return binding;
  const bc = ctx.bcByAggregate.get(access.aggregateName);
  const repo = bc?.repositories.find((r) => r.aggregateName === access.aggregateName);
  const find = repo?.finds.find((f) => f.name === access.operation);
  const isPaged = find ? pagedReturn(find.returnType) : null;
  // Standard ops (`byId`/`create`/…) pass through — EXCEPT a paged `all`
  // (paged by default), which takes the same object-shaped query arg a user
  // find does (`all<Plural>({ page, pageSize, sort, dir })`).
  if (STANDARD_AGG_OPS.has(access.operation) && !isPaged) return binding;
  // A PAGED read still needs its query bag when the call site passed nothing
  // (a hand-written `QueryView { of: Shop.Product.all }` — the scaffold threads
  // its page state, but this shape does not), because a target whose provider
  // is KEYED by that bag has no zero-arg form to fall back on: Flutter's
  // `.family` provider would be referenced bare and fail to compile.  Gated on
  // the target declaring `renderQueryArgsBag`, so the JSX frontends — whose
  // bindings do have a zero-arg form — stay unchanged.
  const needsExplicitBag = isPaged && !!ctx.target.renderQueryArgsBag;
  if (!find || (binding.argsRendered.length === 0 && !needsExplicitBag)) return binding;
  const pairs = find.params.map((p, i) => ({
    name: p.name,
    value: binding.argsRendered[i] ?? "undefined",
  }));
  if (isPaged) {
    // The paged controls follow the user params in the call's args (the scaffold
    // list threads its `pageNum`/`sortKey`/`sortDir` state here); any omitted →
    // the shared 1-based / default-order defaults.
    const extra = binding.argsRendered.slice(find.params.length);
    pairs.push(
      { name: "page", value: extra[0] ?? "1" },
      { name: "pageSize", value: extra[1] ?? "20" },
      { name: "sort", value: extra[2] ?? '"id"' },
      { name: "dir", value: extra[3] ?? '"asc"' },
    );
  }
  // The BAG's spelling is the target's — a JS object literal for the JSX
  // frontends, a Dart named record for Flutter (see `renderQueryArgsBag`).
  const bag =
    ctx.target.renderQueryArgsBag?.(pairs) ??
    `{ ${pairs.map((p) => `${p.name}: ${p.value}`).join(", ")} }`;
  return { ...binding, argsRendered: [bag], reactiveQuery: true };
}

// --- Binding records the shared primitives fill for a target's shell ---

/** `Action(<instance>.<op>, then?)` — a button bound to an aggregate
 *  operation invoked on an in-scope instance.  `emitAction` records
 *  the mutation hook here; both page and component shells declare it
 *  at function top (the hook must be called at component scope, not
 *  inside the onClick handler). */
export interface ActionMutationState {
  /** Local variable bound to the mutation hook (e.g. `confirmOrder`),
   *  referenced by the button's onClick. */
  localVar: string;
  /** Mutation hook name (e.g. `useConfirmOrder`). */
  hookName: string;
  /** camelCase aggregate name — the api module to import from
   *  (`<prefix>api/<aggCamel>`). */
  aggCamel: string;
  /** JS expression for the instance id to mutate (e.g. `order.id`).
   *
   *  ABSENT (`undefined`) means the hook takes NO hook-time argument at
   *  all — `DestroyForm` hoists `useDelete<Agg>()`, whose id goes to
   *  `mutateAsync` instead, unlike `use<Op><Agg>(<id>)`.  That is a
   *  different thing from an id that renders to the empty string, and it
   *  must stay a distinct value rather than `""`: a shell that decorates
   *  a PRESENT id (svelte wraps it in an accessor thunk) turns `""` into
   *  `useDeleteOrder(() => )`, a syntax error.  Render the argument with
   *  `renderActionMutationArg` rather than interpolating this field. */
  idExpr?: string;
  /** A ROW-scoped `Action` (inside a `Table` column / `For` lambda): one hook
   *  serves every row, so its id is read from this holder, which the row's
   *  click sets just before it mutates.  The shell declares the holder (a
   *  plain `{ current: "" }` box — nothing renders from it, so it needs no
   *  reactivity) and passes the hook a getter over it; `idExpr` is unused. */
  rowIdHolder?: string;
  /** The hook is called somewhere other than the shell's function top — React's
   *  row-scoped `Action` calls it inside a per-row child component — so the
   *  shell imports it and declares nothing. */
  importOnly?: boolean;
}

/** Render an action-mutation hook's hook-time ARGUMENT LIST.
 *
 *  The one place that knows what an absent `idExpr` means, shared by every
 *  shell that declares `const <localVar> = <hookName>(<arg>)`.  An absent id
 *  renders as the EMPTY argument list (`useDelete<Agg>()`); a present one is
 *  shaped by the framework's `wrap` — svelte's api factories take the id as an
 *  accessor, so it wraps in a thunk, while react passes it straight through.
 *
 *  Frameworks differ only in how they decorate a present id, never in whether
 *  an absent one may be decorated — which is why the check lives here and not
 *  in each shell.
 *
 *  `wrap` is REQUIRED, with no identity default: a shell that silently got the
 *  identity because it forgot the argument would emit an UNDECORATED id and
 *  compile clean, which is the same silent-degradation shape this helper exists
 *  to close (and what `test/platform/optional-context-param-sweep.test.ts`
 *  guards).  A shell that genuinely passes the id through spells that out as
 *  `(id) => id`. */
export function renderActionMutationArg(
  m: ActionMutationState,
  wrap: (idExpr: string) => string,
): string {
  return m.idExpr === undefined ? "" : wrap(m.idExpr);
}

/** The `can_<op>` probe wiring of a `when`-gated operation trigger. */
export interface OpGateState {
  /** Page-scope local bound to the probe query (`canComplete`). */
  local: string;
  /** The api-client hook/function that issues the probe
   *  (`useCanCompleteTask`), keyed under the record's own query key so every
   *  mutation that invalidates the record re-queries it. */
  hook: string;
  /** Target-native boolean expression — true while the trigger is disabled
   *  (`canComplete.data?.allowed === false`). */
  disabledExpr: string;
  /** Target-native string expression for the disabled trigger's accessible
   *  reason (`chrome.opNotAllowed`, translated when the UI is). */
  reasonExpr: string;
}

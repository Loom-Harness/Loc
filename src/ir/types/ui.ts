import type { ReadGated } from "./context.js";
import type { ExprIR } from "./expr.js";
import type { ActionIR, DerivedIR, ParamIR, StoreIR } from "./members.js";
import type { Sourced, TypeIR } from "./types.js";

// ---------------------------------------------------------------------------
// Page metamodel
//
// Mirrors the grammar's `Ui` / `Page` / `Component` / `Scaffold` /
// `MenuBlock` productions — every IR node here is a one-to-one lowering
// of those ASTs.  Scaffolds are NOT expanded at this layer — they
// stay as literal `ScaffoldIR` directives until the scaffold expander
// runs.
//
// Designed so a future LiveView / Blazor backend can consume the same
// IR — mutations (`:=`), navigations, and component invocations are
// platform-neutral here; their lowering into framework-specific code
// is the per-target generator's concern.
// ---------------------------------------------------------------------------

/** A `ui` SystemMember: pages, components, and an optional sidebar
 *  menu block.  Scaffold synthesis happens at the AST level via
 *  the `scaffold` stdlib macro; by the time we lower to IR, every
 *  page is a first-class PageIR with no special-cased provenance. */
export interface UiIR {
  name: string;
  /** D-PHOENIX-SURFACE: the framework this UI renders against, declared
   *  on the `ui { framework: … }` block itself rather than derived from
   *  the hosting deployable's platform.  `undefined` when the source
   *  omits it (the legacy path: the deployable's `uiFramework` still
   *  derives from its platform).  Values are `Framework` grammar
   *  strings (`react` | `phoenixLiveView`). */
  framework?: string;
  pages: PageIR[];
  components: ComponentIR[];
  /** Shared client-side state containers — `store Cart { … }`
   *  (named-actions-and-stores.md §3, Stage 5).  Referenced by dotted name
   *  from page/component bodies; each consumer's dependency is DERIVED from
   *  its resolved `store-field` refs + `store-action` calls.  Empty when the
   *  ui declares none. */
  stores: StoreIR[];
  /** Optional ui-level menu block.  When undefined the sidebar is
   *  derived from each page's `menuMeta` (see spec §11). */
  menu?: MenuBlockIR;
  /** UI api parameters.  Each entry maps a local handle name (used in
   *  page bodies as `<handle>.<aggregate>.<op>`) to an api the system
   *  declares.  Composition is supplied by the deployable that
   *  deploys this UI. */
  apiParams: UiApiParamIR[];
  /** Channel subscriptions (`channel Orders: Sales.Lifecycle`) — each
   *  binds a local handle to a context's broadcast channel (channels.md
   *  Part I, ui surface).  Empty when the ui declares none. */
  channelParams: UiChannelParamIR[];
  /** Live-event handlers (`on Orders.OrderShipped(e) { toast(…) }`).
   *  Empty when the ui declares none. */
  notifications: UiNotificationIR[];
  /** Extern frontend functions (`function f(…): T extern from "…"`) —
   *  the logic escape hatch (extern-function-hook-escape-hatch.md §3).
   *  Empty when the ui declares none. */
  functions: UiFunctionIR[];
}

/** `function <name>(params): T extern from "<path>"` — a typed pure
 *  function implemented by a hand-written module.  The React generator
 *  emits a typed signature + a conformance shim (`tsc` is the
 *  fail-fast); page bodies call it through the shim. */
export interface UiFunctionIR {
  name: string;
  params: ParamIR[];
  returnType: TypeIR;
  externPath: string;
}

/** `channel <name>: <Ctx>.<Channel>` — a UI's subscription to a
 *  broadcast channel.  The wire format (SSE/WebSocket) is derived from
 *  the frontend's platform, never stated here. */
export interface UiChannelParamIR {
  name: string;
  contextName: string;
  channelName: string;
}

/** A `refetch(<Aggregate>)` action inside an `on` handler body — the
 *  realtime analogue of a mutation's `onSuccess` cache invalidation.
 *  Fully resolved: `queryTag` is the exact `["<tag>"]` query key the
 *  frontend api modules register (`routeSegmentFor(aggregate)`), so a
 *  realtime invalidation and a mutation-success invalidation hit the
 *  same cache entries.  Backends never re-derive the tag. */
export interface RefetchTargetIR {
  /** The aggregate whose queries are invalidated (resolved to a real
   *  aggregate in the enclosing system by the validator). */
  aggregate: string;
  /** The query-key tag — `routeSegmentFor(aggregate)`.  Frontends emit
   *  `qc.invalidateQueries({ queryKey: ["<queryTag>"] })`, prefix-matching
   *  the aggregate's list / detail / find queries. */
  queryTag: string;
}

/** `on <param>.<Event>(e) { toast(…)  refetch(Agg) }` — render a carried
 *  event as it arrives on the realtime wire.  A handler body admits two
 *  actions: `toast(<expr>)` (a message notification) and
 *  `refetch(<Aggregate>[, …])` (invalidate that aggregate's query cache);
 *  the validator (`loom.ui-handler-statement-unknown`) rejects anything else.
 *  Each lowers with `bind` in scope as the event payload. */
export interface UiNotificationIR {
  /** The channel-param handle the handler subscribes through. */
  paramName: string;
  /** The carried event's type tag on the wire (`event.type`). */
  eventType: string;
  /** Handler binding name (`e` in `on Orders.OrderShipped(e)`). */
  bind: string;
  /** One toast message expression per `toast(<expr>)` handler statement. */
  toasts: ExprIR[];
  /** One entry per aggregate named across the handler's `refetch(…)`
   *  statements.  Empty when the handler declares no refetch. */
  refetches: RefetchTargetIR[];
}

/** API declaration — first-class contract derived from a module's
 *  domain.  Auto-derives the full surface (aggregate CRUD +
 *  repository finds + workflows + views).  Future: customization
 *  (hide, rename, expose subset, version). */
export interface ApiIR {
  name: string;
  /** Source module the api derives its surface from. */
  sourceModule: string;
  /** URL slug style for lifecycle actions surfaced by this api.
   *  `"literal"` (default) emits the action name verbatim; `"resource"`
   *  pluralises it.  Drives `OperationIR.routeSlug` derivation in
   *  enrichment (D-URLSTYLE / lifecycle-operations.md). */
  urlStyle: "literal" | "resource";
  /** Per-error HTTP status overrides declared via `httpStatus <Error> -> <Code>`
   *  in the api block (exception-less.md A1).  Keyed by error-payload name; an
   *  error absent here falls back to the stdlib default
   *  (`src/util/error-defaults.ts`).  Empty when the api declares none. */
  errorStatuses: Record<string, number>;
  /** Explicit transport bindings declared via `route <METHOD> <PATH> ->
   *  <Context>.<Handler>` in the api block (unfoldable-api-derivation.md,
   *  Layer 4).  Ride alongside the api, unread by any backend.
   *  Empty when the api declares none. */
  routes: RouteIR[];
}

/** A single explicit `route <METHOD> <PATH> -> <Context>.<Handler>` transport
 *  binding (unfoldable-api-derivation.md, Layer 4).  `target.handler` is a plain
 *  name resolved by the IR validator (`loom.route-handler-unresolved`) against
 *  the commandHandler / queryHandler members of
 *  `target.context`. */
export interface RouteIR {
  /** HTTP method — `GET` | `POST` | `PUT` | `PATCH` | `DELETE`. */
  method: string;
  /** URL path template, delimiters stripped (`/orders/{id}`). */
  path: string;
  /** The `Context.Handler` target. */
  target: { context: string; handler: string };
}

/** UI api parameter — local handle + which api it expects. */
export interface UiApiParamIR {
  /** Local name used in page bodies (e.g. `Sales` in `Sales.Customer.all`). */
  name: string;
  /** Name of the system-scope `Api` this parameter expects. */
  apiName: string;
}

/** Per-page layout selector.  Three discriminator variants:
 *  - `{ kind: "preset", name: "default" }` — wrapped by the
 *    deployable's AppShell chrome (the v1 default behaviour).
 *  - `{ kind: "preset", name: "none" }` — mounted at the top of the
 *    router with no chrome at all (v1 escape hatch).
 *  - `{ kind: "named", ref: string }` — wrapped by a named `layout`
 *    SystemMember declared in the same system.  The
 *    React generator emits one `<X>Layout` component per declared
 *    `LayoutIR` and routes pages through the matching layout-route. */
export type PageLayoutIR =
  | { kind: "preset"; name: "default" | "none" }
  | { kind: "named"; ref: string };

/** A named `layout <Name> { … }` SystemMember.  Each slot's
 *  body is a single page-body-shaped `ExprIR` evaluated against the
 *  same walker-stdlib + user-component scope as a page body.  The
 *  `main` slot is implicit — it's the React Router `<Outlet />`
 *  position; every layout has exactly one `main` (validator enforces). */
export interface LayoutIR {
  name: string;
  header?: ExprIR;
  sidebar?: ExprIR;
  footer?: ExprIR;
}

/** A page declaration: route + parameters + reactive state + body. */
/** A page's `requires` is its auth gate, same syntax as on operations. */
export interface PageIR extends Sourced, ReadGated {
  name: string;
  params: ParamIR[];
  /** Path-with-`:params` from `route: "..."`.  Always set for pages
   *  written in source; scaffold-synthesised pages set it directly in
   *  the `with scaffold(...)` macro. */
  route?: string;
  /** Optional title expression.  May interpolate state / data refs. */
  title?: ExprIR;
  /** Reactive local fields.  Multiple `state { }` blocks merge here
   *  (matches the `permissions` block multiplicity rule). */
  state: StateFieldIR[];
  /** Read-only computed values in the render scope — `derived total: T =
   *  expr`.  Reactive over `state` (recompute on change); sequential (a
   *  derived may reference params, state, and *earlier* derived).  Each
   *  frontend hoists these before the body (React `useMemo`, Vue
   *  `computed`, Svelte `$derived`, HEEx inline-recompute). */
  derived: DerivedIR[];
  /** Named, typed event handlers — `action next() { … }` (Proposal A
   *  Stage 1).  Each frontend hoists one named handler function per action
   *  before the body; a bare `onSubmit: <name>` reference binds it instead
   *  of an inline arrow. */
  actions: ActionIR[];
  /** Single body expression.  Conditional rendering uses `match` in
   *  the expression engine, not a guarded-declaration form. */
  body?: ExprIR;
  /** Per-page menu metadata.  Read by the menu emitter when
   *  no explicit ui-level menu block is declared. */
  menuMeta?: MenuMetaIR;
  /** Explicit emit path override for walker-rendered
   *  pages.  When set, the page-emitter writes the rendered TSX to
   *  this path instead of the default `src/pages/<page-snake>.tsx`.
   *  Populated during lowering so a scaffold-emitted page lands at
   *  its conventional path (`src/pages/<plural>/list.tsx` for an
   *  aggregate's list page, etc.) — preserves URL/file shape. */
  emitPath?: string;
  /** Containing-area path (outermost → innermost), when the page is
   *  declared inside one or more `area { … }` blocks.  Drives `emitPath`
   *  (`src/pages/<area-path>/<page>.tsx`); empty for a top-level
   *  page.  Each segment is the snake-cased area name. */
  area: string[];
  /** Optional layout selector.  When undefined, the page receives
   *  the deployable's default app-shell chrome.  See `PageLayoutIR`
   *  for the preset value set; undefined is intentionally distinct
   *  from `{ kind: "preset", name: "default" }` to preserve the
   *  v2-named-layout-inheritance posture (a ui-level layout supplies
   *  the default when the page doesn't declare one). */
  layout?: PageLayoutIR;
  /** Optional static page metadata projected into the generated
   *  `index.html` shell — `<meta name="description">`,
   *  `<meta property="og:image">`, and `<link rel="canonical">`.
   *  All three are plain string literals (no state / param
   *  interpolation), so we carry them verbatim rather than as
   *  `ExprIR`.  Only the route-`/` page (or the first page when
   *  no `/` exists) contributes metadata to the shell. */
  metadata?: PageMetadataIR;
}

/** Static page metadata — SEO + social-graph tags written into
 *  the generated `index.html`.  All fields optional; absent fields
 *  produce no markup. */
export interface PageMetadataIR {
  description?: string;
  ogImage?: string;
  canonical?: string;
}

/** Provenance for a page's body shape.  Scaffold-emitted pages carry
 *  a non-`custom` origin so downstream generators (pages-emitter,
 *  menu-emitter, page-objects-emit) can pick the right emit path,
 *  nav-link metadata, and Playwright page-object class without
 *  re-introspecting the body.  User-written explicit pages get
 *  `{ kind: "custom" }` — they emit at `src/pages/<page-snake>.tsx`
 *  and contribute no auto-nav entry. */
/** A user-defined component: typed function from params (and optional
 *  local state) to a body expression.  Components compose other
 *  components but never produce pages or routes. */
export interface ComponentIR extends Sourced {
  name: string;
  params: ParamIR[];
  state: StateFieldIR[];
  /** Read-only computed values in the render scope — the component twin of
   *  `PageIR.derived` (same `derived total: T = expr` surface, same
   *  reactive/sequential semantics).  Absent (empty) on an `extern`
   *  component. */
  derived: DerivedIR[];
  /** Named, typed event handlers — the component twin of `PageIR.actions`
   *  (Proposal A Stage 1).  Absent (empty) on an `extern` component. */
  actions: ActionIR[];
  /** Walked region tree.  Absent for an `extern` component, whose
   *  rendering is owned by a hand-written file. */
  body?: ExprIR;
  /** True when the component is `extern` — the generator emits a
   *  typed `<Name>.props.ts` interface and imports the user's module
   *  at call sites instead of generating a body. */
  extern: boolean;
  /** Module specifier for the hand-written component, relative to the
   *  generated project's `src/` root (the `from "<path>"` clause).
   *  Always present when `extern` is true. */
  externPath?: string;
}

/** One reactive local field, inside a `page` or `component`. */
export interface StateFieldIR {
  name: string;
  type: TypeIR;
  /** Optional initial value.  Undefined fields default to `null`
   *  for optional types and the type's zero value otherwise (per
   *  spec §6). */
  init?: ExprIR;
}

/** Per-page sidebar metadata.  Bare entries — validator
 *  enforces the allowed key names (`section` / `label` / `order` /
 *  `hidden`).  Same shape as `ThemeIR`'s entries: bare key + typed
 *  value, with the validator policing the surface. */
export interface MenuMetaIR {
  entries: { name: string; value: ExprIR }[];
}

/** A `menu { section "S" { link Page, link "L" -> "url" } }` block. */
export interface MenuBlockIR {
  sections: MenuSectionIR[];
}

export interface MenuSectionIR {
  label: string;
  links: MenuLinkIR[];
}

export type MenuLinkIR =
  | {
      kind: "page";
      pageName: string;
      /** The linked page's route, captured from the resolved cross-reference.
       *  Role-named scaffold pages share a `pageName` (`List`) across
       *  aggregates, so the menu emitter keys on this unique route to find the
       *  exact target page (e.g. `link Orders.List` → `/orders`).  Undefined
       *  only when the reference didn't resolve. */
      route?: string;
      /** Override props (`label`, `order`).  Validator checks the
       *  allowed key names. */
      props: { name: string; value: ExprIR }[];
    }
  | {
      kind: "external";
      label: string;
      url: string;
    };

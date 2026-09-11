// -------------------------------------------------------------------------
// System-level UI-framework support gates: data grid, HEEx component host
// state, chart, projection-read framework, current-user-needs-auth-ui,
// realtime, flutter primitive, and the auth-ui-framework guard.  Split out
// of system-checks.ts by packet 2.6 (wave-2) — mechanical move, no logic
// change.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { FLUTTER_DEFERRED_BUILDER_NAMES } from "../../../util/flutter-deferred-primitives.js";
import type {
  ActionIR,
  DeployableIR,
  ExprIR,
  StmtIR,
  SystemIR,
  UiIR,
} from "../../types/loom-ir.js";
import { exprUsesCurrentUser, stmtUsesCurrentUser } from "../../types/loom-ir.js";
import { backendServesRealtime } from "../../util/channels.js";
import { bodyUsesChart } from "../../util/chart.js";
import { componentChildrenHosts } from "../../util/component-children.js";
import { dataGridHosts } from "../../util/data-grid.js";
import { FORM_LOCAL_FRAMEWORKS, formLocalCollisionHosts } from "../../util/form-locals.js";
import {
  unsupportedFrontendParamType,
  unsupportedFrontendPropType,
} from "../../util/frontend-prop-type.js";
import { heexComponentHostStateUses } from "../../util/heex-component-host-state.js";
import { liveViewHandlerCollisions, liveViewStatefulReuse } from "../../util/liveview-hoisting.js";
import { readableProjectionNames } from "../../util/projection-read.js";
import { walkExprDeep, walkExprStmtsDeep, walkStmtDeep } from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";
import { walkExpr } from "./shared.js";
import { VIEW_EFFECT_BUILTINS } from "./ui-checks-shared.js";

// `auth: ui` (the frontend OIDC guard) is emitted by every shipped frontend
// generator: React, Vue, Svelte, Angular, Feliz (`generator/feliz/auth-gate.ts`
// — the Elmish session model + `AuthGate` view, driven end-to-end by the
// `authgate` scenario in `generated-feliz-build.yml`) and Flutter
// (`generator/flutter/auth-gate.ts` — the `sessionProvider` probe, the `AuthGate`
// wrapper around `MaterialApp`, and the `ForbiddenView` page guard).  The set is
// KEPT, not deleted: it is the seam a new frontend gates on until it ports, and
// the diagnostic below is its message — a deployable whose resolved UI framework
// is absent would otherwise silently emit no guard at all.

const AUTH_UI_FRAMEWORKS = new Set(["react", "vue", "svelte", "angular", "feliz", "flutter"]);

/** Frontends whose walker emits the `DataGrid` primitive.
 *
 *  The membership rule is D-DATAGRID-TARGETS: a frontend ships `DataGrid` iff
 *  it can run **TanStack Table** itself — not iff it emits JSX, and not iff its
 *  UI kit happens to have a grid widget.  `DataGrid` IS a TanStack row model
 *  behind the `renderDataGridChild` seam, so any other way of satisfying it
 *  forks the behaviour the seam exists to share.  Feliz qualifies because Fable
 *  compiles F# to JavaScript (it binds `@tanstack/table-core` directly, as the
 *  Svelte target does); Flutter never will, because its shipping target is a
 *  native build with no JS runtime.
 *
 *  Using it elsewhere is a COMPILE ERROR rather than a silently missing grid:
 *  the page would otherwise render an empty slot (or a "not supported" comment
 *  on HEEx) and the author would only find out by looking at the running app. */

const DATA_GRID_FRAMEWORKS = new Set<string>(["react", "vue", "svelte", "angular", "feliz"]);

/** `DataGrid` on a frontend that can't render it (M-T1.1 follow-on). */

export function validateDataGridFramework(sys: SystemIR, diags: LoomDiagnostic[]): void {
  for (const d of sys.deployables) {
    for (const { ui, fw } of mountedUis(sys, d)) {
      if (DATA_GRID_FRAMEWORKS.has(fw)) continue;
      // Pages AND components — a grid moved into a component is just as
      // unrenderable, and `dataGridHosts` is the same scan the Feliz emitter
      // uses to decide whether to ship `@tanstack/table-core`.
      for (const what of dataGridHosts(ui)) {
        diags.push({
          severity: "error",
          code: "loom.datagrid-unsupported-target",
          message: diagMessage("loom.datagrid-unsupported-target", {
            what,
            dName: d.name,
            fw: fw || "unknown",
          }),
          source: `${ui.name}/${what}`,
        });
      }
    }
  }
}

/** A page-body primitive that needs HOST-LIVEVIEW state, written inside a
 *  `component`, on a phoenixLiveView ui.
 *
 *  A HEEx function component is a pure render function with no process of its
 *  own, so its `state { … }` and named `action`s are LIFTED into the host page's
 *  LiveView (#2646).  That hoisting was never extended to the walker's form /
 *  query / upload / table-control accumulators, so these primitives emit their
 *  markup inside the component while the host gets no assign, no
 *  `allow_upload/3` and no `handle_event/3`.
 *
 *  It is a COMPILE ERROR rather than a documented degrade because the emitted
 *  project passes `mix compile --warnings-as-errors` and then dies at REQUEST
 *  time on the missing assign — a page that raises on load, or a form whose submit
 *  silently does nothing.  A gate the author reads is strictly better than a
 *  crash they meet in the running app.  The workaround is exact and local: move
 *  the primitive into the page body (components may still hold layout, display,
 *  `state` and `action`s).
 *
 *  Drains when the four accumulators hoist the way state and actions already do
 *  — the same `ComponentActionInfo` + `gather*` seam, plus the multi-instance
 *  question `componentUses` exists to answer for state. */

export function validateHeexComponentHostState(sys: SystemIR, diags: LoomDiagnostic[]): void {
  for (const d of sys.deployables) {
    for (const { ui, fw } of mountedUis(sys, d)) {
      if (fw !== "phoenixLiveView") continue;
      for (const { component, primitive } of heexComponentHostStateUses(ui)) {
        diags.push({
          severity: "error",
          code: "loom.heex-component-host-state-unsupported",
          message: diagMessage("loom.heex-component-host-state-unsupported", {
            component,
            primitive,
            dName: d.name,
          }),
          source: `${ui.name}/${component}`,
        });
      }
    }
  }
}

/** Frontends whose component props and extern-function signatures are emitted
 *  as TYPESCRIPT, through the two shared `_frontend/` modules
 *  (`component-prop-type.ts` / `extern-functions.ts`).  Feliz spells its own
 *  props record and Flutter its own Dart widget args, so neither goes through
 *  the TS mapping this gate describes; HEEx has no props file at all. */

const TS_PROP_FRAMEWORKS: ReadonlySet<string> = new Set(["react", "vue", "svelte", "angular"]);

/** A declared component param / extern-function signature type the TS prop
 *  layer cannot spell (§18 sentinels — `_frontend/component-prop-type.ts` and
 *  `_frontend/extern-functions.ts`).
 *
 *  Both emitters deliberately THROW rather than emit `any`, because a prop the
 *  frontend cannot type silently voids the contract the escape hatch exists to
 *  enforce — right call, wrong phase: the throw was a raw stack trace on a
 *  `.ddd` that had just validated clean.  The condition is a pure fact about a
 *  declared type, so it is refused here; the emitters keep their throws as
 *  internal floors naming this code.  See
 *  `src/ir/util/frontend-prop-type.ts` for the measured evidence per shape. */

export function validateFrontendPropTypes(sys: SystemIR, diags: LoomDiagnostic[]): void {
  for (const d of sys.deployables) {
    for (const { ui, fw } of mountedUis(sys, d)) {
      if (!TS_PROP_FRAMEWORKS.has(fw)) continue;
      const flag = (where: string, what: string): void => {
        diags.push({
          severity: "error",
          code: "loom.frontend-prop-type-unsupported",
          message: diagMessage("loom.frontend-prop-type-unsupported", {
            where,
            what,
            uiName: ui.name,
            dName: d.name,
            fw,
          }),
          source: `${ui.name}/${where}`,
        });
      };
      for (const c of ui.components) {
        for (const p of c.params) {
          const what = unsupportedFrontendParamType(p.type);
          if (what) flag(`component '${c.name}' parameter '${p.name}'`, what);
        }
      }
      for (const fn of ui.functions ?? []) {
        for (const p of fn.params) {
          const what = unsupportedFrontendPropType(p.type);
          if (what) flag(`extern function '${fn.name}' parameter '${p.name}'`, what);
        }
        const ret = unsupportedFrontendPropType(fn.returnType);
        if (ret) flag(`extern function '${fn.name}' return type`, ret);
      }
    }
  }
}

/** The two LiveView component-HOISTING collisions (§18 sentinels).
 *
 *  A HEEx function component owns no process, so `liveview-emit.ts` lifts its
 *  `state { … }` into the host LiveView's assigns and its named `action`s into
 *  the host's `handle_event/3` clauses.  Two shapes the host cannot hold — a
 *  handler NAME declared on two surfaces one page renders, and a `state`-
 *  declaring component rendered more than once — used to `throw` a bare
 *  `Error` mid-generate, with no `loom.*` code and a raw stack trace, on a
 *  `.ddd` that had just validated clean.  Both are model-level facts, so they
 *  are refused HERE; the emitter keeps its throws as internal floors naming
 *  these codes.  See `src/ir/util/liveview-hoisting.ts`. */

export function validateLiveViewHoisting(sys: SystemIR, diags: LoomDiagnostic[]): void {
  for (const d of sys.deployables) {
    for (const { ui, fw } of mountedUis(sys, d)) {
      if (fw !== "phoenixLiveView") continue;
      for (const c of liveViewHandlerCollisions(ui)) {
        diags.push({
          severity: "error",
          code: "loom.heex-handler-name-collision",
          message: diagMessage("loom.heex-handler-name-collision", {
            page: c.page,
            handler: c.handler,
            first: c.first,
            second: c.second,
            dName: d.name,
          }),
          source: `${ui.name}/page '${c.page}'`,
        });
      }
      for (const r of liveViewStatefulReuse(ui)) {
        diags.push({
          severity: "error",
          code: "loom.heex-stateful-component-reused",
          message: diagMessage("loom.heex-stateful-component-reused", {
            page: r.page,
            component: r.component,
            count: r.count,
            dName: d.name,
          }),
          source: `${ui.name}/page '${r.page}'`,
        });
      }
    }
  }
}

/** Every ui a deployable actually mounts, with the framework that will render
 *  it.  `hosts: [A, B]` mounts SEVERAL (D-PHOENIX-SURFACE); `ui:` sugar/compose
 *  mounts one — a gate reading `d.uiName` alone never scans past the first, so
 *  a primitive used only in the second slipped through.  The framework is
 *  resolved per-ui (`ui.framework` wins) because `d.uiFramework` derives from
 *  the FIRST hosted ui only.  Same idiom as `validateUiRealtimeSupport` /
 *  `validateFlutterPrimitiveSupport`. */

function mountedUis(sys: SystemIR, d: DeployableIR): { ui: UiIR; fw: string }[] {
  const uiNames = d.hostedUiNames.length > 0 ? d.hostedUiNames : d.uiName ? [d.uiName] : [];
  const out: { ui: UiIR; fw: string }[] = [];
  for (const uiName of uiNames) {
    const ui = sys.uis.find((u) => u.name === uiName);
    if (ui) out.push({ ui, fw: ui.framework ?? d.uiFramework ?? "" });
  }
  return out;
}

/** Frontends that can render `Chart`.
 *
 *  react reaches a charting LIBRARY through its design pack; the other three
 *  need none — see the rollout note on the gate below. */
/** `Chart` on a target that can't render it.
 *
 *  `primitive-chart` is in `REQUIRED_PRIMITIVES.tsx.core`, so a react pack
 *  missing it is a pack-LOAD failure rather than something to re-check here.
 *  This gate is the per-FRAMEWORK rule, exactly like
 *  `validateDataGridFramework`.
 *
 *  Phoenix, Feliz and Flutter join react by rendering the chart THEMSELVES —
 *  inline SVG (HEEx, Feliz) and a `CustomPainter` (Flutter), computed from rows
 *  the client (or the LiveView socket) has already decoded, with no charting
 *  library and no dependency added.  None of the three has a `.hbs` pack matrix
 *  to backfill, so unlike the tsx leg there was no per-pack library to choose —
 *  which is what made them the cheap legs.  Vue, Svelte and Angular have no
 *  chart renderer and would render an unsupported-primitive comment, so they
 *  stay honest gaps.
 *
 *  NOTE for the sibling ports: this Set is edited by every frontend's chart PR,
 *  so it conflicts on rebase.  Resolve by keeping EVERY framework already
 *  present plus yours — never by taking one side wholesale.
 *
 *  The Set names every shipping framework, so the gate fires for nothing that
 *  exists today — it is the seam a NEW frontend
 *  gates on until it ports, not dead code.  EXPORTED so its own test can prove
 *  it still bites: with nothing left to gate, "the check works" and "the check
 *  is unreachable" are indistinguishable from the outside, and the only honest
 *  way to tell them apart is to remove a framework and watch the diagnostic
 *  come back (`ui-chart-gates.test.ts`) — the same discipline
 *  `PROJECTION_READ_FRAMEWORKS` already uses one gate over. */

export const CHART_FRAMEWORKS = new Set([
  "react",
  "phoenixLiveView",
  "feliz",
  "flutter",
  "vue",
  "svelte",
  "angular",
]);

export function validateChartSupport(sys: SystemIR, diags: LoomDiagnostic[]): void {
  for (const d of sys.deployables) {
    for (const { ui, fw } of mountedUis(sys, d)) {
      if (CHART_FRAMEWORKS.has(fw)) continue;
      // Components render into pages, so a chart moved into one must not slip
      // the gate — same body coverage as `validateUiProjectionReadFramework`.
      const bodies: Array<{ what: string; body: ExprIR | undefined }> = [
        ...ui.pages.map((p) => ({ what: `page '${p.name}'`, body: p.body })),
        ...ui.components.map((c) => ({ what: `component '${c.name}'`, body: c.body })),
      ];
      for (const { what, body } of bodies) {
        if (!bodyUsesChart(body)) continue;
        diags.push({
          severity: "error",
          code: "loom.chart-unsupported-target",
          message: diagMessage("loom.chart-unsupported-target", {
            what,
            name: d.name,
            uiFramework: fw || "unknown",
          }),
          source: `${ui.name}/${what}`,
        });
      }
    }
  }
}

// Frontends whose generated client can READ a query-time projection
// These ship a projections api module + the walker's
// Pattern H; the remaining frontends have no client, so a page reading a
// projection there would emit an unresolved receiver — `undefined.<Projection>`,
// a runtime TypeError and a build break.  Gate honestly until each ports, the
// same reviewed-gap discipline as the backend-side projection gates.
//
// NOTE for the sibling ports: this one-line Set is edited by every frontend's
// port PR, so it conflicts on rebase.  Resolve by keeping EVERY framework
// already present plus yours — never by taking one side wholesale.
//
// The Set names every shipping framework, so the gate fires for nothing that
// exists today — it is the seam a NEW frontend
// gates on until it ports, not dead code.  EXPORTED so its own test can prove
// it still bites: with nothing left to gate, "the check works" and "the check
// is unreachable" are indistinguishable from the outside, and the only honest
// way to tell them apart is to remove a framework and watch the diagnostic
// come back (`projection-select-unresolved.test.ts`).

export const PROJECTION_READ_FRAMEWORKS = new Set([
  "react",
  "vue",
  "svelte",
  "angular",
  "feliz",
  "flutter",
  // Phoenix is the odd leg: it emits no projection CLIENT at all.  A LiveView
  // deployable hosts its contexts in the same OTP app, so the read is an
  // in-process `<Ctx>.QueryProjections.<Proj>.run/1` call — see
  // `renderProjectionLoaders` (generator/elixir/liveview-emit.ts).
  "phoenixLiveView",
]);

/** `loom.ui-projection-read-unsupported`, the FRAMEWORK half.  The FLAVOUR half
 *  (a keyed / folded projection, unreadable on every target) is F3 in
 *  ui-checks.ts; this one decides whether the page's own frontend has the
 *  client, which needs the deployable in scope. */

export function validateUiProjectionReadFramework(sys: SystemIR, diags: LoomDiagnostic[]): void {
  const readable = readableProjectionNames(sys.subdomains.flatMap((sd) => sd.contexts));
  if (readable.size === 0) return;
  for (const d of sys.deployables) {
    for (const { ui, fw } of mountedUis(sys, d)) {
      if (PROJECTION_READ_FRAMEWORKS.has(fw)) continue;
      const handles = new Set(ui.apiParams.map((p) => p.name));
      // Components read projections too — F3 walks their bodies, so this half
      // must as well or a read simply moved into a component slips the gate.
      const bodies: Array<{ what: string; body: ExprIR | undefined }> = [
        ...ui.pages.map((p) => ({ what: `page '${p.name}'`, body: p.body })),
        ...ui.components.map((c) => ({ what: `component '${c.name}'`, body: c.body })),
      ];
      for (const { what, body } of bodies) {
        for (const name of projectionReads(body, handles, readable)) {
          diags.push({
            severity: "error",
            code: "loom.ui-projection-read-unsupported",
            message: diagMessage("loom.ui-projection-read-unsupported#frontend-has-no-client", {
              what,
              name,
              dName: d.name,
              fw: fw || "unknown",
              // Named from the gate itself, so a port that widens the set can't
              // leave the message advertising a stale list.
              frameworks: [...PROJECTION_READ_FRAMEWORKS].sort().join(", "),
            }),
            source: `${ui.name}/${what}`,
          });
        }
      }
    }
  }
}

/** Readable-projection names a page body reads through an api handle — the
 *  validator's mirror of the walker's Pattern H (`<apiHandle>.<Projection>`). */

function projectionReads(
  body: ExprIR | undefined,
  handles: ReadonlySet<string>,
  readable: ReadonlySet<string>,
): string[] {
  const found: string[] = [];
  walkExprDeep(body, (e) => {
    if (
      e.kind === "member" &&
      e.receiver.kind === "ref" &&
      handles.has(e.receiver.name) &&
      readable.has(e.member)
    ) {
      found.push(e.member);
    }
  });
  return found;
}

export function validateAuthUiFramework(sys: SystemIR, diags: LoomDiagnostic[]): void {
  for (const d of sys.deployables) {
    if (!d.auth?.ui) continue;
    if (!AUTH_UI_FRAMEWORKS.has(d.uiFramework ?? "")) {
      diags.push({
        severity: "error",
        code: "loom.auth-ui-unsupported-framework",
        message: diagMessage("loom.auth-ui-unsupported-framework", {
          name: d.name,
          uiFramework: d.uiFramework ?? "unknown",
          // Named from the gate itself, so widening the Set can't leave the
          // message advertising a stale list.
          frameworks: [...AUTH_UI_FRAMEWORKS].join(", "),
        }),
        source: d.name,
      });
    }
  }
}

/** `currentUser` read from a page/component with no principal bound.
 *
 *  `currentUser` in a page body is the VERIFIED SESSION user, and the only
 *  thing that binds one is the auth guard: `auth: ui` on a frontend deployable
 *  (React's `const currentUser = useSession().user`, and its Vue/Svelte/Angular/
 *  Feliz twins) or `auth: required` on a fullstack deployable that mounts the ui
 *  itself (Phoenix `LiveAuth.on_mount` assigns `@current_user`).  Without one,
 *  every frontend emits a DANGLING reference — react `currentUser.email` against
 *  no binding, flutter invalid Dart, feliz a `CurrentUser` match on a Model that
 *  has no such field.  Nothing downstream re-checks it, so the model compiles
 *  and the claim read is garbage at runtime.
 *
 *  The missing `user { … }` block is NOT this gate's case: without it the token
 *  never resolves to a `current-user` ref at all, and `loom.auth-no-user-block`
 *  (plus the AST-level `auth`-without-`user` error) already names it. */

export function validateCurrentUserNeedsAuthUi(sys: SystemIR, diags: LoomDiagnostic[]): void {
  for (const d of sys.deployables) {
    // A guard is mounted — the session user is in scope, nothing to say.
    if (d.auth?.ui || d.auth?.required) continue;
    for (const { ui } of mountedUis(sys, d)) {
      // Components are walked for the same reason charts and grids are — a
      // read moved into one renders into the page all the same.
      const hosts: { what: string; host: UiRenderHost }[] = [
        ...ui.pages.map((p) => ({ what: `page '${p.name}'`, host: p as UiRenderHost })),
        ...ui.components.map((c) => ({ what: `component '${c.name}'`, host: c as UiRenderHost })),
      ];
      for (const { what, host } of hosts) {
        if (!hostReadsCurrentUser(host)) continue;
        diags.push({
          severity: "error",
          code: "loom.current-user-needs-auth-ui",
          message: diagMessage("loom.current-user-needs-auth-ui", {
            what,
            uiName: ui.name,
            dName: d.name,
          }),
          source: `${ui.name}/${what}`,
        });
      }
    }
  }
}

/** The render-scope members a page and a component share — every place a
 *  `currentUser` read can hide in one.  (`PageIR` carries more; only these
 *  five are walked here.)
 *
 *  `requires` is page-only (a component has no gate expression) and is the
 *  SECURITY-shaped member: `page { requires currentUser.role == "admin" }` is
 *  precisely the place a `currentUser` read is load-bearing.  Without a session
 *  binding the gate expression renders against nothing (`_frontend/gate-expr.ts`
 *  emits the read verbatim), so an unauthenticated ui would ship an access check
 *  that can never evaluate — clean validation, no guard. */

interface UiRenderHost {
  body?: ExprIR;
  requires?: ExprIR;
  state: { init?: ExprIR }[];
  derived: { expr: ExprIR }[];
  actions: { body: StmtIR[] }[];
}

function hostReadsCurrentUser(host: UiRenderHost): boolean {
  if (exprUsesCurrentUser(host.body)) return true;
  if (exprUsesCurrentUser(host.requires)) return true;
  if (host.state.some((s) => exprUsesCurrentUser(s.init))) return true;
  if (host.derived.some((d) => exprUsesCurrentUser(d.expr))) return true;
  return host.actions.some((a) => a.body.some(stmtUsesCurrentUser));
}

// Frontends that CONSUME the realtime SSE wire (channels.md Part I) — each
// subscribes to the backend's `GET /realtime/events` stream, so a live-event
// handler is honored ONLY when the target backend serves that wire
// (`backendServesRealtime`).  `static` hosts one of these framework bundles.

const SSE_REALTIME_FRONTENDS = new Set<string>([
  "react",
  "vue",
  "svelte",
  "angular",
  "feliz",
  // Flutter subscribes through `generator/flutter/realtime.ts` — the browser's
  // own `EventSource` on the web, a line parser over a streamed `package:http`
  // response natively, behind one conditional-import façade.
  "flutter",
  "static",
]);

// Frontends that realize realtime NATIVELY (Phoenix LiveView pushes over its
// own socket), so no separate SSE wire — a `on` handler is always honored.

const NATIVE_REALTIME_FRONTENDS = new Set<string>(["elixir", "phoenixLiveView"]);

/** Honesty gate for `on <channel>.<Event>` live-event handlers (channels.md
 *  Part I).  A handler on a ui whose serving frontend can't consume realtime
 *  — a framework with no realtime path, or an SSE-consuming frontend pointed
 *  at a serving deployable that doesn't stream the SSE wire — compiles clean
 *  today but emits nothing.  Warn so the silent drop is a reviewed decision,
 *  not a surprise.  Neither arm names a shipped pairing any more (all six
 *  frontends consume, all five backends serve); both stay as the seam the
 *  next target gates on.
 *
 *  Capability-driven (the two frontend sets + `backendServesRealtime`) rather
 *  than hard-coding a frontend list, so a future frontend without the wire
 *  warns until it grows realtime consumption. */

export function validateUiRealtimeSupport(sys: SystemIR, diags: LoomDiagnostic[]): void {
  const byName = new Map(sys.deployables.map((d) => [d.name, d]));
  for (const d of sys.deployables) {
    const uiNames = d.hostedUiNames.length > 0 ? d.hostedUiNames : d.uiName ? [d.uiName] : [];
    for (const uiName of uiNames) {
      const ui = sys.uis.find((u) => u.name === uiName);
      if (!ui || (ui.notifications?.length ?? 0) === 0) continue;
      // The serving framework: the ui's declared `framework:` wins (a `static`
      // host or a Phoenix surface states it), else the deployable's platform.
      const framework = ui.framework ?? d.uiFramework ?? d.platform;
      if (NATIVE_REALTIME_FRONTENDS.has(framework)) continue;
      if (SSE_REALTIME_FRONTENDS.has(framework)) {
        // A self-hosting backend+ui mount (dotnet/phoenix) targets itself.
        const target = d.targetName ? byName.get(d.targetName) : undefined;
        const backendPlatform = target?.platform ?? d.platform;
        if (backendServesRealtime(backendPlatform)) continue;
        diags.push({
          severity: "warning",
          code: "loom.ui-realtime-unsupported",
          message: diagMessage("loom.ui-realtime-unsupported#backend-serves-no-sse", {
            name: d.name,
            uiName,
            target: target
              ? `target backend '${target.name}' (platform '${backendPlatform}')`
              : `backend platform '${backendPlatform}'`,
          }),
          source: d.name,
        });
        continue;
      }
      // Unknown / non-consuming frontend — no realtime path.  No SHIPPED
      // frontend sits here any more (flutter was the last, and joined
      // `SSE_REALTIME_FRONTENDS`); this is the seam a new one warns on until it
      // grows realtime consumption.
      diags.push({
        severity: "warning",
        code: "loom.ui-realtime-unsupported",
        message: diagMessage("loom.ui-realtime-unsupported#frontend-has-no-consumer", {
          name: d.name,
          uiName,
          framework,
        }),
        source: d.name,
      });
    }
  }
}

// Honesty gate for the Flutter-UNRENDERED page primitives
// (`loom.flutter-primitive-unsupported`).  The Flutter pack renders the display
// / layout primitives, the controlled inputs (Field / MultilineField /
// PasswordField / NumberField / Toggle / SelectField), and Tabs; the form family
// + Modal render via the walker SEAMS.  The one primitive with NO renderer yet
// is `FLUTTER_DEFERRED_BUILDER_NAMES`, derived once from the
// `FLUTTER_UNRENDERED_PRIMITIVES` set in `src/util/flutter-deferred-primitives.ts`
// (FileUpload — a standalone multipart upload needs the File-type-on-Flutter
// foundation).  Because frontends validate against the target-AGNOSTIC
// walker-stdlib, a page using it while targeting a `platform: flutter` deployable
// type-checks and validates clean — then the Flutter walker emits a `// flutter
// pack: no renderer for "X"` comment (valid Dart, so `generated-flutter-build.yml`
// stays green) where the widget should be, and the UI element silently VANISHES.
//
// This fails fast at compile time instead — the frontend-target twin of
// `loom.feliz-store-unsupported` / `loom.ui-realtime-unsupported`.  Flutter is a
// self-hosting frontend platform (`platform: flutter` only ever serves the
// `framework: flutter` bundle), so the deployable platform is the reliable
// target detector.  DERIVED from the unrendered set: when FileUpload grows a
// real Flutter renderer and leaves `FLUTTER_UNRENDERED_PRIMITIVES`, the gate
// auto-closes with no edit here (as Field / Toggle / NumberField / Tabs did).

export function validateFlutterPrimitiveSupport(sys: SystemIR, diags: LoomDiagnostic[]): void {
  for (const d of sys.deployables) {
    if (d.platform !== "flutter") continue;
    const uiNames = d.hostedUiNames.length > 0 ? d.hostedUiNames : d.uiName ? [d.uiName] : [];
    for (const uiName of uiNames) {
      const ui = sys.uis.find((u) => u.name === uiName);
      if (!ui) continue;
      const hosts: { where: string; body?: ExprIR }[] = [
        ...ui.pages.map((p) => ({ where: `page '${p.name}'`, body: p.body })),
        ...ui.components.map((c) => ({ where: `component '${c.name}'`, body: c.body })),
      ];
      for (const host of hosts) {
        // One diagnostic per (host, primitive-name) — a page repeating the same
        // unrendered primitive shouldn't spam the report.
        const flagged = new Set<string>();
        walkExpr(host.body, (e) => {
          if (e.kind !== "call" || !FLUTTER_DEFERRED_BUILDER_NAMES.has(e.name)) return;
          if (flagged.has(e.name)) return;
          flagged.add(e.name);
          const where = `${host.where} on ui '${uiName}'`;
          diags.push({
            severity: "error",
            code: "loom.flutter-primitive-unsupported",
            message: diagMessage("loom.flutter-primitive-unsupported", {
              where,
              name: e.name,
              dName: d.name,
            }),
            source: where,
          });
        });
      }
    }
  }
}

/** A user component invoked WITH CHILDREN on the Angular frontend.
 *
 *  HONEST GAP.  Angular has no PascalCase component tag, so a user component
 *  is invoked through `<ng-container [ngComponentOutlet]="X" …>`, and
 *  `ngComponentOutlet` cannot project content from a template
 *  (`ngComponentOutletContent` takes pre-built DOM nodes — TS-side only).  So
 *  the extra positional argument that every JSX-family frontend renders as
 *  children was DROPPED, silently: the child markup appeared nowhere in the
 *  emitted project, and `renderUserComponent`'s doc comment admitting the drop
 *  was the only trace anywhere.
 *
 *  Angular-scoped on purpose — react / vue / svelte render the children into
 *  the component's `Slot { }` correctly, and feliz / flutter / heex were not
 *  probed, so naming them would be an unverified refusal.
 *
 *  Ratchet: a WALKED component already carries a kebab selector
 *  (`components-emit.ts`) and its `Slot { }` already emits `<ng-content>`
 *  (`angular-target.renderChildrenSlot`), so the call site can switch from the
 *  outlet to `<app-x …>children</app-x>` with the class in the page's
 *  standalone `imports: []`.  That PR narrows this gate to `extern` components
 *  (no Loom-known selector) or deletes it. */
export function validateComponentChildrenSupport(sys: SystemIR, diags: LoomDiagnostic[]): void {
  for (const d of sys.deployables) {
    for (const { ui, fw } of mountedUis(sys, d)) {
      if (fw !== "angular") continue;
      for (const hit of componentChildrenHosts(ui)) {
        diags.push({
          // WARNING, not error, and the choice is deliberate.  #2734 made the
          // same drop VISIBLE at the call site (a degradation comment in the
          // emitted Angular) rather than blocking, and the two remedies are
          // complementary rather than rival: the comment documents the loss in
          // the output, this diagnostic tells the author at compile time, and
          // between them nothing about the drop is silent any more.  Raising
          // this to `error` would additionally REFUSE a model that has always
          // generated — a breaking change, and one that would make #2734's
          // comment path unreachable — so the non-blocking half of the pair is
          // the one that belongs here.
          severity: "warning",
          code: "loom.component-children-unsupported",
          message: diagMessage("loom.component-children-unsupported", {
            what: hit.what,
            component: hit.component,
            dName: d.name,
          }),
          source: `${ui.name}/${hit.what}`,
        });
      }
    }
  }
}

/** Two forms on one page whose generated page-local bindings collide.
 *
 *  HONEST GAP, not a design rule.  Every JS frontend splices a form's mutation
 *  hook + form handle in as page-scope consts named by the design pack's
 *  `form-of-decls` / `form-op-decls` templates, and react / svelte / vue name
 *  them BARE (`create`, `form`, `register`, `handleSubmit`) — so a second form
 *  on the same page redeclares them.  React and Svelte then fail to build
 *  (TS2300 / a Svelte compile error), which is loud; VUE dedupes the decl
 *  strings and compiles, so the second form silently submits the FIRST form's
 *  mutation with the first form's schema — a `CreateForm { of: Note }` that
 *  posts an `Item`.  Angular already scopes the locals by aggregate and only
 *  collides when two forms share an aggregate (+ op).
 *
 *  The rule per framework lives in `ir/util/form-locals.ts`, alongside the note
 *  on which shapes were probed CLEAN and must not be flagged (`CreateForm` +
 *  `OperationForm`; two `OperationForm`s over different ops).
 *
 *  Ratchet: the fix is Angular's aggregate prefix generalised to a per-FORM
 *  prefix, threaded through the ~68 pack templates that hardcode these names.
 *  The PR that lands it deletes this gate and its register row. */
export function validateFormLocalCollisions(sys: SystemIR, diags: LoomDiagnostic[]): void {
  for (const d of sys.deployables) {
    for (const { ui, fw } of mountedUis(sys, d)) {
      if (!FORM_LOCAL_FRAMEWORKS.has(fw)) continue;
      for (const hit of formLocalCollisionHosts(ui)) {
        diags.push({
          severity: "error",
          code: "loom.page-form-locals-unsupported",
          message: diagMessage("loom.page-form-locals-unsupported", {
            what: hit.what,
            dName: d.name,
            fw,
            labels: hit.labels.join(" and "),
            hint:
              fw === "vue"
                ? "On vue this does NOT fail the build — the duplicate declarations are deduped, so the second form silently submits the first form's mutation and schema."
                : "The duplicate declarations are a compile error in the generated project.",
          }),
          source: `${ui.name}/${hit.what}`,
        });
      }
    }
  }
}

// -------------------------------------------------------------------------
// FLUTTER ACTION-BODY GAPS — `loom.flutter-action-body-unsupported`.
//
// Two §18 sentinels: the `TODO(flutter full-parity)` arms in
// `src/generator/flutter/riverpod-emit.ts` that fire on VALID `.ddd` and leave
// a comment where an effect should be.  Both were measured on this tree from a
// `.ddd` that reported `0 error(s), 0 warning(s)`:
//
//   VIEW EFFECT   `action say() { toast("hi") }` (`navigate` was the same
//                 shape until Wave C1 packet 1e-ii routed it through the
//                 generated `lib/nav.dart` bridge — see riverpod-emit.ts)
//                 react  -> `const go = () => { navigate("/other"); };` with a
//                          real `useNavigate()` binding
//                 flutter-> `// TODO(flutter full-parity): 'private-operation'
//                          call 'navigate' in a Notifier method`
//                 The button is wired, it just does nothing — forever, and
//                 silently.  The cause is architectural rather than an
//                 oversight: a Riverpod `Notifier` has no `BuildContext`, so it
//                 can reach neither the router nor a `ScaffoldMessenger`.
//                 Closing it means routing the effect out of the Notifier and
//                 into the widget layer — M-T1.32.
//
//   MATCH AWAIT   `match await Shop.Order.delete() { … }` — an awaited op that
//                 is one of the five STANDARD aggregate ops rather than a
//                 declared `operation`.  `renderVariantMatchNotifier` resolves
//                 its op through `agg.operations`, which never holds a standard
//                 op, so it emits its "not a resolvable remote op" TODO and the
//                 whole effect (request, error reification, every arm body)
//                 disappears.  React renders it against the standard mutation
//                 hook.
//
// Refused here rather than commented there, because the author otherwise learns
// about it by watching a button do nothing in a built app.
// -------------------------------------------------------------------------

/** The five STANDARD aggregate operations — supplied by the repository / route
 *  surface rather than declared on the aggregate.  `renderVariantMatchNotifier`
 *  looks its op up in `agg.operations`, which holds only DECLARED ones, so an
 *  awaited standard op never resolves there. */

const STANDARD_AGG_OPS: ReadonlySet<string> = new Set([
  "all",
  "byId",
  "create",
  "update",
  "delete",
]);

/** `<handle>.<Agg>.<op>(…)` / `<Agg>.<op>(…)` — the awaited-subject shapes the
 *  Flutter `match await` emitter detects, reduced to the pair it resolves on. */

function awaitedAggregateOp(e: ExprIR): { aggregate: string; operation: string } | undefined {
  if (e.kind !== "method-call") return undefined;
  const recv = e.receiver;
  if (recv.kind === "member") return { aggregate: recv.member, operation: e.member };
  if (recv.kind === "ref") return { aggregate: recv.name, operation: e.member };
  return undefined;
}

export function validateFlutterActionBodies(sys: SystemIR, diags: LoomDiagnostic[]): void {
  // aggregate name → its DECLARED operation names: the set the Flutter
  // `match await` emitter resolves against.
  const declaredOps = new Map<string, Set<string>>();
  for (const sub of sys.subdomains) {
    for (const ctx of sub.contexts) {
      for (const agg of ctx.aggregates) {
        declaredOps.set(agg.name, new Set(agg.operations.map((o) => o.name)));
      }
    }
  }
  for (const d of sys.deployables) {
    for (const { ui, fw } of mountedUis(sys, d)) {
      if (fw !== "flutter") continue;
      // The message KEY is spelled out at each call site rather than built from
      // a slug: `diagnostic-catalog.test.ts` reads the key as a string literal
      // to check it belongs to the `code:` beside it, and a template literal is
      // invisible to that scan (it read as inline wording AND as an orphaned
      // catalog entry — the gate working).
      const push = (where: string, message: string): void => {
        diags.push({
          severity: "error",
          code: "loom.flutter-action-body-unsupported",
          message,
          source: `${ui.name}/${where}`,
        });
      };
      const flagViewEffect = (where: string, detail: string): void =>
        push(
          where,
          diagMessage("loom.flutter-action-body-unsupported#view-effect", {
            where,
            uiName: ui.name,
            dName: d.name,
            detail,
          }),
        );
      const flagStandardOp = (where: string, detail: string): void =>
        push(
          where,
          diagMessage("loom.flutter-action-body-unsupported#match-await-standard-op", {
            where,
            uiName: ui.name,
            dName: d.name,
            detail,
          }),
        );
      const actionHosts: { where: string; actions: readonly ActionIR[] }[] = [
        ...ui.pages.map((p) => ({ where: `page '${p.name}'`, actions: p.actions })),
        ...ui.components.map((c) => ({ where: `component '${c.name}'`, actions: c.actions })),
      ];
      for (const host of actionHosts) {
        for (const action of host.actions) {
          const where = `${host.where} action '${action.name}'`;
          const effects = new Set<string>();
          const unresolved = new Set<string>();
          for (const stmt of action.body) {
            walkStmtDeep(stmt, (s) => {
              // `navigate` renders through the generated `lib/nav.dart` bridge
              // (Wave C1 packet 1e-ii, ledger row F2-CFE-1); `toast` is the
              // view effect that still has no way out of the Notifier.
              if (s.kind === "call" && VIEW_EFFECT_BUILTINS.has(s.name) && s.name !== "navigate") {
                effects.add(s.name);
              }
              if (s.kind !== "variant-match") return;
              const op = awaitedAggregateOp(s.subject);
              if (!op) return;
              // Only the DECLARED-op lookup the Flutter emitter performs; an
              // aggregate this ui cannot reach at all is a different gate's.
              const ops = declaredOps.get(op.aggregate);
              if (!ops || ops.has(op.operation)) return;
              if (STANDARD_AGG_OPS.has(op.operation)) {
                unresolved.add(`${op.aggregate}.${op.operation}`);
              }
            });
          }
          for (const name of [...effects].sort()) flagViewEffect(where, name);
          for (const name of [...unresolved].sort()) flagStandardOp(where, name);
        }
      }
    }
  }
}

// -------------------------------------------------------------------------
// BACKEND-BODY STATEMENT KINDS in a ui body — `loom.ui-body-statement-kind`.
//
// `loom.if-stmt-page-body-unsupported` (M-FT.11) gated ONE statement kind on
// this reasoning: a page body is an expression tree, so a backend-body
// statement form has nowhere to go.  Three more kinds sat in the same position
// and none was gated — measured on this tree, each from a `.ddd` that reported
// `0 error(s), 0 warning(s)`:
//
//   action bump() { return 1 }              react   `Error: react: unsupported
//   action bump() { precondition n > 0 }            statement '<kind>' in a page
//   action bump() { requires n > 0 }                event handler` — a bare
//                                                   throw, raw stack trace, no
//                                                   `loom.*` code
//                                           flutter `// TODO(flutter
//                                                   full-parity): unsupported
//                                                   action statement '<kind>'`
//                                                   — the action SILENTLY does
//                                                   nothing
//
// One shape, a crash on four frontends and a silent no-op on a fifth: the §18
// sentinel class in one picture.
//
// UNLIKE the `if` gate, this one is PER-FRAMEWORK, and the difference was
// measured rather than assumed.  **Phoenix LiveView renders all three**, in
// `heex-walker-core.ts`'s hoisted-handler `renderStmt`: `precondition` /
// `requires` become a predicate that keeps the socket or flashes and halts the
// pipe, and `return` becomes `|> tap(fn _ -> … end)` (Elixir has no `return`,
// and a page handler has no value sink).  That is a real rendering, pinned by
// `heex-page-stmt-coverage.test.ts` — so a universal gate would have refused
// working `.ddd`, which is how this arrived at the per-framework shape the
// sibling `DataGrid` / `Chart` / flutter-primitive gates already use.
// -------------------------------------------------------------------------

/** Statement kind → the `.ddd` keyword it is written with.  `if` is
 *  deliberately absent: it has its own gate with wording that names the ternary
 *  / `match` replacement, and merging the two would trade a specific message
 *  for a generic one. */

const BACKEND_BODY_UI_STMT_KINDS: Readonly<Record<string, string>> = {
  return: "return",
  precondition: "precondition",
  requires: "requires",
};

/** Frontends whose action-body renderer HAS an arm for those three kinds.
 *  Measured, not inferred: `src/generator/elixir/heex-walker-core.ts`
 *  `renderStmt` cases `precondition`/`requires` (~2065) and `return` (~2165).
 *  The set is kept rather than spelled `fw !== "phoenixLiveView"` so a frontend
 *  that ports them joins ONE list. */

const BACKEND_BODY_STMT_FRAMEWORKS: ReadonlySet<string> = new Set(["phoenixLiveView"]);

/** The backend-body statement kinds in `stmts` (or nested in one of them, or in
 *  a block-body lambda one of them carries), deduped, in a stable order. */

function backendBodyKinds(stmts: readonly StmtIR[]): string[] {
  const found = new Set<string>();
  for (const s of stmts) {
    walkStmtDeep(s, (n) => {
      if (n.kind in BACKEND_BODY_UI_STMT_KINDS) found.add(n.kind);
    });
  }
  return [...found].sort();
}

export function validateUiBodyStatementKinds(sys: SystemIR, diags: LoomDiagnostic[]): void {
  for (const d of sys.deployables) {
    for (const { ui, fw } of mountedUis(sys, d)) {
      if (BACKEND_BODY_STMT_FRAMEWORKS.has(fw)) continue;
      const flag = (where: string, stmts: readonly StmtIR[]): void => {
        for (const kind of backendBodyKinds(stmts)) {
          diags.push({
            severity: "error",
            code: "loom.ui-body-statement-kind",
            message: diagMessage("loom.ui-body-statement-kind", {
              where,
              uiName: ui.name,
              keyword: BACKEND_BODY_UI_STMT_KINDS[kind],
              fw: fw || "unknown",
              dName: d.name,
            }),
            source: `${ui.name}/${where}`,
          });
        }
      };
      // A page/component BODY is an expression, but its lambdas carry statement
      // blocks — reached through `walkExprStmtsDeep`, exactly as the sibling
      // `if` gate does.
      const bodyStmts = (body: ExprIR | undefined): StmtIR[] => {
        const out: StmtIR[] = [];
        walkExprStmtsDeep(body, (st) => out.push(st));
        return out;
      };
      for (const page of ui.pages) {
        for (const a of page.actions) flag(`page '${page.name}' action '${a.name}'`, a.body);
        flag(`page '${page.name}' body`, bodyStmts(page.body));
      }
      for (const c of ui.components) {
        for (const a of c.actions) flag(`component '${c.name}' action '${a.name}'`, a.body);
        flag(`component '${c.name}' body`, bodyStmts(c.body));
      }
      for (const st of ui.stores) {
        for (const a of st.actions) flag(`store '${st.name}' action '${a.name}'`, a.body);
      }
    }
  }
}

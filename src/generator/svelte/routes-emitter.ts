// Page emitter — SvelteKit file-based routing edition.
//
// Walks `ui.pages` (post scaffold expansion) and emits one
// `+page.svelte` per routable page under `src/routes/…`, mapping the
// page metamodel's route strings + layout selectors onto SvelteKit's
// conventions:
//
//   route "/orders"        → src/routes/(app)/orders/+page.svelte
//   route "/orders/:id"    → src/routes/(app)/orders/[id]/+page.svelte
//   route "/"              → src/routes/(app)/+page.svelte
//   layout: none           → the (bare) group (root layout only — no chrome)
//   layout: <Name>         → the (app) group for now (named-layout
//                            parity is a follow-up slice; the page
//                            still renders inside the default chrome)
//
// Route groups `(app)` / `(bare)` don't contribute URL segments —
// the chrome lives at src/routes/(app)/+layout.svelte while the root
// layout owns the query-client provider + toaster, so `layout: none`
// pages skip the chrome but keep the app plumbing.
//
// Sibling of src/generator/react/pages-emitter.ts; the per-page
// module assembly lives in walker/page-shell.ts.

import { diagMessage } from "../../diagnostics/messages.js";
import type { ComponentIR, PageIR, ParamIR, UiIR } from "../../ir/types/loom-ir.js";
import type { OriginRef } from "../../ir/types/origin.js";
import {
  classifyPage,
  type PageNameCtx,
  pageConstructId,
  pageEmitName,
} from "../../ir/util/page-kind.js";
import { emissionSink } from "../../util/emission-sink.js";
import { humanize, lowerFirst, plural, snake } from "../../util/naming.js";
import { routeSegmentFor } from "../../util/storage-names.js";
import type { FrontendAggregateResolver } from "../_frontend/aggregate-model.js";
import type { AggregateNames, PropValueObject } from "../_frontend/component-prop-type.js";
import {
  buildExternFunctionShim,
  buildExternFunctionSignature,
} from "../_frontend/extern-functions.js";
import { renderGateExpr } from "../_frontend/gate-expr.js";
import type { NavEntryVM, NavSectionVM } from "../_frontend/menu-emitter.js";
import { pageFileBase } from "../_frontend/page-identity.js";
import { buildPageObjectModule } from "../_frontend/page-objects-builder.js";
import { buildWalkerPageObject } from "../_frontend/walker-page-objects.js";
import {
  buildWorkflowPageObject,
  type WorkflowPageObjectResolver,
} from "../_frontend/workflow-page-object.js";
import type { LoadedPack } from "../_packs/loader.js";
import type { SourceMapRecorder } from "../_trace/sourcemap.js";
import { componentKeyPrefix, pageKeyPrefix } from "../_walker/i18n-extract.js";
import { isWalkableLayoutBody, walkBody } from "../_walker/walker-core.js";
import type { WalkerModel } from "../_walker/walker-model.js";
import { svelteLayoutGroup } from "./layouts-emitter.js";
import {
  renderSvelteComponentFile,
  renderSvelteExternComponentProps,
  renderSvelteExternComponentShim,
  renderSveltePage,
} from "./walker/page-shell.js";
import { svelteTarget } from "./walker/svelte-target.js";
export interface SveltePageEmitContext {
  /** The aggregates and workflows the frontend serves, in context order: a
   *  page's kind is classified against them. */
  pageNames: PageNameCtx;
  /** The aggregates the frontend serves, by name. */
  aggregatesByName: AggregateNames;
  /** Declared value objects by name — a `valueobject`-typed prop or extern
   *  signature is spelled structurally from its fields. */
  valueObjects: ReadonlyMap<string, PropValueObject>;
  /** The domain facts a page / component body walk reads. */
  walkerModel: WalkerModel;
  /** The model each scaffold page's aggregate page object renders from. */
  frontendAggregate: FrontendAggregateResolver;
  /** The model each scaffold workflow form's page object renders from. */
  workflowPageObject: WorkflowPageObjectResolver;
  pack: LoadedPack;
  /** The system's root components. */
  topLevelComponents: readonly ComponentIR[];
  /** True when the frontend opts into `auth: ui` — a page's `requires` gate
   *  then renders a client-side `{#if}`-guarded `<Forbidden/>` against the
   *  verified session claims.  Optional: absent ⇒ ungated. */
  authUi?: boolean;
  /** True when the UI has extractable user-visible strings (M-T1.11) — pages
   *  emit `page.<Name>` and components `component.<Name>` i18n key prefixes into
   *  their body walks, so literal text renders through `t()`.  Absent ⇒ text
   *  renders raw (byte-identical to pre-i18n). */
  i18nEnabled?: boolean;
  /** Generate-time source-map recorder (`--sourcemap`) — see
   *  `PlatformSurface.emitProject`'s doc comment.  Absent means "record
   *  nothing" (the default, flag-off shape). */
  sourcemap?: SourceMapRecorder;
  /** Where each page and component was declared, by construct id, for the
   *  `--sourcemap` file regions (the Frontend Contract carries no source
   *  origins: they name local files). */
  sourceOrigins?: ReadonlyMap<string, OriginRef>;
}

/** Translate a page-metamodel route to a SvelteKit route directory
 *  (no group segment).  `:param` segments become `[param]`; the root
 *  route maps to the group directory itself. */
export function routeToKitDir(route: string): string {
  const segs = route.split("/").filter((s) => s.length > 0);
  return segs.map((s) => (s.startsWith(":") ? `[${s.slice(1)}]` : s)).join("/");
}

/** The route group a page's layout selector maps to:
 *   - `layout: none`     → `(bare)` (root layout only, no chrome)
 *   - `layout: <Name>`   → `(<name>)` (the named layout's group, whose
 *     `+layout.svelte` is emitted by layouts-emitter)
 *   - default            → `(app)` (the default chrome) */
function groupForLayout(page: PageIR): string {
  if (page.layout?.kind === "preset" && page.layout.name === "none") return "(bare)";
  if (page.layout?.kind === "named") return svelteLayoutGroup(page.layout.ref);
  return "(app)";
}

/** The scaffold's synthesised landing page — the one page kind whose route a
 *  user page of the same address takes over.  Classified rather than stamped,
 *  through the same `classifyPage` every other consumer uses.
 *
 *  The empty name context is deliberate and not a shortcut: `classifyPage`
 *  decides `home` on the reserved NAME alone, before it consults any aggregate
 *  or workflow names, and a hand-written `page Home` is meant to classify the
 *  same way (the scaffold's override contract is by name). */
function isScaffoldLandingPage(page: PageIR): boolean {
  return classifyPage(page, { aggregateNames: [], workflowNames: [] }).kind === "home";
}

/** Emit path for a routable page. */
export function sveltePagePath(page: PageIR): string | undefined {
  if (!page.route) return undefined;
  const dir = routeToKitDir(page.route);
  const group = groupForLayout(page);
  return dir === ""
    ? `src/routes/${group}/+page.svelte`
    : `src/routes/${group}/${dir}/+page.svelte`;
}

export function emitSveltePagesForUi(ui: UiIR, ctx: SveltePageEmitContext): Map<string, string> {
  const out = emissionSink("generator/svelte/routes-emitter");

  const userComponents = new Map<string, readonly ParamIR[]>();
  for (const c of ctx.topLevelComponents) userComponents.set(c.name, c.params);
  for (const c of ui.components) userComponents.set(c.name, c.params);
  const pageRoutes = new Map<string, string>();
  for (const page of ui.pages) {
    if (page.route) pageRoutes.set(page.name, page.route);
  }

  // Extern frontend functions (extern-function-hook-escape-hatch.md §3):
  // same two machine-owned files as react — the wire-DTO-typed
  // signature (`src/lib/extern/<name>.signature.ts`, api modules at
  // `../api` on SvelteKit) and the conformance shim
  // (`src/lib/<name>.ts`); body calls register through
  // `externFunctionNames` and the page / component shells import each
  // used shim as `$lib/<name>`.
  const externFunctionNames = new Set<string>();
  for (const fn of ui.functions ?? []) {
    externFunctionNames.add(fn.name);
    out.set(
      `src/lib/extern/${fn.name}.signature.ts`,
      buildExternFunctionSignature(fn, "../api", ctx.valueObjects),
    );
    out.set(`src/lib/${fn.name}.ts`, buildExternFunctionShim(fn));
  }

  // User components — `src/lib/components/<Name>.svelte`, ui-scope
  // shadowing top-level on name collision.  Extern components are a
  // follow-up parity slice for svelte; surface loudly rather than
  // emit a broken import.
  const emittedComponents = new Map<string, ComponentIR>();
  for (const c of ctx.topLevelComponents) emittedComponents.set(c.name, c);
  for (const c of ui.components) emittedComponents.set(c.name, c);
  for (const c of emittedComponents.values()) {
    const componentConstruct = `${ui.name}.${c.name}`;
    // Extern component: Loom owns a re-export wrapper at
    // `src/lib/components/<Name>.svelte` (so call sites import
    // `$lib/components/<Name>.svelte` unchanged) + a typed
    // `<Name>.props.ts`; the user owns the hand-written module at the
    // `from` path.  No body is walked.
    if (c.extern) {
      const shimPath = `src/lib/components/${c.name}.svelte`;
      const shimContent = renderSvelteExternComponentShim(c.name, c.externPath ?? "");
      out.set(shimPath, shimContent);
      ctx.sourcemap?.file(
        shimPath,
        shimContent,
        ctx.sourceOrigins?.get(componentConstruct) ?? c.origin,
        componentConstruct,
      );
      const propsPath = `src/lib/components/${c.name}.props.ts`;
      const propsContent = renderSvelteExternComponentProps(
        c.name,
        [...c.params],
        ctx.aggregatesByName,
        ctx.valueObjects,
      );
      out.set(propsPath, propsContent);
      ctx.sourcemap?.file(
        propsPath,
        propsContent,
        ctx.sourceOrigins?.get(componentConstruct) ?? c.origin,
        componentConstruct,
      );
      continue;
    }
    const componentPath = `src/lib/components/${c.name}.svelte`;
    const componentContent = renderSvelteComponentFile(
      c.name,
      [...c.params],
      c.state,
      c.body!,
      ctx.pack,
      userComponents,
      // The ui's api handles — the SAME list the page shell gets.  A component
      // body reads (`QueryView { of: Sales.Order.all }`) exactly as a page body
      // does; handed `[]` the handle resolved to nothing.
      ui.apiParams,
      ctx.aggregatesByName,
      ctx.walkerModel,
      ctx.valueObjects,
      pageRoutes,
      externFunctionNames,
      c.derived,
      // `auth: ui` enables currentUser-only operation-`requires` gating on
      // `Action(...)` buttons in this component.
      ctx.authUi,
      // Named, typed component event handlers (Proposal A Stage 1).
      c.actions,
      // Shared client-side stores (Stage 5) — for store-import + bindings.
      ui.stores,
      // i18n key prefix — `component.<Name>` matches the catalog; undefined when
      // the UI has no extractable strings (byte-identical to pre-i18n).
      ctx.i18nEnabled ? componentKeyPrefix(ui, c) : undefined,
    );
    out.set(componentPath, componentContent);
    ctx.sourcemap?.file(
      componentPath,
      componentContent,
      ctx.sourceOrigins?.get(componentConstruct) ?? c.origin,
      componentConstruct,
    );
  }

  // A scaffold-synthesised `Home` YIELDS its route to a user page claiming the
  // same address — `classifyPage`'s override contract ("write `page Home { … }`
  // to replace the generated landing page"), implemented on React by
  // `app-shell.ts`'s `userHasRootRoute`.  SvelteKit could not honour it at all:
  // both pages compute the same route DIRECTORY, so the emitter threw, on a
  // model that validates clean and generates correctly on React.  Measured on
  // this tree before this arm (a `with scaffold(...)` ui plus
  // `page Dashboard { route: "/" }`):
  //
  //   svelte   Error: svelte pages 'Dashboard' and 'Home' both emit to
  //            src/routes/(app)/+page.svelte
  //   react    one `<Route path="/" element={<Dashboard />} />`
  //   vue      BOTH `{ path: "/", component: Dashboard }` and `{ path: "/",
  //            component: Home }` — the router matches the first and `Home` is
  //            dead code
  //   angular  the same, twice `{ path: "" }`
  //
  // Only React got it right; this arm is Svelte joining it.  The three
  // remaining frontends (and the one-derivation fix that would retire all of
  // these copies) are H6 of the packet-1d-ii hand-off.
  const yieldedHomes = new Set<PageIR>();
  {
    const claimed = new Map<string, PageIR>();
    for (const page of ui.pages) {
      if (!page.route || isScaffoldLandingPage(page)) continue;
      claimed.set(page.route, page);
    }
    for (const page of ui.pages) {
      if (page.route && isScaffoldLandingPage(page) && claimed.has(page.route)) {
        yieldedHomes.add(page);
      }
    }
  }

  const seenPaths = new Map<string, string>();
  for (const page of ui.pages) {
    if (!isWalkableLayoutBody(page.body, userComponents)) continue;
    if (yieldedHomes.has(page)) continue;
    const emitPath = sveltePagePath(page);
    if (!emitPath) continue;
    const prior = seenPaths.get(emitPath);
    if (prior) {
      // UNREACHABLE on a validated model: `loom.ui-page-route-collision`
      // (phase ⑦, `ui-page-identity-checks.ts`) refuses two pages of one ui
      // sharing a `route:`, and this path is a pure function of the route plus
      // the layout group — so a collision here means a strictly STRONGER
      // collision was let through upstream.  Kept as an internal invariant
      // (the api toolkit and the playground can hand a generator an
      // unvalidated model) rather than deleted, and it names the gate that is
      // supposed to have fired instead of re-explaining SvelteKit routing.
      throw new Error(
        diagMessage("loom.ui-page-route-collision#svelte-emit-invariant", {
          first: prior,
          second: page.name,
          path: emitPath,
        }),
      );
    }
    seenPaths.set(emitPath, page.name);
    const rendered = renderSveltePage(
      page.name,
      page.body!,
      ctx.pack,
      page.params,
      page.state,
      page.title,
      userComponents,
      ui.apiParams,
      ctx.aggregatesByName,
      ctx.walkerModel,
      pageRoutes,
      externFunctionNames,
      page.derived,
      // `page { requires <expr> }` UI gate — only when a verified session is
      // available to evaluate it against.
      ctx.authUi ? page.requires : undefined,
      // `auth: ui` also enables currentUser-only operation-`requires` gating
      // on `Action(...)` buttons inside the body.
      ctx.authUi,
      // Named, typed page event handlers (Proposal A Stage 1).
      page.actions,
      // Shared client-side stores (Stage 5) — for store-import + bindings.
      ui.stores,
      // i18n key prefix — `page.<Name>` matches the catalog (the scaffold's
      // role-scoped `page.name`, e.g. `List`, not the router emit name);
      // undefined when the UI has no extractable strings (byte-identical).
      ctx.i18nEnabled ? pageKeyPrefix(ui, page) : undefined,
    );
    const pageContent = rendered.content;
    out.set(emitPath, pageContent);
    // Sibling component files a primitive hoisted out of the page — a `.svelte`
    // file holds exactly one component, so `DataGrid` emits its child as its own
    // `src/lib/components/<Name>.svelte` (the page's import comes from the same
    // `usedUserComponents` channel a hand-written component uses).
    for (const f of rendered.componentFiles) out.set(f.path, f.content);
    ctx.sourcemap?.file(
      emitPath,
      pageContent,
      ctx.sourceOrigins?.get(pageConstructId(ui.name, page)) ?? page.origin,
      pageConstructId(ui.name, page),
    );
  }
  return out;
}

/** Nav-entry data for the app-shell template — the default grouped
 *  sidebar (Aggregates / Workflows) mirroring the react
 *  shell's hardcoded grouping, overridden by an explicit `ui.menu`
 *  via the shared `deriveSidebarFromUi`. */
/** The shared sidebar entry shape (`_frontend/menu-emitter.ts`), so these
 *  default sections can be handed straight to `deriveSidebarFromUi` as the base
 *  the ui's own custom pages merge into (M-FT.6). */
type DefaultNavEntry = NavEntryVM;

export function defaultNavSections(
  scaffoldedAggregates: readonly { readonly name: string }[],
  scaffoldedWorkflows: readonly { readonly name: string }[],
  hasWorkflowsIndex: boolean,
  /** The ui's pages, so a DEFAULT entry inherits the `requires` gate of the
   *  page it links to (resolved by route, which is what the entry carries).
   *  A scaffolded List page CLONES the `policy { read X requires … }` gate
   *  guarding the very read it makes, so the default sidebar must not
   *  advertise a route the backend refuses. */
  uiPages: readonly PageIR[] = [],
  /** `auth: ui` — without a client-side session user there is nothing to test,
   *  so every entry stays ungated and the output is byte-identical. */
  authUi = false,
): NavSectionVM[] {
  const gateForRoute = (route: string): string | undefined => {
    if (!authUi) return undefined;
    const page = uiPages.find((p) => p.route === route);
    return page?.requires ? renderGateExpr(page.requires, "currentUser") : undefined;
  };
  /** `activeArgs` is the shared VM's route-match argument list; the Svelte
   *  app-shell ignores it (it compares `$page.url.pathname`), but carrying it
   *  keeps these sections assignable to `NavSectionVM`. */
  const entry = (to: string, label: string, testId: string, exact = false): DefaultNavEntry => {
    const requiresJs = gateForRoute(to);
    return {
      to,
      label,
      testId,
      activeArgs: exact ? `${JSON.stringify(to)}, { exact: true }` : JSON.stringify(to),
      ...(requiresJs ? { requiresJs } : {}),
    };
  };
  const sections: NavSectionVM[] = [];
  if (scaffoldedAggregates.length > 0) {
    sections.push({
      label: "Aggregates",
      entries: scaffoldedAggregates.map((a) => {
        const slug = routeSegmentFor(a.name);
        // Humanised, like every other frontend's default sidebar (react's
        // `prepareAppShellVM`, vue's `defaultNavSections`): the sidebar showed
        // the raw declaration identifiers — `closeProject`, `fileUrgent`,
        // `WorkItems` — where the other packs read "Close project", "Work items".
        // Routed through `entry` so the M-T3.15-C3 `requires` gate still rides along.
        return entry(`/${slug}`, humanize(plural(a.name)), `nav-${slug}`);
      }),
    });
  }
  const wfEntries: DefaultNavEntry[] = [];
  if (hasWorkflowsIndex) {
    wfEntries.push(entry("/workflows", "All workflows", "nav-workflows", true));
  }
  for (const wf of scaffoldedWorkflows) {
    wfEntries.push(
      entry(`/workflows/${snake(wf.name)}`, humanize(wf.name), `nav-workflow-${snake(wf.name)}`),
    );
  }
  if (wfEntries.length > 0) sections.push({ label: "Workflows", entries: wfEntries });
  return sections;
}

/** Playwright page-object emission — same dispatch rules as the
 *  react pages-emitter (scaffold-origin pages route to the shared
 *  per-aggregate / per-workflow builders; custom walker
 *  pages get a per-page class from their collected testids).  Only
 *  the api-module import root differs (`src/lib/api` in SvelteKit
 *  projects). */
export function emitSveltePageObjectsForUi(
  ui: UiIR,
  ctx: SveltePageEmitContext,
): Map<string, string> {
  const out = emissionSink("generator/svelte/routes-emitter");
  const pageCtx = ctx.pageNames;
  const seenAggregates = new Set<string>();
  const seenWorkflows = new Set<string>();

  for (const page of ui.pages) {
    const origin = classifyPage(page, pageCtx);
    if (origin.kind === "custom") continue;
    switch (origin.kind) {
      case "aggregate-list":
      case "aggregate-new":
      case "aggregate-detail": {
        if (seenAggregates.has(origin.aggregateName)) break;
        seenAggregates.add(origin.aggregateName);
        const model = ctx.frontendAggregate(
          origin.aggregateName,
          origin.contextName,
        );
        if (!model) break;
        out.set(
          `e2e/pages/${lowerFirst(model.name)}.ts`,
          buildPageObjectModule(model, "../../src/lib/api", "native"),
        );
        break;
      }
      case "workflow-form": {
        if (seenWorkflows.has(origin.workflowName)) break;
        seenWorkflows.add(origin.workflowName);
        const wf = ctx.workflowPageObject(
          origin.workflowName,
          origin.contextName,
        );
        if (!wf) break;
        out.set(
          `e2e/pages/workflows/${snake(wf.name)}.ts`,
          buildWorkflowPageObject(wf, "../../../src/lib/api", "native"),
        );
        break;
      }
      case "workflows-index":
      case "home":
        break;
    }
  }

  // Custom walker pages — per-page class over the collected testids.
  const userComponents = new Map<string, readonly ParamIR[]>();
  for (const c of ctx.topLevelComponents) userComponents.set(c.name, c.params);
  for (const c of ui.components) userComponents.set(c.name, c.params);
  for (const page of ui.pages) {
    if (classifyPage(page, pageCtx).kind !== "custom") continue;
    if (!isWalkableLayoutBody(page.body, userComponents)) continue;
    if (!page.body) continue;
    const paramNames = new Set(page.params.map((p) => p.name));
    const stateNames = new Set(page.state.map((st) => st.name));
    const { collectedTestids } = walkBody(
      page.body,
      svelteTarget,
      ctx.pack,
      paramNames,
      stateNames,
      userComponents,
      ui.apiParams,
      new Map(),
      ctx.walkerModel,
    );
    // Keyed on the page's emit identity, not its bare name — see the React
    // sibling: two custom pages sharing a name across areas collapsed onto one
    // `e2e/pages/<name>.ts` and the second was silently dropped.
    const path = `e2e/pages/${pageFileBase(page, pageCtx)}.ts`;
    if (out.has(path)) continue;
    out.set(
      path,
      buildWalkerPageObject({
        pageName: pageEmitName(page, pageCtx),
        params: page.params,
        route: page.route ?? "",
        testids: collectedTestids,
      }),
    );
  }
  return out;
}

// Playwright page-object emission walked from `ui.pages`.
//
// Each scaffold page contributes to its archetype's page-object file:
//
//   aggregate-list / aggregate-new / aggregate-detail
//     → one shared `e2e/pages/<camel-agg>.ts` per aggregate
//       (covers all three classes ListPage / NewPage / DetailPage)
//   workflow-form
//     → `e2e/pages/workflows/<snake-name>.ts` per workflow
//
// Custom (walker-emitted) pages get one class per page over the testids the
// shared walker core collects while walking the page body.  The walk runs
// through the HOST's own `WalkerTarget`, passed in by the caller: page
// objects key on testids, not on the rendering framework, so this module
// stays framework-neutral and every frontend shares it.

import type { ComponentIR, ParamIR, UiIR } from "../../ir/types/loom-ir.js";
import { classifyPage, type PageNameCtx, pageEmitName } from "../../ir/util/page-kind.js";
import { emissionSink } from "../../util/emission-sink.js";
import { lowerFirst, snake } from "../../util/naming.js";
import type { LoadedPack } from "../_packs/loader.js";
import type { WalkerTarget } from "../_walker/target.js";
import { isWalkableLayoutBody, walkBody } from "../_walker/walker-core.js";
import type { WalkerModel } from "../_walker/walker-model.js";
import type { FrontendAggregateResolver } from "./aggregate-model.js";
import { pageFileBase } from "./page-identity.js";
import { buildPageObjectModule, type SelectStyle } from "./page-objects-builder.js";
import { buildWalkerPageObject } from "./walker-page-objects.js";
import {
  buildWorkflowPageObject,
  type WorkflowPageObjectResolver,
} from "./workflow-page-object.js";

/** What page-object emission reads besides the page IR. */
export interface PageObjectEmitContext {
  /** The aggregates and workflows the frontend serves, in context order: a
   *  page's kind is classified against them. */
  pageNames: PageNameCtx;
  /** The model each scaffold page's aggregate page object renders from. */
  frontendAggregate: FrontendAggregateResolver;
  /** The model each scaffold workflow form's page object renders from. */
  workflowPageObject: WorkflowPageObjectResolver;
  /** Loaded design pack the custom-page body walk renders through. */
  pack: LoadedPack;
  /** Top-level (workspace-wide) components; a ui-scope component of the same
   *  name overrides one. */
  topLevelComponents: readonly ComponentIR[];
  /** The domain facts a custom-page body walk reads.  A host that emits no
   *  walker page objects passes the empty model. */
  walkerModel: WalkerModel;
}

export interface PageObjectEmitOptions {
  /** The host's walker target.  When set, each custom walker page gets a
   *  page object over the testids its body walk collects; absent, only the
   *  scaffold-archetype page objects emit (a host whose forms do not render
   *  through the shared pack form templates cannot walk its pages here). */
  walkerTarget?: WalkerTarget;
  /** How choice fields (`enum` / `X id`) are driven in the fill blocks.
   *  Combobox (default) for the portal-select frontends; `"native"` for
   *  frontends rendering a real `<select>` — Playwright drives those with
   *  `selectOption`, and native mode needs no per-option testids. */
  selectStyle?: SelectStyle;
}

export function emitPageObjectsForUi(
  ui: UiIR,
  ctx: PageObjectEmitContext,
  options: PageObjectEmitOptions = {},
): Map<string, string> {
  const selectStyle = options.selectStyle ?? "combobox";
  const out = emissionSink("generator/_frontend/page-objects-emit");
  const pageCtx = ctx.pageNames;
  const seenAggregates = new Set<string>();
  const seenWorkflows = new Set<string>();

  for (const page of ui.pages) {
    // Only scaffold pages dispatch to the per-aggregate / per-workflow
    // builders; custom pages get the walker-side page object below.
    const origin = classifyPage(page, pageCtx);
    if (origin.kind === "custom") continue;
    switch (origin.kind) {
      case "aggregate-list":
      case "aggregate-new":
      case "aggregate-detail": {
        // One file per aggregate, regardless of how many of its archetypes
        // appear — `buildPageObjectModule` covers all three classes.
        if (seenAggregates.has(origin.aggregateName)) break;
        seenAggregates.add(origin.aggregateName);
        const model = ctx.frontendAggregate(origin.aggregateName, origin.contextName);
        if (!model) break;
        out.set(
          `e2e/pages/${lowerFirst(model.name)}.ts`,
          buildPageObjectModule(model, undefined, selectStyle),
        );
        break;
      }
      case "workflow-form": {
        if (seenWorkflows.has(origin.workflowName)) break;
        seenWorkflows.add(origin.workflowName);
        const wf = ctx.workflowPageObject(origin.workflowName, origin.contextName);
        if (!wf) break;
        out.set(
          `e2e/pages/workflows/${snake(wf.name)}.ts`,
          buildWorkflowPageObject(wf, undefined, selectStyle),
        );
        break;
      }
      // Index pages and Home have no testable form or table: the index
      // pages are tested via their child links, Home via its summary cards.
      case "workflows-index":
      case "home":
        break;
    }
  }

  // Path-collision contract: scaffold-archetype pages own
  // `e2e/pages/<aggregate-camel>.ts`; walker pages emit at
  // `e2e/pages/<page-file-base>.ts`.  An explicit page named identically to a
  // scaffold-aggregate fragment is skipped rather than overwriting it.
  const target = options.walkerTarget;
  if (!target) return out;
  const userComponents = userComponentsMap(ui, ctx.topLevelComponents);
  for (const page of ui.pages) {
    if (classifyPage(page, pageCtx).kind !== "custom") continue;
    if (!isWalkableLayoutBody(page.body, userComponents)) continue;
    if (!page.body) continue;
    const paramNames = new Set(page.params.map((p) => p.name));
    const stateNames = new Set(page.state.map((s) => s.name));
    const { collectedTestids } = walkBody(
      page.body,
      target,
      ctx.pack,
      paramNames,
      stateNames,
      userComponents,
      ui.apiParams,
      new Map(),
      ctx.walkerModel,
    );
    // Keyed on the page's emit identity, not its bare name: two custom pages
    // sharing a name across areas must not collapse onto one file.
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

/** The ui's component-name → params map: top-level components seed it,
 *  ui-scope entries override on collision. */
function userComponentsMap(
  ui: UiIR,
  topLevelComponents: readonly ComponentIR[],
): Map<string, readonly ParamIR[]> {
  const map = new Map<string, readonly ParamIR[]>();
  for (const c of topLevelComponents) map.set(c.name, c.params);
  for (const c of ui.components) map.set(c.name, c.params);
  return map;
}

// -------------------------------------------------------------------------
// Page/slot identity checks (`validateUiPageIdentity`).  Split out of
// ui-checks.ts by packet 2.6 (wave-2) — mechanical move, no logic change.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import type { EnrichedLoomModel, PageIR } from "../../types/loom-ir.js";
import { allContexts } from "../../types/loom-ir.js";
import { classifyPage, type PageNameCtx, pageSlotKey } from "../../util/page-kind.js";
import type { LoomDiagnostic } from "./diagnostic.js";

// -------------------------------------------------------------------------
// PAGE EMIT IDENTITY — `loom.ui-page-path-collision` /
// `loom.ui-page-slot-collision`.
//
// A page's identity is its `area` path + name, which lowering has already
// resolved into `emitPath`.  Two pages that resolve to the SAME emit path, or
// that fill the SAME conventional archetype slot, are indistinguishable to
// every downstream emitter — and every emitter resolved that the same silent
// way: last write wins on the file map, first write wins on the page-object
// map.  A duplicated `area Ops { … }` block in one scope parses clean
// (`checkPageScope` scopes page uniqueness per area NODE, not per area NAME),
// both areas compute `src/pages/ops/…`, and one page's body simply vanishes
// from the build with no diagnostic anywhere.
//
// Checking it HERE, on `emitPath`, covers every frontend at once (React, Vue,
// Svelte, Angular, Feliz, Flutter and Phoenix all key their emission on the
// same derivation) rather than seven per-frontend guards that each catch their
// own topology's half of the problem.
// -------------------------------------------------------------------------

export function validateUiPageIdentity(loom: EnrichedLoomModel, diags: LoomDiagnostic[]): void {
  const nameCtx = {
    aggregateNames: allContexts(loom).flatMap((c) => c.aggregates.map((a) => a.name)),
    workflowNames: allContexts(loom).flatMap((c) => c.workflows.map((w) => w.name)),
  };
  for (const sys of loom.systems) {
    for (const ui of sys.uis) {
      const byPath = new Map<string, PageIR>();
      const bySlot = new Map<string, PageIR>();
      const byRoute = new Map<string, PageIR>();
      for (const page of ui.pages) {
        // ROUTE identity — the third way two pages can be indistinguishable,
        // and the one that is NOT a function of `emitPath`.  Two pages with
        // different names in different areas compute different emit paths and
        // fill different archetype slots, yet a shared `route:` makes one of
        // them unreachable in every router: React/Vue/Angular match the first
        // declared `path`, and SvelteKit — whose route IS a directory — cannot
        // even express it, so `svelte/routes-emitter.ts` used to `throw` a bare
        // `Error` mid-generate (no code, a raw stack trace) on a `.ddd` that
        // `ddd parse` had just called clean.  Checked here for the same reason
        // the path/slot pairs above are: one derivation, every frontend.
        if (page.route) {
          const priorRoute = byRoute.get(page.route);
          // ONE pair is exempt, and it is a language rule rather than an
          // oversight: a scaffold-synthesised `Home` YIELDS to a user page that
          // claims the same route.  `classifyPage`'s own contract says so
          // ("write `page Home { … }` to replace the generated landing page"),
          // and `react/templating/preparers/app-shell.ts` implements it —
          // `userHasRootRoute` skips the synthesised Home's import AND its
          // route.  Measured on `web/src/examples/erp/main.ddd`, whose
          // hand-written `page Dashboard { route: "/" }` sits beside the
          // scaffold's `Home`: the emitted `App.tsx` carries exactly one
          // `<Route path="/" element={<Dashboard />} />`.  Refusing that would
          // break a shipped example and a designed override.
          //
          // NOT exempt, and the reason the pair is tested rather than the route:
          // two USER pages at one route, which no frontend resolves.
          const exempt =
            priorRoute !== undefined &&
            isScaffoldHome(priorRoute, nameCtx) !== isScaffoldHome(page, nameCtx);
          if (priorRoute && !exempt) {
            diags.push({
              severity: "error",
              message: diagMessage("loom.ui-page-route-collision", {
                ui: ui.name,
                first: pageLabel(priorRoute),
                second: pageLabel(page),
                route: page.route,
              }),
              source: sys.name,
              code: "loom.ui-page-route-collision",
            });
          } else if (priorRoute === undefined || isScaffoldHome(priorRoute, nameCtx)) {
            // The page that actually MOUNTS owns the route from here on, so a
            // THIRD page at the same route still collides with the winner
            // rather than with the yielded Home.
            byRoute.set(page.route, page);
          }
        }
        const path = page.emitPath;
        if (path !== undefined) {
          const prior = byPath.get(path);
          if (prior) {
            diags.push({
              severity: "error",
              message: diagMessage("loom.ui-page-path-collision", {
                ui: ui.name,
                first: pageLabel(prior),
                second: pageLabel(page),
                path,
              }),
              source: sys.name,
              code: "loom.ui-page-path-collision",
            });
          } else {
            byPath.set(path, page);
          }
        }
        const slot = pageSlotKey(classifyPage(page, nameCtx));
        if (slot === undefined) continue;
        const priorSlot = bySlot.get(slot);
        if (priorSlot) {
          diags.push({
            severity: "error",
            message: diagMessage("loom.ui-page-slot-collision", {
              ui: ui.name,
              first: pageLabel(priorSlot),
              second: pageLabel(page),
              slot: slotLabel(slot),
            }),
            source: sys.name,
            code: "loom.ui-page-slot-collision",
          });
        } else {
          bySlot.set(slot, page);
        }
      }
    }
  }
}

/** The scaffold's synthesised landing page — the one page kind that YIELDS its
 *  route to a user page of the same address (see the exemption above).  A
 *  hand-written `page Home` classifies the same way on purpose: the scaffold's
 *  override contract is by NAME, so replacing the landing page and colliding
 *  with it are the same act. */

function isScaffoldHome(p: PageIR, ctx: PageNameCtx): boolean {
  return classifyPage(p, ctx).kind === "home";
}

/** `page 'List'` / `page 'List' (in area ops/orders)` — enough for the author
 *  to find which of the two declarations to change. */

function pageLabel(p: PageIR): string {
  const area = p.area ?? [];
  return area.length === 0 ? `page '${p.name}'` : `page '${p.name}' in area ${area.join("/")}`;
}

/** Human name for a conventional archetype slot key. */

function slotLabel(slot: string): string {
  const parts = slot.split(":");
  if (parts[0] === "agg") return `the ${parts[2]} page of aggregate '${parts[1]}'`;
  if (parts[0] === "wf") return `the ${parts[2]} page of workflow '${parts[1]}'`;
  return `the '${slot}' page`;
}

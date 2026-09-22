// Route-driven Playwright smoke spec — framework-neutral (navigates
// param-less page routes and asserts the URL); shared by the React,
// Svelte, and Vue frontends.  Extracted from src/generator/react/index.ts.

import type { UiIR } from "../../ir/types/loom-ir.js";
import { type PageNameCtx, pageEmitName } from "../../ir/util/page-kind.js";

/** Auto-generated minimal Playwright smoke: every param-less page this
 *  ui declares navigates and loads.  Driven by route (not by importing
 *  the page objects) so it stays correct regardless of how the ui's
 *  pages map onto page-object files.  Richer per-page scenarios live
 *  in the page objects under e2e/pages/ and the generated
 *  `*.ui.spec.ts`.
 *
 *  WHAT "LOADS" HAS TO MEAN.  This used to assert `toHaveURL(<the route it
 *  just navigated to>)` and nothing else — `page.goto` sets that URL, so the
 *  assertion restated its own input and could not fail on anything the app
 *  did, up to and including rendering nothing.  A pack whose shell threw on
 *  mount (mui@v5: a CJS default import handed to React as a module object)
 *  shipped a blank error boundary through this gate, through `tsc --noEmit`,
 *  and through `vite build`.
 *
 *  So each case now also asserts the app did not crash into its own error
 *  boundary.  `app-error` is the testid every JSX/SFC pack's app-shell puts on
 *  that boundary, which makes it a hook the generator already owns rather than
 *  a new convention.  `toHaveCount(0)` is deliberately a no-op on a target
 *  whose shell has no such boundary (Feliz / Flutter / HEEx) — the uncaught-
 *  error trap in `fixtures.ts` is what covers those. */
export function smokeSpec(ui: UiIR, nameCtx: PageNameCtx): string {
  // Auto-generated minimal Playwright smoke: every param-less page this
  // ui declares navigates and loads.  Driven by route (not by importing
  // the page objects) so it stays correct regardless of how the ui's
  // pages map onto page-object files — a custom-page ui emits
  // `pages/<page>.ts` (class `<Page>Page`), a scaffold ui emits
  // `pages/<aggregate>.ts` (class `<Agg>ListPage`), and a ui covers only
  // the aggregates it actually shows.  A per-served-aggregate
  // `import { <Agg>ListPage } from "./pages/<agg>"` assumes the scaffold shape
  // for every served aggregate and breaks (module-not-found → Playwright "No
  // tests found" → non-zero exit) on any ui with custom or partial pages.
  // Richer per-page scenarios live in the page objects
  // under e2e/pages/ and the generated `*.ui.spec.ts`.
  const cases: string[] = [];
  for (const page of ui.pages) {
    // Parameterised routes (`/x/:id`) need a seeded entity — out of scope
    // for a smoke; they're exercised by the per-page specs.
    if (page.params.length > 0) continue;
    const route = page.route;
    if (!route || route.includes(":")) continue;
    const routeRe = `${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
    cases.push(
      // Title uses the aggregate-qualified emit name (`OrderList`), not the
      // scaffold's role-scoped page name (`List`) — stable + unique.
      `test(${JSON.stringify(`${pageEmitName(page, nameCtx)} loads`)}, async ({ page }) => {\n` +
        `  await page.goto(${JSON.stringify(route)});\n` +
        `  await expect(page).toHaveURL(new RegExp(${JSON.stringify(routeRe)}));\n` +
        `  // The app mounted rather than crashing into its root error boundary.\n` +
        `  await expect(page.getByTestId("app-error")).toHaveCount(0);\n` +
        `});`,
    );
  }
  // A ui made up entirely of parameterised pages would otherwise produce a
  // spec with zero tests — which Playwright reports as "No tests found"
  // and exits non-zero.  Fall back to loading the SPA root.
  if (cases.length === 0) {
    cases.push(
      `test("app root loads", async ({ page }) => {\n` +
        `  await page.goto("/");\n` +
        `  await expect(page.locator("body")).toBeVisible();\n` +
        `  await expect(page.getByTestId("app-error")).toHaveCount(0);\n` +
        `});`,
    );
  }
  return `// Auto-generated smoke spec.
import { test, expect } from "./fixtures";

${cases.join("\n\n")}
`;
}

// Preview element-select mode (M-T8.20 slice 4) — the HEAVY lane.
//
// This is the one leg of the mission that genuinely needs a running app: the
// click has to land on a real DOM element inside the preview iframe, which
// means Generate → Bundle → Boot, which means the npm registry and PGlite's
// WASM.  The spec self-skips when the browser cannot reach the registry (the
// same probe `runtime.spec.ts` uses), so it costs nothing in the no-network
// lane and is not a substitute for a gate there.
//
// The RESOLUTION half — `data-testid` → generated page → `.ddd` declaration —
// is proven headlessly and network-free in
// `test/playground/select-target.test.ts`; what only this spec can prove is
// the bridge: arming the mode from the parent, the in-frame controller
// swallowing the click, and the id coming back over the port.

import { expect, test } from "@playwright/test";
import {
  browserCanReachNetwork,
  selectExample,
  waitForBundle,
  waitForPlaygroundReady,
} from "./_helpers";

// Everything the page said while this test ran.  Dumped on failure: a preview
// that renders nothing, a bridge port that never opens and a bundle that threw
// all present as "locator not found", and the console line is usually the only
// thing that distinguishes them.
let pageErrors: string[] = [];

test.beforeEach(() => {
  pageErrors = [];
});

test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && pageErrors.length > 0) {
    console.log(
      `[preview-select-mode] page errors during the failing run:\n${pageErrors
        .map((m) => `  ${m.slice(0, 300)}`)
        .join("\n")}`,
    );
  }
});

test("Select in the preview footer resolves a clicked element to its page", async ({ page }) => {
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(`pageerror: ${err.message}`));

  await page.goto("/");
  await waitForPlaygroundReady(page);
  await selectExample(page, /Sales System/);

  if (!(await browserCanReachNetwork(page))) {
    test.skip(true, "browser cannot reach the npm registry from this environment");
  }

  await page.getByTestId("btn-generate").click();
  await expect(page.getByText(/generated \d+ file\(s\)/)).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("btn-bundle").click();
  await waitForBundle(page);
  await page.getByTestId("devtools-tab-backend").click();
  await page.getByTestId("btn-boot").click();
  await expect(page.getByTestId("backend-status")).toHaveText("booted", { timeout: 600_000 });

  const frame = page.frameLocator('[data-testid="preview-iframe"]');

  // Give the preview the whole viewport BEFORE touching the app.
  //
  // In the docked three-column shell the preview panel is a few hundred pixels
  // wide — far below the generated Mantine AppShell's `sm` breakpoint — so the
  // app renders in MOBILE mode with `collapsed: { mobile: true }`, i.e. the
  // navbar translated off-canvas (`translateX(-100%)`).  A translated element
  // keeps a non-empty box, so Playwright called the sidebar link "visible,
  // enabled and stable" and then clicked a viewport point that is LEFT of the
  // iframe — on top of the editor panel.  That is the failure this spec died
  // of on every `main` run since it landed:
  //
  //   <span class="mtk3 mtki">verifies requirement, covers code</span>
  //   from <div data-panel="true"> subtree intercepts pointer events
  //
  // — a Monaco token, i.e. the .ddd source, swallowing a click meant for the
  // preview.  Maximising makes the iframe viewport-wide, which puts the app
  // back in desktop layout and takes the editor out from under it.
  await page.getByTestId("preview-fullscreen-toggle").click();
  // Belt and braces: if the app is STILL below `sm` (a future shell, a smaller
  // CI viewport), open the burger so the navbar is on-screen rather than
  // off-canvas.  `hiddenFrom="sm"` means the burger exists only in that mode,
  // so this is also the check for "are we in mobile layout".
  const burger = frame.getByTestId("nav-burger");
  const openedNav = await burger.isVisible().catch(() => false);
  if (openedNav) {
    await burger.click();
  }

  // Reach the Products list with select mode OFF.  It has to be off: an armed
  // click is `preventDefault()`ed by the in-frame controller (see the click
  // listener in `web/src/preview/iframe-html.ts`), so a click spent navigating
  // while armed is consumed by the picker and the app never moves.
  const nav = frame.getByRole("link", { name: /Products/i }).first();
  await nav.click();
  const list = frame.locator('[data-testid="products-list"]');
  await expect(list).toBeVisible({ timeout: 60_000 });

  // Back to the docked layout before picking: the result bar this spec
  // asserts on (`SelectResultBar` in `layout/PreviewPane.tsx`) is a SIBLING of
  // the element that goes fullscreen, so in the maximised state it is not on
  // screen at all.  The list itself stays clickable docked — it sits in
  // `<main>`, which is full width whenever the navbar is collapsed.
  await page.getByTestId("preview-fullscreen-toggle").click();
  // If we had to open the navbar to reach the link, close it again — an open
  // mobile navbar overlays the left of `<main>`, i.e. the list we are about
  // to click.
  if (openedNav) {
    await burger.click();
  }

  // Now arm select mode from the parent's footer toggle and pick the list.
  const toggle = page.getByTestId("preview-select-toggle");
  await expect(toggle).toBeVisible({ timeout: 60_000 });
  await toggle.click();
  await expect(toggle).toHaveAttribute("data-active", "true");
  await list.click();

  const result = page.getByTestId("select-result");
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result).toHaveAttribute("data-kind", "found");
  await expect(result).toContainText("WebApp.products.List");
  // The toggle disarms itself after one pick — the in-frame controller and
  // the parent state have to agree, or the button lies about being armed.
  await expect(toggle).not.toHaveAttribute("data-active", "true");
  // And the two follow-ups the mission names are offered.
  await expect(page.getByTestId("select-open-builder")).toBeVisible();
  await expect(page.getByTestId("select-ask-agent")).toBeVisible();
});

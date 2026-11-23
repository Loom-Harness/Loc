// A `mock` backend in the playground: the mock example bundles (zocker and
// faker included, no drizzle, no PGlite), boots in its worker with no
// storage, and the React preview lists its generated rows and stores a row
// created through the form.  The mock is labelled wherever deployables are
// listed, and the API e2e suite is refused against it rather than run.
// Needs the npm registry (the bundle installs from it), like runtime.spec.ts.
//
// `LOOM_E2E_SHOTS=<dir>` also writes screenshots of each stage there.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "./_test";
import {
  browserCanReachNetwork,
  dumpPreviewDiagnostics,
  fatalConsoleErrors,
  pgliteStarts,
  startFromExample,
  waitForBundle,
} from "./_helpers";

const SHOTS = process.env.LOOM_E2E_SHOTS;

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

test.use({ deviceScaleFactor: 1 });

test("mock backend: bundles, boots with no storage, previews rows and stores a created one", async ({
  page,
}) => {
  test.setTimeout(1_200_000);
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

  await page.goto("/");
  await startFromExample(page, /Mock backend/);
  if (!(await browserCanReachNetwork(page))) {
    test.skip(true, "browser cannot reach the npm registry from this environment");
  }

  await test.step("Generate: the footer names the mock", async () => {
    await page.getByTestId("btn-generate").click();
    await expect(page.getByText(/generated \d+ file\(s\)/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("footer-mocks")).toHaveText("catalog_api (mock: rules not simulated)");
  });

  await test.step("Bundle", async () => {
    await page.getByTestId("btn-bundle").click();
    await waitForBundle(page);
    await shot(page, "1-bundled");
  });

  await test.step("Boot: no storage opened, the deployable row says mock", async () => {
    await page.getByTestId("devtools-tab-backend").click();
    await page.getByTestId("btn-boot").click();
    await expect(page.getByTestId("backend-status")).toHaveText("booted", { timeout: 600_000 });
    await expect(page.getByTestId("deployable-mock-catalog_api")).toHaveText("mock: rules not simulated");
    await expect(page.getByTestId("deployable-storage-catalog_api")).toHaveCount(0);
    expect(await pgliteStarts(page), "no PGlite started for a mock-only system").toEqual([]);
    await shot(page, "2-booted");
  });

  const iframe = page.frameLocator('[data-testid="preview-iframe"]');
  await test.step("Preview: the list page shows the generated rows", async () => {
    await expect(page.getByTestId("preview-region")).toBeVisible();
    // Maximised, the preview is in its desktop layout with the navbar on
    // screen (docked, the editor sits over the off-canvas navbar).
    await page.getByTestId("preview-fullscreen-toggle").click();
    const burger = iframe.getByTestId("nav-burger");
    if (await burger.isVisible().catch(() => false)) await burger.click();
    try {
      await iframe.getByTestId("nav-products").first().click({ timeout: 120_000 });
      await expect(iframe.getByTestId("products-list")).toBeVisible({ timeout: 60_000 });
      await expect(iframe.locator('[data-testid^="products-row-"]')).toHaveCount(10, { timeout: 60_000 });
    } catch (e) {
      await dumpPreviewDiagnostics(page, errors, "mock-backend");
      throw e;
    }
    await shot(page, "3-list");
  });

  await test.step("Create a row through the form; it reads back and lists", async () => {
    await iframe.getByTestId("products-list-create").click();
    await iframe.getByTestId("products-new-input-sku").locator("input").or(iframe.getByTestId("products-new-input-sku")).first().fill("ZZZ-PLAYGROUND-1");
    await iframe.getByTestId("products-new-input-name").locator("input").or(iframe.getByTestId("products-new-input-name")).first().fill("Made in the preview");
    await iframe.getByTestId("products-new-submit").click();
    await expect(iframe.getByTestId("products-detail")).toBeVisible({ timeout: 30_000 });
    await expect(iframe.getByTestId("products-detail-sku")).toContainText("ZZZ-PLAYGROUND-1");
    await shot(page, "4-created");
    await iframe.getByTestId("nav-products").first().click();
    await expect(iframe.getByTestId("products-list")).toBeVisible();
    // Sort by sku, descending: the created row leads.
    const skuHeader = iframe.getByRole("button", { name: /^Sku/ });
    await skuHeader.click();
    await skuHeader.click();
    await expect(iframe.locator('[data-testid^="products-row-"]').first()).toContainText("ZZZ-PLAYGROUND-1", {
      timeout: 30_000,
    });
    await shot(page, "5-listed");
    await page.getByTestId("preview-fullscreen-toggle").click();
  });

  await test.step("Tests: the API suite is refused against the mock", async () => {
    await page.getByTestId("devtools-tab-tests").click();
    await expect(page.getByTestId("test-suite-api")).toBeVisible({ timeout: 300_000 });
    await expect(page.getByTestId("suite-hint-api")).toHaveText(
      "API tests target catalog_api, a mock (rules not simulated) — its answers are not the backend's behaviour, so they are not run.",
    );
    await expect(page.getByTestId("btn-run-all-api")).toBeDisabled();
    await shot(page, "6-tests");
  });

  expect(fatalConsoleErrors(errors), "console errors during the mock flow").toEqual([]);
});

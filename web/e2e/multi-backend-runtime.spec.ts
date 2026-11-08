// Two Node backends on one storage: Bundle → Boot both → a write through one
// backend is read back through the other.  Each backend runs in its own
// runtime worker; the database runs once, in the infra worker, and both reach
// it through `PGliteWorker`.  Needs real internet, like runtime.spec.ts.

import { expect, type Page, test } from "@playwright/test";
import {
  browserCanReachNetwork,
  recordInitialMigration,
  selectExample,
  waitForBundle,
  waitForPlaygroundReady,
} from "./_helpers";

async function pickTarget(page: Page, slug: string): Promise<void> {
  await page.getByTestId("req-target").click();
  await page.getByRole("option", { name: slug, exact: true }).click();
  await expect(page.getByTestId("req-target")).toHaveValue(slug);
}

async function pickEndpoint(page: Page, name: RegExp): Promise<void> {
  await page.getByTestId("req-endpoint").click();
  await page.getByRole("option", { name }).click();
}

test("shared storage: both backends boot, a write via admin is read via storefront", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  await page.goto("/");
  await waitForPlaygroundReady(page);
  await selectExample(page, /Shared storage/);

  if (!(await browserCanReachNetwork(page))) {
    test.skip(true, "browser cannot reach the npm registry from this environment");
  }

  await test.step("Generate", async () => {
    await recordInitialMigration(page);
    await page.getByTestId("btn-generate").click();
    await expect(page.getByText(/generated \d+ file\(s\)/)).toBeVisible({ timeout: 60_000 });
  });

  await test.step("Bundle both backends", async () => {
    await page.getByTestId("btn-bundle").click();
    await waitForBundle(page);
  });

  await test.step("Boot", async () => {
    await page.getByTestId("devtools-tab-backend").click();
    await page.getByTestId("btn-boot").click();
    try {
      await expect(page.getByTestId("backend-status")).toHaveText("booted", { timeout: 600_000 });
    } catch (e) {
      console.log(`[multi-backend] errors:\n${consoleErrors.map((m) => "  " + m.slice(0, 400)).join("\n")}`);
      throw e;
    }
    // Both deployables serve; neither is listed as files-only.
    await expect(page.getByTestId("req-target")).toHaveValue("admin");
    await expect(page.getByText(/not booted/)).toHaveCount(0);
  });

  await test.step("POST /products through admin → 201", async () => {
    await pickEndpoint(page, /^POST \/(api\/)?products$/);
    await page.waitForFunction(
      () => typeof (window as unknown as { __loomSetRequestBody?: unknown }).__loomSetRequestBody === "function",
    );
    await page.evaluate(
      (json) =>
        (window as unknown as { __loomSetRequestBody?: (t: string) => void }).__loomSetRequestBody?.(json),
      JSON.stringify({ sku: "SHARED-1", name: "Shared widget" }),
    );
    await expect(page.getByTestId("req-body")).toContainText('"SHARED-1"');
    await page.getByTestId("btn-send").click();
    await expect(page.getByTestId("resp-status")).toContainText("201", { timeout: 30_000 });
  });

  await test.step("GET /products through storefront → the product admin wrote", async () => {
    await pickTarget(page, "storefront");
    await pickEndpoint(page, /^GET \/(api\/)?products$/);
    await page.getByTestId("btn-send").click();
    await expect(page.getByTestId("resp-status")).toContainText("200", { timeout: 30_000 });
    const parsed = JSON.parse((await page.getByTestId("resp-body").textContent()) ?? "{}");
    expect(parsed.total).toBe(1);
    expect(parsed.items[0].sku).toBe("SHARED-1");
  });

  await test.step("Reset empties the shared database for both", async () => {
    // The Database sub-view's Reset rebuilds every storage the boot opened.
    await page.getByTestId("runtime-subview").getByText("Database").click();
    await page.getByTestId("btn-wipe").click();
    await page.getByRole("button", { name: "Yes, clear all rows" }).click();
    await page.getByTestId("runtime-subview").getByText("API", { exact: true }).click();
    await pickTarget(page, "admin");
    await pickEndpoint(page, /^GET \/(api\/)?products$/);
    await page.getByTestId("btn-send").click();
    await expect(page.getByTestId("resp-status")).toContainText("200", { timeout: 30_000 });
    const parsed = JSON.parse((await page.getByTestId("resp-body").textContent()) ?? "{}");
    expect(parsed.total).toBe(0);
  });
});

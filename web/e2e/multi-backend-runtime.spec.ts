// Two Node backends on one storage: Bundle → Boot both → a write through one
// backend is read back through the other.  Each backend runs in its own
// runtime worker; the database runs once, under the infra worker, and both
// reach it over a storage port each.  Needs real internet, like runtime.spec.ts.

import { expect, type Page, test } from "./_test";
import {
  browserCanReachNetwork,
  recordAndGenerate,
  startFromExample,
  waitForBundle,
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
  await startFromExample(page, /Shared storage/);

  if (!(await browserCanReachNetwork(page))) {
    test.skip(true, "browser cannot reach the npm registry from this environment");
  }

  await test.step("Generate", async () => {
    await recordAndGenerate(page);
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

  // Guard: a request costs what the runtime worker spends on it, plus a
  // message each way.  A main-thread task that runs per response (a React
  // commit of the whole shell for each response's log lines was ~40 ms)
  // shows up here as page-observed time far above the worker's own.
  await test.step("dispatch overhead outside the worker stays small", async () => {
    const overheads = await page.evaluate(async () => {
      const w = window as unknown as {
        __loomDispatch: (t: string, m: string, p: string, b?: unknown) => Promise<{ durationMs?: number }>;
      };
      const out: number[] = [];
      for (let i = 0; i < 30; i++) {
        const t0 = performance.now();
        const res = await w.__loomDispatch("admin", "GET", "/products");
        out.push(performance.now() - t0 - (res.durationMs ?? 0));
      }
      return out;
    });
    const median = [...overheads].sort((a, b) => a - b)[Math.floor(overheads.length / 2)];
    console.log(`[multi-backend] dispatch overhead outside the worker: median ${median.toFixed(1)} ms`);
    // Measured ~1 ms after the fix, ~42 ms before; the ceiling leaves room for
    // a loaded CI runner.
    expect(median).toBeLessThan(15);
  });
});

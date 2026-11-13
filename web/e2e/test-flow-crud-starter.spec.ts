// The playground's test flow, end to end, on the default crud starter:
// generate → bundle → boot → Tests → every generated suite (unit, UI e2e,
// API e2e) is discovered and runs green in the browser, and the requirements
// rollup reads the results.  The flow this guards breaks silently — a suite
// that fails to load used to empty the whole Tests list — so it runs on the
// model a new user starts from.  Needs the npm registry (the bundle and the
// suites' imports install from it), like runtime.spec.ts.

import { expect, type Locator, test } from "./_test";
import {
  browserCanReachNetwork,
  recordAndGenerate,
  waitForBundle,
  waitForPlaygroundReady,
} from "./_helpers";

/** Run a suite and wait until every row has a verdict; return each row's
 *  status and text. */
async function runAll(suite: Locator, testid: string): Promise<{ status: string; text: string }[]> {
  await suite.page().getByTestId(`btn-run-all-${testid}`).click();
  const rows = suite.getByTestId("test-row");
  await expect(rows.first()).toBeVisible();
  await expect
    .poll(
      async () => {
        const all = await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
        return all.every((s) => s === "pass" || s === "fail");
      },
      { timeout: 180_000, message: `${testid}: every row has a verdict` },
    )
    .toBe(true);
  return rows.evaluateAll((els) =>
    els.map((e) => ({ status: e.getAttribute("data-status") ?? "", text: (e as HTMLElement).innerText })),
  );
}

/** Every row passed; a failure reports its row text (name + error). */
function expectAllPass(rows: { status: string; text: string }[], what: string): void {
  expect(rows.length, `${what}: rows`).toBeGreaterThan(0);
  for (const r of rows) expect(r.status, `${what}: ${r.text}`).toBe("pass");
}

test("crud starter: generated unit, UI and API suites are discovered and pass in the browser", async ({
  page,
}) => {
  test.setTimeout(1_200_000);
  await page.goto("/");
  await waitForPlaygroundReady(page);
  if (!(await browserCanReachNetwork(page))) {
    test.skip(true, "browser cannot reach the npm registry from this environment");
  }

  await recordAndGenerate(page);
  await page.getByTestId("btn-bundle").click();
  await waitForBundle(page);
  await page.getByTestId("devtools-tab-backend").click();
  await page.getByTestId("btn-boot").click();
  await expect(page.getByTestId("backend-status")).toHaveText(/booted/i, { timeout: 600_000 });
  await expect(page.getByTestId("preview-region")).toBeVisible();

  await page.getByTestId("devtools-tab-tests").click();
  const unit = page.locator('[data-testid^="test-suite-unit-"]');
  const ui = page.getByTestId("test-suite-ui");
  const api = page.getByTestId("test-suite-api");
  // Discovery settles when the API suite (loaded last) is listed or an
  // error is up; an error fails the flow with its text.
  const hint = page.getByTestId("test-error-hint");
  await expect(hint.or(api).first()).toBeVisible({ timeout: 300_000 });
  if (await hint.isVisible()) {
    await page.getByTestId("test-error-toggle").click();
    throw new Error(
      `Test discovery failed: ${await hint.innerText()}\n${await page.getByTestId("test-error").innerText()}`,
    );
  }
  await expect(unit.first()).toBeVisible();
  await expect(ui).toBeVisible();

  for (let i = 0; i < (await unit.count()); i++) {
    const s = unit.nth(i);
    const id = ((await s.getAttribute("data-testid")) ?? "").replace(/^test-suite-/, "");
    expectAllPass(await runAll(s, id), `unit ${id}`);
  }
  expectAllPass(await runAll(api, "api"), "API e2e");
  expectAllPass(await runAll(ui, "ui"), "UI e2e");
});

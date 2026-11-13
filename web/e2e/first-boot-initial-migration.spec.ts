// A built-in example boots on its first Run without the user recording a
// migration: the workspace has no chain, so Boot records the initial
// migration itself (`initial`) and creates the database from it.  A later
// schema change still waits for an explicit record.  Needs real internet
// (npm), like runtime.spec.ts.

import { expect, test } from "./_test";
import { browserCanReachNetwork, startFromExample, waitForBundle } from "./_helpers";

test("first Boot of an example records its initial migration and boots", async ({ page }) => {
  test.setTimeout(900_000);
  await page.goto("/");
  await startFromExample(page, /Sales System/);
  if (!(await browserCanReachNetwork(page))) test.skip(true, "browser cannot reach the npm registry");

  // Nothing is recorded yet, and Boot is not blocked on it.
  await expect(page.getByTestId("migration-pending")).toHaveAttribute("data-initial", "true", { timeout: 30_000 });

  await page.getByTestId("btn-generate").click();
  await expect(page.getByTestId("btn-generate")).toHaveAttribute("data-state", "ok", { timeout: 120_000 });
  await page.getByTestId("btn-bundle").click();
  await waitForBundle(page);
  await expect(page.getByTestId("btn-boot")).toBeEnabled();
  await page.getByTestId("btn-boot").click();
  await page.getByTestId("devtools-tab-backend").click();
  await expect(page.getByTestId("backend-status")).toHaveText("booted", { timeout: 600_000 });

  // The chain now records the whole model, under the name Boot gave it.
  await expect(page.getByTestId("migration-pending")).toHaveCount(0, { timeout: 30_000 });
  await page.getByTestId("devtools-tab-migrations").click();
  await expect(page.getByTestId("migration-chain-status")).toContainText("nothing unrecorded", { timeout: 30_000 });
  await expect(page.getByTestId("migration-chain-status")).toContainText(/^1 recorded · head Sales Initial /);
});

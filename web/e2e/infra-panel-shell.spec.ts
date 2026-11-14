// The Infrastructure panel's shell: reachable from the desktop dock, the
// command palette and the mobile More sheet, and honest before a boot (no
// infra worker to ask).  No network — nothing here bundles or boots; the tabs'
// own specs (`infra-panel-<tab>.spec.ts`) boot an example and drive them.

import { expect, test } from "./_test";
import { waitForPlaygroundReady } from "./_helpers";

test("desktop: the dock's Infrastructure tab says nothing is running yet", async ({ page }) => {
  await page.goto("/");
  await waitForPlaygroundReady(page);
  await page.getByTestId("devtools-tab-infra").click();
  const panel = page.getByTestId("infra-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-booted", "false");
  await expect(page.getByTestId("infra-not-booted")).toContainText(/Boot the system/);
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("More → Infrastructure opens the panel", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("mobile-tabs")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("mobile-tab-more").click();
    await page.getByTestId("mobile-more-sheet").getByTestId("mobile-tab-infra").click();
    await expect(page.getByTestId("mobile-tab-more")).toHaveAttribute("data-secondary-active", "infra");
    await expect(page.getByTestId("infra-panel")).toBeVisible();
    await expect(page.getByTestId("infra-not-booted")).toBeVisible();
  });
});

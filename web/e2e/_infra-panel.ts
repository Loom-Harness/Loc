import { expect, type Page } from "@playwright/test";

/** Open one tab of the infra panel (the bottom dock's Infra panel). */
export async function openInfraTab(page: Page, tab: "broker" | "oidc" | "cache"): Promise<void> {
  await page.getByTestId("devtools-tab-infra").click();
  await page.getByTestId(`infra-tab-${tab}`).click();
  await expect(page.getByTestId(`infra-${tab}`)).toBeVisible({ timeout: 30_000 });
}

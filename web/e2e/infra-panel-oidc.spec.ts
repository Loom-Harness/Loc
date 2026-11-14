// The infra panel's OIDC tab on a booted `auth { oidc }` example: the generated
// frontend signs in through the playground identity provider (code + PKCE),
// and the tab must show the realm, the personas, and the token set the token
// endpoint served for that login — decoded — next to one minted from the tab.
// Needs real internet (npm), like oidc-login-preview.spec.ts.

import { expect, type FrameLocator, test } from "./_test";
import { openInfraTab } from "./_infra-panel";
import { browserCanReachNetwork, recordAndGenerate, startFromExample, waitForBundle } from "./_helpers";

test("infra panel — OIDC tab shows personas and every issued token, decoded", async ({ page }) => {
  test.setTimeout(900_000);
  await page.goto("/");
  await startFromExample(page, /OIDC auth/);
  if (!(await browserCanReachNetwork(page))) test.skip(true, "browser cannot reach the npm registry");

  await recordAndGenerate(page);
  await page.getByTestId("btn-bundle").click();
  await waitForBundle(page);
  await page.getByTestId("devtools-tab-backend").click();
  await page.getByTestId("btn-boot").click();
  await expect(page.getByTestId("backend-status")).toHaveText("booted", { timeout: 600_000 });

  await test.step("the realm and the dev realm's personas", async () => {
    await openInfraTab(page, "oidc");
    const tab = page.getByTestId("infra-oidc");
    await expect(tab.getByTestId("infra-oidc-realm")).toContainText("/realms/desk");
    await expect(tab.locator('[data-testid="infra-oidc-persona"][data-persona="demo-admin"]')).toBeVisible();
    await tab.getByTestId("infra-emulated").hover();
    await expect(page.getByTestId("infra-emulated-notes")).toContainText("no consent screen");
    await expect(tab.getByTestId("infra-oidc-no-tokens")).toBeVisible();
  });

  await test.step("a sign-in through the preview shows the token the token endpoint served", async () => {
    const app: FrameLocator = page.frameLocator('[data-testid="preview-iframe"]');
    await app.getByRole("button", { name: "Sign in" }).click();
    await app.getByTestId("loom-idp-persona-demo-admin").click();
    await expect(app.getByTestId("sign-out")).toBeVisible({ timeout: 30_000 });

    const tab = page.getByTestId("infra-oidc");
    const served = tab.locator('[data-testid="infra-oidc-token"][data-source="authorization_code"]');
    await expect(served).toHaveCount(1);
    await expect(served).toHaveAttribute("data-persona", "demo-admin");
    await expect(served.getByTestId("infra-oidc-token-expiry")).toContainText("expires in");
    await served.getByTestId("infra-oidc-token-toggle").click();
    const access = served.locator('[data-testid="infra-oidc-decoded"][data-label="Access token"]');
    await expect(access.getByTestId("infra-oidc-header")).toContainText('"alg": "RS256"');
    await expect(access.getByTestId("infra-oidc-claims")).toContainText('"preferred_username": "demo-admin"');
    await expect(access.getByTestId("infra-oidc-claims")).toContainText('"iss": "http');
  });

  await test.step("Mint issues a token for a persona", async () => {
    const tab = page.getByTestId("infra-oidc");
    await tab.locator('[data-testid="infra-oidc-persona"][data-persona="demo"] [data-testid="infra-oidc-mint"]').click();
    const minted = tab.locator('[data-testid="infra-oidc-token"][data-source="mint"]');
    await expect(minted).toHaveCount(1);
    await expect(minted).toHaveAttribute("data-persona", "demo");
    await minted.getByTestId("infra-oidc-token-toggle").click();
    await expect(
      minted.locator('[data-testid="infra-oidc-decoded"][data-label="ID token"] [data-testid="infra-oidc-claims"]'),
    ).toContainText('"preferred_username": "demo"');
  });
});

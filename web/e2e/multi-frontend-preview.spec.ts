// Every frontend of a system previews, each against the backend its
// `targets:` names.  The two-frontends example with `storefront` rebound to
// its own storage: a product written through `admin` lists in `backoffice`
// (which targets admin) and not in `shopfront` (which targets storefront),
// and the reverse.  A preview that sent every frontend's calls to one backend
// would list the same products in both.  Needs real internet, like
// runtime.spec.ts.

import { expect, type Page, test } from "./_test";
import {
  browserCanReachNetwork,
  readEditorSource,
  recordAndGenerate,
  startFromExample,
  waitForBundle,
} from "./_helpers";

async function post(page: Page, target: string, sku: string): Promise<void> {
  await page.getByTestId("req-target").click();
  await page.getByRole("option", { name: target, exact: true }).click();
  await expect(page.getByTestId("req-target")).toHaveValue(target);
  await page.getByTestId("req-endpoint").click();
  await page.getByRole("option", { name: /^POST \/(api\/)?products$/ }).click();
  await page.waitForFunction(
    () => typeof (window as unknown as { __loomSetRequestBody?: unknown }).__loomSetRequestBody === "function",
  );
  await page.evaluate(
    (json) => (window as unknown as { __loomSetRequestBody?: (t: string) => void }).__loomSetRequestBody?.(json),
    JSON.stringify({ sku, name: `${sku} widget` }),
  );
  await expect(page.getByTestId("req-body")).toContainText(sku);
  await page.getByTestId("btn-send").click();
  await expect(page.getByTestId("resp-status")).toContainText("201", { timeout: 30_000 });
}

async function pickFrontend(page: Page, label: string): Promise<void> {
  await page.getByTestId("preview-frontend").click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await expect(page.getByTestId("preview-frontend")).toHaveValue(label);
}

/** The preview's product list shows `shown` and not `hidden`. */
async function expectProducts(page: Page, shown: string, hidden: string): Promise<void> {
  const app = page.frameLocator('[data-testid="preview-iframe"]');
  await expect(app.getByText(/Welcome/i).first()).toBeVisible({ timeout: 60_000 });
  await app.getByRole("link", { name: /Products/ }).first().click();
  await expect(app.getByText(shown, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(app.getByText(hidden, { exact: true })).toHaveCount(0);
}

test("two frontends: the picker previews each against its own backend", async ({ page }) => {
  await page.goto("/");
  await startFromExample(page, /Two frontends/);

  if (!(await browserCanReachNetwork(page))) {
    test.skip(true, "browser cannot reach the npm registry from this environment");
  }

  await test.step("Rebind storefront to its own storage", async () => {
    const source = await readEditorSource(page);
    const edited = source
      .replace(
        "resource catalogState { for: Catalog, kind: state, use: primary }",
        "storage replica { type: postgres }\n  resource catalogState { for: Catalog, kind: state, use: primary }\n  resource replicaState { for: Catalog, kind: state, use: replica }",
      )
      .replace(/(deployable storefront \{[^}]*?)dataSources: \[catalogState\]/, "$1dataSources: [replicaState]");
    expect(edited).toContain("dataSources: [replicaState]");
    await page.evaluate(
      (t) => (window as unknown as { __loomSetSource: (s: string) => void }).__loomSetSource(t),
      edited,
    );
    expect(await readEditorSource(page)).toContain("use: replica");
    await expect(page.getByTestId("btn-validate")).toHaveAttribute("data-state", "ok");
  });

  await test.step("Generate, bundle both frontends, boot", async () => {
    await recordAndGenerate(page);
    await page.getByTestId("btn-bundle").click();
    await waitForBundle(page);
    await page.getByTestId("devtools-tab-backend").click();
    await page.getByTestId("btn-boot").click();
    await expect(page.getByTestId("backend-status")).toHaveText("booted", { timeout: 600_000 });
  });

  await test.step("One product per backend", async () => {
    await post(page, "admin", "ADMIN-1");
    await post(page, "storefront", "SHOP-1");
  });

  await test.step("backoffice → admin lists only admin's product", async () => {
    await expect(page.getByTestId("preview-frontend")).toHaveValue("backoffice → admin");
    await expectProducts(page, "ADMIN-1", "SHOP-1");
  });

  await test.step("shopfront → storefront lists only storefront's product", async () => {
    await pickFrontend(page, "shopfront → storefront");
    await expectProducts(page, "SHOP-1", "ADMIN-1");
  });
});

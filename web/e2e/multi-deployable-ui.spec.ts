// The multi-deployable Runtime/Output surfaces: per-deployable status rows,
// the HTTP console's deployable picker, the SQL console's and Reset's storage
// picker, and per-deployable log tagging + filter.  Two Node backends, each on
// its OWN storage (the shared-storage example with `storefront` rebound to a
// second storage), so a write through one backend must not show in the other.
// Needs real internet, like multi-backend-runtime.spec.ts.

import { expect, type Page, test } from "@playwright/test";
import {
  browserCanReachNetwork,
  readEditorSource,
  recordInitialMigration,
  selectExample,
  waitForBundle,
  waitForPlaygroundReady,
} from "./_helpers";

async function pick(page: Page, testid: string, option: string): Promise<void> {
  await page.getByTestId(testid).click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(page.getByTestId(testid)).toHaveValue(option);
}

async function sql(page: Page, statement: string): Promise<void> {
  await page.getByTestId("sql-input").fill(statement);
  await page.getByTestId("btn-run-sql").click();
}

test("two deployables, two storages: pickers, status rows and tagged logs", async ({ page }) => {
  await page.goto("/");
  await waitForPlaygroundReady(page);
  await selectExample(page, /Shared storage/);

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
    expect(edited).toContain("replicaState");
    await page.evaluate(
      (t) => (window as unknown as { __loomSetSource: (s: string) => void }).__loomSetSource(t),
      edited,
    );
    expect(await readEditorSource(page)).toContain("use: replica");
    // The edit must validate before anything is recorded against it.
    await expect(page.getByTestId("btn-validate")).toHaveAttribute("data-state", "ok");
  });

  await test.step("Generate, bundle", async () => {
    await recordInitialMigration(page);
    await page.getByTestId("btn-generate").click();
    await expect(page.getByText(/generated \d+ file\(s\)/)).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("btn-bundle").click();
    await waitForBundle(page);
  });

  await test.step("Before boot: every deployable listed, none booted", async () => {
    await page.getByTestId("devtools-tab-backend").click();
    for (const slug of ["admin", "storefront"]) {
      await expect(page.getByTestId(`deployable-state-${slug}`)).toHaveText("not booted");
    }
  });

  await test.step("Boot: per-deployable status with storage and emulated markers", async () => {
    await page.getByTestId("btn-boot").click();
    await expect(page.getByTestId("backend-status")).toHaveText("booted", { timeout: 600_000 });
    await expect(page.getByTestId("deployable-state-admin")).toHaveText("booted");
    await expect(page.getByTestId("deployable-state-storefront")).toHaveText("booted");
    await expect(page.getByTestId("deployable-storage-admin")).toHaveText("storage primary");
    await expect(page.getByTestId("deployable-storage-storefront")).toHaveText("storage replica");
    await expect(page.getByTestId("deployable-emulated-admin")).toBeVisible();
    await expect(page.getByTestId("deployable-emulated-storefront")).toBeVisible();
  });

  await test.step("HTTP console: the caption follows the picked deployable", async () => {
    await expect(page.getByTestId("req-target")).toHaveValue("admin");
    await expect(page.getByTestId("req-target-caption")).toContainText("Sends to admin · storage primary");
    await pick(page, "req-target", "storefront");
    await expect(page.getByTestId("req-target-caption")).toContainText("Sends to storefront · storage replica");
    await expect(page.getByTestId("req-target-caption")).not.toContainText("default");
    // The endpoint list is re-read from the picked deployable's own spec.
    await expect(page.getByTestId("req-endpoint")).toHaveValue("");
    await page.getByTestId("req-endpoint").click();
    await expect(page.getByRole("option", { name: /^GET \/(api\/)?products$/ })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  await test.step("Requests to each deployable tag the Output log with it", async () => {
    for (const slug of ["admin", "storefront"]) {
      await pick(page, "req-target", slug);
      await page.getByTestId("btn-send").click();
      await expect(page.getByTestId("resp-status")).toBeVisible({ timeout: 30_000 });
    }
    await page.getByTestId("devtools-tab-output").click();
    await page.getByTestId("output-stream-select").click();
    await page.getByRole("option", { name: "Runtime logs", exact: true }).click();
    const log = page.getByTestId("output-backend-log");
    await expect(log.locator('[data-source="admin"]').first()).toBeVisible();
    await expect(log.locator('[data-source="storefront"]').first()).toBeVisible();

    await pick(page, "output-backend-log-source", "storefront");
    await expect(log.locator('[data-source="storefront"]').first()).toBeVisible();
    await expect(log.locator('[data-source="admin"]')).toHaveCount(0);
  });

  await test.step("SQL console: the storage picker chooses the database", async () => {
    await page.getByTestId("devtools-tab-backend").click();
    await page.getByTestId("runtime-subview").getByText("Database").click();
    await expect(page.getByTestId("db-target")).toHaveValue("primary");
    await sql(page, "SELECT current_schema() AS s");
    await expect(page.getByTestId("sql-result")).toBeVisible({ timeout: 30_000 });
    // Two databases: a table created in one is absent from the other.
    await sql(page, "CREATE TABLE only_in_primary (id int)");
    await expect(page.getByTestId("sql-error")).toHaveCount(0);
    await pick(page, "db-target", "replica");
    await sql(page, "SELECT * FROM only_in_primary");
    await expect(page.getByTestId("sql-error")).toContainText(/only_in_primary/, { timeout: 30_000 });
    await pick(page, "db-target", "primary");
    await sql(page, "SELECT * FROM only_in_primary");
    await expect(page.getByTestId("sql-result")).toBeVisible({ timeout: 30_000 });
  });

  await test.step("Reset acts on the picked storage only", async () => {
    await pick(page, "db-target", "replica");
    await expect(page.getByText("Reset acts on storage replica only.")).toBeVisible();
    await page.getByTestId("btn-wipe").click();
    await page.getByRole("button", { name: "Yes, clear all rows" }).click();
    // primary's ad-hoc table survives a Reset of replica.
    await pick(page, "db-target", "primary");
    await sql(page, "SELECT * FROM only_in_primary");
    await expect(page.getByTestId("sql-result")).toBeVisible({ timeout: 30_000 });
  });
});

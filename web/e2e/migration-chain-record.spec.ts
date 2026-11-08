// The playground's migration chain, end to end in the browser: record the
// Initial, evolve the model, record each change, and see the chain status, the
// destructive gate and the workspace's `migrations/` files follow — and Boot
// evolve the in-browser database only by the recorded chain.
//
// The recording tests are pure client-side (build worker + git store), no
// network.  The Boot test bundles and boots, so it needs the npm registry and
// jsdelivr and self-skips without them.

import { expect, type Page, test } from "@playwright/test";
import {
  browserCanReachNetwork,
  recordInitialMigration,
  waitForBundle,
  waitForPlaygroundReady,
} from "./_helpers";

type LoomWindow = {
  __loomSetSource: (t: string) => void;
  __loomGetSource: () => string;
};

async function wipeStorage(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases?.();
    for (const { name } of dbs ?? []) {
      if (name?.startsWith("loom-")) {
        await new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase(name!);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
        });
      }
    }
  });
  await page.reload();
  await waitForPlaygroundReady(page);
  await page.waitForFunction(
    () => typeof (window as unknown as Partial<LoomWindow>).__loomSetSource === "function",
  );
}

async function editSource(page: Page, edit: (src: string) => string): Promise<void> {
  const before = await page.evaluate(() => (window as unknown as LoomWindow).__loomGetSource());
  const after = edit(before);
  expect(after, "the edit changed the source").not.toBe(before);
  await page.evaluate((t) => (window as unknown as LoomWindow).__loomSetSource(t), after);
}

async function openMigrations(page: Page): Promise<void> {
  await page.getByTestId("devtools-tab-migrations").click();
  await expect(page.getByTestId("migrations-panel")).toBeVisible();
  await page.getByTestId("evolution-refresh").click();
}

async function record(page: Page, name: string): Promise<void> {
  await page.getByTestId("migration-record-name").fill(name);
  await expect(page.getByTestId("migration-record")).toBeEnabled();
  await page.getByTestId("migration-record").click();
  await expect(page.getByTestId("migration-record-result")).toContainText(/Recorded \d+ migration file/, {
    timeout: 30_000,
  });
}

const status = (page: Page) => page.getByTestId("migration-chain-status");

test("records the Initial, then each model change, into migrations/", async ({ page }) => {
  await wipeStorage(page);
  await openMigrations(page);

  // No chain yet: recording starts it.
  await expect(status(page)).toContainText("No migrations/ yet", { timeout: 30_000 });
  await record(page, "initial");
  await expect(status(page)).toContainText(/\d+ recorded · head .* nothing unrecorded/, {
    timeout: 30_000,
  });

  // An additive change is pending until recorded.
  await editSource(page, (s) => s.replace("email: string", "email: string\n        phone: string?"));
  await page.getByTestId("evolution-refresh").click();
  await expect(status(page)).toContainText(/1 unrecorded step/, { timeout: 30_000 });
  await expect(page.getByTestId("migration-card").first()).toContainText(/ADD COLUMN "phone"/);
  await record(page, "add-phone");
  await expect(status(page)).toContainText("nothing unrecorded", { timeout: 30_000 });

  // A destructive change needs the flag before it can be recorded.
  await editSource(page, (s) => s.replace("\n        phone: string?", ""));
  await page.getByTestId("evolution-refresh").click();
  await expect(page.getByTestId("migration-destructive-gate").first()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("migration-record-name").fill("drop-phone");
  await expect(page.getByTestId("migration-record")).toBeDisabled();
  await page.getByTestId("migration-record-destructive").check();
  await page.getByTestId("migration-record").click();
  await expect(page.getByTestId("migration-record-result")).toContainText(/Recorded \d+ migration file/, {
    timeout: 30_000,
  });
  await expect(status(page)).toContainText("nothing unrecorded", { timeout: 30_000 });
});

async function generatorOutput(page: Page): Promise<string> {
  await page.getByTestId("devtools-tab-output").click();
  await page.getByTestId("output-stream-select").click();
  await page.getByRole("option", { name: /Generator/ }).click();
  return page.locator("body").innerText();
}

/** The generated project's file names, read off the Download .zip archive. */
async function downloadedNames(page: Page): Promise<string> {
  await page.getByTestId("explorer-mode-generated").click();
  const download = page.waitForEvent("download");
  await page.getByText("Download .zip").click({ timeout: 60_000 });
  const zip = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of zip) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("latin1");
}

test("generate warns on unrecorded changes and renders only the recorded chain until they are recorded", async ({
  page,
}) => {
  await wipeStorage(page);
  await openMigrations(page);
  await expect(status(page)).toContainText("No migrations/ yet", { timeout: 30_000 });
  await record(page, "initial");

  // An unrecorded change: generate still succeeds, warns how to record it,
  // and its migrations stop at the recorded chain.
  await editSource(page, (s) => s.replace("email: string", "email: string\n        phone: string?"));
  await page.getByTestId("btn-generate").click();
  await expect(page.getByTestId("btn-generate")).toHaveAttribute("data-state", "ok", {
    timeout: 60_000,
  });
  await expect
    .poll(() => generatorOutput(page), { timeout: 60_000 })
    .toMatch(/schema changes not recorded in migrations\/.*Migrations tab → Record migration/s);
  const before = await downloadedNames(page);
  expect(before).toMatch(/db\/migrations\/\d+_sales_initial\.sql/);
  expect(before).not.toMatch(/_sales_add_phone\.sql/);

  // Recorded: the project carries both migrations.
  await openMigrations(page);
  await record(page, "add-phone");
  await page.getByTestId("btn-generate").click();
  await expect(page.getByTestId("btn-generate")).toHaveAttribute("data-state", "ok", {
    timeout: 60_000,
  });
  const after = await downloadedNames(page);
  expect(after).toMatch(/db\/migrations\/\d+_sales_initial\.sql/);
  expect(after).toMatch(/db\/migrations\/\d+_sales_add_phone\.sql/);
});

/** Bundle the current generate and boot it from the Runtime tab; resolves
 *  once the backend status settles on `expected`. */
async function bundleAndBoot(page: Page, expected: "booted" | "migration required"): Promise<void> {
  const generate = page.getByTestId("btn-generate");
  await expect(generate).toHaveAttribute("data-state", "ok", { timeout: 120_000 });
  await page.getByTestId("btn-bundle").click();
  await waitForBundle(page);
  await page.getByTestId("devtools-tab-backend").click();
  await page.getByTestId("btn-boot").click();
  await expect(page.getByTestId("backend-status")).toHaveText(expected, { timeout: 600_000 });
}

async function runSql(page: Page, sql: string): Promise<void> {
  await page.getByTestId("runtime-subview").getByText("Database").click();
  await page.getByTestId("sql-input").fill(sql);
  await page.getByTestId("btn-run-sql").click();
}

test("Boot evolves the database only by the recorded chain: nothing before the initial is recorded, rows kept across a recorded change, an unrecorded change left alone", async ({
  page,
}) => {
  test.setTimeout(1_800_000);
  await wipeStorage(page);
  if (!(await browserCanReachNetwork(page))) {
    test.skip(true, "browser cannot reach the npm registry from this environment");
  }

  // A fresh example has no chain: Boot creates nothing and says why.
  await bundleAndBoot(page, "migration required");
  await expect(page.getByTestId("boot-migration-pending")).toHaveAttribute("data-kind", "unrecorded");
  await expect(page.getByTestId("boot-migration-pending-message")).toContainText(
    "Record the initial migration in the Migrations tab",
  );
  await expect(page.getByTestId("pipeline-count-boot")).toHaveText("migration required");

  // Record the initial migration: Boot applies it and the tables exist.
  await recordInitialMigration(page);
  await bundleAndBoot(page, "booted");
  await runSql(page, "SELECT 1"); // opens the Database sub-view
  await expect(page.getByTestId("migrated-status")).toHaveText("1 migration applied");
  await runSql(
    page,
    "INSERT INTO sales.customers (id, name, email) VALUES ('00000000-0000-4000-8000-000000000001', 'Ada', 'ada@example.com')",
  );
  await expect(page.getByTestId("sql-affected")).toContainText("1");

  // An unrecorded change: Boot leaves the database as it is.
  await editSource(page, (s) => s.replace("email: string", "email: string\n        phone: string?"));
  await page.getByTestId("btn-generate").click();
  await expect
    .poll(() => generatorOutput(page), { timeout: 60_000 })
    .toMatch(/schema changes not recorded in migrations\//);
  await bundleAndBoot(page, "migration required");
  await expect(page.getByTestId("boot-migration-pending-message")).toContainText(
    "1 unrecorded schema change in module Sales. The database was left as it is.",
  );

  // Recorded: Boot applies exactly that migration, and the row is still there.
  await openMigrations(page);
  await record(page, "add-phone");
  await bundleAndBoot(page, "booted");
  await runSql(page, "SELECT name, phone FROM sales.customers");
  await expect(page.getByTestId("migrated-status")).toHaveText("1 migration applied");
  await expect(page.getByTestId("migrated-list")).toContainText("_sales_add_phone");
  await expect(page.getByTestId("sql-result")).toContainText("Ada");
  await expect(page.getByTestId("sql-result")).toContainText("phone");
});

test("an index on an existing table is built CONCURRENTLY; a model the validator refuses is not recorded", async ({
  page,
}) => {
  await wipeStorage(page);
  await openMigrations(page);
  await expect(status(page)).toContainText("No migrations/ yet", { timeout: 30_000 });
  await record(page, "initial");

  await editSource(page, (s) =>
    s.replace(
      "resource salesState { for: Sales, kind: state, use: primary }",
      "resource salesState { for: Sales, kind: state, use: primary, index: [Customer.email] }",
    ),
  );
  await page.getByTestId("evolution-refresh").click();
  await expect(page.getByTestId("migrations-panel")).toContainText(
    'CREATE INDEX CONCURRENTLY "customers_email_idx"',
    { timeout: 30_000 },
  );
  await record(page, "index-email");

  // Renaming the field leaves `index:` naming a column that no longer exists.
  // `ddd migrate add` refuses that model, and so does the playground.
  await editSource(page, (s) => s.replace("email: string", "contactEmail: string"));
  await page.getByTestId("evolution-refresh").click();
  await expect(page.getByTestId("migrations-panel")).toContainText(
    /index:. references 'Customer\.email', but 'email' is not a field/,
    { timeout: 30_000 },
  );
  await expect(page.getByTestId("migration-record")).toHaveCount(0);
});

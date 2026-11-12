// The playground's migration chain, end to end in the browser: record the
// Initial, evolve the model, record each change, and see the chain status, the
// destructive gate and the workspace's `migrations/` files follow — and Boot
// evolve the in-browser database only by the recorded chain.  The pipeline
// strip's migration badge follows the source with no tab open: an example
// opens at "migration required · initial schema", a schema edit shows its
// unrecorded change, Record migration… writes the chain entry the Migrations
// tab writes, and Apply brings the database to the head with its rows.
//
// The recording tests are pure client-side (build worker + git store), no
// network.  The Boot test bundles and boots, so it needs the npm registry and
// jsdelivr and self-skips without them.

import { expect, type Page, test } from "./_test";
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
    .toMatch(/schema changes not recorded in migrations\/.*Record migration… beside Boot/s);
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

const badge = (page: Page) => page.getByTestId("migration-pending");

/** Record from the strip's Record migration… dialog. */
async function recordFromDialog(page: Page, name: string): Promise<void> {
  const dialog = page.getByTestId("record-migration-dialog");
  await expect(dialog.getByTestId("record-migration-preview")).toBeVisible({ timeout: 60_000 });
  await dialog.getByTestId("record-migration-name").fill(name);
  await expect(dialog.getByTestId("record-migration")).toBeEnabled();
  await dialog.getByTestId("record-migration").click();
  // A recording closes the dialog.
  await expect(dialog.getByTestId("record-migration-preview")).toHaveCount(0, { timeout: 30_000 });
}

// Apply migrates the cluster the first Boot made, in place: the database has to
// outlive a Boot, which only an OPFS data dir does.
test.describe("on an OPFS cluster", () => {
  test.use({ pgliteStorage: "opfs" });

  test("the strip's migration badge: an example opens at initial schema, Record writes the chain entry, a schema edit shows without a tab, Apply migrates in place", async ({
    page,
  }) => {
    test.setTimeout(1_800_000);
    await wipeStorage(page);
    if (!(await browserCanReachNetwork(page))) {
      test.skip(true, "browser cannot reach the npm registry from this environment");
    }

    // A fresh example records nothing: the badge says so before any generate,
    // bundle or boot, and Boot waits for the initial migration.
    await expect(badge(page)).toHaveAttribute("data-kind", "unrecorded", { timeout: 60_000 });
    await expect(badge(page)).toHaveAttribute("data-initial", "true");
    await expect(page.getByTestId("migration-pending-badge")).toHaveText("migration required · initial schema");
    await expect(page.getByTestId("btn-generate")).toHaveAttribute("data-state", "ok", { timeout: 120_000 });
    await page.getByTestId("btn-bundle").click();
    await waitForBundle(page);
    const boot = page.getByTestId("btn-boot");
    await expect(boot).toHaveAttribute("data-state", "blocked");
    await expect(boot).toBeDisabled();
    await expect(page.getByTestId("pipeline-count-boot")).toHaveText("migration required");

    // The Problems pane links to the same state: its notice opens the dialog.
    await page.getByTestId("btn-validate").click();
    await expect(page.getByTestId("problems-migration-notice")).toContainText("initial schema");
    await page.getByTestId("problems-record-migration").click();
    const dialog = page.getByTestId("record-migration-dialog");
    await expect(dialog).toContainText("Record the initial migration");
    await expect(dialog.getByTestId("record-migration-summary")).toContainText(
      /Starts migrations\/ with each module's Initial migration: creates \d+ tables? in module/,
    );
    await expect(dialog.getByTestId("record-migration-sql")).toContainText("CREATE TABLE");
    await recordFromDialog(page, "initial");

    // The entry is the one the Migrations tab writes: the tab reads the chain
    // the dialog recorded, with nothing left to record.
    await expect(badge(page)).toHaveCount(0, { timeout: 60_000 });
    await openMigrations(page);
    await expect(status(page)).toContainText(/1 recorded · head Sales Initial \(\d+\) · nothing unrecorded/, {
      timeout: 30_000,
    });

    // Recorded: Boot is no longer gated, and its boot creates the tables.
    await bundleAndBoot(page, "booted");
    await runSql(page, "SELECT 1"); // opens the Database sub-view
    await expect(page.getByTestId("migrated-status")).toHaveText("1 migration applied");
    await runSql(
      page,
      "INSERT INTO sales.customers (id, name, email) VALUES ('00000000-0000-4000-8000-000000000001', 'Ada', 'ada@example.com')",
    );
    await expect(page.getByTestId("sql-affected")).toContainText("1");

    // A schema edit: the badge shows the unrecorded change with no tab opened
    // for it and no generate or boot.
    await editSource(page, (s) => s.replace("email: string", "email: string\n        phone: string?"));
    await expect(badge(page)).toHaveAttribute("data-kind", "unrecorded", { timeout: 60_000 });
    await expect(page.getByTestId("migration-pending-badge")).toHaveText(
      "migration required · 1 unrecorded change",
    );
    await expect(page.getByTestId("migration-pending-destructive")).toHaveCount(0);

    // Record from the badge: the database is now behind the chain.
    await page.getByTestId("btn-record-migration").click();
    await expect(dialog.getByTestId("record-migration-sql")).toContainText(/ADD COLUMN "phone"/, {
      timeout: 60_000,
    });
    await recordFromDialog(page, "add-phone");
    await expect(badge(page)).toHaveAttribute("data-kind", "recorded-not-applied", { timeout: 60_000 });
    await expect(page.getByTestId("migration-pending-badge")).toHaveText(
      "migration recorded · 1 migration not applied",
    );

    // Apply: regenerate, bundle, boot — the boot applies exactly that entry,
    // the badge clears, and the row is still there.
    await page.getByTestId("btn-apply-migrations").click();
    await expect(badge(page)).toHaveCount(0, { timeout: 600_000 });
    await expect(page.getByTestId("backend-status")).toHaveText("booted", { timeout: 600_000 });
    await runSql(page, "SELECT name, phone FROM sales.customers");
    await expect(page.getByTestId("migrated-status")).toHaveText("1 migration applied");
    await expect(page.getByTestId("migrated-list")).toContainText("_sales_add_phone");
    await expect(page.getByTestId("sql-result")).toContainText("Ada");
    await expect(page.getByTestId("sql-result")).toContainText("phone");
  });
});

test("Boot leaves the database alone while a change is unrecorded, and its notice opens the Record dialog", async ({
  page,
}) => {
  test.setTimeout(1_800_000);
  await wipeStorage(page);
  if (!(await browserCanReachNetwork(page))) {
    test.skip(true, "browser cannot reach the npm registry from this environment");
  }
  await recordInitialMigration(page);
  await bundleAndBoot(page, "booted");

  // An unrecorded change: Boot leaves the database as it is.
  await editSource(page, (s) => s.replace("email: string", "email: string\n        phone: string?"));
  await page.getByTestId("btn-generate").click();
  await expect
    .poll(() => generatorOutput(page), { timeout: 60_000 })
    .toMatch(/schema changes not recorded in migrations\//);
  await bundleAndBoot(page, "migration required");
  await expect(page.getByTestId("boot-migration-pending")).toHaveAttribute("data-kind", "unrecorded");
  await expect(page.getByTestId("boot-migration-pending-message")).toContainText(
    "1 unrecorded schema change in module Sales. The database was left as it is.",
  );
  await page.getByTestId("boot-migration-record").click();
  await expect(page.getByTestId("record-migration-dialog")).toContainText(/ADD COLUMN "phone"/, {
    timeout: 60_000,
  });
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

test("the strip's migration badge plans against the project entry while a non-entry file is open", async ({
  page,
}) => {
  await wipeStorage(page);
  await expect(badge(page)).toHaveAttribute("data-kind", "unrecorded", { timeout: 60_000 });
  await expect(badge(page)).toHaveAttribute("data-initial", "true");

  // A new file opens in the editor; it declares no `system`, so the check
  // must keep planning against main.ddd rather than the open file.
  await page.getByTestId("explorer-mode").getByText("User code").click();
  await page.getByTestId("source-files-add").click();
  await page.getByTestId("source-files-new-file").click();
  await page.getByTestId("source-files-name").fill("grade.ddd");
  await page.getByTestId("source-files-submit").click();
  await expect(page.getByTestId("source-files-tree").getByText("grade.ddd", { exact: true })).toBeVisible();

  // Past the check's debounce: the badge still reports main.ddd's plan.
  await page.waitForTimeout(3_000);
  await expect(badge(page)).toHaveAttribute("data-kind", "unrecorded");
  await expect(page.getByTestId("migration-pending-badge")).toHaveText("migration required · initial schema");
});

// The playground's migration chain, end to end in the browser: record the
// Initial, evolve the model, record each change, and see the chain status, the
// destructive gate and the workspace's `migrations/` files follow.
//
// Pure client-side (build worker + git store), no network.

import { expect, type Page, test } from "@playwright/test";
import { waitForPlaygroundReady } from "./_helpers";

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

test("generate refuses unrecorded changes, renders the chain once they are recorded", async ({
  page,
}) => {
  await wipeStorage(page);
  await openMigrations(page);
  await expect(status(page)).toContainText("No migrations/ yet", { timeout: 30_000 });
  await record(page, "initial");

  // An unrecorded change: generate refuses and says how to fix it.
  await editSource(page, (s) => s.replace("email: string", "email: string\n        phone: string?"));
  await page.getByTestId("btn-generate").click();
  await expect
    .poll(() => generatorOutput(page), { timeout: 60_000 })
    .toMatch(/schema changes not recorded in migrations\/.*Migrations tab → Record migration/s);

  // Recorded: generate succeeds and the project carries both migrations.
  await openMigrations(page);
  await record(page, "add-phone");
  await page.getByTestId("btn-generate").click();
  await page.getByTestId("explorer-mode-generated").click();
  const download = page.waitForEvent("download");
  await page.getByText("Download .zip").click({ timeout: 60_000 });
  const zip = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of zip) chunks.push(c as Buffer);
  const names = Buffer.concat(chunks).toString("latin1");
  expect(names).toMatch(/db\/migrations\/\d+_sales_initial\.sql/);
  expect(names).toMatch(/db\/migrations\/\d+_sales_add_phone\.sql/);
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

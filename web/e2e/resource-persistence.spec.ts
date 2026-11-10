// The resource fakes persist like the PGlite storages: an object put into the
// fake S3 (and files, and mail) is still there after a page reload and a
// re-boot, and the database Reset clears it.  Needs real internet (npm), like
// runtime.spec.ts.

import { expect, type Page, test } from "./_test";
import {
  browserCanReachNetwork,
  recordInitialMigration,
  selectExample,
  waitForBundle,
  waitForPlaygroundReady,
} from "./_helpers";

type InfraCall = (service: string, op: string, params?: unknown) => Promise<unknown>;

const infra = (page: Page, service: string, op: string, params?: unknown) =>
  page.evaluate(
    ([s, o, p]) => (window as unknown as { __loomInfraService: InfraCall }).__loomInfraService(s as string, o as string, p),
    [service, op, params],
  );

// Persistence is the subject: the fakes' state lives beside an OPFS cluster.
test.use({ pgliteStorage: "opfs" });

const OBJECT = "https://persist-bucket.s3.us-east-1.amazonaws.com/keep/me.txt";

async function generateBundleBoot(page: Page): Promise<void> {
  await page.getByTestId("btn-generate").click();
  await expect(page.getByText(/generated \d+ file\(s\)/)).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("btn-bundle").click();
  await waitForBundle(page);
  await page.getByTestId("devtools-tab-backend").click();
  await page.getByTestId("btn-boot").click();
  await expect(page.getByTestId("backend-status")).toHaveText("booted", { timeout: 600_000 });
}

const listObjects = (page: Page) => infra(page, "s3", "list") as Promise<{ key: string }[]>;

test("objects and mail survive a reload; database Reset clears them", async ({ page }) => {
  await page.goto("/");
  await waitForPlaygroundReady(page);
  await selectExample(page, /Sales System/);
  if (!(await browserCanReachNetwork(page))) test.skip(true, "browser cannot reach the npm registry");

  await recordInitialMigration(page);
  await generateBundleBoot(page);

  await test.step("store an object and a mail", async () => {
    await infra(page, "s3", "http", {
      method: "PUT",
      url: OBJECT,
      headers: { "content-type": "text/plain" },
      body: new TextEncoder().encode("still here"),
    });
    await infra(page, "mailbox", "capture", { via: "smtp", from: "a@x.test", to: ["b@x.test"], subject: "kept", text: "t" });
    expect((await listObjects(page)).map((o) => o.key)).toEqual(["keep/me.txt"]);
  });

  await test.step("reload and boot again: both are still there", async () => {
    await page.waitForTimeout(3_000); // let the queued OPFS writes land
    await page.reload();
    await waitForPlaygroundReady(page);
    await generateBundleBoot(page);
    expect((await listObjects(page)).map((o) => o.key)).toEqual(["keep/me.txt"]);
    const got = (await infra(page, "s3", "http", { method: "GET", url: OBJECT, headers: {}, body: [] })) as {
      status: number;
      headers: Record<string, string>;
    };
    expect(got.status).toBe(200);
    expect(got.headers["content-type"]).toBe("text/plain");
    const mail = (await infra(page, "mailbox", "list")) as { subject: string }[];
    expect(mail.map((m) => m.subject)).toEqual(["kept"]);
  });

  await test.step("Reset database empties the object store and the Mailbox", async () => {
    await page.getByTestId("runtime-subview").getByText("Database").click();
    await page.getByTestId("btn-wipe").click();
    await page.getByRole("button", { name: "Yes, clear all rows" }).click();
    await expect.poll(async () => (await listObjects(page)).length, { timeout: 30_000 }).toBe(0);
    expect(await infra(page, "mailbox", "list")).toEqual([]);
  });
});

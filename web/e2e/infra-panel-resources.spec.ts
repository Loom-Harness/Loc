// The Infrastructure panel's Mailbox, Object store and REST mock tabs on a
// booted system: the Resource fakes example's deployable sends mail, writes
// objects and files, and calls an external API, and each tab shows what it
// did — read from the infra worker, the one copy the deployable used.  The
// tab's own actions (clear, upload, delete, override) are checked against the
// deployable too.  One boot serves all three tabs (a step each).  Needs real
// internet (npm), like resource-fakes.spec.ts.

import { expect, type Page, test } from "./_test";
import { browserCanReachNetwork, recordAndGenerate, startFromExample, waitForBundle } from "./_helpers";

type InfraCall = (service: string, op: string, params?: unknown) => Promise<unknown>;

const infra = (page: Page, service: string, op: string, params?: unknown) =>
  page.evaluate(
    ([s, o, p]) => (window as unknown as { __loomInfraService: InfraCall }).__loomInfraService(s as string, o as string, p),
    [service, op, params],
  );

/** GetObject on desk-files over the S3 wire — the request the deployable's SDK makes. */
async function wireGet(page: Page, key: string): Promise<{ status: number; text: string }> {
  const res = (await infra(page, "s3", "http", {
    method: "GET",
    url: `https://desk-files.s3.us-east-1.amazonaws.com/${key}`,
    headers: {},
    body: new Uint8Array(),
  })) as { status: number; body: Uint8Array };
  return { status: res.status, text: res.status === 200 ? Buffer.from(Object.values(res.body)).toString("utf8") : "" };
}

async function send(page: Page, endpoint: RegExp, name = "alpha"): Promise<void> {
  await page.getByTestId("devtools-tab-backend").click();
  await page.getByTestId("req-endpoint").click();
  await page.getByRole("option", { name: endpoint }).click();
  await page.getByTestId("req-pathparam-name").fill(name);
  await page.getByTestId("btn-send").click();
}

async function expectStatus(page: Page, status: RegExp): Promise<void> {
  await expect(page.getByTestId("resp-status")).toContainText(status, { timeout: 30_000 });
}

async function openTab(page: Page, id: string): Promise<void> {
  await page.getByTestId("devtools-tab-infra").click();
  await expect(page.getByTestId("infra-panel")).toHaveAttribute("data-booted", "true");
  await page.getByTestId(`infra-tab-${id}`).click();
}

test("infrastructure panel: mailbox, object store and REST mocks follow the deployable", async ({ page }) => {
  test.setTimeout(900_000);
  await page.goto("/");
  await startFromExample(page, /Resource fakes/);
  if (!(await browserCanReachNetwork(page))) test.skip(true, "browser cannot reach the npm registry");
  await recordAndGenerate(page);
  await page.getByTestId("btn-bundle").click();
  await waitForBundle(page);
  await page.getByTestId("devtools-tab-backend").click();
  await page.getByTestId("btn-boot").click();
  await expect(page.getByTestId("backend-status")).toHaveText("booted", { timeout: 600_000 });

  await test.step("tab list: every resource tab is declared, the emulated badge explains itself", async () => {
    await page.getByTestId("devtools-tab-infra").click();
    for (const id of ["mailbox", "storage", "restApi"]) {
      await expect(page.getByTestId(`infra-tab-${id}`)).toHaveAttribute("data-declared", "true");
    }
    await page.getByTestId("infra-tab-mailbox").click();
    await page.getByTestId("infra-panel-mailbox").getByTestId("infra-emulated").hover();
    await expect(page.getByTestId("infra-emulated-notes")).toContainText(/No mail leaves the browser/);
  });

  await test.step("mailbox: lists, reads and clears what the deployable sent", async () => {
    await send(page, /^POST \/(api\/)?notes\/\{name\}$/);
    await expectStatus(page, /200/);
    await send(page, /^POST \/(api\/)?campaign\/\{name\}$/);
    await expectStatus(page, /200/);

    await openTab(page, "mailbox");
    const rows = page.getByTestId("mailbox-row");
    await expect(rows.filter({ hasText: "smtp: alpha" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "sendgrid: alpha" })).toHaveCount(1);

    await rows.filter({ hasText: "smtp: alpha" }).click();
    await expect(page.getByTestId("mailbox-subject")).toHaveText("smtp: alpha");
    await expect(page.getByTestId("mailbox-from")).toContainText("desk@example.test");
    await expect(page.getByTestId("mailbox-to")).toContainText("ada@example.test");
    await expect(page.getByTestId("mailbox-via")).toContainText("via smtp");
    await expect(page.getByTestId("mailbox-text")).toHaveText("Note alpha via smtp");

    // An HTML body renders in a frame with no script, no same-origin.
    await infra(page, "mailbox", "capture", {
      via: "smtp",
      from: "desk@example.test",
      to: ["ada@example.test"],
      subject: "html mail",
      text: "plain twin",
      html: "<h1 id='h'>Hello</h1><script>document.getElementById('h').textContent='ran'</script>",
    });
    await rows.filter({ hasText: "html mail" }).click();
    const frame = page.getByTestId("mailbox-html");
    await expect(frame).toHaveAttribute("sandbox", "");
    await expect(page.frameLocator("[data-testid=mailbox-html]").locator("#h")).toHaveText("Hello");

    await page.getByTestId("mailbox-clear").click();
    await expect(page.getByTestId("mailbox-empty")).toBeVisible();
    expect(await infra(page, "mailbox", "list")).toEqual([]);
  });

  await test.step("object store: browse, view, download, upload and delete the deployable's objects", async () => {
    await send(page, /^POST \/(api\/)?notes\/\{name\}$/);
    await expectStatus(page, /200/);
    await send(page, /^POST \/(api\/)?vault\/\{name\}$/);
    await expectStatus(page, /200/);

    await openTab(page, "storage");
    await page.getByTestId("storage-store").filter({ hasText: "s3://desk-files" }).click();
    await page.getByTestId("storage-folder").filter({ hasText: "notes/" }).getByRole("button").click();
    const alpha = page.locator('[data-testid=storage-object][data-key="notes/alpha"]');
    await expect(alpha).toBeVisible();
    await expect(alpha.getByTestId("storage-object-size")).toHaveText(`${JSON.stringify("alpha").length} B`);

    await alpha.getByTestId("storage-object-name").click();
    await expect(page.getByTestId("storage-view-body")).toHaveText(JSON.stringify("alpha"));

    const [download] = await Promise.all([page.waitForEvent("download"), alpha.getByTestId("storage-download").click()]);
    // The browser adds the extension of the object's content type (application/json).
    expect(download.suggestedFilename()).toMatch(/^alpha(\.json)?$/);
    const path = await download.path();
    expect(path && (await import("node:fs")).readFileSync(path, "utf8")).toBe(JSON.stringify("alpha"));

    // An uploaded object is the deployable's to read: its SDK's GetObject
    // (the S3 wire the fake answers) returns it.
    await page.getByTestId("storage-upload-input").setInputFiles({
      name: "beta",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify("uploaded")),
    });
    await expect(page.locator('[data-testid=storage-object][data-key="notes/beta"]')).toBeVisible();
    expect(await wireGet(page, "notes/beta")).toEqual({ status: 200, text: JSON.stringify("uploaded") });

    // Deleting one takes it from the deployable too: its GetObject is a 404.
    await openTab(page, "storage");
    await alpha.getByTestId("storage-delete").click();
    await expect(alpha).toHaveCount(0);
    const left = (await infra(page, "s3", "list")) as { key: string }[];
    expect(left.map((o) => o.key)).toEqual(["notes/beta"]);
    expect((await wireGet(page, "notes/alpha")).status).toBe(404);

    // localDisk: walk the folders down to the file the deployable wrote.
    await openTab(page, "storage");
    await page.getByTestId("storage-store").filter({ hasText: "localDisk" }).click();
    const doc = page.locator('[data-testid=storage-object][data-key$="docs_alpha"]');
    for (let depth = 0; depth < 8 && !(await doc.isVisible()); depth++) {
      await page.getByTestId("storage-folder").first().getByRole("button").click();
    }
    await expect(doc).toBeVisible();
    await doc.getByTestId("storage-object-name").click();
    await expect(page.getByTestId("storage-view-body")).toHaveText(JSON.stringify("alpha"));
  });

  await test.step("REST mocks: logs the deployable's call, and an override changes its answer", async () => {
    await infra(page, "httpMock", "clearLog");
    await send(page, /^POST \/(api\/)?notes\/\{name\}$/, "gamma");
    await expectStatus(page, /200/);

    await openTab(page, "restApi");
    const row = page.getByTestId("rest-row").filter({ hasText: "https://fx.example.test/rate/usd" });
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId("rest-row-status")).toHaveText("200");
    await row.click();
    await expect(page.getByTestId("rest-row-response")).toContainText('"ccy"');

    await page.getByTestId("rest-override-operation").click();
    await page.getByRole("option", { name: /GET \/rate\/\{ccy\}/ }).click();
    await page.getByTestId("rest-override-status").fill("503");
    await page.getByTestId("rest-override-body").fill('{ "down": true }');
    await page.getByTestId("rest-override-set").click();
    await expect(page.getByTestId("rest-override")).toContainText("503");

    await send(page, /^POST \/(api\/)?notes\/\{name\}$/, "delta");
    await expect(page.getByTestId("resp-status")).toBeVisible();
    await openTab(page, "restApi");
    const overridden = page.getByTestId("rest-row").filter({ has: page.getByTestId("rest-row-overridden") });
    await expect(overridden).toHaveCount(1);
    await expect(overridden.getByTestId("rest-row-status")).toHaveText("503");
    const log = (await infra(page, "httpMock", "log")) as { status: number; overridden: boolean }[];
    expect(log.at(-1)).toMatchObject({ status: 503, overridden: true });

    await page.getByTestId("rest-override-clear").click();
    await expect(page.getByTestId("rest-override")).toHaveCount(0);
    expect(await infra(page, "httpMock", "overrides")).toEqual([]);
  });
});

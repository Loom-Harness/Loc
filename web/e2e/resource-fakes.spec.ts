// Emulated resource kinds: a Node backend wired to s3, localDisk, smtp, ses,
// sendgrid and an external REST API runs in the browser with every one of them
// answered by the infra worker's fakes.  Each leg asserts an observable effect
// (an object read back over S3, a captured mail, a written file, a mocked
// response), not just a 2xx.  Needs real internet (npm), like runtime.spec.ts.

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

/** Assert a 200; on any other status, surface the backend's own error log so a
 *  failing fake is diagnosable from CI output alone. */
async function expectOk(page: Page): Promise<void> {
  try {
    await expect(page.getByTestId("resp-status")).toContainText("200", { timeout: 30_000 });
  } catch (e) {
    await page.getByRole("tab", { name: /^Output/ }).click();
    await page.getByTestId("output-stream-select").click();
    await page.getByRole("option", { name: /Runtime logs/i }).click();
    const text = await page.locator("body").innerText();
    console.log(`[resource-fakes] backend log:\n${text.split("\n").filter((l) => /error|ENOENT|failed|not a function|not defined/i.test(l)).slice(0, 12).join("\n")}`);
    throw e;
  }
}

async function send(page: Page, endpoint: RegExp, name = "alpha"): Promise<void> {
  await page.getByTestId("req-endpoint").click();
  await page.getByRole("option", { name: endpoint }).click();
  await page.getByTestId("req-pathparam-name").fill(name);
  await page.getByTestId("btn-send").click();
}

test("resource fakes: object round trip, mail, disk file, REST mock", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await page.goto("/");
  await waitForPlaygroundReady(page);
  await selectExample(page, /Resource fakes/);
  if (!(await browserCanReachNetwork(page))) test.skip(true, "browser cannot reach the npm registry");

  await recordInitialMigration(page);
  await page.getByTestId("btn-generate").click();
  await expect(page.getByText(/generated \d+ file\(s\)/)).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("btn-bundle").click();
  await waitForBundle(page);
  await page.getByTestId("devtools-tab-backend").click();
  await page.getByTestId("btn-boot").click();
  try {
    // Fail on the boot error as soon as it shows, not after the 10-minute wait.
    const bootError = page.getByText(/Boot failed before the API came up/);
    await expect(async () => {
      if (await bootError.isVisible()) {
        throw new Error(`boot failed: ${await page.getByTestId("runtime-subview").innerText().catch(() => "")}`);
      }
      await expect(page.getByTestId("backend-status")).toHaveText("booted", { timeout: 2_000 });
    }).toPass({ timeout: 600_000, intervals: [2_000] });
  } catch (e) {
    console.log(`[resource-fakes] errors:\n${consoleErrors.map((m) => `  ${m.slice(0, 400)}`).join("\n")}`);
    throw e;
  }

  await test.step("s3: put through the real SDK, read back through the fake", async () => {
    await send(page, /^POST \/(api\/)?notes\/\{name\}$/);
    await expectOk(page);
    const objects = (await infra(page, "s3", "list")) as { bucket: string; key: string }[];
    expect(objects).toEqual([expect.objectContaining({ bucket: "desk-files", key: "notes/alpha" })]);
    await send(page, /^GET \/(api\/)?notes\/\{name\}$/);
    await expectOk(page);
  });

  await test.step("restApi: the external call was answered by the mock", async () => {
    expect(await infra(page, "httpMock", "log")).toEqual([{ method: "GET", url: "https://fx.example.test/rate/usd" }]);
  });

  await test.step("smtp: the mail lands in the Mailbox", async () => {
    const mail = (await infra(page, "mailbox", "list")) as { via: string; subject: string; to: string[] }[];
    expect(mail.find((m) => m.via === "smtp")).toMatchObject({ subject: "smtp: alpha", to: ["ada@example.test"] });
  });

  await test.step("ses + localDisk: mail captured, file written", async () => {
    await send(page, /^POST \/(api\/)?vault\/\{name\}$/);
    await expectOk(page);
    const mail = (await infra(page, "mailbox", "list")) as { via: string; subject: string }[];
    expect(mail.find((m) => m.via === "ses")).toMatchObject({ subject: "ses: alpha" });
    const files = (await infra(page, "disk", "list")) as { path: string; size: number }[];
    // The generated client writes the bytes plus a `.meta.json` sidecar.
    expect(files.map((f) => f.path.split("/").pop()).sort()).toEqual(["docs_alpha", "docs_alpha.meta.json"]);
    expect(files.find((f) => f.path.endsWith("docs_alpha"))?.size).toBe(JSON.stringify("alpha").length);
  });

  await test.step("sendgrid: mail captured", async () => {
    await send(page, /^POST \/(api\/)?campaign\/\{name\}$/);
    await expectOk(page);
    const mail = (await infra(page, "mailbox", "list")) as { via: string; subject: string }[];
    expect(mail.find((m) => m.via === "sendgrid")).toMatchObject({ subject: "sendgrid: alpha" });
  });

  await test.step("signed URL points at the fake object store and serves the object", async () => {
    await send(page, /^GET \/(api\/)?notes\/\{name\}\/link$/);
    await expectOk(page);
    const body = (await page.getByTestId("resp-body").textContent()) ?? "";
    expect(body).toContain("X-Amz-Signature");
    // The fake serves the presigned GET: signature params are accepted, the object comes back.
    const url = JSON.parse(body) as string;
    const served = (await infra(page, "s3", "http", { method: "GET", url, headers: {}, body: [] })) as {
      status: number;
      body: Record<string, number>;
    };
    expect(served.status).toBe(200);
    expect(JSON.parse(String.fromCharCode(...Object.values(served.body)))).toBe("alpha");
  });
});

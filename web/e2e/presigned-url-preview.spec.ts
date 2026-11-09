// A presigned S3 URL fetched by the generated frontend inside the preview
// iframe is answered by the playground's object store, not the internet: the
// iframe's fetch shim forwards it over the bridge port to the infra worker's
// `s3` service.  Needs real internet (npm), like runtime.spec.ts.

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

const SIGNED =
  "https://desk-files.s3.us-east-1.amazonaws.com/notes/hello.txt" +
  "?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIATEST%2F20260101%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Signature=abc";

test("presigned S3 URL from the preview iframe reaches the object store", async ({ page }) => {
  await page.goto("/");
  await waitForPlaygroundReady(page);
  await selectExample(page, /Sales System/);
  if (!(await browserCanReachNetwork(page))) test.skip(true, "browser cannot reach the npm registry");

  await recordInitialMigration(page);
  await page.getByTestId("btn-generate").click();
  await expect(page.getByText(/generated \d+ file\(s\)/)).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("btn-bundle").click();
  await waitForBundle(page);
  await page.getByTestId("devtools-tab-backend").click();
  await page.getByTestId("btn-boot").click();
  await expect(page.getByTestId("backend-status")).toHaveText("booted", { timeout: 600_000 });
  await expect(page.frameLocator('[data-testid="preview-iframe"]').getByText(/Products|Orders|Home/i).first()).toBeVisible({
    timeout: 60_000,
  });

  const handle = await page.locator('[data-testid="preview-iframe"]').elementHandle();
  const frame = await handle?.contentFrame();
  expect(frame, "preview iframe frame").toBeTruthy();

  await test.step("PUT through the iframe lands in the object store", async () => {
    const status = await frame!.evaluate(
      async (url) => { const r = await fetch(url, { method: "PUT", body: "from the iframe" }); return r.status === 200 ? 200 : `${r.status} ${await r.text()}`; },
      SIGNED,
    );
    expect(status).toBe(200);
    const objects = (await infra(page, "s3", "list")) as { bucket: string; key: string }[];
    expect(objects).toEqual([expect.objectContaining({ bucket: "desk-files", key: "notes/hello.txt" })]);
  });

  await test.step("GET through the iframe returns the stored bytes", async () => {
    const text = await frame!.evaluate(async (url) => (await fetch(url)).text(), SIGNED);
    expect(text).toBe("from the iframe");
  });
});

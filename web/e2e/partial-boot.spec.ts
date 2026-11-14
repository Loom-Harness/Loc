// A system the browser can run only part of ("Mixed backends"): `shipping_svc`
// is a Node backend, `orders_svc` is ASP.NET.  Boot starts the Node one; the
// Runtime panel lists the ASP.NET one as not runnable in the playground with
// the reason; and the Node backend's call into it through its typed client
// fails with that reason — it never goes to the network or hangs.
// Needs real internet (npm), like runtime.spec.ts.

import { expect, type Page, test } from "./_test";
import { browserCanReachNetwork, recordAndGenerate, startFromExample, waitForBundle } from "./_helpers";

interface Dispatched {
  ok: boolean;
  message?: string;
  response?: { status: number; body: string };
}

const dispatch = (page: Page, target: string, method: string, path: string, body?: unknown): Promise<Dispatched> =>
  page.evaluate(
    ([t, m, p, b]) =>
      (
        window as unknown as {
          __loomDispatch: (t: string, m: string, p: string, b?: unknown) => Promise<Dispatched>;
        }
      ).__loomDispatch(t as string, m as string, p as string, b ?? undefined),
    [target, method, path, body ?? null] as const,
  );

test("partial boot: the Node backend runs, the ASP.NET one is listed with why, and a call into it fails with that reason", async ({
  page,
}) => {
  test.setTimeout(900_000);
  const logs: string[] = [];
  page.on("console", (m) => logs.push(m.text()));
  await page.goto("/");
  await startFromExample(page, /Mixed backends/);
  if (!(await browserCanReachNetwork(page))) test.skip(true, "browser cannot reach the npm registry");

  await recordAndGenerate(page);
  await page.getByTestId("btn-bundle").click();
  await waitForBundle(page);
  await page.getByTestId("devtools-tab-backend").click();
  await page.getByTestId("btn-boot").click();
  await expect(page.getByTestId("backend-status")).toHaveText("booted", { timeout: 600_000 });

  await test.step("the Node backend answers", async () => {
    const res = await dispatch(page, "shipping_svc", "GET", "/api/shipments");
    expect(res.ok, res.message).toBe(true);
    expect(res.response?.status).toBe(200);
  });

  await test.step("the ASP.NET deployable is listed as not runnable, with the reason", async () => {
    await expect(page.getByTestId("deployable-state-shipping_svc")).toHaveText("booted");
    await expect(page.getByTestId("deployable-state-orders_svc")).toHaveText("not runnable in the playground");
    await expect(page.getByTestId("deployable-reason-orders_svc")).toContainText("runs outside the playground");
  });

  await test.step("a call into it fails with that reason, promptly", async () => {
    const started = Date.now();
    const res = await dispatch(page, "shipping_svc", "POST", "/api/workflows/placeOrder", { code: "ORD-1" });
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(res.response?.status ?? 0).toBeGreaterThanOrEqual(500);
    // The generated backend logs the failed outbound call; the reason names
    // the deployable and why it is not running.
    await expect
      .poll(() => logs.some((l) => /orders_svc.*not running in the playground.*runs outside the playground/.test(l)), {
        timeout: 15_000,
      })
      .toBe(true);
    // Nothing was stored: the workflow failed before its write.
    const shipments = await dispatch(page, "shipping_svc", "GET", "/api/shipments");
    expect(JSON.parse(shipments.response?.body ?? "{}").total).toBe(0);
  });
});

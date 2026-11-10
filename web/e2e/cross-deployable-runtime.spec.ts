// Backend → backend HTTP: `shippingSvc` calls `ordersSvc` over a typed api
// resource.  The caller's `ORDERS_URL` (from the generated compose file) names
// `http://orders_svc:3000`; the playground routes that address to the other
// deployable's app, each running in its own worker.  Needs real internet, like
// runtime.spec.ts.

import { expect, type Page, test } from "./_test";
import {
  browserCanReachNetwork,
  recordAndGenerate,
  startFromExample,
  waitForBundle,
} from "./_helpers";

async function pickTarget(page: Page, slug: string): Promise<void> {
  await page.getByTestId("req-target").click();
  await page.getByRole("option", { name: slug, exact: true }).click();
  await expect(page.getByTestId("req-target")).toHaveValue(slug);
}

async function pickEndpoint(page: Page, name: RegExp): Promise<void> {
  await page.getByTestId("req-endpoint").click();
  await page.getByRole("option", { name }).click();
}

async function setBody(page: Page, json: string): Promise<void> {
  await page.waitForFunction(
    () => typeof (window as unknown as { __loomSetRequestBody?: unknown }).__loomSetRequestBody === "function",
  );
  await page.evaluate(
    (t) => (window as unknown as { __loomSetRequestBody?: (t: string) => void }).__loomSetRequestBody?.(t),
    json,
  );
  await expect(page.getByTestId("req-body")).toContainText(json.slice(1, 8));
}

test("cross-deployable: shippingSvc reads and writes ordersSvc through its api client", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  await page.goto("/");
  await startFromExample(page, /Cross-deployable call/);

  if (!(await browserCanReachNetwork(page))) {
    test.skip(true, "browser cannot reach the npm registry from this environment");
  }

  await recordAndGenerate(page);
  await page.getByTestId("btn-bundle").click();
  await waitForBundle(page);
  await page.getByTestId("devtools-tab-backend").click();
  await page.getByTestId("btn-boot").click();
  try {
    await expect(page.getByTestId("backend-status")).toHaveText("booted", { timeout: 600_000 });
  } catch (e) {
    console.log(`[cross-deployable] errors:\n${consoleErrors.map((m) => "  " + m.slice(0, 400)).join("\n")}`);
    throw e;
  }

  let orderId = "";
  await test.step("POST /orders on ordersSvc → the order the caller will read", async () => {
    await pickTarget(page, "orders_svc");
    await pickEndpoint(page, /^POST \/(api\/)?orders$/);
    await setBody(page, JSON.stringify({ code: "ORD-7", status: "Draft" }));
    await page.getByTestId("btn-send").click();
    await expect(page.getByTestId("resp-status")).toContainText("201", { timeout: 30_000 });
    orderId = JSON.parse((await page.getByTestId("resp-body").textContent()) ?? "{}").id;
    expect(orderId).toBeTruthy();
  });

  await test.step("fulfil on shippingSvc → reads ORD-7 over HTTP, stores a shipment", async () => {
    await pickTarget(page, "shipping_svc");
    // The endpoint picker lists the first backend's spec only (#4780), so the
    // workflow's route is typed in.
    await page.getByTestId("req-method").click();
    await page.getByRole("option", { name: "POST", exact: true }).click();
    await page.getByTestId("req-path").fill("/api/workflows/fulfil");
    await setBody(page, JSON.stringify({ orderId }));
    await page.getByTestId("btn-send").click();
    await expect(page.getByTestId("resp-status")).toContainText(/20\d/, { timeout: 30_000 });
  });

  await test.step("GET /shipments on shippingSvc → carries the callee's order code", async () => {
    await page.getByTestId("req-method").click();
    await page.getByRole("option", { name: "GET", exact: true }).click();
    await page.getByTestId("req-path").fill("/api/shipments");
    await page.getByTestId("btn-send").click();
    await expect(page.getByTestId("resp-status")).toContainText("200", { timeout: 30_000 });
    const parsed = JSON.parse((await page.getByTestId("resp-body").textContent()) ?? "{}");
    expect(parsed.total).toBe(1);
    expect(parsed.items[0].orderCode).toBe("ORD-7");
  });
});

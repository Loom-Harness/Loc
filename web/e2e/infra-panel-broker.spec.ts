// The infra panel's Broker tab on a booted example: two Node backends on one
// channel per broker kind (the "Broker channels" example).  The deployables
// publish and consume; the tab must show what the one emulated broker holds —
// redis subscribers, rabbitmq queues and the dead-letter queue, kafka consumer
// groups with their committed offsets — and its actions must reach the broker:
// a test message published from the tab is consumed by both backends, a
// re-drive puts dead letters back on the address, a seek replays a group.
// Needs real internet (npm), like channels-broker.spec.ts.

import { expect, type Page, test } from "./_test";
import { openInfraTab } from "./_infra-panel";
import { browserCanReachNetwork, recordAndGenerate, startFromExample, waitForBundle } from "./_helpers";

interface Dispatched {
  ok: boolean;
  message?: string;
  response?: { status: number; body: string };
}

async function json<T>(page: Page, target: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = (await page.evaluate(
    ([t, m, p, b]) =>
      (
        window as unknown as {
          __loomDispatch: (t: string, m: string, p: string, b?: unknown) => Promise<unknown>;
        }
      ).__loomDispatch(t, m, p, b ?? undefined),
    [target, method, path, body ?? null] as const,
  )) as Dispatched;
  if (!res.ok || !res.response || res.response.status >= 300) {
    throw new Error(`${method} ${path} on ${target}: ${res.message ?? `${res.response?.status} ${res.response?.body}`}`);
  }
  return (res.response.body ? JSON.parse(res.response.body) : null) as T;
}

async function sightings(page: Page, target: "admin" | "storefront"): Promise<string[]> {
  const res = await json<{ items: { channel: string; sku: string }[] }>(page, target, "GET", "/api/sightings?pageSize=100");
  return res.items.map((s) => `${s.channel}:${s.sku}`).sort();
}

async function launch(page: Page, sku: string): Promise<void> {
  const created = await json<{ id: string }>(page, "admin", "POST", "/api/products", { sku, name: sku });
  await json(page, "admin", "POST", `/api/products/${created.id}/launch`, {});
}

test("infra panel — Broker tab shows and manages the emulated brokers", async ({ page }) => {
  test.setTimeout(900_000);
  await page.goto("/");
  await startFromExample(page, /Broker channels/);
  if (!(await browserCanReachNetwork(page))) test.skip(true, "browser cannot reach the npm registry");

  await recordAndGenerate(page);
  await page.getByTestId("btn-bundle").click();
  await waitForBundle(page);
  await page.getByTestId("devtools-tab-backend").click();
  await page.getByTestId("btn-boot").click();
  await expect(page.getByTestId("backend-status")).toHaveText("booted", { timeout: 600_000 });

  await test.step("the deployables' traffic shows up: subscribers, queues, groups and offsets", async () => {
    await launch(page, "WIDGET");
    await expect.poll(() => sightings(page, "storefront"), { timeout: 30_000 }).toContain("kafka:WIDGET");
    await openInfraTab(page, "broker");
    const tab = page.getByTestId("infra-broker");
    await tab.getByTestId("infra-emulated").hover();
    await expect(page.getByTestId("infra-emulated-notes")).toContainText("kafka: an offset reset");
    await expect(
      tab.locator('[data-testid="infra-broker-redis-channel"][data-name="loom.Catalog.Announcements"]'),
    ).toContainText(/admin.*storefront|storefront.*admin/);
    await expect(tab.locator('[data-testid="infra-broker-queue"][data-name="loom.Catalog.Listings.admin"]')).toBeVisible();
    const history = tab.locator('[data-testid="infra-broker-topic"][data-name="loom.Catalog.History"]');
    // One record consumed by each group: its committed offsets sum to 1.
    for (const client of ["admin", "storefront"]) {
      const group = history.locator(`[data-testid="infra-broker-group"][data-group="loom.Catalog.History.${client}"]`);
      await expect(group).toContainText(client);
      await expect
        .poll(async () =>
          (await group.getByTestId("infra-broker-offset").allInnerTexts())
            .map((t) => Number(t.split("/")[0]))
            .reduce((a, b) => a + b, 0),
        )
        .toBe(1);
    }
    // The retained record, body included.
    await history.getByTestId("infra-broker-topic-toggle").click();
    await expect(history.getByTestId("infra-broker-message")).toHaveCount(1);
    await expect(history.getByTestId("infra-broker-message")).toContainText('"sku":"WIDGET"');
  });

  await test.step("a test message published from the tab is consumed by both backends", async () => {
    const tab = page.getByTestId("infra-broker");
    await tab.getByTestId("infra-broker-publish-address").selectOption("kafka loom.Catalog.History");
    await expect(tab.getByTestId("infra-broker-publish-type")).toHaveValue("Catalog.ProductLogged");
    await tab
      .getByTestId("infra-broker-publish-data")
      .fill(JSON.stringify({ product: "11111111-1111-4111-8111-111111111111", sku: "FROMTAB" }));
    await tab.getByTestId("infra-broker-publish-send").click();
    await expect.poll(() => sightings(page, "admin"), { timeout: 30_000 }).toContain("kafka:FROMTAB");
    await expect.poll(() => sightings(page, "storefront"), { timeout: 30_000 }).toContain("kafka:FROMTAB");
    await expect(
      tab.locator('[data-testid="infra-broker-topic"][data-name="loom.Catalog.History"] [data-testid="infra-broker-message"]'),
    ).toHaveCount(2);
  });

  await test.step("dead letters are listed and re-driven onto their address", async () => {
    await launch(page, "POISON");
    const tab = page.getByTestId("infra-broker");
    const dlq = tab.locator('[data-testid="infra-broker-queue"][data-name="loom.dlq.loom.Catalog.Listings"]');
    await expect(dlq.getByTestId("infra-broker-queue-counts")).toContainText("2 ready", { timeout: 30_000 });
    await dlq.getByTestId("infra-broker-queue-toggle").click();
    await expect(dlq.getByTestId("infra-broker-message")).toHaveCount(2);
    await expect(dlq.getByTestId("infra-broker-message").first()).toContainText('"sku":"POISON"');
    await dlq.getByTestId("infra-broker-redrive").click();
    await expect(tab.locator('[data-testid="infra-broker-journal"][data-kind="redriven"]')).toHaveCount(2);
    // A re-drive republishes to the address's exchange, so both groups' queues
    // receive each of the two messages again; still poison, each copy is
    // retried and parked once more: four dead letters.
    await expect(tab.locator('[data-testid="infra-broker-journal"][data-kind="retried"]').first()).toBeVisible();
    await expect(dlq.getByTestId("infra-broker-queue-counts")).toContainText("4 ready", { timeout: 30_000 });
  });

  await test.step("a seek replays a kafka group from the start", async () => {
    const tab = page.getByTestId("infra-broker");
    const group = tab.locator('[data-testid="infra-broker-group"][data-group="loom.Catalog.History.storefront"]');
    const storefrontDeliveries = async (): Promise<number> =>
      (
        await page.evaluate(() =>
          (
            window as unknown as {
              __loomInspectBroker: () => Promise<{ journal: { kind: string; address: string; client: string | null }[] }>;
            }
          ).__loomInspectBroker(),
        )
      ).journal.filter((j) => j.kind === "delivered" && j.address === "loom.Catalog.History" && j.client === "storefront")
        .length;
    const before = await storefrontDeliveries();
    await group.getByTestId("infra-broker-seek-earliest").click();
    // The broker journals one `seeked` line per moved partition: all three.
    await expect(tab.locator('[data-testid="infra-broker-journal"][data-kind="seeked"]')).toHaveCount(3);
    // The group re-consumes its three retained records.
    await expect.poll(storefrontDeliveries, { timeout: 30_000 }).toBe(before + 3);
  });
});

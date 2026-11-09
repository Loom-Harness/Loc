// Two Node backends on one channel of each broker kind (redis, rabbitmq,
// kafka), with the brokers emulated in the infra worker: one broker state,
// reached by a stateless `ChannelTransport` facade in each deployable.
//
//   redis     broadcast reaches both backends; a backend that is down misses it
//   rabbitmq  each consumer group (one per backend) gets a message once; a
//             reaction that keeps failing lands in loom.dlq.<address>
//   kafka     each group gets every record once; a backend that was down
//             replays what it missed from the retained log
//
// The model's finer semantics (competing members of ONE group, prefetch,
// new-group start offsets) are pinned without a browser in
// test/web/broker-model.test.ts.  Needs real internet, like runtime.spec.ts.

import { expect, type Page, test } from "./_test";
import {
  browserCanReachNetwork,
  recordInitialMigration,
  selectExample,
  waitForBundle,
  waitForPlaygroundReady,
} from "./_helpers";

interface Dispatched {
  ok: boolean;
  message?: string;
  response?: { status: number; body: string };
}

interface Journal {
  kind: string;
  transport: string;
  address: string;
  type: string;
  id: string;
  client: string | null;
  group?: string | null;
}

interface BrokerState {
  rabbitmq: { queues: { name: string; ready: number; messages: { type: string }[] }[] };
  kafka: { topics: { name: string; groups: { group: string; offsets: number[] }[] }[] };
  journal: Journal[];
  emulated: { transport: string; note: string }[];
}

interface Sighting {
  channel: string;
  sku: string;
}

async function call(page: Page, target: string, method: string, path: string, body?: unknown): Promise<Dispatched> {
  return page.evaluate(
    ([t, m, p, b]) =>
      (
        window as unknown as {
          __loomDispatch: (t: string, m: string, p: string, b?: unknown) => Promise<Dispatched>;
        }
      ).__loomDispatch(t, m, p, b ?? undefined),
    [target, method, path, body ?? null] as const,
  );
}

async function json<T>(page: Page, target: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await call(page, target, method, path, body);
  if (!res.ok || !res.response || res.response.status >= 300) {
    throw new Error(`${method} ${path} on ${target}: ${res.message ?? `${res.response?.status} ${res.response?.body}`}`);
  }
  return (res.response.body ? JSON.parse(res.response.body) : null) as T;
}

async function sightings(page: Page, target: "admin" | "storefront"): Promise<string[]> {
  const page_ = await json<{ items: Sighting[] }>(page, target, "GET", "/api/sightings?pageSize=100");
  return page_.items.map((s) => `${s.channel}:${s.sku}`).sort();
}

async function broker(page: Page): Promise<BrokerState> {
  return page.evaluate(() =>
    (window as unknown as { __loomInspectBroker: () => Promise<BrokerState> }).__loomInspectBroker(),
  );
}

async function hook(page: Page, name: "__loomStopDeployable" | "__loomStartDeployable", slug: string) {
  const res = await page.evaluate(
    ([n, s]) => (window as unknown as Record<string, (s: string) => Promise<Dispatched>>)[n]?.(s),
    [name, slug] as const,
  );
  expect(res, `${name}(${slug})`).toMatchObject({ ok: true });
}

/** Create a product through admin and launch it: three events, one per channel. */
async function launch(page: Page, sku: string): Promise<void> {
  const created = await json<{ id: string }>(page, "admin", "POST", "/api/products", { sku, name: sku });
  await json(page, "admin", "POST", `/api/products/${created.id}/launch`, {});
}

const ALL = (sku: string) => [`kafka:${sku}`, `rabbitmq:${sku}`, `redis:${sku}`];

test("channels: redis broadcast, rabbitmq queue + DLQ, kafka log replay across two backends", async ({ page }) => {
  test.setTimeout(900_000);
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  await page.goto("/");
  await waitForPlaygroundReady(page);
  await selectExample(page, /Broker channels/);

  if (!(await browserCanReachNetwork(page))) {
    test.skip(true, "browser cannot reach the npm registry from this environment");
  }

  await test.step("Generate, bundle, boot both backends", async () => {
    await recordInitialMigration(page);
    await page.getByTestId("btn-generate").click();
    await expect(page.getByText(/generated \d+ file\(s\)/)).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("btn-bundle").click();
    await waitForBundle(page);
    await page.getByTestId("devtools-tab-backend").click();
    await page.getByTestId("btn-boot").click();
    try {
      await expect(page.getByTestId("backend-status")).toHaveText("booted", { timeout: 600_000 });
    } catch (e) {
      console.log(`[channels-broker] errors:\n${consoleErrors.map((m) => "  " + m.slice(0, 400)).join("\n")}`);
      throw e;
    }
  });

  await test.step("one launch reaches both backends on every broker, once per group", async () => {
    await launch(page, "WIDGET");
    await expect.poll(() => sightings(page, "admin"), { timeout: 30_000 }).toEqual(ALL("WIDGET"));
    await expect.poll(() => sightings(page, "storefront"), { timeout: 30_000 }).toEqual(ALL("WIDGET"));

    const { journal, emulated } = await broker(page);
    // Every consuming group received each envelope exactly once.
    for (const transport of ["redis", "rabbitmq", "kafka"]) {
      const delivered = journal.filter((j) => j.transport === transport && j.kind === "delivered");
      expect(delivered.map((j) => j.client).sort(), transport).toEqual(["admin", "storefront"]);
      expect(new Set(delivered.map((j) => j.id)).size, transport).toBe(1);
    }
    // What the emulation does differently is stated, not silent.
    expect(emulated.map((e) => e.transport)).toEqual(expect.arrayContaining(["redis", "rabbitmq", "kafka"]));
  });

  await test.step("rabbitmq: a reaction that keeps failing is dead-lettered", async () => {
    await launch(page, "POISON");
    // Each backend's group fails its copy five times, then parks it.
    await expect
      .poll(
        async () =>
          (await broker(page)).rabbitmq.queues.find((q) => q.name === "loom.dlq.loom.Catalog.Listings")?.ready,
        { timeout: 30_000 },
      )
      .toBe(2);
    const { journal, rabbitmq } = await broker(page);
    for (const client of ["admin", "storefront"]) {
      const poisoned = journal.filter(
        (j) => j.transport === "rabbitmq" && j.client === client && j.type === "Catalog.ProductListed",
      );
      expect(poisoned.filter((j) => j.kind === "retried"), client).toHaveLength(4);
      expect(poisoned.filter((j) => j.kind === "dead-lettered"), client).toHaveLength(1);
      expect(rabbitmq.queues.find((q) => q.name === `loom.Catalog.Listings.${client}`)?.ready, client).toBe(0);
    }
    // The other channels' reactions to the same launch are unaffected.
    const expected = ["kafka:POISON", "redis:POISON", ...ALL("WIDGET")].sort();
    await expect.poll(() => sightings(page, "admin"), { timeout: 30_000 }).toEqual(expected);
    await expect.poll(() => sightings(page, "storefront"), { timeout: 30_000 }).toEqual(expected);
  });

  await test.step("a backend that was down: kafka replays, rabbitmq kept the queue, redis is gone", async () => {
    await hook(page, "__loomStopDeployable", "storefront");
    await launch(page, "LATE");
    await expect
      .poll(() => sightings(page, "admin"), { timeout: 30_000 })
      .toEqual([...ALL("LATE"), "kafka:POISON", "redis:POISON", ...ALL("WIDGET")].sort());
    // The kafka record waits in the log, past storefront's committed offset.
    const before = await broker(page);
    const history = before.kafka.topics.find((t) => t.name === "loom.Catalog.History");
    const shopGroup = history?.groups.find((g) => g.group === "loom.Catalog.History.storefront");
    const adminGroup = history?.groups.find((g) => g.group === "loom.Catalog.History.admin");
    const sum = (xs: number[] | undefined) => (xs ?? []).reduce((a, b) => a + b, 0);
    expect(sum(adminGroup?.offsets) - sum(shopGroup?.offsets)).toBe(1);

    await hook(page, "__loomStartDeployable", "storefront");
    await expect
      .poll(() => sightings(page, "storefront"), { timeout: 30_000 })
      .toEqual(["kafka:LATE", "rabbitmq:LATE", "kafka:POISON", "redis:POISON", ...ALL("WIDGET")].sort());
  });

  await test.step("consumers log outside any request, and those lines reach Runtime logs", async () => {
    // Every line below is written by a channel consumer, after the request
    // that raised the event has returned: no RPC is running in that
    // deployable, so only the background flush can carry it.
    await page.getByTestId("devtools-tab-output").click();
    await page.getByTestId("output-stream-select").click();
    await page.getByRole("option", { name: "Runtime logs" }).click();
    const lines = page.getByTestId("output-backend-log-structured");
    for (const address of ["loom.Catalog.Announcements", "loom.Catalog.Listings", "loom.Catalog.History"]) {
      await expect(
        lines.filter({ hasText: "channel_consumed" }).filter({ hasText: address }).and(page.locator('[data-source="storefront"]')).first(),
        `storefront channel_consumed on ${address}`,
      ).toBeAttached({ timeout: 30_000 });
    }
    for (const source of ["admin", "storefront"]) {
      await expect(
        lines.filter({ hasText: "channel_dead_lettered" }).and(page.locator(`[data-source="${source}"]`)).first(),
        `${source} channel_dead_lettered`,
      ).toBeAttached({ timeout: 30_000 });
    }
  });
});

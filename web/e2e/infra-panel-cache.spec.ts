// The infra panel's Cache tab on a booted `kind: cache` example ("Cache"): the
// generated node backend caches single-row reads in redis, which the
// playground answers with its emulated cache (the `ioredis` facade → the infra
// worker's cache service).  The deployable's reads fill the cache; the tab must
// list the key with its remaining TTL and value, and its Evict / Flush must
// reach the cache the deployable reads — its next read is a miss.
// Needs real internet (npm), like runtime.spec.ts.

import { expect, type Page, test } from "./_test";
import { openInfraTab } from "./_infra-panel";
import { browserCanReachNetwork, recordAndGenerate, startFromExample, waitForBundle } from "./_helpers";

interface Dispatched {
  ok: boolean;
  message?: string;
  response?: { status: number; headers: Record<string, string>; body: string };
}

async function send(page: Page, method: string, path: string, body?: unknown) {
  const res = (await page.evaluate(
    ([m, p, b]) =>
      (
        window as unknown as {
          __loomDispatch: (t: string, m: string, p: string, b?: unknown) => Promise<unknown>;
        }
      ).__loomDispatch("api", m as string, p as string, b ?? undefined),
    [method, path, body ?? null] as const,
  )) as Dispatched;
  if (!res.ok || !res.response || res.response.status >= 300) {
    throw new Error(`${method} ${path}: ${res.message ?? `${res.response?.status} ${res.response?.body}`}`);
  }
  return res.response;
}

const cacheHeader = async (page: Page, id: string): Promise<string | undefined> =>
  (await send(page, "GET", `/api/products/${id}`)).headers["x-loom-cache"];

test("infra panel — Cache tab lists, evicts and flushes the emulated redis cache", async ({ page }) => {
  test.setTimeout(900_000);
  await page.goto("/");
  await startFromExample(page, /^Cache \(/);
  if (!(await browserCanReachNetwork(page))) test.skip(true, "browser cannot reach the npm registry");

  await recordAndGenerate(page);
  await page.getByTestId("btn-bundle").click();
  await waitForBundle(page);
  await page.getByTestId("devtools-tab-backend").click();
  await page.getByTestId("btn-boot").click();
  await expect(page.getByTestId("backend-status")).toHaveText("booted", { timeout: 600_000 });

  const created = JSON.parse((await send(page, "POST", "/api/products", { name: "Teapot", price: 42 })).body) as {
    id: string;
  };

  await test.step("the deployable's reads fill the cache: miss, then hit", async () => {
    expect(await cacheHeader(page, created.id)).toBe("miss");
    expect(await cacheHeader(page, created.id)).toBe("hit");
  });

  await test.step("the tab lists the key with its TTL and value", async () => {
    await openInfraTab(page, "cache");
    const tab = page.getByTestId("infra-cache");
    await tab.getByTestId("infra-emulated").hover();
    await expect(page.getByTestId("infra-emulated-notes")).toContainText("least recently used");
    const key = tab.locator(`[data-testid="infra-cache-key"][data-key$=":${created.id}"]`);
    await expect(key).toHaveCount(1);
    await expect(key).toHaveAttribute("data-key", /^demo/);
    // `ttl: 120` — a TTL a little under two minutes, counting down.
    await expect(key.getByTestId("infra-cache-ttl")).toHaveText(/^1m \d\ds$|^2m 00s$/);
    await expect(key.getByTestId("infra-cache-value")).toContainText("Teapot");
    await expect(tab.getByTestId("infra-cache-stats")).toContainText("1 hits");
  });

  await test.step("Evict reaches the cache the deployable reads: its next read misses", async () => {
    const tab = page.getByTestId("infra-cache");
    const key = tab.locator(`[data-testid="infra-cache-key"][data-key$=":${created.id}"]`);
    await key.getByTestId("infra-cache-evict").click();
    await expect(key).toHaveCount(0);
    expect(await cacheHeader(page, created.id)).toBe("miss");
    await expect(key).toHaveCount(1);
  });

  await test.step("Flush all empties it", async () => {
    const tab = page.getByTestId("infra-cache");
    await tab.getByTestId("infra-cache-flush-all").click();
    await expect(tab.getByTestId("infra-cache-key")).toHaveCount(0);
    expect(await cacheHeader(page, created.id)).toBe("miss");
  });
});

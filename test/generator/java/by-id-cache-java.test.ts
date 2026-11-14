// The Java by-id read cache (`resource … { kind: cache }`) — wiring and
// absence claims only.  What the cache DOES (hits, eviction on every write
// path, scope isolation) is the corpus fixture `cache-by-id`'s `test e2e`
// blocks, replayed against the booted Spring backend by the behavioural-java
// leg.  Here: which files exist, which dependency is declared, and what a
// deployable without a cache resource does not carry.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

function system(opts: { storage?: "inMemory" | "redis"; cache: boolean }): string {
  const store = opts.storage ?? "inMemory";
  return `
system Shop {
  user { id: string  tenantId: string  role: string }
  subdomain Sales {
    context Orders {
      aggregate Order with crudish {
        code: string
        notes: string mask unless currentUser.role == "manager"
      }
      repository Orders for Order
    }
  }
  api OrdersApi from Sales
  storage primary { type: postgres }
  storage hot { type: ${store} }
  resource ordersState { for: Orders, kind: state, use: primary }
  ${opts.cache ? "resource ordersCache { for: Orders, kind: cache, use: hot, ttl: 90 }" : ""}
  deployable shopApi {
    platform: java
    contexts: [Orders]
    dataSources: [ordersState${opts.cache ? ", ordersCache" : ""}]
    serves: OrdersApi
    port: 8081
    auth: required
  }
}
`;
}

const ROOT = "shop_api/src/main/java/com/loom/shopapi";
const CONTROLLER = `${ROOT}/features/orders/OrdersController.java`;
const REPO = `${ROOT}/features/orders/OrderRepositoryImpl.java`;
const CACHES = `${ROOT}/config/ByIdCaches.java`;
const GRADLE = "shop_api/build.gradle.kts";

describe("java generator — by-id read cache", () => {
  it("an inMemory cache wires the controller, the repository writes and a map-backed store", async () => {
    const out = await generateSystemFiles(system({ cache: true }));
    const caches = out.get(CACHES)!;
    expect(caches).toContain("static final class MemoryStore implements CacheStore");
    expect(caches).toContain("public static final ByIdCache ORDER = new ByIdCache(");
    expect(caches).toContain(", 90);");
    expect(caches).not.toContain("RedisStore");
    const ctrl = out.get(CONTROLLER)!;
    expect(ctrl).toContain("ByIdCaches.ORDER.read(");
    expect(ctrl).toContain("ByIdCaches.ORDER.write(");
    // The mask reads the caller's role, so the fingerprint carries it.
    expect(ctrl).toContain("(Object) __user.role()");
    const repo = out.get(REPO)!;
    // One eviction in `save`, one in `delete`.
    expect(repo.match(/ByIdCaches\.ORDER\.evictAfterCommit/g)).toHaveLength(2);
    // No second client: an in-process store pulls no dependency.
    expect(out.get(GRADLE)!).not.toContain("lettuce");
  });

  it("a redis cache dials its resource's url and declares the client dependency", async () => {
    const out = await generateSystemFiles(system({ cache: true, storage: "redis" }));
    const caches = out.get(CACHES)!;
    expect(caches).toContain("static final class RedisStore implements CacheStore");
    expect(caches).toContain('System.getenv("ORDERS_CACHE_URL")');
    expect(caches).toContain('"redis://hot:6379"');
    expect(out.get(GRADLE)!).toContain("io.lettuce:lettuce-core");
  });

  it("a store that fails never fails the request: every store call is guarded", async () => {
    const caches = (await generateSystemFiles(system({ cache: true }))).get(CACHES)!;
    expect(caches.match(/catch \(RuntimeException e\)/g)).toHaveLength(3);
    expect(caches).toContain('"cache_unavailable"');
  });

  it("a deployable without a cache resource carries none of it", async () => {
    const out = await generateSystemFiles(system({ cache: false }));
    expect(out.has(CACHES)).toBe(false);
    const ctrl = out.get(CONTROLLER)!;
    expect(ctrl).not.toContain("ByIdCaches");
    expect(ctrl).not.toContain("ObjectMapper");
    expect(out.get(REPO)!).not.toContain("ByIdCaches");
    expect(out.get(GRADLE)!).not.toContain("lettuce");
  });
});

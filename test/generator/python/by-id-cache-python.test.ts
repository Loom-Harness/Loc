import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// The Python by-id read cache (`kind: cache`, src/ir/plan/cache.ts).  What the
// cache DOES — hits, eviction on every write path, scope isolation — is the
// `cache-by-id` corpus fixture's, run against the booted FastAPI backend.  The
// claims here are what no booted run observes: wiring that is absent when no
// cache resource is declared, and the dependency that is added only when used.

const src = (storage: string, withCache: boolean) => `
system C {
  user { id: string  role: string }
  subdomain Core {
    context Main {
      aggregate Doc with crudish { title: string }
    }
  }
  api MainApi from Core
  storage pg { type: postgres }
  storage hot { type: ${storage} }
  resource st { for: Main, kind: state, use: pg }
  ${withCache ? "resource ca { for: Main, kind: cache, use: hot, ttl: 30 }" : ""}
  deployable d {
    platform: python
    contexts: [Main]
    dataSources: [st${withCache ? ", ca" : ""}]
    serves: MainApi
    port: 8000
  }
}
`;

describe("python by-id read cache wiring", () => {
  it("a deployable with no cache resource emits no cache module, route read-through or dependency", async () => {
    const files = await generateSystemFiles(src("redis", false));
    expect([...files.keys()].some((p) => p.endsWith("app/by_id_cache.py"))).toBe(false);
    const routes = files.get("d/app/http/doc_routes.py")!;
    expect(routes).not.toContain("by_id_cache");
    expect(files.get("d/app/main.py")).not.toContain("install_by_id_cache_eviction");
    expect(files.get("d/pyproject.toml")).not.toContain("redis==");
  });

  it("an inMemory cache needs no redis client dependency", async () => {
    const files = await generateSystemFiles(src("inMemory", true));
    expect(files.get("d/app/by_id_cache.py")).toContain("class MemoryStore");
    expect(files.get("d/app/by_id_cache.py")).not.toContain("RedisStore");
    expect(files.get("d/pyproject.toml")).not.toContain("redis==");
  });

  it("a redis cache adds the redis client and installs eviction from the lifespan", async () => {
    const files = await generateSystemFiles(src("redis", true));
    expect(files.get("d/app/by_id_cache.py")).toContain("class RedisStore");
    expect(files.get("d/pyproject.toml")).toContain("redis==");
    expect(files.get("d/app/main.py")).toContain("install_by_id_cache_eviction()");
  });
});

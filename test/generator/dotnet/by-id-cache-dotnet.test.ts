// The .NET by-id read cache (`kind: cache`).  What the cache DOES — hits,
// eviction on every write path, scope isolation — is the corpus fixture
// `cache-by-id` run by the behavioural dotnet / dapper legs.  These pins are
// the claims no booted tier observes: what a deployable without a cache
// resource does NOT emit, which client dependency ships for which storage, and
// that the plan's inputs (not a re-derivation) reach the C#.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const system = (storage: string, extra = "") => `
system Cached {
  user { id: string  tenantId: string  role: string }
  tenancy by user.tenantId of Org
  subdomain Core {
    context Catalog {
      aggregate Org with crudish { name: string }
      aggregate Item with tenantOwned, crudish {
        name: string
        cost: int mask unless currentUser.role == "manager"
      }
    }
  }
  api CatalogApi from Core
  storage primary { type: postgres }
  storage hot { type: ${storage} }
  resource catalogState { for: Catalog, kind: state, use: primary }
  ${extra}
  deployable d {
    platform: dotnet
    contexts: [Catalog]
    dataSources: [catalogState${extra ? ", catalogCache" : ""}]
    serves: CatalogApi
    port: 4000
    auth: required
  }
}
`;

const CACHE = "resource catalogCache { for: Catalog, kind: cache, use: hot, ttl: 90 }";

describe("by-id read cache — dotnet", () => {
  it("a deployable with no cache resource emits no cache module, registration or dependency", async () => {
    const files = await generateSystemFiles(system("inMemory"));
    expect([...files.keys()].filter((p) => p.includes("Caching"))).toEqual([]);
    const program = files.get("d/Program.cs") ?? "";
    expect(program).not.toContain("CacheEvictingRepository");
    expect(program).toContain(
      "builder.Services.AddScoped<D.Domain.Items.IItemRepository, D.Infrastructure.Repositories.ItemRepository>();",
    );
    expect(files.get("d/Api/ItemsController.cs")).not.toContain("_cache");
    expect(files.get("d/D.csproj")).not.toContain("StackExchange.Redis");
  });

  it("an inMemory cache: store, plan prefix + ttl, decorated repositories, no redis client", async () => {
    const files = await generateSystemFiles(system("inMemory", CACHE));
    const mod = files.get("d/Infrastructure/Caching/ByIdCache.cs") ?? "";
    expect(mod).toContain("public static readonly ICacheStore Hot = new MemoryCacheStore();");
    expect(mod).not.toContain("RedisCacheStore");
    expect(mod).toMatch(
      /: base\("Item", CacheStores\.Hot, "cached:catalog:item:[0-9a-f]{8}:", 90,/,
    );
    const program = files.get("d/Program.cs") ?? "";
    expect(program).toContain(
      "CacheEvictingRepository.Wrap<D.Domain.Items.IItemRepository>(sp.GetRequiredService<D.Infrastructure.Repositories.ItemRepository>()",
    );
    // The scope fingerprint reads the principal inputs the plan names.
    const controller = files.get("d/Api/ItemsController.cs") ?? "";
    expect(controller).toContain("new object?[] { _user.User.OperatingOrg, _user.User.Role }");
    expect(files.get("d/D.csproj")).not.toContain("StackExchange.Redis");
  });

  it("a redis cache dials <RESOURCE>_URL with the sidecar fallback and ships the redis client", async () => {
    const files = await generateSystemFiles(system("redis", CACHE));
    const mod = files.get("d/Infrastructure/Caching/ByIdCache.cs") ?? "";
    expect(mod).toContain(
      'new RedisCacheStore(Environment.GetEnvironmentVariable("CATALOG_CACHE_URL") ?? "redis://hot:6379")',
    );
    expect(files.get("d/D.csproj")).toContain('"StackExchange.Redis"');
  });
});

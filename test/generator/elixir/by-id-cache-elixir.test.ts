// The by-id read cache on the Phoenix backend (`src/generator/elixir/vanilla/by-id-cache-emit.ts`).
// What the cache DOES at run time (hits, eviction on every write path, scope
// isolation) is the `cache-by-id` corpus fixture's claim.  These pin what no
// booted tier can observe: which files and dependencies exist only when a
// cache resource is wired (absence / wiring), and that the redis and inMemory
// stores each render only their own client.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const system = (opts: { storage: string; cache: boolean }) => `
system C {
  subdomain Core {
    context Catalog {
      aggregate Item with crudish { name: string }
      aggregate Note with crudish { body: string }
    }
  }
  storage primary { type: postgres }
  storage hot { type: ${opts.storage} }
  resource catalogState { for: Catalog, kind: state, use: primary }
  ${opts.cache ? "resource catalogCache { for: Catalog, kind: cache, use: hot, ttl: 120 }" : ""}
  deployable d {
    platform: elixir
    contexts: [Catalog]
    dataSources: [catalogState${opts.cache ? ", catalogCache" : ""}]
    port: 4000
  }
}
`;

describe("by-id read cache — phoenix", () => {
  it("renders the inMemory store as an ETS-backed process, with no redis client or dep", async () => {
    const files = await generateSystemFiles(system({ storage: "inMemory", cache: true }));
    const cache = files.get("d/lib/d/by_id_cache.ex") ?? "";
    expect(cache).toContain("defmodule D.ByIdCache.Memory do");
    expect(cache).toContain(":ets.new(table");
    expect(cache).toContain("defmodule D.ByIdCache.Item do");
    expect(cache).toContain("defmodule D.ByIdCache.Note do");
    // Absence: nothing dials redis, and no Redix dependency rides in.
    expect(cache).not.toContain("Redix");
    expect(files.get("d/mix.exs")).not.toContain(":redix");
    expect(files.get("d/lib/d/application.ex")).toContain(
      "Supervisor.child_spec({D.ByIdCache.Memory, :d_hot_by_id}, id: :d_hot_by_id)",
    );
  });

  it("renders the redis store as a named Redix connection on the resource's URL env var", async () => {
    const files = await generateSystemFiles(system({ storage: "redis", cache: true }));
    const cache = files.get("d/lib/d/by_id_cache.ex") ?? "";
    expect(cache).toContain('Redix.command(conn, ["GET", key])');
    expect(cache).not.toContain("ByIdCache.Memory");
    expect(files.get("d/mix.exs")).toContain('{:redix, "1.10.0"}');
    expect(files.get("d/lib/d/application.ex")).toMatch(
      /\{Redix, \{System\.get_env\("CATALOG_CACHE_URL"\) \|\| "redis:\/\/hot:6379", \[name: :d_hot_by_id\]\}\}/,
    );
  });

  it("wires the read-through into show and the eviction into every repository write", async () => {
    const files = await generateSystemFiles(system({ storage: "inMemory", cache: true }));
    const controller = files.get("d/lib/d_web/controllers/item_controller.ex") ?? "";
    expect(controller).toContain("D.ByIdCache.Item.read(id, scope)");
    expect(controller).toContain("D.ByIdCache.Item.write(id, scope");
    const repo = files.get("d/lib/d/catalog/item_repository.ex") ?? "";
    for (const write of ["Repo.insert()", "Repo.update(force: true)", "Repo.update(changeset"]) {
      expect(repo, write).toMatch(
        new RegExp(
          `${write.replace(/[().]/g, "\\$&")}[^\\n]*\\n\\s+\\|> D\\.ByIdCache\\.Item\\.evict_written\\(\\)`,
        ),
      );
    }
    const context = files.get("d/lib/d/catalog.ex") ?? "";
    expect(context).toContain(
      "D.Repo.delete!(record)\n        |> D.ByIdCache.Item.evict_written()",
    );
  });

  it("emits nothing of the cache when no cache resource is wired", async () => {
    const files = await generateSystemFiles(system({ storage: "inMemory", cache: false }));
    expect(files.has("d/lib/d/by_id_cache.ex")).toBe(false);
    expect(files.get("d/lib/d/catalog/item_repository.ex")).not.toContain("ByIdCache");
    expect(files.get("d/lib/d_web/controllers/item_controller.ex")).not.toContain("ByIdCache");
    expect(files.get("d/lib/d/application.ex")).not.toContain("ByIdCache");
  });
});

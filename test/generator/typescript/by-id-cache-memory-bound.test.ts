import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IN_MEMORY_CACHE_MAX_ENTRIES } from "../../../src/ir/plan/cache.js";
import { generateSystemFiles } from "../../_helpers/generate.js";

// The inMemory bound (`IN_MEMORY_CACHE_MAX_ENTRIES`, src/ir/plan/cache.ts),
// run, not read: the generated node `cache/by-id-cache.ts` is transpiled and
// driven directly, because no booted tier writes ten thousand ids.  A full
// store skips the write, so the read stays a miss and goes to the database;
// once entries expire, a write drops them and is stored again.  The other four
// backends render the same rule from the same constant
// (`test/system/cache-plan-census.test.ts`).

const SRC = `
system S {
  subdomain D { context C { aggregate Thing with crudish { label: string } } }
  api A from D
  storage primary { type: postgres }
  storage hot { type: inMemory }
  resource cState { for: C, kind: state, use: primary }
  resource cCache { for: C, kind: cache, use: hot, ttl: 30 }
  deployable d { platform: node, contexts: [C], dataSources: [cState, cCache], serves: A, port: 3000 }
}`;

type Cache = {
  read(id: string, scope: string): Promise<{ wire: unknown } | undefined>;
  write(id: string, scope: string, body: string, etag: string | null): Promise<void>;
};

async function loadThingCache(): Promise<Cache> {
  const source = (await generateSystemFiles(SRC)).get("d/cache/by-id-cache.ts")!;
  // The module's imports (the request logger, the repositories its eviction
  // wraps) are stubbed: the store and the cache are what is under test.
  const body = source.replace(/^import .*$/gm, "");
  const stubs = "const requestLog = () => ({ warn() {} });\n";
  const js = ts.transpileModule(stubs + body, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  new Function("exports", js)(exports);
  return exports.thingCache as Cache;
}

const fill = async (cache: Cache, from: number, to: number) => {
  for (let i = from; i < to; i++) await cache.write(`id-${i}`, "[]", `{"n":${i}}`, null);
};

describe("node inMemory by-id cache — the plan's bound", () => {
  afterEach(() => vi.useRealTimers());

  it("holds at most the bound: a write to a full store is skipped and the read falls open", async () => {
    const cache = await loadThingCache();
    await fill(cache, 0, IN_MEMORY_CACHE_MAX_ENTRIES);
    expect(await cache.read("id-0", "[]")).toEqual({ wire: { n: 0 }, etag: null });
    await cache.write("over", "[]", `{"n":-1}`, null);
    expect(await cache.read("over", "[]")).toBeUndefined();
    // A full store still updates an id it already holds.
    await cache.write("id-1", "[]", `{"n":1.5}`, null);
    expect(await cache.read("id-1", "[]")).toEqual({ wire: { n: 1.5 }, etag: null });
  });

  it("drops the expired entries when a write finds the store full", async () => {
    vi.useFakeTimers({ now: 0 });
    const cache = await loadThingCache();
    await fill(cache, 0, IN_MEMORY_CACHE_MAX_ENTRIES);
    vi.setSystemTime(31_000); // past the 30 s ttl
    await cache.write("fresh", "[]", `{"n":7}`, null);
    expect(await cache.read("fresh", "[]")).toEqual({ wire: { n: 7 }, etag: null });
    expect(await cache.read("id-0", "[]")).toBeUndefined();
  });
});

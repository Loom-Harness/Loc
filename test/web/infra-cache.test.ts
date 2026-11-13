import { describe, expect, it } from "vitest";
import { RESOURCE_FACADE_PACKAGES } from "../../web/src/engine/npm/resource-facades.js";
import { CacheModel, type CacheServerInfo, runCommand } from "../../src/emulation/cache.js";
import { createCacheService } from "../../web/src/runtime/infra/cache.js";

// The playground's cache (web/src/runtime/infra/cache.ts over the core's
// src/emulation/cache.ts): the redis a `kind: cache` resource dials, behind the
// `ioredis` facade.  These pin how the redis commands the generated cache
// module sends are parsed (`runCommand`), what the infra panel's Cache tab
// reads (keys per server with their TTL, evict, flush), and the facade; the
// model's own semantics are in the emulation contract (test/emulation).  The browser-level proof is
// web/e2e/infra-panel-cache.spec.ts.

function clock() {
  let t = 1_000_000;
  return {
    now: () => t,
    advance: (ms: number): void => {
      t += ms;
    },
  };
}

describe("cache model — the redis commands the generated cache module sends", () => {
  it("expires a SET PX key at its deadline, not before", () => {
    const c = clock();
    const m = new CacheModel(c.now);
    expect(runCommand(m, "set", ["loom:prices:all:v1:p1", "42", "PX", 1000])).toBe("OK");
    c.advance(999);
    expect(runCommand(m, "get", ["loom:prices:all:v1:p1"])).toBe("42");
    expect(runCommand(m, "pttl", ["loom:prices:all:v1:p1"])).toBe(1);
    c.advance(1);
    expect(runCommand(m, "get", ["loom:prices:all:v1:p1"])).toBeNull();
    expect(runCommand(m, "pttl", ["loom:prices:all:v1:p1"])).toBe(-2);
    expect([m.hits, m.misses]).toEqual([1, 1]);
  });

  it("INCRs a missing version key from 0 and refuses a non-integer", () => {
    const m = new CacheModel();
    expect(runCommand(m, "incr", ["loom:prices:all:version"])).toBe(1);
    expect(runCommand(m, "incr", ["loom:prices:all:version"])).toBe(2);
    runCommand(m, "set", ["k", "abc"]);
    expect(() => runCommand(m, "incr", ["k"])).toThrow(/not an integer/);
  });

  it("honours NX / XX and EX, deletes, and refuses commands it does not emulate", () => {
    const m = new CacheModel();
    expect(runCommand(m, "set", ["a", "1", "XX"])).toBeNull();
    expect(runCommand(m, "set", ["a", "1", "NX"])).toBe("OK");
    expect(runCommand(m, "set", ["a", "2", "NX"])).toBeNull();
    runCommand(m, "set", ["b", "x", "EX", 5]);
    expect(runCommand(m, "pttl", ["b"])).toBe(5000);
    expect(runCommand(m, "del", ["a", "b", "missing"])).toBe(2);
    expect(() => runCommand(m, "hgetall", ["a"])).toThrow(/unknown command 'hgetall'/);
  });

  it("evicts the least recently used key past its capacity", () => {
    const m = new CacheModel(undefined, 2);
    runCommand(m, "set", ["a", "1"]);
    runCommand(m, "set", ["b", "2"]);
    runCommand(m, "get", ["a"]); // a is now the most recent
    runCommand(m, "set", ["c", "3"]);
    expect(m.keys().map((k) => k.key)).toEqual(["a", "c"]);
    expect(m.evictions).toBe(1);
  });
});

describe("cache service — what the Cache tab reads and does", () => {
  it("lists live keys per server with the remaining TTL and a value preview", async () => {
    const c = clock();
    const svc = createCacheService({ now: c.now });
    const cmd = (server: string, name: string, ...args: unknown[]) =>
      svc.handle({ op: "command", params: { server, name, args } }, { client: "api" });
    await cmd("redis://cache:6379/0", "set", "loom:p:all:v1:x", "y".repeat(500), "PX", 60_000);
    await cmd("redis://cache:6379/0", "set", "loom:p:all:v1:gone", "1", "PX", 10);
    await cmd("redis://other:6379/0", "set", "persistent", "v");
    c.advance(1000);
    const { servers, emulated } = (await svc.handle(
      { op: "keys", params: {} },
      { client: null },
    )) as {
      servers: CacheServerInfo[];
      emulated: string[];
    };
    expect(servers.map((s) => [s.server, s.keys.map((k) => [k.key, k.ttlMs, k.size])])).toEqual([
      ["redis://cache:6379/0", [["loom:p:all:v1:x", 59_000, 500]]],
      ["redis://other:6379/0", [["persistent", null, 1]]],
    ]);
    expect(servers[0]?.keys[0]?.preview).toHaveLength(201);
    expect(emulated.length).toBeGreaterThan(0);

    expect(
      await svc.handle(
        { op: "evict", params: { server: "redis://other:6379/0", key: "persistent" } },
        { client: null },
      ),
    ).toEqual({ removed: 1 });
    await svc.handle({ op: "flush", params: { server: "redis://cache:6379/0" } }, { client: null });
    const after = (await svc.handle({ op: "keys", params: {} }, { client: null })) as {
      servers: CacheServerInfo[];
    };
    expect(after.servers.flatMap((s) => s.keys)).toEqual([]);
  });
});

describe("the ioredis facade a bundled cache module imports", () => {
  it("forwards each command to the cache service under the client's server URL", async () => {
    const calls: unknown[][] = [];
    (globalThis as { __loomInfra?: unknown }).__loomInfra = {
      call: async (...a: unknown[]) => {
        calls.push(a);
        return "OK";
      },
    };
    const src = RESOURCE_FACADE_PACKAGES.ioredis as string;
    const mod = (await import(`data:text/javascript,${encodeURIComponent(src)}`)) as {
      default: new (
        url: string,
      ) => {
        set(...a: unknown[]): Promise<unknown>;
        incr(k: string): Promise<unknown>;
        subscribe(c: string): Promise<unknown>;
      };
    };
    const r = new mod.default("redis://cache:6379");
    await r.set("k", "v", "PX", 500);
    await r.incr("ver");
    expect(calls).toEqual([
      [
        "cache",
        "command",
        { server: "redis://cache:6379", name: "set", args: ["k", "v", "PX", 500] },
      ],
      ["cache", "command", { server: "redis://cache:6379", name: "incr", args: ["ver"] }],
    ]);
    await expect(r.subscribe("ch")).rejects.toThrow(/not emulated/);
    delete (globalThis as { __loomInfra?: unknown }).__loomInfra;
  });
});

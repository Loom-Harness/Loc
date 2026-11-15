// The by-id read cache has ONE decision-maker: `src/ir/plan/cache.ts` decides
// which reads are cached, the entry key, the scope fingerprint, the ttl and
// the evicting writes.  A backend that read a cache resource's `ttl` /
// `keyPrefix`, picked out `kind: cache` resources, or spelled the status
// header itself would be composing a key or an eviction set the plan never
// agreed to — and the five backends would drift apart one at a time.
//
// The stored entry is part of the decision too: backends sharing one redis
// read each other's entries, so the envelope (`CACHE_ENTRY`) and the inMemory
// bound (`IN_MEMORY_CACHE_MAX_ENTRIES`) come from the plan, and a by-id cache
// emitter that quotes an envelope field name itself is spelling its own shape.
//
// String census over emitter SOURCE (not emitted text): what it guards is an
// import discipline, which no booted tier can observe.  The cross-backend
// behaviour it protects is witnessed by `cache-by-id-redis`'s `effects.cache`
// golden, which records the stored entries every backend wrote.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

const ROOT = join(__dirname, "..", "..");
const SCANNED = ["src/generator", "src/platform", "src/system"];

/** What only the plan may do. */
const FORBIDDEN: readonly { what: string; re: RegExp }[] = [
  { what: "reads a resource's ttl", re: /\.ttl\b/ },
  { what: "reads a resource's keyPrefix", re: /\.keyPrefix\b/ },
  { what: "picks out `kind: cache` resources", re: /kind\s*===?\s*["']cache["']/ },
  { what: "spells the cache status header", re: /["'`]x-loom-cache["'`]/ },
  { what: "names the evicting writes", re: /evictOn\s*[:=]\s*\[/ },
];

/** The by-id cache emitters: one per backend. */
const CACHE_EMITTERS = [
  "src/generator/typescript/emit/by-id-cache.ts",
  "src/generator/python/by-id-cache-builder.ts",
  "src/generator/java/emit/by-id-cache.ts",
  "src/generator/dotnet/emit/by-id-cache.ts",
  "src/generator/elixir/vanilla/by-id-cache-emit.ts",
] as const;

/** A quoted envelope field name: `"body"`, `'etag'`, or `\"body\"` inside a
 *  string of emitted source. */
const ENVELOPE_LITERAL = /(["']|\\")(body|etag)(["']|\\")/;

function envelopeOffences(files: readonly { path: string; text: string }[]): string[] {
  const out: string[] = [];
  for (const { path, text } of files) {
    if (!/\bCACHE_ENTRY\b/.test(text))
      out.push(`${path} does not spell the entry through CACHE_ENTRY`);
    const rendersMemoryStore = /MemoryStore|MemoryCacheStore|\.Memory do\b/.test(text);
    if (rendersMemoryStore && !/\bIN_MEMORY_CACHE_MAX_ENTRIES\b/.test(text))
      out.push(`${path} renders an inMemory store without IN_MEMORY_CACHE_MAX_ENTRIES`);
    text.split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      if (ENVELOPE_LITERAL.test(line)) out.push(`${path}:${i + 1} quotes an envelope field`);
    });
  }
  return out;
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

function cachePlanOffences(files: readonly { path: string; text: string }[]): string[] {
  const out: string[] = [];
  for (const { path, text } of files) {
    text.split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const f of FORBIDDEN) if (f.re.test(line)) out.push(`${path}:${i + 1} ${f.what}`);
    });
  }
  return out;
}

describe("cache plan census", () => {
  it("no emitter composes a cache key, ttl or eviction set outside src/ir/plan/cache.ts", () => {
    const files = SCANNED.flatMap((d) => tsFiles(join(ROOT, d))).map((p) => ({
      path: relative(ROOT, p),
      text: readFileSync(p, "utf8"),
    }));
    expectReach("emitter source files", files.length, 500);
    expect(cachePlanOffences(files)).toEqual([]);
  });

  it("bites on each forbidden shape", () => {
    const seeded = [
      "const t = ds.ttl ?? 60;",
      "const p = `${ds.keyPrefix}:${id}`;",
      'const caches = sys.dataSources.filter((d) => d.kind === "cache");',
      'c.header("x-loom-cache", "hit");',
      'const read = { evictOn: ["save"] };',
    ].map((text, i) => ({ path: `seed${i}.ts`, text }));
    expect(cachePlanOffences(seeded)).toHaveLength(5);
  });

  it("every by-id cache emitter spells the entry and the inMemory bound through the plan", () => {
    const files = CACHE_EMITTERS.map((p) => ({
      path: p,
      text: readFileSync(join(ROOT, p), "utf8"),
    }));
    expectReach("by-id cache emitters", files.length, 5);
    expect(envelopeOffences(files)).toEqual([]);
  });

  it("bites on a local envelope or an unbounded store", () => {
    const seeded = [
      { path: "own-key.ts", text: 'CACHE_ENTRY;\nconst x = `${a}["body"]`;' },
      { path: "escaped.ts", text: 'CACHE_ENTRY;\nconst x = "{\\"etag\\": null}";' },
      { path: "no-plan.ts", text: "const x = 1;" },
      { path: "unbounded.ts", text: "CACHE_ENTRY;\nclass MemoryStore {}" },
    ];
    expect(envelopeOffences(seeded)).toHaveLength(4);
  });
});
// Gate for D-CACHE-BY-ID (docs/decisions/D-CACHE-BY-ID.md).

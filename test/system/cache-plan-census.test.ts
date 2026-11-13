// The by-id read cache has ONE decision-maker: `src/ir/plan/cache.ts` decides
// which reads are cached, the entry key, the scope fingerprint, the ttl and
// the evicting writes.  A backend that read a cache resource's `ttl` /
// `keyPrefix`, picked out `kind: cache` resources, or spelled the status
// header itself would be composing a key or an eviction set the plan never
// agreed to — and the five backends would drift apart one at a time.
//
// String census over emitter SOURCE (not emitted text): what it guards is an
// import discipline, which no booted tier can observe.

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
});

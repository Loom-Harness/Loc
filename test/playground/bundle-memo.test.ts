// The bundle memo must MISS on any change to the generated tree, a pin, or
// the build options, and expire (its inputs include live-registry ranges).
import { describe, expect, it } from "vitest";
import { BundleMemo, bundleKey } from "../../web/src/engine/npm/bundle-memo.js";

const files = () =>
  new Map<string, string | Uint8Array>([
    ["a.ts", "x"],
    ["b.ts", new Uint8Array([1, 2])],
  ]);
const base = () => ({
  signature: "s",
  generatedFiles: files(),
  rootDeps: { hono: "^4.0.0", zod: "^4.0.0" },
});

describe("bundleKey", () => {
  it("is stable across insertion order", async () => {
    const reordered = {
      ...base(),
      generatedFiles: new Map([...files()].reverse()),
      rootDeps: { zod: "^4.0.0", hono: "^4.0.0" },
    };
    expect(await bundleKey(reordered)).toBe(await bundleKey(base()));
  });
  it.each([
    ["file text", (i: ReturnType<typeof base>) => i.generatedFiles.set("a.ts", "y")],
    [
      "file bytes",
      (i: ReturnType<typeof base>) => i.generatedFiles.set("b.ts", new Uint8Array([1, 3])),
    ],
    ["new file", (i: ReturnType<typeof base>) => i.generatedFiles.set("c.ts", "")],
    [
      "file path",
      (i: ReturnType<typeof base>) => {
        i.generatedFiles.delete("a.ts");
        i.generatedFiles.set("a2.ts", "x");
      },
    ],
    [
      "a pin",
      (i: ReturnType<typeof base>) => {
        i.rootDeps.hono = "^4.1.0";
      },
    ],
    [
      "a dependency",
      (i: ReturnType<typeof base>) => {
        delete (i.rootDeps as Record<string, string>).zod;
      },
    ],
    [
      "build options",
      (i: ReturnType<typeof base>) => {
        i.signature = "s2";
      },
    ],
  ])("misses on a change to %s", async (_n, mutate) => {
    const m = base();
    mutate(m);
    expect(await bundleKey(m)).not.toBe(await bundleKey(base()));
  });
  it("length-prefixes fields (no concatenation collisions)", async () => {
    const a = { signature: "s", rootDeps: {}, generatedFiles: new Map([["ab", "c"]]) };
    const b = { signature: "s", rootDeps: {}, generatedFiles: new Map([["a", "bc"]]) };
    expect(await bundleKey(a)).not.toBe(await bundleKey(b));
  });
});

describe("BundleMemo", () => {
  it("serves a hit, expires after the TTL, and caps its size", () => {
    let t = 0;
    const m = new BundleMemo<number>(1000, () => t);
    m.set("k", 1);
    expect(m.get("k")).toBe(1);
    t = 1000;
    expect(m.get("k")).toBeUndefined();
    for (let i = 0; i < 6; i++) m.set(`k${i}`, i);
    expect(m.get("k0")).toBeUndefined();
    expect(m.get("k5")).toBe(5);
  });
});

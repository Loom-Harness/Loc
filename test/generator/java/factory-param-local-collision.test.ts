// The Java construction factory builds the instance into a local and takes
// each create input as a same-named parameter.  A field (or event-sourced
// `create` parameter) named `e` must not collide with that local: javac
// refuses a local re-declaring a parameter ("variable e is already defined").

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SRC = readFileSync(
  new URL("../../fixtures/corpus/factory-param-local-collision.ddd", import.meta.url),
  "utf8",
).replaceAll("__PLATFORM__", "java");

/** The `public static <T> create(...)` factory — params and body. */
function createFactory(java: string): { params: string[]; body: string } {
  const m = /public static \w+ create\(([^)]*)\) \{\n([\s\S]*?)\n {4}\}/.exec(java);
  if (!m) throw new Error("no public create factory");
  const params = m[1]
    .split(",")
    .map((p) => p.trim().split(/\s+/)[1])
    .filter((p): p is string => !!p);
  return { params, body: m[2] };
}

describe("java construction factory — instance local vs parameter names", () => {
  it("never declares a local that re-declares one of the factory's parameters", async () => {
    const files = await generateSystemFiles(SRC);
    const paths = [...files.keys()].filter((p) => /\/(Point|Tally)\.java$/.test(p));
    expect(paths).toHaveLength(2);
    for (const path of paths) {
      const { params, body } = createFactory(files.get(path)!);
      expect(params, path).toContain("e");
      const local = /var (\w+) = new /.exec(body)?.[1];
      expect(local, path).toBeDefined();
      expect(params, path).not.toContain(local);
      expect(body, path).toContain(`return ${local};`);
    }
  });
});

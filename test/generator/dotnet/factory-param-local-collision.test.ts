// The .NET construction factory builds the instance into a local and takes
// each create input as a same-named parameter.  A field (or event-sourced
// `create` parameter) named `e` must not collide with that local: C# refuses
// a local re-declaring a parameter in the same scope (CS0136).  The local
// steps aside only on a collision, so every other model keeps `var e`.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { factoryLocal } from "../../../src/util/naming.js";
import { generateSystemFiles } from "../../_helpers/index.js";

const SRC = readFileSync(
  new URL("../../fixtures/corpus/factory-param-local-collision.ddd", import.meta.url),
  "utf8",
).replaceAll("__PLATFORM__", "dotnet");

/** The body of `public static <T> Create(...)` — params line through `}`. */
function createFactory(cs: string): { params: string[]; body: string } {
  const m = /public static \w+ Create\(([^)]*)\)\n {4}\{\n([\s\S]*?)\n {4}\}/.exec(cs);
  if (!m) throw new Error("no public Create factory");
  const params = m[1]
    .split(",")
    .map((p) => p.trim().split(/\s+/)[1])
    .filter((p): p is string => !!p);
  return { params, body: m[2] };
}

describe("dotnet construction factory — instance local vs parameter names", () => {
  it("never declares a local that re-declares one of the factory's parameters (CS0136)", async () => {
    const files = await generateSystemFiles(SRC);
    for (const path of ["d/Domain/Points/Point.cs", "d/Domain/Tallies/Tally.cs"]) {
      const cs = files.get(path);
      expect(cs, path).toBeDefined();
      const { params, body } = createFactory(cs!);
      expect(params, path).toContain("e");
      const local = /var (\w+) = new /.exec(body)?.[1];
      expect(local, path).toBeDefined();
      expect(params, path).not.toContain(local);
      expect(body, path).toContain(`return ${local};`);
    }
  });

  it("keeps `e` when no parameter owns it, and walks past every taken name", () => {
    expect(factoryLocal(["name", "qty"])).toBe("e");
    expect(factoryLocal(["e"])).toBe("_e");
    expect(factoryLocal(["e", "_e"])).toBe("__e");
  });
});

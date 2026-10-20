// `scripts/ci-changes.mjs` decides which gated workflows a pull request runs.
// A wrong "no" here is a gate that silently never runs, so its matcher is
// pinned against GitHub's own `paths:` semantics: `**` crosses directories,
// `*` does not, and the LAST matching pattern decides (a `!` excludes).
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs script, no declaration file
import * as changes from "../../scripts/ci-changes.mjs";

describe("ci-changes — glob semantics", () => {
  const { globToRegExp, included, match } = changes;

  it("`**` crosses directories, `*` and `?` do not", () => {
    expect(globToRegExp("src/**").test("src/ir/lower/lower.ts")).toBe(true);
    expect(globToRegExp("src/*").test("src/ir/lower.ts")).toBe(false);
    expect(globToRegExp("src/*.ts").test("src/a.ts")).toBe(true);
    expect(globToRegExp("src/?.ts").test("src/ab.ts")).toBe(false);
    expect(globToRegExp("**/*.ts").test("a.ts")).toBe(true);
    expect(globToRegExp("**/*.ts").test("x/y/a.ts")).toBe(true);
  });

  it("treats regex metacharacters in a path literally", () => {
    expect(globToRegExp("package.json").test("packageXjson")).toBe(false);
    expect(
      globToRegExp(".github/workflows/hono-build.yml").test(".github/workflows/hono-build.yml"),
    ).toBe(true);
  });

  it("the last matching pattern decides, so a later `!` excludes", () => {
    const p = ["src/**", "!src/generator/java/**"];
    expect(included(p, "src/ir/lower.ts")).toBe(true);
    expect(included(p, "src/generator/java/emit.ts")).toBe(false);
    // …and a later positive re-includes, as GitHub's ordering does.
    expect(included([...p, "src/generator/java/pins.ts"], "src/generator/java/pins.ts")).toBe(true);
    expect(included(p, "docs/README.md")).toBe(false);
  });

  it("a workflow runs when ANY changed file reaches it", () => {
    const filters = { a: ["src/**"], b: ["docs/**"], all: ["**"] };
    expect(match(filters, ["src/x.ts", "README.md"])).toEqual({ a: true, b: false, all: true });
    expect(match(filters, [])).toEqual({ a: false, b: false, all: false });
  });

  it("fails open: an unknown file list runs every gate", () => {
    expect(match({ a: ["src/**"], b: ["docs/**"] }, null)).toEqual({ a: true, b: true });
  });
});

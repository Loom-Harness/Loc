// `npm run prequeue` names every merge-queue gate.
//
// Its gate table (scripts/prequeue-gates.mjs) must list exactly the workflows
// the merge queue runs (`queueRequired` rows of merge-queue-required-checks.ts),
// each with a local command that exists or a stated reason it has none, and its
// "does the diff reach this gate" answer must come from the workflow's own
// pull_request path filter.  A gate added to the queue without a prequeue row,
// or a row whose command names a script that is gone, fails here.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { staleSource } from "../../bin/fresh-build.mjs";
import {
  globToRegExp,
  pullRequestPaths,
  QUEUE_GATES,
  reaches,
} from "../../scripts/prequeue-gates.mjs";
import { QUEUE_REQUIRED_CHECKS } from "./merge-queue-required-checks.js";

const workflow = (w: string): string => readFileSync(join(".github/workflows", w), "utf8");
const scripts = (
  JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }
).scripts;

describe("prequeue gate table", () => {
  it("lists exactly the merge queue's gates, under their check names", () => {
    const want = QUEUE_REQUIRED_CHECKS.map((c) => `${c.workflow} :: ${c.check}`).sort();
    const have = QUEUE_GATES.map((g) => `${g.workflow} :: ${g.check}`).sort();
    expect(have).toEqual(want);
  });

  it("gives every gate a local command or the reason it has none", () => {
    const empty = QUEUE_GATES.filter((g) => g.cmds.length === 0 && !g.manual).map(
      (g) => g.workflow,
    );
    expect(empty).toEqual([]);
  });

  it("names only npm scripts that exist", () => {
    const missing = QUEUE_GATES.flatMap((g) => g.cmds)
      .flatMap((c) => [...c.cmd.matchAll(/npm run ([\w:.-]+)/g)].map((m) => m[1]))
      .filter((s) => !Object.hasOwn(scripts, s));
    expect(missing).toEqual([]);
  });

  it("reads a path filter from every gate workflow that declares one", () => {
    for (const g of QUEUE_GATES) {
      const src = workflow(g.workflow);
      const filter = pullRequestPaths(src);
      const declares = /\n {2}pull_request:\n(?: {4}.*\n|\s*#.*\n)*? {4}paths:/.test(src);
      expect(filter === null ? false : filter.length > 0, g.workflow).toBe(declares);
    }
  });

  it("a shared-seam change reaches every frontend build, corpus-elixir, feliz and flutter", () => {
    const reached = (file: string): string[] =>
      QUEUE_GATES.filter((g) => reaches(pullRequestPaths(workflow(g.workflow)), [file])).map(
        (g) => g.workflow,
      );
    for (const seam of ["src/ir/plan/x.ts", "src/system/x.ts", "src/util/x.ts"]) {
      expect(reached(seam), seam).toEqual(
        expect.arrayContaining([
          "generated-react-build.yml",
          "generated-vue-build.yml",
          "generated-svelte-build.yml",
          "generated-angular-build.yml",
          "generated-feliz-build.yml",
          "generated-flutter-build.yml",
          "corpus-elixir-build.yml",
          "elixir-vanilla-build.yml",
          "hono-build.yml",
          "dotnet-build.yml",
          "java-build.yml",
          "python-build.yml",
          "corpus-build.yml",
        ]),
      );
    }
    // A docs-only change reaches only the gates without a path filter.
    expect(reached("docs/README.md").sort()).toEqual(
      QUEUE_GATES.filter((g) => pullRequestPaths(workflow(g.workflow)) === null)
        .map((g) => g.workflow)
        .sort(),
    );
  });

  it("matches GitHub path-filter globs", () => {
    expect(globToRegExp("src/ir/**").test("src/ir/plan/a.ts")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/a.ts")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/x/a.ts")).toBe(false);
    expect(globToRegExp("**/*.md").test("docs/x/a.md")).toBe(true);
    expect(globToRegExp("**/*.md").test("a.md")).toBe(true);
    expect(globToRegExp("package.json").test("web/package.json")).toBe(false);
    const filter = [
      { neg: false, glob: "src/**" },
      { neg: true, glob: "src/cli/**" },
    ];
    expect(reaches(filter, ["src/cli/main.ts"])).toBe(false);
    expect(reaches(filter, ["src/cli/main.ts", "src/ir/a.ts"])).toBe(true);
    expect(reaches(null, ["anything"])).toBe(true);
  });
});

describe("the CLI's stale-build check (bin/fresh-build.mjs)", () => {
  it("names a src file newer than the build, and nothing once the build is newer", () => {
    const root = mkdtempSync(join(tmpdir(), "fresh-build-"));
    try {
      mkdirSync(join(root, "src", "a"), { recursive: true });
      const info = join(root, "tsconfig.tsbuildinfo");
      const file = join(root, "src", "a", "x.ts");
      writeFileSync(info, "{}");
      writeFileSync(file, "export {};");
      const t = Date.now() / 1000;
      utimesSync(info, t - 100, t - 100);
      utimesSync(file, t, t);
      expect(staleSource(root)).toBe(file);
      utimesSync(info, t + 100, t + 100);
      expect(staleSource(root)).toBeNull();
      // A declaration file is not a compiled input.
      writeFileSync(join(root, "src", "y.d.ts"), "export {};");
      utimesSync(join(root, "src", "y.d.ts"), t + 200, t + 200);
      expect(staleSource(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is inert outside a source checkout", () => {
    const root = mkdtempSync(join(tmpdir(), "fresh-build-"));
    try {
      expect(staleSource(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

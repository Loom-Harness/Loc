import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { reactBuildExamples, reactBuildPacks, reactPackId } from "./react-build-cases.js";

// ---------------------------------------------------------------------------
// Drift guard — pure string check, no build, so it runs in the fast
// `npm test` suite (unlike its sibling generated-react-build.test.ts, which
// is excluded).  The workflow's PR / merge-queue slice names examples and
// packs in its `LOOM_REACT_BUILD_CASE` value; the harness throws on a name
// it doesn't know, but only once CI runs it.  Pin the names here so a typo
// or a retired example/pack fails in seconds instead.  The nightly sweep
// passes an empty selection (every example × every pack), so there is no
// second list to drift.
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

const wf = fs.readFileSync(
  path.join(repoRoot, ".github", "workflows", "generated-react-build.yml"),
  "utf-8",
);

/** The non-empty `<ddd>[:<packs>]` specs quoted in the workflow's case expression. */
function sliceSpecs(): string[] {
  const line = wf.split("\n").find((l) => l.trim().startsWith("LOOM_REACT_BUILD_CASE:"));
  expect(line, "workflow sets LOOM_REACT_BUILD_CASE").toBeTruthy();
  // Only the quoted strings that name a `.ddd` are case lists; the others
  // are the event names the expression compares against.
  const quoted = [...(line ?? "").matchAll(/'([^']*)'/g)]
    .map((m) => m[1])
    .filter((q) => q.includes(".ddd"));
  return quoted.flatMap((q) => q.split(";")).filter((s) => s.trim() !== "");
}

describe("React build: the workflow's case list names known examples and packs", () => {
  it("every example in the slice is a harness example", () => {
    const known = new Set(reactBuildExamples.map((e) => e.ddd));
    const specs = sliceSpecs();
    expect(specs.length).toBeGreaterThan(0);
    const unknown = specs.map((s) => s.split(":")[0]).filter((ddd) => !known.has(ddd));
    expect(unknown).toEqual([]);
  });

  it("every pack in the slice is a harness pack", () => {
    const known = new Set(reactBuildPacks.map(reactPackId));
    const named = sliceSpecs().flatMap((s) => {
      const colon = s.indexOf(":");
      return colon === -1 ? [] : s.slice(colon + 1).split(",");
    });
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((p) => !known.has(p.trim()))).toEqual([]);
  });
});

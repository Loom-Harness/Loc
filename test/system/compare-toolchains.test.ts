// The comparison helpers behind `scripts/compare-toolchains.mjs`: a harness
// that reports "0 differences" must be able to report one.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { diagnosticKeys, diffTrees, setDiff } from "../../scripts/compare-toolchains.mjs";

function tree(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmp-tree-"));
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), text);
  }
  return dir;
}

describe("compare-toolchains", () => {
  it("diffs diagnostics as a set, ignoring the model path", () => {
    const d = { severity: "error", code: "loom.x", message: "m", range: { start: 1 }, node: "A" };
    const a = diagnosticKeys({ model: "/base/a.ddd", diagnostics: [d] });
    const b = diagnosticKeys({ model: "/head/a.ddd", diagnostics: [d] });
    expect(setDiff(a, b)).toEqual({ removed: [], added: [] });
    const c = diagnosticKeys({ diagnostics: [{ ...d, message: "other" }] });
    const diff = setDiff(a, c);
    expect(diff.removed).toHaveLength(1);
    expect(diff.added).toHaveLength(1);
  });

  it("reports a changed byte, a missing file and an extra file", () => {
    const a = tree({ "x/a.ts": "1", "b.ts": "2", "gone.ts": "3" });
    const b = tree({ "x/a.ts": "1", "b.ts": "2!", "new.ts": "4" });
    expect(diffTrees(a, b)).toEqual({ files: 3, differing: ["~ b.ts", "- gone.ts", "+ new.ts"] });
    expect(diffTrees(a, a).differing).toEqual([]);
  });
});

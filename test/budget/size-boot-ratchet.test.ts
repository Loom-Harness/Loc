// The fast-suite half of M-T9.23: the size + cold-boot ratchet's decision core,
// the pinned budget file, and the nightly's matrix — all pinned without
// building or booting anything.  (The measuring half is the opt-in
// `test/e2e/size-boot-budget.test.ts`, run by `size-boot-budget.yml`.)

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SIZE_BOOT_CELLS } from "./size-boot-cells.js";
import { type BudgetFile, budgetFailures, evaluateBudget } from "./size-boot-ratchet.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const BUDGET = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "test/budget/size-boot-budget.json"), "utf8"),
) as BudgetFile;

const FILE: BudgetFile = {
  policy: {
    bundle: { growTolerance: 0.05, shrinkTolerance: 0.05 },
    boot: { growTolerance: 0.5, shrinkTolerance: 0.5 },
  },
  entries: {
    "bundle:x": { kind: "bundle", baseline: 1000, measuredOn: "t" },
    "boot:y": { kind: "boot", baseline: 2000, measuredOn: "t" },
  },
};
const all = new Set(["bundle:x", "boot:y"]);

describe("evaluateBudget — the decision table", () => {
  it("passes inside the band on both sides, per kind", () => {
    const v = evaluateBudget(FILE, { "bundle:x": 1049, "boot:y": 1001 }, all);
    expect(v.map((x) => x.status)).toEqual(["ok", "ok"]);
    expect(budgetFailures(v)).toEqual([]);
  });

  it("fails GROWTH past the kind's tolerance (bundle +5%, boot +50%)", () => {
    const v = evaluateBudget(FILE, { "bundle:x": 1051, "boot:y": 3001 }, all);
    expect(v.map((x) => x.status)).toEqual(["grew", "grew"]);
    expect(budgetFailures(v)[0]).toContain("exceeds the budget 1000 by 5.1%");
  });

  it("fails a SHRINK past the tolerance too — the gain must be pinned", () => {
    const v = evaluateBudget(FILE, { "bundle:x": 949, "boot:y": 999 }, all);
    expect(v.map((x) => x.status)).toEqual(["shrank", "shrank"]);
    expect(budgetFailures(v)[0]).toContain("lower the baseline to 949");
  });

  it("the band edges are inclusive", () => {
    const v = evaluateBudget(FILE, { "bundle:x": 1050, "boot:y": 1000 }, all);
    expect(v.map((x) => x.status)).toEqual(["ok", "ok"]);
  });

  it("a measured cell with no budget fails; so does an expected cell that measured nothing", () => {
    const v = evaluateBudget(FILE, { "bundle:new": 5 }, new Set(["bundle:new", "boot:y"]));
    expect(v.map((x) => `${x.key}:${x.status}`)).toEqual([
      "bundle:new:unbudgeted",
      "boot:y:unmeasured",
    ]);
    expect(budgetFailures(v)).toHaveLength(2);
  });

  it("an UNPINNED cell fails every run that measures it, naming the value to pin", () => {
    const file: BudgetFile = {
      ...FILE,
      entries: { "boot:z": { kind: "boot", baseline: null, measuredOn: "unpinned" } },
    };
    const v = evaluateBudget(file, { "boot:z": 1234 }, new Set(["boot:z"]));
    expect(v.map((x) => x.status)).toEqual(["unpinned"]);
    expect(budgetFailures(v)[0]).toContain("set its baseline to 1234");
    // …and an unpinned cell a sharded run did not reach is not "unmeasured".
    expect(evaluateBudget(file, {}, new Set(["boot:z"]))).toEqual([]);
  });

  it("a budgeted cell OUTSIDE this run's shard is not this run's business", () => {
    expect(evaluateBudget(FILE, { "bundle:x": 1000 }, new Set(["bundle:x"]))).toHaveLength(1);
  });
});

describe("the pinned budget file", () => {
  it("budgets exactly the cells the nightly measures", () => {
    expect(Object.keys(BUDGET.entries).sort()).toEqual(SIZE_BOOT_CELLS.map((c) => c.key).sort());
  });

  it("every entry is a positive number of the cell's kind, with provenance", () => {
    for (const cell of SIZE_BOOT_CELLS) {
      const e = BUDGET.entries[cell.key]!;
      expect(e.kind, cell.key).toBe(cell.kind);
      if (e.baseline === null) {
        // Unpinned is allowed only with the reason it could not be measured.
        expect(e.measuredOn, cell.key).toMatch(/^unpinned — /);
      } else {
        expect(e.baseline, cell.key).toBeGreaterThan(0);
      }
      expect(e.measuredOn.length, cell.key).toBeGreaterThan(5);
    }
  });

  it("every FRONTEND bundle is pinned — only a boot cell may wait for its first nightly", () => {
    for (const cell of SIZE_BOOT_CELLS.filter((c) => c.kind === "bundle")) {
      expect(BUDGET.entries[cell.key]!.baseline, cell.key).not.toBeNull();
    }
  });

  it("tolerances are sane: bundles are deterministic, boots are noisy", () => {
    expect(BUDGET.policy.bundle.growTolerance).toBeLessThanOrEqual(0.1);
    expect(BUDGET.policy.boot.growTolerance).toBeLessThanOrEqual(1);
    for (const k of ["bundle", "boot"] as const) {
      expect(BUDGET.policy[k].growTolerance).toBeGreaterThan(0);
      expect(BUDGET.policy[k].shrinkTolerance).toBeGreaterThan(0);
    }
  });
});

describe("size-boot-budget.yml", () => {
  const wf = fs.readFileSync(path.join(repoRoot, ".github/workflows/size-boot-budget.yml"), "utf8");

  it("its matrix shards exactly the budgeted cells", () => {
    const matrix = [...wf.matchAll(/^\s+- '((?:bundle|boot):[^']+)'/gm)].map((m) => m[1]!);
    expect(matrix.sort()).toEqual(SIZE_BOOT_CELLS.map((c) => c.key).sort());
  });

  it("is nightly + label + dispatch — never an unlabeled per-PR gate", () => {
    expect(wf).toMatch(/schedule:\s*\n\s*- cron:/);
    expect(wf).toContain("workflow_dispatch:");
    expect(wf).toContain("contains(github.event.pull_request.labels.*.name, 'run-size-boot')");
    expect(wf).not.toContain("merge_group");
  });
});

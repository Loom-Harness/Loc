// The fast-suite half of M-T3.14: the SAST ruleset's registers and wiring,
// pinned without semgrep.  (The scan itself is the opt-in
// `test/e2e/sast-generated.test.ts`, run nightly by `sast-generated.yml`.)

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";
import { LEAK_SHAPES_ID, sastCorpusFeatures, sourceFor } from "./harness.js";
import { FORBIDDEN_RULES, OIDC_FEATURES, REQUIRED_RULES, SEEDS, TRIAGE } from "./registers.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const RULES_YAML = fs.readFileSync(path.join(repoRoot, "test/sast/loom-auth-tenancy.yml"), "utf8");
const ruleIds = [...RULES_YAML.matchAll(/^\s+- id: ([\w-]+)$/gm)].map((m) => m[1]!);
const familyOf = (id: string): string | undefined => {
  const at = RULES_YAML.indexOf(`- id: ${id}`);
  const next = RULES_YAML.indexOf("- id:", at + 1);
  return /family: (\w+)/.exec(RULES_YAML.slice(at, next < 0 ? undefined : next))?.[1];
};

describe("the SAST ruleset's registers", () => {
  it("the rule ids in the YAML are exactly FORBIDDEN ∪ REQUIRED, each in its declared family", () => {
    expect([...ruleIds].sort()).toEqual([...FORBIDDEN_RULES, ...REQUIRED_RULES].sort());
    for (const id of FORBIDDEN_RULES) expect(familyOf(id), id).toBe("forbidden");
    for (const id of REQUIRED_RULES) expect(familyOf(id), id).toBe("required");
  });

  it("every rule carries a seed — no rule without its standing mutation proof", () => {
    const seeded = new Set(SEEDS.map((s) => s.rule));
    expect(ruleIds.filter((id) => !seeded.has(id))).toEqual([]);
  });

  it("the two historical leaks the authz missions name are seeded on every backend they hit", () => {
    // F2-ADP-1 lived in the .NET EF bypass; audit A1 in the four backends that
    // read a projection's source table directly (EF was never affected — its
    // tenant filter is model-level).
    expect(
      SEEDS.filter((s) => s.rule === "loom-ef-bypass-lifts-every-filter").map((s) => s.backend),
    ).toEqual(["dotnet"]);
    expect(
      SEEDS.filter((s) => s.rule.startsWith("loom-aggregation-without-tenant-floor"))
        .map((s) => s.backend)
        .sort(),
    ).toEqual(["java", "node", "python", "vanilla"]);
  });

  it("every triage row names a FORBIDDEN rule and says why", () => {
    for (const [key, why] of Object.entries(TRIAGE)) {
      const rule = key.split(" @ ")[0]!;
      expect((FORBIDDEN_RULES as readonly string[]).includes(rule), key).toBe(true);
      expect(why.length, key).toBeGreaterThan(30);
    }
  });

  it("the sweep is the authorization/tenancy corpus, and it contains the leak fixtures", () => {
    const ids = sastCorpusFeatures().map((f) => f.id);
    expect(ids.length).toBeGreaterThanOrEqual(15);
    for (const must of [
      ...OIDC_FEATURES,
      "projection-agg-filters",
      "policy-deny",
      "find-bypass",
      "tenancy-owned",
    ]) {
      expect(ids, must).toContain(must);
    }
    for (const s of SEEDS) {
      expect(s.fixture === LEAK_SHAPES_ID || ids.includes(s.fixture), s.id).toBe(true);
    }
  });

  it("the leak-shape fixture generates on all five backends", async () => {
    for (const b of ["node", "dotnet", "java", "python", "vanilla"] as const) {
      const files = await generateSystemFiles(sourceFor(LEAK_SHAPES_ID, b));
      expect(files.size, b).toBeGreaterThan(20);
    }
  });
});

describe("sast-generated.yml", () => {
  const wf = fs.readFileSync(path.join(repoRoot, ".github/workflows/sast-generated.yml"), "utf8");

  it("is nightly + `security` label + dispatch — never an unlabeled per-PR gate", () => {
    expect(wf).toMatch(/schedule:\s*\n\s*- cron:/);
    expect(wf).toContain("workflow_dispatch:");
    expect(wf).toContain("contains(github.event.pull_request.labels.*.name, 'security')");
    expect(wf).not.toContain("merge_group");
  });

  it("installs a pinned semgrep and runs the gated suite", () => {
    expect(wf).toMatch(/pip install[^\n]*semgrep==\d+\.\d+\.\d+/);
    expect(wf).toContain("LOOM_SAST: '1'");
    expect(wf).toContain("npx vitest run test/e2e/sast-generated.test.ts");
  });
});

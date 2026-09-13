// Behavioral-tier `timeout-minutes` ratchet.
//
// WHY THIS EXISTS
// ---------------
// The seven behavioral legs carried four different budgets — 15/15/20/20/20/25/30
// — none of which was derived from a measurement on record. One of them
// (`behavioral-java`, 20m) had drifted *below* the work it was gating and was
// killing ~18 % of its own runs; the other six were over-provisioned by 57–77 %,
// which is its own cost, since an over-wide cap is how long a hung job squats a
// slot out of a ~20-slot pool.
//
// Numbers picked by eye drift back to numbers picked by eye. So the budgets now
// come from a stated rule (docs/ci-gating.md § "Sizing a job's
// `timeout-minutes`"), and live in THREE places that must agree:
//
//   1. the workflow's own `timeout-minutes:` — what GitHub enforces;
//   2. the baseline table in `docs/ci-gating.md` — what a reader is told;
//   3. the `LEGS` table in `ci-budget-report.mjs` — what the re-derivation
//      script compares against when it reports headroom and cap kills.
//
// A bump in one place and not the others is the failure this catches. (2) going
// stale would make the doc lie; (3) going stale would make the *measuring tool*
// report headroom against a budget nobody carries — the worst of the three,
// because it is the one you would consult before changing anything.
//
// It deliberately does NOT re-measure CI at run time: the fast suite must not
// need network or a token. Re-measuring is the script's job, on demand.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");

/**
 * The measured baseline of 2026-09-10, applying
 * `max(10, ceil_to_5min(p95 x 1.5))`. Change a number here only alongside a
 * fresh `node test/behavioral/ci-budget-report.mjs` run, and update the table
 * in docs/ci-gating.md in the same commit.
 */
const BUDGETS: ReadonlyArray<readonly [workflow: string, minutes: number]> = [
  ["behavioral-e2e.yml", 10],
  ["behavioral-e2e-python.yml", 10],
  ["behavioral-e2e-java.yml", 30],
  ["behavioral-e2e-dotnet.yml", 15],
  ["behavioral-e2e-dapper.yml", 15],
  ["behavioral-e2e-mikroorm.yml", 20],
  ["behavioral-e2e-elixir.yml", 20],
];

/**
 * The job-execution p95 each budget above was derived FROM, in seconds, as
 * measured on 2026-09-10 (n=40 for java, n=15 for the rest). Kept so the
 * ratchet can re-run the rule rather than trusting the arithmetic was done
 * right once — the number in the workflow must be what the rule produces from
 * the number in the doc, not merely a number three files agree on.
 */
const MEASURED_P95_SECONDS: Readonly<Record<string, number>> = {
  "behavioral-e2e.yml": 204, // 3m24s
  "behavioral-e2e-python.yml": 277, // 4m37s
  "behavioral-e2e-java.yml": 1186, // 19m46s — censored, see docs/ci-gating.md
  "behavioral-e2e-dotnet.yml": 499, // 8m19s
  "behavioral-e2e-dapper.yml": 434, // 7m14s
  "behavioral-e2e-mikroorm.yml": 635, // 10m35s
  "behavioral-e2e-elixir.yml": 687, // 11m27s
};

const read = (p: string) => readFileSync(path.join(repo, p), "utf8");

/** Every `timeout-minutes:` declared in a workflow file. */
function timeouts(yaml: string): number[] {
  return [...yaml.matchAll(/^\s*timeout-minutes:\s*(\d+)\s*$/gm)].map((m) => Number(m[1]));
}

describe("behavioral tier timeout budgets", () => {
  it.each(BUDGETS)("%s declares timeout-minutes: %i", (workflow, minutes) => {
    const found = timeouts(read(path.join(".github/workflows", workflow)));
    // One job per behavioral workflow, so exactly one budget. A second one
    // appearing means the leg was split — which is a real design change that
    // should come here and restate the rule, not slip through.
    expect(found).toEqual([minutes]);
  });

  it("docs/ci-gating.md's baseline table matches the workflows", () => {
    const doc = read("docs/ci-gating.md");
    for (const [workflow, minutes] of BUDGETS) {
      const leg = workflow.replace(/\.yml$/, "");
      // Row shape: | `behavioral-e2e-java` | 17m56s | ... | 20m | **30m** |
      const row = new RegExp(
        `\\|\\s*\`${leg}\`[^|]*\\|(?:[^|\\n]*\\|){4}\\s*\\*\\*(\\d+)m\\*\\*\\s*\\|`,
      );
      const m = doc.match(row);
      expect(m, `no baseline row for ${leg} in docs/ci-gating.md`).not.toBeNull();
      expect(Number(m?.[1]), `docs/ci-gating.md baseline row for ${leg}`).toBe(minutes);
    }
  });

  it("ci-budget-report.mjs's LEGS table matches the workflows", () => {
    const script = read("test/behavioral/ci-budget-report.mjs");
    for (const [workflow, minutes] of BUDGETS) {
      const entry = new RegExp(`\\["${workflow.replace(/\./g, "\\.")}",\\s*(\\d+)\\]`);
      const m = script.match(entry);
      expect(m, `no LEGS entry for ${workflow} in ci-budget-report.mjs`).not.toBeNull();
      expect(Number(m?.[1]), `ci-budget-report.mjs LEGS entry for ${workflow}`).toBe(minutes);
    }
  });

  it("every budget is what the rule produces from that leg's measured p95", async () => {
    // Imports the real implementation, so the rule cannot be restated here and
    // drift from the one the report prints.
    const { budgetFor } = await import("./ci-budget-report.mjs");
    for (const [workflow, minutes] of BUDGETS) {
      const p95 = MEASURED_P95_SECONDS[workflow];
      expect(p95, `no measured p95 recorded for ${workflow}`).toBeGreaterThan(0);
      expect(budgetFor(p95), `rule applied to ${workflow}'s measured p95 (${p95}s)`).toBe(minutes);
    }
  });

  it("jobExecSeconds skips steps that started but never completed", async () => {
    const { jobExecSeconds } = await import("./ci-budget-report.mjs");
    // The shape that matters, and the reason the filter is not decoration: a
    // job killed at its cap has an IN-FLIGHT step — `started_at` set,
    // `completed_at` null. `new Date(null)` is epoch 0, so subtracting gives a
    // huge NEGATIVE duration; unfiltered, one such step drags a job's total
    // below zero, the `total > 0` guard then drops the whole job, and the leg
    // that is timing out quietly measures as though it never did.
    //
    // (A never-started step, `{null, null}`, contributes 0 either way — testing
    // only that shape looks like coverage and proves nothing. It did, once.)
    const killed = {
      steps: [
        { started_at: "2026-09-10T16:02:45Z", completed_at: "2026-09-10T16:02:48Z" },
        { started_at: "2026-09-10T16:02:48Z", completed_at: "2026-09-10T16:03:01Z" },
        { started_at: "2026-09-10T16:03:01Z", completed_at: null },
        { started_at: null, completed_at: null },
      ],
    };
    expect(jobExecSeconds(killed)).toBe(16);
    expect(jobExecSeconds({})).toBe(0);
  });

  it("covers every behavioral-e2e workflow (a new leg must declare a measured budget)", async () => {
    const { readdirSync } = await import("node:fs");
    const onDisk = readdirSync(path.join(repo, ".github/workflows"))
      .filter((f) => /^behavioral-e2e.*\.yml$/.test(f))
      .sort();
    expect(onDisk).toEqual(BUDGETS.map(([w]) => w).sort());
  });
});

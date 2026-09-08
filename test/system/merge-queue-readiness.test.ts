// Merge-queue readiness ratchet.
//
// WHY THIS EXISTS
// ---------------
// `docs/ci-gating.md` documents the structural fix for "green PR, red `main`
// one merge later": turn on GitHub's merge queue and make the heavy runtime
// gates required checks that run once, on the rebased merge candidate, instead
// of never running on the PR at all.
//
// That flip has one sharp edge. A required status check whose workflow has NO
// `merge_group:` trigger never reports inside the queue — and GitHub waits for
// it. The queue does not fail, it *stalls*, indefinitely, for every PR, until
// someone edits branch protection. The same hazard hides in the smaller cases:
// a required check whose job was renamed, a matrix whose cell names are
// dynamic (`${{ matrix.backend }}`) and therefore un-nameable in branch
// protection, or a rollup job that goes green because it was skipped.
//
// So the required-checks set is written down once, in
// `merge-queue-required-checks.ts`, and this test proves the workflows still
// honour it. Drift becomes a red fast-suite run today, instead of a surprise
// on flip day — the same audit→gate ratchet the repo applies everywhere else
// (docs/audits/quality-audit-2026-08.md §6 R1/R2).
//
// It intentionally does NOT check the live repo settings (a test cannot see
// them). The settings flip stays a documented runbook in docs/ci-gating.md;
// this test guarantees the workflow side of that runbook is true.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REQUIRED_CHECKS } from "./merge-queue-required-checks.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const workflowsDir = path.resolve(here, "../../.github/workflows");

interface JobInfo {
  readonly id: string;
  /** Job-level `name:`, if declared. */
  readonly name?: string;
  readonly needs: readonly string[];
  /** Job-level `if:` with folded continuations flattened onto one line. */
  readonly ifExpr?: string;
}

interface Workflow {
  readonly onKeys: readonly string[];
  readonly jobs: readonly JobInfo[];
}

/**
 * Deliberately small, indentation-disciplined reader for the subset of
 * workflow syntax this ratchet cares about — no YAML parser is resolvable in
 * this repo's dependency tree, and pulling one in for a structural assertion
 * would be a heavier change than the assertion. Every workflow in
 * `.github/workflows/` is 2-space indented with a block-style `on:` and
 * `jobs:`; the "the reader understands every workflow" case below fails loudly
 * if that ever stops holding.
 */
function parseWorkflow(source: string): Workflow {
  const lines = source.split("\n");
  const onKeys: string[] = [];
  const jobs: JobInfo[] = [];

  let section: "on" | "jobs" | null = null;
  let job: { id: string; name?: string; needs: string[]; ifExpr?: string } | null = null;
  // Set while consuming a folded/literal scalar (`if: >-`) so the
  // continuation lines land on the job's `if` expression.
  let foldingIf = false;

  const flush = () => {
    if (job) jobs.push({ ...job, needs: [...job.needs] });
    job = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (/^\s*#/.test(line)) continue;

    // A new top-level key closes whatever section we were in.
    if (/^\S/.test(line)) {
      flush();
      foldingIf = false;
      section = /^on:\s*$/.test(line) ? "on" : /^jobs:\s*$/.test(line) ? "jobs" : null;
      continue;
    }

    if (section === "on") {
      const m = line.match(/^ {2}([A-Za-z_][A-Za-z0-9_]*):/);
      if (m) onKeys.push(m[1]);
      continue;
    }

    if (section !== "jobs") continue;

    const jobStart = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (jobStart) {
      flush();
      foldingIf = false;
      job = { id: jobStart[1], needs: [] };
      continue;
    }
    if (!job) continue;

    if (foldingIf) {
      if (/^ {6}\S/.test(line)) {
        job.ifExpr = `${job.ifExpr ?? ""} ${line.trim()}`.trim();
        continue;
      }
      foldingIf = false;
    }

    const key = line.match(/^ {4}([A-Za-z0-9_-]+):(.*)$/);
    if (!key) continue;
    const [, name, rest] = key;
    const value = rest.trim();

    if (name === "name" && job.name === undefined) job.name = stripQuotes(value);
    else if (name === "if") {
      if (value === ">-" || value === ">" || value === "|" || value === "|-") {
        job.ifExpr = "";
        foldingIf = true;
      } else job.ifExpr = value;
    } else if (name === "needs") {
      if (value.startsWith("[")) {
        job.needs.push(
          ...value
            .replace(/^\[|\]$/g, "")
            .split(",")
            .map((s) => stripQuotes(s.trim()))
            .filter(Boolean),
        );
      } else if (value) job.needs.push(stripQuotes(value));
    }
  }
  flush();
  return { onKeys, jobs };
}

function stripQuotes(s: string): string {
  return s.replace(/^['"]|['"]$/g, "");
}

/** The check-run name GitHub reports for a job: its `name:`, else its id. */
function checkName(job: JobInfo): string {
  return job.name ?? job.id;
}

function load(workflow: string): Workflow {
  return parseWorkflow(readFileSync(path.join(workflowsDir, workflow), "utf8"));
}

describe("merge-queue readiness", () => {
  it("the reader understands every workflow in the repo (block-style on:/jobs:)", () => {
    const files = readdirSync(workflowsDir).filter((f) => f.endsWith(".yml"));
    expect(files.length).toBeGreaterThan(0);
    const unreadable = files.filter((f) => {
      const wf = load(f);
      return wf.onKeys.length === 0 || wf.jobs.length === 0;
    });
    expect(unreadable, "workflows this ratchet cannot read (inline on:/jobs:?)").toEqual([]);
  });

  it("declares no duplicate check names (check-run names are repo-global)", () => {
    const seen = new Map<string, string[]>();
    for (const entry of REQUIRED_CHECKS) {
      const at = seen.get(entry.check) ?? [];
      at.push(entry.workflow);
      seen.set(entry.check, at);
    }
    const dupes = [...seen].filter(([, files]) => files.length > 1);
    expect(dupes, "two required checks share a name").toEqual([]);
  });

  it("lists each workflow at most once", () => {
    const files = REQUIRED_CHECKS.map((c) => c.workflow);
    expect(files.length).toBe(new Set(files).size);
  });

  describe.each(REQUIRED_CHECKS.map((c) => [c.workflow, c] as const))("%s", (workflow, entry) => {
    it("exists", () => {
      expect(existsSync(path.join(workflowsDir, workflow))).toBe(true);
    });

    it("has a `merge_group:` trigger — without it the queue stalls on this check", () => {
      expect(load(workflow).onKeys).toContain("merge_group");
    });

    it(`exposes the required check name "${entry.check}"`, () => {
      const names = load(workflow).jobs.map(checkName);
      expect(names, `jobs in ${workflow}: ${names.join(", ")}`).toContain(entry.check);
    });

    it("does not gate the required job on a `pull_request`-only context", () => {
      const job = load(workflow).jobs.find((j) => checkName(j) === entry.check);
      expect(job).toBeDefined();
      const expr = job?.ifExpr ?? "";
      // The repo's label-guard idiom short-circuits to `true` on
      // merge_group. Anything else that reads `github.event.pull_request`
      // or compares `event_name` to a pull_request/push literal would make
      // the job skip (or misbehave) inside the queue.
      if (expr.includes("github.event.pull_request") || /event_name\s*==/.test(expr)) {
        expect(
          expr.includes("github.event_name != 'pull_request' ||"),
          `job \`${entry.check}\` has a pull_request-shaped if: ${expr}`,
        ).toBe(true);
      }
    });
  });

  describe("rollup jobs", () => {
    const rollups = REQUIRED_CHECKS.filter((c) => c.check.endsWith("-passed"));

    it("cover every workflow whose required check is a rollup", () => {
      // Sanity: the rollups are the matrix/multi-job workflows, so there is
      // at least one per frontend build family plus the runtime matrices.
      expect(rollups.length).toBeGreaterThanOrEqual(10);
    });

    it.each(
      rollups.map((c) => [c.workflow, c.check] as const),
    )("%s → %s is always() over a non-empty needs", (workflow, check) => {
      const job = load(workflow).jobs.find((j) => checkName(j) === check);
      expect(job, `no job named ${check} in ${workflow}`).toBeDefined();
      if (!job) return;
      expect(job.needs.length, `${check} must aggregate other jobs`).toBeGreaterThan(0);
      // `always()` (or the `!cancelled()` variant test.yml uses) is what
      // makes the rollup report red when a needed job failed, instead of
      // being skipped into a silent pass.
      const expr = job.ifExpr ?? "";
      expect(
        /always\(\)/.test(expr) || /!\s*cancelled\(\)/.test(expr),
        `${check} if: "${expr}" — must be always() so a failed need cannot skip it`,
      ).toBe(true);
      // Every `needs` entry must be a real job in the same workflow.
      const ids = new Set(load(workflow).jobs.map((j) => j.id));
      for (const need of job.needs)
        expect(ids, `${check} needs unknown job ${need}`).toContain(need);
    });
  });

  describe("discovery oracles stay OUT of the queue", () => {
    // The mirror image of the ratchet above, and the reason it needs its own
    // test rather than a comment in the workflow.
    //
    // `pairwise.yml`'s `compile` and `schema-load` legs are a DISCOVERY
    // instrument: an all-pairs cover whose job is to reach crossings nobody
    // has generated before. A new failure there is almost never a regression
    // in the PR under test — it is a latent bug the cover has just now
    // reached. Wire that into the merge queue and the instrument's success
    // condition becomes a repo-wide freeze: on 2026-09-07, #2728 added two
    // axes at 06:38 UTC, they found two real latent bugs (TPH × java, paged ×
    // document × elixir), and nothing merged for nine hours because every
    // queue entry ran these legs and failed on findings unrelated to itself.
    //
    // These legs were never in REQUIRED_CHECKS, so the ratchet above never
    // covered them — the `merge_group` arm arrived by a queue-readiness sweep
    // that read "add the trigger everywhere" and did not ask about tier. This
    // test is what makes the next such sweep stop here.
    const DISCOVERY_JOBS = [
      { workflow: "pairwise.yml", jobs: ["compile", "schema-load"] },
    ] as const;

    it.each(
      DISCOVERY_JOBS.flatMap((w) => w.jobs.map((j) => [w.workflow, j] as const)),
    )("%s → `%s` is not reachable from merge_group", (workflow, jobId) => {
      const job = load(workflow).jobs.find((j) => j.id === jobId);
      expect(job, `no job \`${jobId}\` in ${workflow}`).toBeDefined();
      const expr = job?.ifExpr ?? "";
      // The job must be event-gated at all (an absent `if:` would run it on
      // every trigger the workflow declares, merge_group included)…
      expect(expr, `\`${jobId}\` has no if: — it would run in the queue`).not.toBe("");
      // …and must not name merge_group as one of the events it runs on.
      expect(
        /merge_group/.test(expr),
        `\`${jobId}\` if: "${expr}" — a discovery oracle must not gate the merge queue`,
      ).toBe(false);
    });

    it("is not listed in REQUIRED_CHECKS either", () => {
      const listed = REQUIRED_CHECKS.filter((c) =>
        DISCOVERY_JOBS.some((w) => w.workflow === c.workflow),
      );
      expect(listed, "a discovery oracle was promoted into the required set").toEqual([]);
    });
  });

  describe("pr-gate stays IN the queue", () => {
    // The one required check that REQUIRED_CHECKS cannot cover, and therefore
    // the one the `merge_group:` ratchet above never reached.
    //
    // Every other required check is a job, so its name resolves in the manifest
    // (invariant 2). `pr-gate` is posted through the Checks API by the
    // `pr-gate-eval` job, so it has no job of that name and cannot be a row
    // there — and it fell through the gap: required on `main`, never checked
    // for the trigger that makes it reportable in a merge group.
    //
    // The consequence is the manifest's own invariant 1, live: GitHub applies
    // ONE required-checks list to a pull request and to a merge group, so there
    // is no per-context list to leave `pr-gate` out of. Without `merge_group:`
    // it is never posted inside the queue and the entry waits forever. On
    // 2026-09-07 that is exactly what happened — an entry formed, ran its whole
    // sweep green, and sat with zero runs left; `PUT /merge` answered
    // `Required status check "pr-gate" is expected`.
    const evaluatedContexts = () => {
      const src = readFileSync(path.join(workflowsDir, "pr-gate.yml"), "utf8");
      return { onKeys: load("pr-gate.yml").onKeys, src };
    };

    it("declares a `merge_group:` trigger", () => {
      expect(
        evaluatedContexts().onKeys,
        "pr-gate is a required check; without merge_group: every queue entry stalls on it",
      ).toContain("merge_group");
    });

    it("reads the merge-group SHA, so the evaluation is of the group and not of nothing", () => {
      // The trigger alone is not enough: the eval script is SHA-driven
      // (`scripts/pr-gate.mjs` reads HEAD_SHA), and on a merge_group payload
      // both `pull_request` and `workflow_run` are empty.
      expect(evaluatedContexts().src).toContain("github.event.merge_group.head_sha");
    });

    it("lets completions from inside the group re-evaluate it", () => {
      // The merge_group arm fires once, when the group forms and everything
      // else is still pending. If queue refs are filtered out of the
      // `workflow_run` arm, nothing ever moves that verdict off `in_progress`
      // and the trigger buys nothing.
      const { src } = evaluatedContexts();
      const ignore = src.slice(src.indexOf("branches-ignore:"));
      const block = ignore.slice(0, ignore.indexOf("workflows:"));
      expect(
        /gh-readonly-queue/.test(block),
        "pr-gate ignores merge-queue refs again — its verdict can never leave in_progress",
      ).toBe(false);
    });
  });

  it("keeps test.yml's pre-existing `tests passed` rollup intact", () => {
    // Branch protection already requires this one; renaming the job would
    // silently drop the only required check the repo has today.
    const job = load("test.yml").jobs.find((j) => j.id === "tests-passed");
    expect(job).toBeDefined();
    expect(job?.name).toBe("tests passed");
    expect(job?.needs).toEqual(["test", "corpus", "lint"]);
  });
});

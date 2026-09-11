// Pins the decision core of scripts/pr-gate.mjs (v2, event-driven) — the
// aggregate required check that substitutes for a merge queue on this
// personal-account repo (docs/ci-gating.md).  The gate's claim is "any
// triggered red blocks, path-skipped is fine, pending is never green, and
// every workflow completion re-evaluates"; each arm below is the
// seeded-defect proof for one clause.
//
// The second half pins pr-gate.yml's `workflow_run.workflows` list against
// the real workflow inventory: a workflow missing from that list completes
// WITHOUT re-evaluating the gate, so a PR can stick at in_progress until an
// unrelated event — the v2 equivalent of v1's silent-timeout class.

import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain-JS module without a declaration file; the runtime
// shape is pinned by the assertions below.
import {
  API_MAX_ATTEMPTS,
  apiFetch,
  currentGateState,
  evaluate,
  evaluateOnce,
  existingGateRunId,
  fetchCheckRuns,
  isRetryableStatus,
  latestPerName,
  liveRuns,
  publishCheck,
  retryDelayMs,
  SELF_NAMES,
  shouldWatchTail,
  sweepShouldPost,
  TAIL_BUDGET_MS,
  TAIL_PENDING_MAX,
  TAIL_POLL_MS,
  verdict,
  watchTail,
} from "../../scripts/pr-gate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const workflowsDir = path.join(repoRoot, ".github/workflows");

interface CheckRun {
  id?: number;
  name: string;
  status: string;
  conclusion: string | null;
  suite?: number;
}

const run = (name: string, status: string, conclusion: string | null = null): CheckRun => ({
  name,
  status,
  conclusion,
});

const green = (name: string): CheckRun => run(name, "completed", "success");

const evalRuns = (runs: CheckRun[]) => evaluate(runs, SELF_NAMES);

describe("evaluate — one snapshot's classification", () => {
  it("passes success, neutral and skipped; fails failure and cancelled", () => {
    const { failed, pending } = evalRuns([
      green("a"),
      run("b", "completed", "neutral"),
      run("c", "completed", "skipped"),
      run("d", "completed", "failure"),
      run("e", "completed", "cancelled"),
    ]);
    expect(pending).toEqual([]);
    expect(failed).toEqual(["d", "e"]);
  });

  it("fails closed on a conclusion it has never heard of", () => {
    expect(evalRuns([run("x", "completed", "some_future_conclusion")]).failed).toEqual(["x"]);
    expect(evalRuns([run("y", "completed", null)]).failed).toEqual(["y"]);
  });

  it("excludes only its own check names — a FAILING pr-gate run is not self-fulfilling", () => {
    // Both the API-posted check (`pr-gate`) and the eval job's own check
    // (`pr-gate-eval`, cancelled by per-SHA concurrency collapses) must be
    // invisible to the verdict.
    const { total, failed } = evalRuns([
      run("pr-gate", "completed", "failure"),
      run("pr-gate-eval", "completed", "cancelled"),
      green("a"),
    ]);
    expect(total).toBe(1);
    expect(failed).toEqual([]);
  });

  it("reports queued and in_progress runs as pending", () => {
    const { pending } = evalRuns([run("a", "queued"), run("b", "in_progress"), green("c")]);
    expect(pending).toEqual(["a", "b"]);
  });
});

// The stale-suite bug (observed on #2467 and #2477, 2026-08-10).  Both PRs sat
// permanently red with EVERY component check green, because a SHA can carry
// more than one check suite and the API's `filter=latest` only dedupes WITHIN
// one.  The trigger is the flow CLAUDE.md prescribes: open a draft, then mark
// it ready.  The ready-flip fires a second event on the SAME head SHA, the new
// suite's `cancel-in-progress` kills the draft suite mid-flight, and the gate's
// fail-closed "cancelled counts as FAILED" rule then reads the corpse.
//
// It is unrecoverable by design-of-the-bug: the cancelled run never changes, so
// every re-evaluation and every sweep re-derives the same red.  Only a
// force-push to a fresh SHA cleared it, which is why it has to be fixed here
// rather than worked around per PR.
describe("latestPerName — a SHA can carry more than one check suite", () => {
  it("keeps the newest run per name, dropping a superseded suite's corpse", () => {
    const collapsed = latestPerName([
      { id: 1, name: "build", status: "completed", conclusion: "cancelled" },
      { id: 2, name: "build", status: "completed", conclusion: "success" },
    ]);
    expect(collapsed).toEqual([
      { id: 2, name: "build", status: "completed", conclusion: "success" },
    ]);
  });

  it("is order-independent — the corpse loses whichever way the API lists it", () => {
    // The API does not promise an order, so the fix cannot rely on one.
    const newest = { id: 2, name: "build", status: "completed", conclusion: "success" };
    const corpse = { id: 1, name: "build", status: "completed", conclusion: "cancelled" };
    expect(latestPerName([newest, corpse])).toEqual([newest]);
    expect(latestPerName([corpse, newest])).toEqual([newest]);
  });

  it("still lets a genuinely failed NEWEST run condemn the SHA", () => {
    // The point is not "ignore cancellations" — it is "read the live suite".
    // A re-run that fails after an earlier success must still fail closed.
    const { failed } = evalRuns([
      { id: 1, name: "build", status: "completed", conclusion: "success" },
      { id: 2, name: "build", status: "completed", conclusion: "failure" },
    ]);
    expect(failed).toEqual(["build"]);
  });

  it("does not double-count a name across suites in the total", () => {
    const { total } = evalRuns([
      { id: 1, name: "build", status: "completed", conclusion: "cancelled" },
      { id: 2, name: "build", status: "completed", conclusion: "success" },
    ]);
    expect(total).toBe(1);
  });

  it("REGRESSION: the draft-then-ready SHA is green, not permanently red", () => {
    // The exact shape of #2477: a draft suite cancelled wholesale by the
    // ready-flip, and a live suite in which everything passed.  Before the fix
    // this returned `failure` naming all three, and no later event could undo
    // it.  This is the assertion that fails if the dedupe is reverted.
    const draftSuite: CheckRun[] = [
      { id: 10, name: "tests passed", status: "completed", conclusion: "cancelled" },
      { id: 11, name: "pages-passed", status: "completed", conclusion: "cancelled" },
      { id: 12, name: "flutter-build", status: "completed", conclusion: "cancelled" },
    ];
    const liveSuite: CheckRun[] = [
      { id: 20, name: "tests passed", status: "completed", conclusion: "success" },
      { id: 21, name: "pages-passed", status: "completed", conclusion: "success" },
      { id: 22, name: "flutter-build", status: "completed", conclusion: "success" },
    ];
    expect(verdict(evalRuns([...draftSuite, ...liveSuite]))).toEqual({
      state: "success",
      summary: "all 3 triggered check(s) passed",
    });
  });

  it("reads the gate's OWN state from the newest posting too", () => {
    // `pr-gate` posts a fresh check run per evaluation, so a busy SHA carries
    // many.  A bare `find` answered from whichever the API listed first, which
    // made the sweep's has-this-changed comparison a coin flip.
    expect(
      currentGateState([
        { id: 1, name: "pr-gate", status: "completed", conclusion: "failure" },
        { id: 2, name: "pr-gate", status: "completed", conclusion: "success" },
      ]),
    ).toBe("success");
  });
});

// ---------------------------------------------------------------------------
// #2787 — the corpse that `latestPerName` could not reach.
//
// `latestPerName` collapses by NAME, so it rescues a SHA only once the live
// suite has materialised a run of that name.  The four `*-passed` rollups sit
// behind a dynamic matrix (`configure` emits it, the rollup `needs:` it), and
// GitHub does not create the rollup job until `configure` runs.  On a saturated
// pool nothing on the live suite had started in ~3h, so the superseded suite's
// cancelled corpse was the ONLY bearer of each name and the fail-closed rule
// condemned a SHA on which nothing had failed:
//
//   pr-gate: check(s) failed: corpus-elixir-build-passed, pages-passed,
//            elixir-vanilla-build-passed, corpus-build-passed
//   ...against 12 queued / 11 skipped / 4 cancelled / 2 pending / 0 failure.
//
// The MUTATION PROOF the fix owes: reverting `liveRuns` (or its call in
// `evaluate`) turns the first case below back into `failed: [rollup]`.  The
// three that follow are the controls — each one is a way the narrow rule could
// have been written too wide, and each must still fail closed.
// ---------------------------------------------------------------------------
describe("liveRuns — a superseded suite's corpse is not a verdict", () => {
  /** The motivating SHA, minimised: suite 1 cancelled, suite 2 live, and the
   *  rollup name exists ONLY in the dead suite. */
  const supersededSHA: CheckRun[] = [
    { id: 1, suite: 1, name: "corpus-build-passed", status: "completed", conclusion: "cancelled" },
    { id: 2, suite: 1, name: "test", status: "completed", conclusion: "cancelled" },
    { id: 3, suite: 2, name: "test", status: "queued", conclusion: null },
  ];

  it("a corpse-only name goes PENDING, not FAILED", () => {
    const { failed, pending, total } = evalRuns(supersededSHA);
    expect(failed).toEqual([]);
    // The rollup stops reporting entirely — the live suite owns that answer,
    // whether or not it has created a job of that name yet.
    expect(total).toBe(1);
    expect(pending).toEqual(["test"]);
    expect(verdict({ total, pending, failed }).state).toBe("pending");
  });

  it("CONTROL — a genuinely failed check still fails, corpses or not", () => {
    const { failed } = evalRuns([
      ...supersededSHA,
      { id: 4, suite: 2, name: "lint", status: "completed", conclusion: "failure" },
    ]);
    expect(failed).toEqual(["lint"]);
  });

  it("CONTROL — a superseded suite's genuine FAILURE is not laundered", () => {
    // It ran and it failed before its suite was cancelled.  Only `cancelled`
    // is a non-verdict; a `failure` is a verdict whatever happened next.
    const { failed } = evalRuns([
      { id: 1, suite: 1, name: "build", status: "completed", conclusion: "failure" },
      { id: 2, suite: 2, name: "test", status: "queued", conclusion: null },
    ]);
    expect(failed).toEqual(["build"]);
  });

  it("CONTROL — a cancelled run in the NEWEST suite still fails", () => {
    const { failed } = evalRuns([
      { id: 1, suite: 1, name: "build", status: "completed", conclusion: "success" },
      { id: 2, suite: 2, name: "build", status: "completed", conclusion: "cancelled" },
    ]);
    expect(failed).toEqual(["build"]);
  });

  it("CONTROL — corpses with NO newer suite present still fail", () => {
    // Nothing to defer to: deferring here would be inventing a live suite.
    const { failed } = evalRuns([
      { id: 1, suite: 1, name: "build", status: "completed", conclusion: "cancelled" },
      { id: 2, suite: 1, name: "test", status: "completed", conclusion: "cancelled" },
    ]);
    expect(failed).toEqual(["build", "test"]);
  });

  it("a suiteless snapshot is untouched — every pre-existing case is byte-identical", () => {
    // Only the tests hand-build runs without a suite; the API always sends one.
    const runs: CheckRun[] = [
      { id: 1, name: "build", status: "completed", conclusion: "cancelled" },
      { id: 2, name: "test", status: "completed", conclusion: "success" },
    ];
    expect(liveRuns(runs)).toEqual(runs);
  });

  it("is empty-safe (Math.max of nothing is -Infinity, not a verdict)", () => {
    expect(liveRuns([])).toEqual([]);
  });

  it("the FETCH carries the suite through — otherwise liveRuns is a no-op in prod", () => {
    // The hole this closes: every test above hand-builds runs WITH a `suite`,
    // so dropping `check_suite.id` from `fetchCheckRuns`' projection would keep
    // all of them green while the real gate went on condemning corpses.  Drive
    // the production mapping against an API-shaped payload instead.
    const apiPayload = {
      total_count: 1,
      check_runs: [
        {
          id: 7,
          name: "corpus-build-passed",
          status: "completed",
          conclusion: "cancelled",
          check_suite: { id: 42 },
        },
      ],
    };
    const fetchImpl = async () =>
      ({ ok: true, status: 200, json: async () => apiPayload }) as unknown as Response;
    return fetchCheckRuns("o/r", "sha", "t", { fetchImpl }).then((runs: unknown[]) => {
      expect(runs).toEqual([
        {
          id: 7,
          name: "corpus-build-passed",
          status: "completed",
          conclusion: "cancelled",
          suite: 42,
        },
      ]);
    });
  });
});

describe("verdict — snapshot to published state", () => {
  it("any failure wins, even while others are still pending (fail-fast)", () => {
    const v = verdict(evalRuns([run("fast-suite", "completed", "failure"), run("slow", "queued")]));
    expect(v.state).toBe("failure");
    expect(v.summary).toContain("fast-suite");
  });

  it("pending is BLOCKING but not failed — never green while checks run", () => {
    const v = verdict(evalRuns([green("done"), run("still-going", "in_progress")]));
    expect(v.state).toBe("pending");
    expect(v.summary).toContain("still-going");
  });

  it("zero other checks reporting blocks (fail-closed), it does not pass", () => {
    expect(verdict(evalRuns([])).state).toBe("pending");
  });

  it("all triggered checks green → success", () => {
    const v = verdict(evalRuns([green("a"), green("b")]));
    expect(v.state).toBe("success");
    expect(v.summary).toContain("2");
  });
});

// ---------------------------------------------------------------------------
// The workflow_run trigger list — pinned against the real inventory.
// ---------------------------------------------------------------------------

/** The `name:` of a workflow file (first line by repo convention). */
function workflowName(file: string): string {
  const m = readFileSync(path.join(workflowsDir, file), "utf8").match(/^name:\s*(.+)$/m);
  expect(m, `${file} has no name:`).toBeTruthy();
  return (m as RegExpMatchArray)[1].trim().replace(/^['"]|['"]$/g, "");
}

/** The quoted entries of pr-gate.yml's `workflow_run.workflows:` list.
 *  Anchored on the indented KEY line, not the word — the file's comments and
 *  the `branches-ignore` block also contain "workflows"/list entries. */
function triggerList(): string[] {
  const src = readFileSync(path.join(workflowsDir, "pr-gate.yml"), "utf8");
  const start = src.search(/^ {4}workflows:\s*$/m);
  expect(start, "pr-gate.yml lost its workflow_run.workflows key").toBeGreaterThan(-1);
  const block = src.slice(start, src.indexOf("permissions:"));
  return [...block.matchAll(/-\s*'([^']+)'/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// The sweep's concurrency, pinned.
//
// The gate is event-driven, and the sweep is the safety net that un-parks a PR
// whose verdict stopped advancing.  (It is NOT a 15-minute cap: the cron is
// delivered at a ~3.5 h median, and the sweep also rides `workflow_run` — see
// the `schedule:` comment in pr-gate.yml.)  That net was itself broken by the
// concurrency block, in a
// way nothing tested: a `schedule` payload carries neither `pull_request` nor
// `workflow_run`, so the group key resolved to the literal `pr-gate-` and, with
// `cancel-in-progress: true`, each cron tick cancelled the previous one.  Under
// the runner starvation the sweep exists to survive, the sweep never ran.
//
// Both halves are pinned because both are load-bearing and the "obvious" fix to
// the first (a unique key per run) silently breaks correctness: unique keys let
// sweeps OVERLAP, and a slower sweep posting its older verdict last can re-park
// a PR it already greened.
//
// UPDATED 2026-09-08: `cancel-in-progress` is now FALSE on every path, and this
// file used to REQUIRE the opposite — it asserted the value was conditional and
// named `pull_request` / `workflow_run`, i.e. it pinned "cancel for the
// SHA-keyed events" as the safe shape.  Measurement falsified that.  A burst of
// completions did not collapse to the newest evaluation, it collapsed to none:
// of the last 100 `workflow_run`-triggered pr-gate runs, 94 `cancelled`, 4
// queued, 2 pending, ZERO successful.  An evaluation takes ~2m20s but waits far
// longer for a runner, so the next completing check cancelled it before it ever
// reached `publishCheck` — and with ~40 checks per SHA (times three SHAs during
// a merge-queue batch) the stream never ended.  Serialising instead caps the
// group at one running + one pending, which costs no extra runner (a PENDING
// run holds no slot; a CANCELLED one has already wasted the slot it claimed).
// The old assertion is kept below, inverted, so the reasoning is not silently
// re-derived in the direction that broke it.
// ---------------------------------------------------------------------------

/** The `concurrency:` block of pr-gate.yml, comments stripped. */
function concurrencyBlock(): { group: string; cancelInProgress: string } {
  const src = readFileSync(path.join(workflowsDir, "pr-gate.yml"), "utf8");
  const start = src.search(/^concurrency:\s*$/m);
  expect(start, "pr-gate.yml lost its top-level concurrency: key").toBeGreaterThan(-1);
  const block = src.slice(start, src.indexOf("\njobs:"));
  const group = block.match(/^\s*group:\s*(.+)$/m);
  const cancel = block.match(/^\s*cancel-in-progress:\s*(.+)$/m);
  expect(group, "concurrency block lost its group:").toBeTruthy();
  expect(cancel, "concurrency block lost its cancel-in-progress:").toBeTruthy();
  return {
    group: (group as RegExpMatchArray)[1].trim(),
    cancelInProgress: (cancel as RegExpMatchArray)[1].trim(),
  };
}

describe("pr-gate.yml concurrency does not cancel its own safety net", () => {
  it("the group key has a non-empty fallback for SHA-less events", () => {
    const { group } = concurrencyBlock();
    // Both SHA expressions are empty on `schedule` / `workflow_dispatch`.  With
    // no third alternative the key collapses to a single shared literal and
    // every sweep contends with every other sweep.
    expect(group).toContain("github.event.pull_request.head.sha");
    expect(group).toContain("github.event.workflow_run.head_sha");
    expect(
      /\|\|\s*'[^']+'\s*\}\}/.test(group),
      `group key needs a literal fallback for SHA-less (schedule / dispatch) events, got: ${group}`,
    ).toBe(true);
  });

  it("cancel-in-progress is a flat false — the RUNNING evaluation is never killed", () => {
    const { cancelInProgress } = concurrencyBlock();
    // A literal `false`, not an expression: every conditional spelling this
    // block has carried cancelled SOME path, and each one starved the verdict
    // on exactly the path it cancelled (the sweep first, then every SHA-keyed
    // event).  There is no path that benefits from killing an evaluation that
    // has already claimed its slot — it is the one about to publish.
    //
    // What this flag does NOT do, and this test used to be titled as though it
    // did: stop GitHub cancelling a superseded PENDING run.  That happens
    // regardless (measured 2026-09-10: 479 of 759 evaluations `cancelled`,
    // sampled ones with zero jobs), and it is harmless — a pending run holds
    // no runner, and the newest arrival, which is the tail evaluation, is
    // never the evicted one.
    expect(
      cancelInProgress,
      `cancel-in-progress must be a flat \`false\`, got: ${cancelInProgress}. ` +
        "Cancelling collapses a burst of check completions to no published " +
        "verdict at all (measured under `true`: 94 of 100 runs cancelled, 0 " +
        "successful), which parks the gate and gets green merge-queue entries " +
        "ejected. Under `false` a superseded PENDING run is still cancelled " +
        "(66 of 91 on 2026-09-10) — that is the design, because the newest " +
        "queued run always survives and publishes.",
    ).toBe("false");
  });

  it("the group key still serialises rather than letting runs overlap", () => {
    // With cancellation off, the group key is the ONLY thing preventing two
    // evaluations of one SHA from racing — a slower one posting its older
    // verdict last would re-park a PR it already greened. A unique-per-run key
    // (`github.run_id`, `github.run_attempt`) would reintroduce exactly that.
    const { group } = concurrencyBlock();
    expect(group).not.toContain("github.run_id");
    expect(group).not.toContain("github.run_attempt");
  });
});

describe("pr-gate.yml re-evaluates on every other workflow's completion", () => {
  const others = readdirSync(workflowsDir)
    .filter((f) => f.endsWith(".yml") && f !== "pr-gate.yml")
    .sort();
  const listed = new Set(triggerList());

  it("found the real inventory (the reader still works)", () => {
    expect(others.length).toBeGreaterThan(40);
    expect(listed.size).toBeGreaterThan(40);
  });

  for (const file of others) {
    it(`${file} is in the workflow_run list`, () => {
      const name = workflowName(file);
      expect(
        listed.has(name),
        `pr-gate.yml's workflow_run.workflows is missing '${name}' (${file}).\n` +
          "Without it, that workflow's completion never re-evaluates the gate " +
          "and a PR waiting only on it sticks at in_progress.",
      ).toBe(true);
    });
  }

  it("lists nothing that does not exist (stale names re-evaluate nothing)", () => {
    const real = new Set(others.map(workflowName));
    const stale = [...listed].filter((n) => !real.has(n));
    expect(stale, `stale workflow_run entries: ${stale.join("; ")}`).toEqual([]);
  });

  it("does not listen to itself", () => {
    expect(listed.has(workflowName("pr-gate.yml"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Park resilience — pinned.  A fully-green PR has been observed sitting at
// in_progress with nothing left to wait for.  Two 2026-09-10 measurements
// disagree on why (see the header of scripts/pr-gate.mjs): #2859 retired the
// branch-filtered "GitHub drops dispatches" counts as an artifact, and the C0
// unfiltered census counted 13 of 178 eligible completions producing no
// evaluation run at all.  The tail watch at the bottom of this file is the
// in-run answer either way; the two defenses pinned here are the older ones,
// each of which rots silently if removed:
//   1. `branches-ignore: [main]` on the workflow_run trigger — without it,
//      every push:main heavy-set completion (~60 per merge) creates an eval
//      run, a dispatch storm this gate has no reason to carry;
//   2. the sweep — a reconciler over open PRs for SHAs no watcher is still on.
//      It rides the same event stream it protects against, so it is a backstop
//      of last resort, not a cap on the outage.
// ---------------------------------------------------------------------------

/** The body of one job in pr-gate.yml, from its key to the next job (or EOF).
 *  Read by slicing rather than by parsing YAML because what these assertions
 *  are about is the literal `if:` expression GitHub evaluates — a YAML load
 *  would hand back the same string with its folding already applied, and the
 *  comments that explain each arm would be gone. */
function jobBlock(job: string): string {
  const src = readFileSync(path.join(workflowsDir, "pr-gate.yml"), "utf8");
  const start = src.search(new RegExp(`^ {2}${job}:\\s*$`, "m"));
  expect(start, `pr-gate.yml has no \`${job}:\` job`).toBeGreaterThan(-1);
  const rest = src.slice(start + 1);
  const next = rest.search(/^ {2}[a-z][\w-]*:\s*$/m);
  return next === -1 ? rest : rest.slice(0, next);
}

/** A job's `if:` guard, with comment lines dropped so an arm mentioned only in
 *  prose can never satisfy an assertion about the expression. */
function jobGuard(job: string): string {
  const block = jobBlock(job);
  const start = block.indexOf("if:");
  expect(start, `the ${job} job lost its if: guard`).toBeGreaterThan(-1);
  const runsOn = block.indexOf("runs-on:", start);
  const concurrency = block.indexOf("concurrency:", start);
  const end = Math.min(...[runsOn, concurrency].filter((i) => i > -1));
  return block
    .slice(start, end)
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");
}

const evalJobGuard = () => jobGuard("pr-gate-eval");
const sweepJobGuard = () => jobGuard("sweep");

/** The sweep job's OWN concurrency block — the workflow-level one is keyed per
 *  SHA and so cannot serialise sweeps against each other. */
function sweepJobConcurrency(): { group: string; cancelInProgress: string } {
  const block = jobBlock("sweep");
  const start = block.indexOf("concurrency:");
  expect(start, "the sweep job lost its own concurrency: block").toBeGreaterThan(-1);
  const scoped = block.slice(start, block.indexOf("runs-on:", start));
  const group = scoped.match(/^\s*group:\s*(.+)$/m);
  const cancel = scoped.match(/^\s*cancel-in-progress:\s*(.+)$/m);
  expect(group, "the sweep's concurrency block lost its group:").toBeTruthy();
  expect(cancel, "the sweep's concurrency block lost its cancel-in-progress:").toBeTruthy();
  return {
    group: (group as RegExpMatchArray)[1].trim(),
    cancelInProgress: (cancel as RegExpMatchArray)[1].trim(),
  };
}

/** What the workflow-level `group:` resolves to on a `schedule` /
 *  `workflow_dispatch` payload, where all three SHA expressions are empty:
 *  the literal prefix plus the `|| '<fallback>'` alternative. */
function workflowGroupWithoutSha(): string {
  const { group } = concurrencyBlock();
  const prefix = group.slice(0, group.indexOf("${{"));
  const fallback = group.match(/\|\|\s*'([^']+)'\s*\}\}/);
  expect(fallback, `group key lost its SHA-less fallback literal: ${group}`).toBeTruthy();
  return `${prefix}${(fallback as RegExpMatchArray)[1]}`.trim();
}

describe("the sweep job can actually start on the cron", () => {
  // A job cannot acquire a concurrency group its own workflow run already
  // holds.  From #2835 until #2846 both names were `pr-gate-sweep` — the
  // workflow key resolves to it on exactly the SHA-less events the sweep runs
  // on — so every scheduled sweep failed in under a second with zero steps and
  // no logs, while the `workflow_run` sweeps (keyed `pr-gate-<head_sha>`, no
  // collision) all passed.  Nothing else in this file could see that: the
  // trigger, the throttle and the group were each individually correct.
  it("its group differs from the workflow group on the events it runs on", () => {
    const jobGroup = sweepJobConcurrency().group;
    expect(
      jobGroup,
      `the sweep job's concurrency group (${jobGroup}) is the string the ` +
        "workflow-level group resolves to on schedule / workflow_dispatch. " +
        "GitHub fails such a job at startup — 0 steps, no logs — so the " +
        "safety net silently stops running. Rename either one.",
    ).not.toBe(workflowGroupWithoutSha());
  });
});

describe("pr-gate survives a SHA whose evaluations stop arriving", () => {
  const src = readFileSync(path.join(workflowsDir, "pr-gate.yml"), "utf8");

  it("ignores main / merge-queue completions at the trigger (the storm source)", () => {
    const wrBlock = src.slice(src.indexOf("workflow_run:"), src.indexOf("permissions:"));
    expect(
      /branches-ignore:/.test(wrBlock) && /-\s*main\b/.test(wrBlock),
      "workflow_run must carry branches-ignore including main — every push:main " +
        "completion otherwise creates an eval run — a dispatch storm this gate\n" +
        "has no reason to carry",
    ).toBe(true);
  });

  it("carries the scheduled sweep (the idle-repo safety net)", () => {
    expect(/^\s*schedule:/m.test(src), "pr-gate.yml lost its schedule trigger").toBe(true);
    expect(/cron:/.test(src)).toBe(true);
  });

  // UPDATED 2026-09-09.  This block used to assert that `pr-gate-eval`'s guard
  // was the INVERTED form (`event_name != 'workflow_run' || …`), because that
  // was what let the SAME job fall through to sweep mode on schedule/dispatch.
  // The sweep is its own job now — it needs a throttle and a constant
  // concurrency group that the per-SHA evaluation must not have — so the
  // inversion is gone and pinning it would now block the fix that removed it.
  // What replaces it is the pair of properties that actually matter: the
  // evaluation runs on every path that HAS a SHA, and the sweep runs on the
  // paths that do not.
  it("the evaluation runs on every path that carries a SHA", () => {
    const guard = evalJobGuard();
    expect(guard).toContain("github.event_name == 'pull_request'");
    expect(guard).toContain("github.event_name == 'merge_group'");
    // A `workflow_run` completion is only worth evaluating when the run that
    // triggered it was itself a PR or merge-group run — those are the two
    // contexts whose head SHA this gate publishes on.
    expect(guard).toContain("github.event.workflow_run.event == 'pull_request'");
    expect(guard).toContain("github.event.workflow_run.event == 'merge_group'");
  });

  it("the sweep runs on ACTIVITY, not only on the cron that does not fire", () => {
    // The whole point of the 2026-09-09 change.  `schedule` alone is not a
    // safety net on this account: the cron asks for four sweeps an hour and
    // Actions delivers a mean gap of ~3.5 hours (re-measured 2026-09-10), so a
    // green PR (#2819) sat parked with all 241 of its checks green.  Riding
    // `workflow_run` is what closes it.
    const guard = sweepJobGuard();
    expect(
      guard.includes("github.event_name == 'workflow_run'"),
      `the sweep must ride workflow_run or it is back on the cron alone, got: ${guard}`,
    ).toBe(true);
    expect(guard).toContain("github.event_name == 'schedule'");
    expect(guard).toContain("github.event_name == 'workflow_dispatch'");
  });

  it("the sweep is throttled, and by something that costs no API call", () => {
    // Unthrottled it would ride EVERY completion — tens per SHA — and a sweep
    // costs a paged check-run fetch per open PR, which would exhaust the
    // per-repository GITHUB_TOKEN budget.  GitHub expressions have no
    // arithmetic, so the throttle is a last-digit string test on run_number
    // rather than a modulo.
    const guard = sweepJobGuard();
    expect(
      /endsWith\(\s*format\('\{0\}',\s*github\.run_number\s*\)/.test(guard),
      `the sweep's workflow_run arm must be throttled, got: ${guard}`,
    ).toBe(true);
  });

  it("the sweep serialises against ITSELF, not against one SHA", () => {
    // The workflow-level group is keyed per SHA, so it would happily run one
    // sweep per active SHA at once.  A constant job-level group is what caps
    // them at one running plus one pending.
    const block = sweepJobConcurrency();
    expect(
      /\$\{\{|github\./.test(block.group),
      `the sweep's concurrency group must be a CONSTANT, got: ${block.group}`,
    ).toBe(false);
    expect(block.cancelInProgress).toBe("false");
  });

  it("the sweep never posts a check run onto a SHA this gate evaluates", () => {
    // It is skipped on `pull_request` / `merge_group`, and a skipped job still
    // surfaces as a check run — so its name has to be excluded from the
    // verdict, or the gate counts its own plumbing.
    expect(sweepJobGuard()).not.toContain("github.event_name == 'pull_request'");
    expect(SELF_NAMES.has("pr-gate-sweep")).toBe(true);
  });

  it("sweep may list open PRs", () => {
    expect(/pull-requests:\s*read/.test(src)).toBe(true);
  });
});

describe("sweep reconciliation — currentGateState / sweepShouldPost", () => {
  it("reads the published gate state out of a snapshot", () => {
    expect(currentGateState([green("a")])).toBe("absent");
    expect(currentGateState([run("pr-gate", "in_progress"), green("a")])).toBe("pending");
    expect(currentGateState([run("pr-gate", "completed", "success")])).toBe("success");
    expect(currentGateState([run("pr-gate", "completed", "failure")])).toBe("failure");
  });

  it("posts exactly when the fresh verdict disagrees — the parked-PR fix", () => {
    // The observed outage: gate published `pending`, every check green.
    expect(sweepShouldPost("pending", { state: "success" })).toBe(true);
    // And the churn guard: identical verdicts are not re-posted every cycle.
    expect(sweepShouldPost("success", { state: "success" })).toBe(false);
    expect(sweepShouldPost("pending", { state: "pending" })).toBe(false);
    expect(sweepShouldPost("success", { state: "failure" })).toBe(true);
    expect(sweepShouldPost("absent", { state: "pending" })).toBe(true);
  });
});

describe("apiFetch — github.com's transient 5xx is not a verdict", () => {
  // Observed 2026-08-17: the scheduled sweep died on `503 No server is
  // currently available to service your request` while posting PR 6 of 12 —
  // a red `pr-gate` run that said nothing about any PR, and left the six
  // unswept.  The gate is the recovery path for every other check, so an API
  // blip must cost a retry, not the job.
  const res = (status: number) =>
    ({ ok: status >= 200 && status < 300, status, text: async () => "" }) as Response;
  const noSleep = async () => {};

  it("classifies what is worth retrying — transient yes, defect no", () => {
    for (const s of [429, 500, 502, 503, 504]) expect(isRetryableStatus(s), `${s}`).toBe(true);
    // A 401/403 is a bad token or a missing permission and a 422 is a malformed
    // body; retrying those only delays the honest failure.
    for (const s of [400, 401, 403, 404, 409, 422])
      expect(isRetryableStatus(s), `${s}`).toBe(false);
  });

  it("backs off 1s, 2s, 4s — bounded, so an evaluation stays seconds long", () => {
    expect([1, 2, 3].map(retryDelayMs)).toEqual([1000, 2000, 4000]);
    // v2's whole claim is that a gate run never parks a runner slot.
    let total = 0;
    for (let a = 1; a < API_MAX_ATTEMPTS; a += 1) total += retryDelayMs(a);
    expect(total).toBeLessThanOrEqual(10_000);
  });

  it("retries the 503 and returns the response that follows it", async () => {
    const seen: number[] = [];
    const statuses = [503, 503, 201];
    const fetchImpl = async () => {
      const s = statuses[seen.length];
      seen.push(s);
      return res(s);
    };
    const out = await apiFetch("u", {}, { fetchImpl, sleep: noSleep, onRetry: () => {} });
    expect(out.status).toBe(201);
    expect(seen).toEqual([503, 503, 201]);
  });

  it("does not retry a 422 — one call, and the caller still throws", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return res(422);
    };
    const out = await apiFetch("u", {}, { fetchImpl, sleep: noSleep, onRetry: () => {} });
    expect(calls).toBe(1);
    expect(out.ok).toBe(false);
  });

  it("gives up after the ladder and hands the failing response back to the caller", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return res(503);
    };
    const out = await apiFetch("u", {}, { fetchImpl, sleep: noSleep, onRetry: () => {} });
    // Still a Response, not a swallowed error: the call site's own
    // `if (!res.ok) throw` keeps producing its message unchanged.
    expect(calls).toBe(API_MAX_ATTEMPTS);
    expect(out.status).toBe(503);
  });

  it("retries a rejected fetch (reset socket / DNS) and rethrows on the last", async () => {
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls < 3) throw new Error("ECONNRESET");
      return res(200);
    };
    expect(
      (await apiFetch("u", {}, { fetchImpl: flaky, sleep: noSleep, onRetry: () => {} })).ok,
    ).toBe(true);

    let always = 0;
    const dead = async () => {
      always += 1;
      throw new Error("ENOTFOUND");
    };
    await expect(
      apiFetch("u", {}, { fetchImpl: dead, sleep: noSleep, onRetry: () => {} }),
    ).rejects.toThrow("ENOTFOUND");
    expect(always).toBe(API_MAX_ATTEMPTS);
  });

  it("every GitHub call goes through it — a bare fetch would keep the old red", () => {
    // The helper is worthless if a call site skips it, and the miss is
    // invisible (the code reads fine and only fails during an outage).
    const src = readFileSync(path.join(repoRoot, "scripts/pr-gate.mjs"), "utf8");
    const bare = src.match(/await fetch\(/g) ?? [];
    expect(bare, "a call site still calls fetch directly instead of apiFetch").toEqual([]);
    // Three GitHub endpoints: list check runs, list open PRs, publish the
    // check.  (Counted excluding `apiFetch`'s own definition.)
    expect((src.match(/(?<!function )\bapiFetch\(/g) ?? []).length).toBe(3);
  });
});

describe("publishCheck — one `pr-gate` run per SHA, updated in place", () => {
  // The merge refusal on #2593: every component check green, and
  //   405 Repository rule violations found
  //   Required status check "pr-gate" is expected.
  // The SHA carried THREE `pr-gate` runs — two stuck at "waiting on N/M"
  // because v2 created a new run per evaluation and never completed the old
  // ones, and one "all 8 triggered check(s) passed".  The draft→ready flip had
  // split them across two check suites, and the required-check evaluation read
  // a stale pending one.  Only a force-push to a fresh SHA cleared it.
  const ok = { ok: true, status: 200, text: async () => "" } as Response;
  const noSleep = async () => {};
  const V = { state: "success" as const, summary: "all 8 triggered check(s) passed" };

  const spy = (responses: Response[] = [ok]) => {
    const calls: { method: string; url: string; body: Record<string, unknown> }[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({
        method: init.method as string,
        url,
        body: JSON.parse(init.body as string),
      });
      return responses[calls.length - 1] ?? ok;
    };
    return { calls, opts: { fetchImpl, sleep: noSleep, onRetry: () => {} } };
  };

  it("finds the run to reuse — newest per name, null when the gate never published", () => {
    expect(
      existingGateRunId([
        { id: 1, name: "pr-gate", status: "in_progress", conclusion: null },
        { id: 2, name: "pr-gate", status: "completed", conclusion: "success" },
        { id: 3, name: "tests passed", status: "completed", conclusion: "success" },
      ]),
    ).toBe(2);
    expect(existingGateRunId([green("tests passed")])).toBe(null);
  });

  it("UPDATES the existing run instead of leaving a stale pending sibling", async () => {
    const { calls, opts } = spy();
    await publishCheck("o/r", "deadbeef", "t", V, 4242, opts);
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toContain("/check-runs/4242");
    // head_sha is create-only — PATCH 422s on it.
    expect(calls[0].body.head_sha).toBeUndefined();
    expect(calls[0].body.status).toBe("completed");
    expect(calls[0].body.conclusion).toBe("success");
  });

  it("creates one the first time the gate publishes on a SHA", async () => {
    const { calls, opts } = spy();
    await publishCheck("o/r", "deadbeef", "t", V, null, opts);
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toMatch(/\/check-runs$/);
    expect(calls[0].body.head_sha).toBe("deadbeef");
    expect(calls[0].body.name).toBe("pr-gate");
  });

  it("a pending verdict updates the SAME run — that is the whole fix", async () => {
    // Under v2 this call is what minted the run that later blocked the merge.
    const { calls, opts } = spy();
    await publishCheck(
      "o/r",
      "deadbeef",
      "t",
      { state: "pending", summary: "waiting on 2/8: tests passed, schema-load" },
      4242,
      opts,
    );
    expect(calls.map((c) => c.method)).toEqual(["PATCH"]);
    expect(calls[0].body.status).toBe("in_progress");
    expect(calls[0].body.conclusion).toBeUndefined();
  });

  it("falls back to creating when the run belongs to another app (403)", async () => {
    // Only the app that created a check run may update it.  Better a duplicate
    // than no verdict at all — and the log line says which happened.
    const forbidden = { ok: false, status: 403, text: async () => "" } as Response;
    const { calls, opts } = spy([forbidden, ok]);
    await publishCheck("o/r", "deadbeef", "t", V, 4242, { ...opts, onRetry: () => {} });
    expect(calls.map((c) => c.method)).toEqual(["PATCH", "POST"]);
    expect(calls[1].body.head_sha).toBe("deadbeef");
  });

  it("BOTH call sites pass the id — a `null` there silently restores the bug", () => {
    // publishCheck is correct in isolation and useless if a caller hands it
    // `null`: the SHA grows a second run and the merge refusal comes back.
    // Two call sites: `evaluateOnce` (which every single-SHA evaluation and
    // every tail-watch poll goes through) and the sweep — the sweep is what
    // finally published the green verdict on #2593 after the event-driven
    // path stopped moving it.
    const src = readFileSync(path.join(repoRoot, "scripts/pr-gate.mjs"), "utf8");
    const wired = src.match(/publishCheck\([^)]*existingGateRunId\(runs\)/g) ?? [];
    expect(wired.length, "a publishCheck call site is not passing existingGateRunId(runs)").toBe(2);
  });

  it("still throws the caller's message when publishing genuinely fails", async () => {
    const bad = { ok: false, status: 422, text: async () => "Invalid request" } as Response;
    const { opts } = spy([bad, bad]);
    await expect(publishCheck("o/r", "deadbeef", "t", V, 4242, opts)).rejects.toThrow(
      "GitHub API 422 posting check run",
    );
  });
});

// ---------------------------------------------------------------------------
// THE TAIL WATCH — the park, measured, and the fix that closes it.
//
// MEASUREMENT (2026-09-10, repo-wide run listings with NO branch filter — the
// branch-filtered call every earlier diagnosis rested on structurally cannot
// see a `workflow_run`-triggered run, because GitHub attributes it to the
// DEFAULT branch: F65):
//
//   * 178 completions of listed workflows on non-`main` branches in the six
//     hours to 16:00Z produced 172 `PR gate` runs; 13 of those completions
//     produced NO RUN AT ALL.  ~7% of dispatches are simply not delivered.
//   * A drop on a SHA's LAST completion parks the gate.  #2819: the last
//     check (`behavioral-java`) completed at 05:49:10Z, the last evaluation
//     was created at 05:48:26Z, and the repo-wide run list is EMPTY from then
//     until 06:35:29Z — 47 minutes, one eligible completion, zero evaluations.
//     Ten of 22 measurable merged PRs parked >= 5 min fully green.
//   * The two standing theories do not survive.  Cancellation: 479 of 759
//     evaluations are still `cancelled` AFTER #2822 set
//     `cancel-in-progress: false` (GitHub evicts a superseded PENDING run
//     regardless), yet a sample of them had ZERO jobs — they cost no runner,
//     and the NEWEST arrival, which is the tail one, is never the evicted one.
//     A read-after-write race: an evaluation dispatched BY a completion reads
//     the API strictly after it.
//
// Each arm below is a seeded-defect proof for one clause of the fix, and the
// CONTROL arm is the mutation proof: replay the same measured timeline with
// the watch removed and the gate never publishes anything but `in_progress`.
// ---------------------------------------------------------------------------

describe("shouldWatchTail — when an evaluation stops trusting the next dispatch", () => {
  const snap = (total: number, pending: number, failed = 0) => ({
    total,
    pending: Array.from({ length: pending }, (_, i) => `p${i}`),
    failed: Array.from({ length: failed }, (_, i) => `f${i}`),
  });

  it("arms on the measured park shapes — median 1 outstanding, max 7", () => {
    // #2819 / #2674 / #2847 / #2832 / #2742 / #2747 / #2756 (1 outstanding),
    // #2721 (2), #2846 (6), #2845 (7).  All ten must arm, or the fix does not
    // reach the PRs it was measured on.
    for (const outstanding of [1, 2, 6, 7]) {
      expect(shouldWatchTail(snap(239, outstanding)), `${outstanding} outstanding`).toBe(true);
    }
  });

  it("does not arm on a terminal snapshot — nothing to watch out", () => {
    expect(shouldWatchTail(snap(10, 0))).toBe(false);
    // A failure is final for this SHA: re-running the red check produces its
    // own completion and its own evaluation.  Watching it would hold a runner
    // to re-publish a verdict that cannot change.
    expect(shouldWatchTail(snap(10, 2, 1))).toBe(false);
  });

  it("CONTROL — does not arm at PR-open time, which would be v1 all over again", () => {
    // The `pull_request`-event evaluation fires when every check is queued and
    // none has reported.  Without the `pending < total` conjunct this snapshot
    // arms the watch and parks a runner slot for the PR's whole CI cycle —
    // exactly the failure that killed v1 (six parked gates ~ a third of the
    // ~20-slot pool, starving the jobs they waited for).
    expect(shouldWatchTail(snap(5, 5))).toBe(false);
    expect(shouldWatchTail({ total: 0, pending: [], failed: [] })).toBe(false);
  });

  it("does not arm beyond the near-green bound — the cost brake is real", () => {
    expect(shouldWatchTail(snap(239, TAIL_PENDING_MAX))).toBe(true);
    expect(shouldWatchTail(snap(239, TAIL_PENDING_MAX + 1))).toBe(false);
  });
});

describe("watchTail — replaying #2819's dropped tail dispatch", () => {
  interface Snap {
    name: string;
    status: string;
    conclusion: string | null;
  }
  const done = (name: string): Snap => ({ name, status: "completed", conclusion: "success" });
  const running = (name: string): Snap => ({ name, status: "in_progress", conclusion: null });

  /** A GitHub double: serves a scripted sequence of check-run snapshots to the
   *  GETs and records every check-run body the gate PUBLISHES.  Both halves
   *  matter — a fix that reads correctly and never publishes is the bug. */
  const gh = (snapshots: Snap[][]) => {
    const published: { status: string; conclusion?: string; summary: string }[] = [];
    let reads = 0;
    const fetchImpl = async (url: string, init: RequestInit = {}) => {
      if (url.includes("/check-runs?")) {
        const runs = snapshots[Math.min(reads, snapshots.length - 1)];
        reads += 1;
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({
            total_count: runs.length,
            check_runs: runs.map((r, i) => ({ ...r, id: i + 1, check_suite: { id: 7 } })),
          }),
        } as unknown as Response;
      }
      const body = JSON.parse(init.body as string);
      published.push({
        status: body.status,
        conclusion: body.conclusion,
        summary: body.output.summary,
      });
      return { ok: true, status: 200, text: async () => "" } as unknown as Response;
    };
    return { fetchImpl, published, readCount: () => reads };
  };

  /** A fake clock the injected `sleep` advances, so a 15-minute budget costs
   *  no wall time and the poll count is exact rather than approximate. */
  const clock = () => {
    let t = 0;
    return {
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
    };
  };

  // The measured timeline: 05:48:26Z evaluation, `behavioral-java` still
  // running; 05:49:10Z it completes; NO dispatch follows for 47 minutes.
  const TAIL_PENDING = [
    done("tests passed"),
    done("corpus-build-passed"),
    running("behavioral-java"),
  ];
  const ALL_GREEN = [done("tests passed"), done("corpus-build-passed"), done("behavioral-java")];

  it("CONTROL — without the watch, the only verdict ever published is in_progress", async () => {
    // The mutation proof.  This is byte-for-byte what the gate did before the
    // fix: one read, one publish, exit.  The completion at 05:49:10Z arrives
    // afterwards, its dispatch is dropped, and nothing re-reads the SHA — so
    // `pr-gate` sits at `in_progress` and branch protection reports
    // "Required status check `pr-gate` is expected".
    const { fetchImpl, published } = gh([TAIL_PENDING, ALL_GREEN]);
    const { snapshot } = await evaluateOnce("o/r", "13871fcc", "t", {
      fetchImpl,
      sleep: async () => {},
      onRetry: () => {},
    });
    expect(published.map((p) => p.status)).toEqual(["in_progress"]);
    expect(published.some((p) => p.conclusion === "success")).toBe(false);
    // …and the snapshot that produced it is exactly the one the fix arms on,
    // so the control and the fix are proved against the SAME timeline.
    expect(shouldWatchTail(snapshot)).toBe(true);
  });

  it("with the watch, the same timeline reaches success with no further dispatch", async () => {
    const { fetchImpl, published } = gh([TAIL_PENDING, ALL_GREEN]);
    const { now, sleep } = clock();
    const opts = { fetchImpl, sleep, now, onRetry: () => {}, log: () => {} };
    const { snapshot, verdict: v } = await evaluateOnce("o/r", "13871fcc", "t", opts);
    expect(shouldWatchTail(snapshot)).toBe(true);
    const final = await watchTail("o/r", "13871fcc", "t", v, opts);
    expect(final.state).toBe("success");
    expect(published.map((p) => p.status)).toEqual(["in_progress", "completed"]);
    expect(published.at(-1)?.conclusion).toBe("success");
  });

  it("stops at the FIRST terminal verdict rather than burning the budget", async () => {
    const { fetchImpl, published } = gh([ALL_GREEN]);
    const { now, sleep } = clock();
    const t0 = now();
    await watchTail(
      "o/r",
      "sha",
      "t",
      { state: "pending", summary: "waiting" },
      { fetchImpl, sleep, now, onRetry: () => {}, log: () => {} },
    );
    // One poll, not thirty: the watch is a tail, not a poller.
    expect(now() - t0).toBe(TAIL_POLL_MS);
    expect(published.length).toBe(1);
  });

  it("a red tail publishes the failure and exits — it does not wait it out", async () => {
    const RED: Snap[] = [
      done("tests passed"),
      { name: "behavioral-java", status: "completed", conclusion: "failure" },
    ];
    const { fetchImpl, published } = gh([RED]);
    const { now, sleep } = clock();
    const final = await watchTail(
      "o/r",
      "sha",
      "t",
      { state: "pending", summary: "waiting" },
      { fetchImpl, sleep, now, onRetry: () => {}, log: () => {} },
    );
    expect(final.state).toBe("failure");
    expect(published.at(-1)?.conclusion).toBe("failure");
  });

  it("does not re-PATCH an unchanged verdict — many reads, one write", async () => {
    // A watch that re-published every 30s would churn the check run and burn
    // the per-repository token budget the sweep also draws on.
    const { fetchImpl, published, readCount } = gh([TAIL_PENDING]);
    const { now, sleep } = clock();
    await watchTail(
      "o/r",
      "sha",
      "t",
      { state: "pending", summary: "waiting on 1/3: behavioral-java" },
      { fetchImpl, sleep, now, onRetry: () => {}, log: () => {} },
    );
    expect(readCount()).toBe(TAIL_BUDGET_MS / TAIL_POLL_MS);
    // The first read's verdict differs from the hand-written `initial` above,
    // so exactly one publish happens; every identical one after it is skipped.
    expect(published.length).toBe(1);
  });

  it("gives up at the budget instead of holding a runner forever", async () => {
    const { fetchImpl } = gh([TAIL_PENDING]);
    const { now, sleep } = clock();
    const t0 = now();
    const final = await watchTail(
      "o/r",
      "sha",
      "t",
      { state: "pending", summary: "waiting" },
      { fetchImpl, sleep, now, onRetry: () => {}, log: () => {} },
    );
    expect(final.state).toBe("pending");
    expect(now() - t0).toBe(TAIL_BUDGET_MS);
  });
});

describe("the tail watch is actually wired in — a pure function nobody calls is not a fix", () => {
  const script = () => readFileSync(path.join(repoRoot, "scripts/pr-gate.mjs"), "utf8");

  it("the single-SHA path guards watchTail with shouldWatchTail", () => {
    // §90's lesson: verifying that a mechanism EXISTS is not verifying it
    // reaches the thing it names.  Every arm above would stay green with the
    // call site deleted.
    expect(script()).toMatch(
      /if \(shouldWatchTail\(snapshot\)\) await watchTail\(repo, sha, token, v\)/,
    );
  });

  it("the eval job's timeout leaves room for the whole budget", () => {
    // A 10-minute timeout against a 15-minute budget kills the watch mid-tail
    // and restores the park it exists to prevent.
    const block = jobBlock("pr-gate-eval");
    const m = block.match(/^\s*timeout-minutes:\s*(\d+)\s*$/m);
    expect(m, "the pr-gate-eval job lost its timeout-minutes").toBeTruthy();
    const minutes = Number((m as RegExpMatchArray)[1]);
    expect(
      minutes,
      `timeout-minutes: ${minutes} is not above the ${TAIL_BUDGET_MS / 60_000}-minute tail budget`,
    ).toBeGreaterThan(TAIL_BUDGET_MS / 60_000);
  });

  it("the knobs stay sized to the measurement", () => {
    // Outstanding checks at the last DELIVERED evaluation, over the ten
    // measured parks: median 1, max 7.  Minutes from that evaluation to the
    // last completion: median 1.2, 9 of 10 within 5, max 16.9.
    expect(TAIL_PENDING_MAX).toBeGreaterThanOrEqual(7);
    expect(TAIL_BUDGET_MS).toBeGreaterThanOrEqual(15 * 60_000);
    // …and bounded, because the watch holds a runner slot while it runs.
    expect(TAIL_PENDING_MAX).toBeLessThanOrEqual(12);
    expect(TAIL_BUDGET_MS).toBeLessThanOrEqual(20 * 60_000);
    expect(TAIL_POLL_MS).toBeLessThanOrEqual(60_000);
  });
});

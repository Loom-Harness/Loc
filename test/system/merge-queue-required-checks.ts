// The merge-queue required-checks manifest — the single source of truth for
// which GitHub Actions checks branch protection requires on `main` (see
// docs/ci-gating.md → "Enabling the merge queue").
//
// `workflow` is the file under `.github/workflows/`; `check` is the *check-run
// name* GitHub reports, which is the job's `name:` when it has one and the job
// id otherwise.  That string — not the file name, not the workflow `name:` —
// is what goes in the required-status-checks list.
//
// ── Two fields, and the difference matters ──────────────────────────────────
//
// `lane` says WHERE the gate runs.  `queueRequired` says whether it is in
// branch protection's required list.  They are not the same question, and
// conflating them is what made the first required set 41 names deep.
//
// The merge queue exists to catch ONE thing per-PR CI structurally cannot: two
// PRs that are each green against their own base and red combined.  The live
// instance is #2739 adding `??` to the grammar while #2761 pinned `??` as a
// parse error — each green alone, `main` red on the merge.  That was caught by
// `tests passed`, the cheap broad suite over the whole combined tree.  It was
// not caught, and could not have been, by a per-backend docker boot.
//
// So a gate earns a required slot when it reads the COMBINED tree broadly and
// cheaply.  A gate that already ran on the PR's own head is a re-run, and the
// ruleset's "Require all queue entries to pass required checks" makes that
// re-run provably redundant: an entry cannot be in the group unless its own
// checks were green.
//
// ── Why the split is measured, not judged ───────────────────────────────────
//
// Every workflow here carries `pull_request:`, so the trigger alone says
// nothing.  The `if:` guard on the required job decides it, and there are
// exactly two idioms:
//
//   draft guard   `github.event_name != 'pull_request' || draft == false`
//                 → runs on EVERY non-draft PR (subject to `paths:`) and again
//                   in the queue.  The queue run is the redundant one.
//
//   label guard   `github.event_name != 'pull_request' || <run-* label>`
//                 → on a PR it needs the label; `merge_group` is not
//                   `pull_request`, so the guard short-circuits true and the
//                   QUEUE IS ITS ONLY RUN.  Dropping one of these from the
//                   required set does not save cost, it deletes the coverage.
//
// `merge-queue-readiness.test.ts` asserts that correspondence both ways, so a
// future trim cannot cut a label-guarded gate by mistake — which is the one
// error in this area that silently loses testing rather than costing money.
//
// This file is NOT a test — it is imported by the test and quoted verbatim in
// docs/ci-gating.md's activation runbook.  Adding a gate to the required set
// means adding a row here, wiring `merge_group:` into its `on:` block, and
// giving it one stable check name.
//
// ONE required check is deliberately absent: `pr-gate`.  Invariant 2 wants the
// check name to resolve to a real job, and `pr-gate` is posted through the
// Checks API by the `pr-gate-eval` job rather than being a job itself, so it
// cannot be a row here.  It is required on `main` all the same — which means
// invariant 1 applies to it and nothing here enforced that, the gap that let
// it reach the queue with no `merge_group:` trigger and stall every entry.
// Its equivalent of invariant 1 lives in the "pr-gate stays IN the queue"
// block of `merge-queue-readiness.test.ts`.

export interface RequiredCheck {
  /** Workflow file name under `.github/workflows/`. */
  readonly workflow: string;
  /** Check-run name to require in branch protection. */
  readonly check: string;
  /** Which tier of the docs/ci-gating.md table this gate belongs to. */
  readonly lane: "per-pr" | "queue";
  /** Whether branch protection requires this name. */
  readonly queueRequired: boolean;
  /**
   * Set when `queueRequired` is false.  `runs-on-every-pr` is the only
   * accepted reason, and the readiness test verifies the workflow really does
   * carry the draft guard rather than a label guard.
   */
  readonly notRequiredBecause?: "runs-on-every-pr";
  /**
   * Set when `queueRequired` is true AND the merge group is the gate's only
   * run.  The readiness test verifies the label guard is really there, so this
   * row cannot be trimmed later on the mistaken belief it runs per-PR.
   */
  readonly queueIsOnlyRun?: true;
}

/**
 * Every gate wired for the queue, required or not.  Rows with
 * `queueRequired: false` stay listed on purpose: they still carry
 * `merge_group:` and still run in the group, and keeping them here documents
 * the wiring plus the reason they are not gating.
 */
export const REQUIRED_CHECKS: readonly RequiredCheck[] = [
  // ── Required: cheap, broad, reads the combined tree ──────────────────
  // `tests-passed` is the JOB ID; the reported check name is the job's
  // `name:` — "tests passed". Branch protection already requires it; do not
  // rename it.  This is the gate that caught the `??` collision.
  { workflow: "test.yml", check: "tests passed", lane: "per-pr", queueRequired: true },
  { workflow: "langium-generated.yml", check: "check", lane: "per-pr", queueRequired: true },
  { workflow: "workflow-lint.yml", check: "workflow-lint", lane: "per-pr", queueRequired: true },
  { workflow: "hono-build.yml", check: "build-generated-ts", lane: "per-pr", queueRequired: true },
  {
    workflow: "dotnet-build.yml",
    check: "build-generated-dotnet",
    lane: "per-pr",
    queueRequired: true,
  },
  {
    workflow: "java-build.yml",
    check: "build-generated-java",
    lane: "per-pr",
    queueRequired: true,
  },
  {
    workflow: "python-build.yml",
    check: "build-generated-python",
    lane: "per-pr",
    queueRequired: true,
  },
  {
    workflow: "elixir-vanilla-build.yml",
    check: "elixir-vanilla-build-passed",
    lane: "per-pr",
    queueRequired: true,
  },
  {
    workflow: "corpus-build.yml",
    check: "corpus-build-passed",
    lane: "per-pr",
    queueRequired: true,
  },
  {
    workflow: "corpus-elixir-build.yml",
    check: "corpus-elixir-build-passed",
    lane: "per-pr",
    queueRequired: true,
  },
  {
    workflow: "generated-react-build.yml",
    check: "generated-react-build-passed",
    lane: "per-pr",
    queueRequired: true,
  },
  {
    workflow: "generated-vue-build.yml",
    check: "generated-vue-build-passed",
    lane: "per-pr",
    queueRequired: true,
  },
  {
    workflow: "generated-svelte-build.yml",
    check: "generated-svelte-build-passed",
    lane: "per-pr",
    queueRequired: true,
  },
  {
    workflow: "generated-angular-build.yml",
    check: "generated-angular-build-passed",
    lane: "per-pr",
    queueRequired: true,
  },
  {
    workflow: "generated-feliz-build.yml",
    check: "feliz-build",
    lane: "per-pr",
    queueRequired: true,
  },
  {
    workflow: "generated-flutter-build.yml",
    check: "flutter-build",
    lane: "per-pr",
    queueRequired: true,
  },
  { workflow: "conformance-parity.yml", check: "parity", lane: "per-pr", queueRequired: true },
  { workflow: "behavioral-e2e.yml", check: "behavioral", lane: "per-pr", queueRequired: true },

  // ── Required: THE MERGE GROUP IS THEIR ONLY RUN ──────────────────────
  // Label-guarded on a PR, so without these four the features they cover are
  // gated by nothing at all.  Trimming for cost must never reach this block.
  {
    workflow: "tenancy-e2e.yml",
    check: "tenancy-e2e-passed",
    lane: "queue",
    queueRequired: true,
    queueIsOnlyRun: true,
  },
  {
    workflow: "migration-evolution-e2e.yml",
    check: "migration-evolution-e2e-passed",
    lane: "queue",
    queueRequired: true,
    queueIsOnlyRun: true,
  },
  {
    workflow: "elixir-oidc-e2e.yml",
    check: "elixir-oidc-compose-e2e",
    lane: "queue",
    queueRequired: true,
    queueIsOnlyRun: true,
  },
  {
    workflow: "auth-oidc-compose-e2e.yml",
    check: "auth-oidc-compose-e2e",
    lane: "queue",
    queueRequired: true,
    queueIsOnlyRun: true,
  },

  // ── Not required: already binding on every non-draft PR ───────────────
  // Each carries the draft guard, so it has already run on the entry's own
  // head — and "Require all queue entries to pass required checks" means an
  // entry cannot be in the group unless that run was green.  Requiring them
  // again multiplies the queue's cost by the count of PRs in flight, which is
  // what stalled the queue on its first day: entries re-formed as neighbours
  // changed faster than a 41-gate set could finish.
  {
    workflow: "behavioral-e2e-dotnet.yml",
    check: "behavioral-dotnet",
    lane: "queue",
    queueRequired: false,
    notRequiredBecause: "runs-on-every-pr",
  },
  {
    workflow: "behavioral-e2e-java.yml",
    check: "behavioral-java",
    lane: "queue",
    queueRequired: false,
    notRequiredBecause: "runs-on-every-pr",
  },
  {
    workflow: "behavioral-e2e-python.yml",
    check: "behavioral-python",
    lane: "queue",
    queueRequired: false,
    notRequiredBecause: "runs-on-every-pr",
  },
  {
    workflow: "behavioral-e2e-elixir.yml",
    check: "behavioral-elixir",
    lane: "queue",
    queueRequired: false,
    notRequiredBecause: "runs-on-every-pr",
  },
  {
    workflow: "behavioral-e2e-dapper.yml",
    check: "behavioral-dapper",
    lane: "queue",
    queueRequired: false,
    notRequiredBecause: "runs-on-every-pr",
  },
  {
    workflow: "behavioral-e2e-mikroorm.yml",
    check: "behavioral-mikroorm",
    lane: "queue",
    queueRequired: false,
    notRequiredBecause: "runs-on-every-pr",
  },
  {
    workflow: "behavioral-ui-e2e.yml",
    check: "behavioral-ui",
    lane: "queue",
    queueRequired: false,
    notRequiredBecause: "runs-on-every-pr",
  },
  {
    workflow: "behavioral-heex-ui-e2e.yml",
    check: "behavioral-heex-ui",
    lane: "queue",
    queueRequired: false,
    notRequiredBecause: "runs-on-every-pr",
  },
  {
    workflow: "hono-obs-e2e.yml",
    check: "hono-obs-e2e",
    lane: "queue",
    queueRequired: false,
    notRequiredBecause: "runs-on-every-pr",
  },
  {
    workflow: "dotnet-obs-e2e.yml",
    check: "dotnet-obs-e2e",
    lane: "queue",
    queueRequired: false,
    notRequiredBecause: "runs-on-every-pr",
  },
  {
    workflow: "java-obs-e2e.yml",
    check: "java-obs-e2e",
    lane: "queue",
    queueRequired: false,
    notRequiredBecause: "runs-on-every-pr",
  },
  {
    workflow: "python-obs-e2e.yml",
    check: "python-obs-e2e",
    lane: "queue",
    queueRequired: false,
    notRequiredBecause: "runs-on-every-pr",
  },
  {
    workflow: "elixir-vanilla-obs-e2e.yml",
    check: "vanilla-obs-e2e",
    lane: "queue",
    queueRequired: false,
    notRequiredBecause: "runs-on-every-pr",
  },
  {
    workflow: "hono-oidc-e2e.yml",
    check: "hono-oidc-e2e",
    lane: "queue",
    queueRequired: false,
    notRequiredBecause: "runs-on-every-pr",
  },
  {
    workflow: "dotnet-oidc-e2e.yml",
    check: "dotnet-oidc-e2e",
    lane: "queue",
    queueRequired: false,
    notRequiredBecause: "runs-on-every-pr",
  },
  {
    workflow: "java-oidc-e2e.yml",
    check: "java-oidc-e2e",
    lane: "queue",
    queueRequired: false,
    notRequiredBecause: "runs-on-every-pr",
  },
  {
    workflow: "python-oidc-e2e.yml",
    check: "python-oidc-e2e",
    lane: "queue",
    queueRequired: false,
    notRequiredBecause: "runs-on-every-pr",
  },
  {
    workflow: "pages.yml",
    check: "pages-passed",
    lane: "queue",
    queueRequired: false,
    notRequiredBecause: "runs-on-every-pr",
  },
];

/** The names that go in branch protection's required-status-checks list. */
export const QUEUE_REQUIRED_CHECKS: readonly RequiredCheck[] = REQUIRED_CHECKS.filter(
  (c) => c.queueRequired,
);

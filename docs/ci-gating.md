# CI gating — what runs where, and how `main` stays green

Why this exists: agents landed several breakages on `main` that no PR check
could have caught, because the gates that *would* have caught them don't gate
PRs. This documents the tiers and the merge queue that closes it without
making every push slower.

> **Status (2026-09-07): the merge queue is LIVE.** The repo is public and
> organization-owned (`Loom-Harness/Loc`), which is what GitHub gates merge
> queues on — public org repos qualify on every plan, Free included — and the
> queue is switched on for `main`. `merge_group` runs now fire the heavy tier
> against the rebased candidate. **What changed on this date was the repo
> SETTING, not the ownership:** the oldest `merge_group` runs the Actions API
> will page to are all one burst created `2026-09-07T11:59:41Z` (#2786's first
> group), with nothing older — measure it again with
> `list_workflow_runs --event merge_group` and walk to the last page. When the repo became
> org-owned is NOT established here.  A transfer demonstrably happened at some
> point — `git push` still prints `remote: This repository moved` and redirects
> `lemmit/Loc` → `Loom-Harness/Loc` — but that redirect is permanent and
> carries no date, and `created_at` survives a transfer, so neither "it moved
> on 2026-09-07" nor "it was org-owned all along" is supportable from here.
> An earlier draft of this doc asserted the former; it is withdrawn rather
> than restated in the opposite direction. The sections below that were written while
> the queue was off are kept as the design record and marked **[historical]**.

## The failure mode

This section is the **original problem statement** — the shape of the hole the
tiers, `pr-gate` and the merge queue were built to close. It is kept because
the reasoning still explains why each mechanism exists; see the per-point notes
for where it stands today.

Branch protection required only **`tests-passed`** (the fast vitest rollup).
Every heavy gate — the runtime/boot e2e suites, the deploy build — was a
*non-required* check. Three consequences:

1. **Some heavy gates still don't run on a PR by default.** `tenancy-e2e`,
   `channels-e2e`, `api-call-e2e`, `migration-evolution-e2e`,
   `phoenix-ui-e2e`, and the two *compose* OIDC legs (`elixir-oidc-e2e`,
   `auth-oidc-compose-e2e`) trigger on `push: [main]` only. Whatever they
   catch, they catch *after* merge — on `main`, where it sits red. (Each also
   accepts a per-PR **label** trigger as a manual escape hatch — see "The
   interim escape hatch" below — but that's opt-in, so the default is still
   post-merge.)

   This bucket used to be much larger. Promoted out of it, each now carrying a
   `pull_request:` trigger with a narrow `paths:` block, the literal draft
   guard and PR-aware concurrency: the cross-backend `behavioral-e2e-*` legs
   and the `pages` build (earlier), then wave G1 of
   [`docs/new-plan/verification-waves-2026-09.md`](new-plan/verification-waves-2026-09.md)
   — the five `*-obs-e2e`, the four *native* `*-oidc-e2e`
   (`hono`/`python`/`java`/`dotnet`), the four `generated-{react,vue,svelte,angular}-e2e`
   SPA smokes (their first `pull_request:` trigger ever), and
   `elixir-vanilla-vo-e2e`. A promotion is nothing more than that trigger:
   `scripts/pr-gate.mjs` fails `pr-gate` on any non-passing check run on the
   head SHA, so a gate becomes binding the moment it can produce one. Read the
   trigger block in the workflow file for the exact paths — this doc does not
   restate them, and it does not restate job counts.

   **Closed by the queue, for this bucket:** every one of them also fires
   on `merge_group`, so they gate the rebased candidate *before* it lands
   rather than reporting on a `main` that is already red. What remains is
   that they stay invisible on the PR itself — you find out at the queue,
   not at the push.
2. **A red heavy gate doesn't block anything.** A gate can be broken (even
   unparseable) and still merge green. `behavioral-e2e-dapper.yml` had an
   unquoted colon in its `name:`, was a permanent `startup_failure`, and stayed
   red across 100% of recent `main` pushes — unnoticed, because it was *never*
   green, so there was no red-transition to alert on.
3. **A gate's `paths:` filter is a third, quieter switch.** Every heavy gate
   narrows itself to the files it thinks can break it. That list is written
   once, against whatever the test imported that day, and the test's
   dependencies then grow without it. The gate stays green and stays listed —
   and for a change confined to an unwatched dir it *never runs at all*, which
   is worse than a vacuous assertion because there is no assertion to inspect.

   Measured in #2397: **all 27 path-filtered gates omitted `src/macros/**` and
   `src/util/**`**; 26 omitted `src/language/**`, 23 `src/system/**`, 19
   `src/ir/**`. So a change to `src/macros/prelude.ts` — where the `auditable`,
   `tenantOwned`, `versioned` and `tenantRegistry` capabilities are defined —
   triggered none of them, as did a change to `src/util/naming.ts` or
   `src/util/code-builder.ts`, both imported by every emitter on every backend.

   The rule now: **a workflow that runs a test which generates a project must
   watch every phase on the generation path** — `src/language/**` (parse),
   `src/macros/**` (expand), `src/ir/**` (lower/enrich/validate),
   `src/system/**` (compose) and `src/util/**` (the naming / code-builder /
   platform-axes leaves every emitter imports). Those five run for *every*
   backend, so no per-backend argument excuses one.
   `test/system/workflow-path-coverage.test.ts` derives "runs a test that
   generates a project" from the test's own transitive import closure (a
   workflow cannot fall out of scope by rearranging imports) and fails the fast
   suite on drift. The generator's shared seams (`_walker`, `_expr`,
   `_frontend`) are deliberately *not* required — they are genuinely
   per-target, and requiring them would produce the false positives that get a
   gate like this weakened into theatre.

`cancel-in-progress: true` on the `push:main` gates made it worse: a rapid
follow-up merge cancels the previous commit's heavy jobs, so a real failure
gets attributed to a later, innocent commit.

> **Every gate in every tier runs locally.** The workflow → local-command
> reverse index is [`docs/testing.md`](testing.md) → "Running any CI gate
> locally"; pushing a commit just to see a check's verdict burns the shared
> runner pool and is never necessary.

## The tiers

| Lane | What | Rule |
|---|---|---|
| **Per-PR, every push** (required) | `test.yml` (fast vitest ×4 shards + the corpus-census job; coverage is nightly-only) + lint + web-tsc → `tests-passed` (unfiltered on PRs); `langium-generated`; `workflow-lint`; the typecheck/compile gates (`hono/dotnet/java/python-build`, `generated-*-build`, `corpus-build`); `behavioral-e2e` (Hono on PGlite, daemonless) as the runtime canary; `pr-gate` (the aggregate verdict over everything that triggered) | Cheap, parallel, no docker/db. Catches most regressions with fast feedback. |
| **Per-PR, path-scoped** (binding via `pr-gate`) | The cross-backend runtime legs `behavioral-e2e-{dotnet,java,python,elixir,dapper,mikroorm}` + `behavioral-ui-e2e` + `behavioral-heex-ui-e2e` (each fires when the PR touches its backend's emitters, the shared IR, or the harness); the five `{hono,python,java,dotnet,elixir-vanilla}-obs-e2e` legs; the four *native* `{hono,python,java,dotnet}-oidc-e2e` legs; the four `generated-{react,vue,svelte,angular}-e2e` SPA smokes; `elixir-vanilla-vo-e2e`; `pairwise`'s generation sweep; the `pages` build (docs/web/src) | Docker/boot cost paid only by the PRs that can break them; when they fire, `pr-gate` makes them blocking. Each file's `paths:` block is the authority on *when* — deliberately narrower than its own `push: main` block, so a typical PR fires one or two siblings, not the whole family. |
| **Merge queue** (`merge_group`, runs once on the final candidate — **LIVE since 2026-09-07**) | The 22 wired gates (branch protection itself requires only `tests passed` + `pr-gate`): the cheap broad set over the combined tree (`tests passed`, langium drift, the five `build-generated-*`, both `corpus-*`, the six frontend builds, `parity`, headless `behavioral`) plus the four gates the queue is the ONLY run for (`tenancy-e2e`, `migration-evolution-e2e`, `elixir-oidc-compose-e2e`, `auth-oidc-compose-e2e`) | Catches what per-PR CI structurally cannot: two PRs green apart, red together. Everything already binding per-PR is deliberately NOT required here — see "What the queue requires, and what it does not". |
| **Nightly / label** (unchanged) | `conformance-full`, `generated-a11y`, `frontend-fullstack-e2e`, `k8s-e2e` | Broad, slow, low churn — post-hoc is fine. |

Note: `generated-react-build`, `generated-vue-build` and
`generated-angular-build` each emit a **slim** matrix on PRs and the **full**
Cartesian everywhere else. Their `configure` job keys on
`github.event_name == 'pull_request'`, so `merge_group` (like `push:main` and
`workflow_dispatch`) falls through to the full sweep — the per-PR/pre-land
split the tiers call for is already built in, and the queue gets the full
Cartesian on the rebased candidate.

The playground suite is split the same way. `playground-e2e` (the whole
Playwright suite, including the network-gated bundle/boot specs) stays
post-merge / nightly / `run-e2e`-label; `playground-e2e-no-network` runs the
network-free subset (workspace, history, builder, requirements, editor) on
every PR touching `web/**` or `src/**`, so file-management and builder
regressions are caught before merge.

## The `pr-gate` check — still the per-PR aggregate

> **Superseded premise, 2026-09-07.** This section used to open with "GitHub
> offers merge queues only on organization-owned repositories, so while this
> repo lives under a personal account the queue cannot be switched on." The
> repo was transferred to the **Loom-Harness** organization that day and the
> merge queue is now enforced (a direct merge is refused with
> *"405 — Changes must be made through the merge queue"*). `pr-gate` is not
> obsolete — it is the thing that makes each PR's own head green, and that is
> what the trim below actually rests on (NOT on the queue's "Require all queue
> entries to pass required checks" setting, which is currently **off**; see
> the runbook).

Plain required-status-checks still can't substitute for `pr-gate` per-PR,
because **every PR workflow here is path-filtered**: a required check that
gets path-skipped never reports, and the PR blocks on "Expected — waiting for
status" forever. A docs-only PR would strand on all of them.

`pr-gate.yml` was the answer to that, and it still earns its place now that
the queue is on: it is the **per-PR** verdict, computed in seconds, over
whatever actually triggered on your head SHA. The queue gates the *rebased
combination*; `pr-gate` gates *your branch* before you get there, so you
learn about a red check without spending a queue slot on it. One aggregate
check that branch protection can require safely. It is **event-driven** (v2):
the v1 design was a single long-polling job, and under real load it fed on itself —
each open PR's gate parked a runner slot while polling (six parked gates ≈ a
third of the ~20-slot pool), starving the very jobs it waited for until its
timeout fired and needed a manual label re-arm. v2 waits in exactly one place,
and only when waiting is cheap:

- It triggers on the `pull_request` events (including `labeled` — `run-*`
  heavy runs join the set — and `ready_for_review`, which fires the
  draft-gated fan-out), on `merge_group`, **and on `workflow_run: completed`
  of every other workflow**, so each completion re-evaluates the gate.
- Each evaluation is seconds: `scripts/pr-gate.mjs` reads the head SHA's
  check runs once and **posts a check run named `pr-gate`** via the Checks
  API (workflow_run-triggered jobs don't surface in the PR checks UI, so the
  job is `pr-gate-eval` and the canonical name rides the posted check). Any
  triggered red → `failure` with culprits named (fail-fast); checks still
  running → `in_progress` (blocks merge without claiming failure); all
  triggered checks green → `success`. A path-skipped workflow never appears
  on the SHA, so it's OK by construction.
- Zero other checks reporting **blocks** — `test.yml` runs unfiltered on PRs
  precisely so at least one check always comes; pending is *never* green.
- **An evaluation that finds the SHA near-green does not exit — it watches the
  tail.** This is the whole liveness story, and the next section is the
  measurement it rests on. `shouldWatchTail` arms when ≤8 checks are
  outstanding, none has failed, and at least one has already reported; the run
  then re-reads the SHA every 30s for up to 15 minutes, publishing every change
  and stopping at the first terminal verdict. The gate therefore never depends
  on a *specific* future dispatch — only on the one it is already running in.
  Cost is bounded by the SHA-keyed concurrency group (one watcher per SHA) and
  by the budget; median observed tail is ~1 minute.

### Why the gate parked, measured once (2026-09-10)

Seven PRs in ten days offered contradictory explanations for one symptom — a
fully green PR whose merge is refused with *"Required status check `pr-gate` is
expected"*, which is what GitHub says when the required check sits at
`in_progress`. The measurement below replaced all of them; **do not add a new
theory to this section without re-measuring the same way.**

The method: list this workflow's runs **unfiltered**
(`/actions/workflows/pr-gate.yml/runs?created=<window>`) and match on time. Do
not filter by branch — a `workflow_run`-triggered run is attributed to the
repository's **default branch**, so a listing filtered to a PR branch returns
only the one `pull_request`-event run and structurally cannot see an evaluation
(F65 in `docs/audits/2026-09-09-verification-fleet-plan.md`).

**Which earlier work that does and does not indict.** F65 is a true statement
about branch-filtered listings in general; it is **not** true of #2835, whose
#2819 diagnosis listed `event=workflow_run` runs unfiltered and read them
correctly. Its table — last evaluation created 05:48:26, last check completed
05:49:10, *"evaluations created after: none"* — is the same observation this
census reproduces at scale, and its conclusion ("this was delivery, not a
missing name") was right. **#2835 was right on the mechanism and incomplete on
coverage**: the sweep it built maps `/pulls?state=open` to head SHAs, so a
`gh-readonly-queue/**` head is structurally invisible to it, and its own
motivating case — the pr-2738 group, 42 minutes all-green, merged 30 seconds
after one manual re-run — is exactly the case that sweep cannot reach. The tail
watch is what closes that half.

| what was measured | result |
|---|---|
| eligible completions vs evaluations, 2026-09-10T10:00–16:00Z | 178 completions of listed workflows on non-`main` branches → 172 `PR gate` runs; **13 completions produced no run at all** — not cancelled, not skipped: never created |
| the shape of the drops | multi-minute windows, not isolated events (14:09–14:18, 15:22–15:31, 15:56–15:58). **9 of the 13 were on `gh-readonly-queue/**` refs**, against 71 of the 178 completions (40%) — over-represented, though n=13 is too small to call it more than that |
| parks, last 30 merged PRs | of 22 whose gate never went red first, **10 parked ≥5 min fully green**; #2846 14 min, #2845 43 min, #2819 46 min, #2674 58 min |
| each park's cause | exactly one missing dispatch. #2819: last check completed 05:49:11Z, last evaluation created 05:48:26Z, **zero `PR gate` runs repo-wide until 06:35:29Z** — one eligible completion in that window, no run for it |
| tail size at the last delivered evaluation | outstanding checks: median 1, max 7. Minutes from it to the last completion: median 1.2, 9 of 10 within 5, max 16.9 |
| the cancellation theory (#2822) | **not the cause.** 479 of 759 `workflow_run` evaluations in 21 hours are still `cancelled` after `cancel-in-progress: false` — GitHub evicts a superseded *pending* run regardless of the flag — but a sample of 15 had **zero jobs**: they cost no runner, and the newest arrival, which is the tail one, is never the evicted one |
| the read-after-write race theory | **not the cause.** An evaluation dispatched *by* a completion reads the check-runs API strictly after it |
| the cron | six consecutive `schedule` runs gapped 2.0, 4.5, 4.6, 4.5 and 3.6 hours against a `*/15` request |

So there is **one** mechanism: `workflow_run` delivery drops ~7% of dispatches,
and a drop on a SHA's *last* completion leaves nobody to re-evaluate it. The
tail watch is the remedy, and it is mutation-proved in
`test/system/pr-gate.test.ts` — the CONTROL arm replays #2819's timeline through
the pre-fix code path and shows the only verdict ever published is
`in_progress`.

Two claims this measurement **deleted** rather than qualified:

- *"Re-running a red check to green does not re-evaluate the gate — the
  dispatch does fire but no verdict reaches the head SHA."* Both halves were
  wrong. On #2773 the re-run of `Behavioral e2e — Java` completed at 14:41:09Z
  and the repo-wide `PR gate` run list has **no run** between 14:38:40Z and
  14:43:27Z. The dispatch did not fire. There is no separate red-check-re-run
  hole; it is the same dropped tail dispatch.
- *"NOTHING here cancels"* — `pr-gate.yml`'s concurrency block, after #2822.
  Cancellation of *pending* runs is routine, unaffected by the flag, and
  harmless (see the table). Note this section never made that claim: #2835
  already recorded that cancellations do not go to zero and that the metric to
  read is parked groups, not cancel counts. It was the workflow comment that
  overstated it.

**The tail watch is also the in-queue backstop**, which nothing else is. A
merge-queue head receives evaluations on the same two paths a PR head does —
the `merge_group: checks_requested` arm when the group forms, and
`workflow_run` completions from inside the group (`branches-ignore` lists only
`main`, deliberately) — and the single-SHA path in `scripts/pr-gate.mjs` is
shared, so a queue head arms and runs the watch identically, bounded to one
watcher per SHA by the same SHA-keyed concurrency group. The sweep cannot do
this: it enumerates open PRs, and a queue ref is not one.

One residual, stated rather than fixed: **the formation evaluation cannot arm
the watch.** At `checks_requested` no check has reported yet, and
`shouldWatchTail` requires `pending < total` — the conjunct that stops the watch
parking a runner from PR-open, which it would otherwise do on every PR. So an
in-queue head needs at least one `workflow_run` dispatch to land while ≤8 checks
are outstanding. If every one of them is dropped, the group parks and its only
bound is the queue's 180-minute checks timeout, which ejects rather than heals.
With 22 gates wired into the queue there are ~22 chances for one to land, but
that is a probability, not a guarantee — if in-queue parks survive this change,
that is the gap to close, and the fix is a formation-time arm with its own
budget, not another sweep.

The recovery levers, unchanged: **re-run the `pull_request`-event `PR gate` run
for that head** (cheapest — it re-evaluates the same SHA and costs no other CI),
or push a new SHA (restarts ~50 workflows).
- **A `pr-gate` success you read a minute ago is not a licence to merge.**
  Observed twice on 2026-08-16 (#2561, #2576): every check on the head SHA
  read `success`, `pr-gate` included, and the merge API still refused with

  ```
  405 Repository rule violations found
  Required status check "pr-gate" is expected.
  ```

  Both times the fix was the same — merge `main` into the branch, push, let the
  fan-out re-run, merge — so it clears rather than blocks; it costs one full CI
  cycle (~45 min under load). The CAUSE is not diagnosed. Two candidates, and
  the obvious one is ruled out: it is **not** "branch must be up to date",
  because the attempt that finally succeeded was itself one commit behind
  `main`. What is left is a race — the gate re-posts on every `workflow_run`
  completion (and on the sweep, which now rides that same stream), so the
  ruleset may be reading a
  newer `pr-gate` run than the one the API just showed you — or a propagation
  delay on the Checks-API-posted run. If you hit it: re-read the gate's
  CURRENT state rather than trusting the one you fetched, and if it is
  `in_progress`, wait instead of merging.
- **How many evaluations a PR head gets is NOT observable the way this repo
  kept measuring it — and the one unfiltered census disagrees with #2859 on
  what the correct measurement shows.** A `workflow_run`-triggered run is
  attributed to the repository's DEFAULT BRANCH. Measured 2026-09-10 over the
  100 most recent runs of `pr-gate.yml`, **all 91** that were
  `event=workflow_run` carry `head_branch: main` and `head_sha` = `main`'s
  head, whatever PR SHA they were dispatched to evaluate. So
  `list_workflow_runs(branch=<pr-branch>)` returns exactly ONE `pr-gate` run —
  the `pull_request`-event one — and a PR's own check-runs list carries
  exactly one `pr-gate-eval` for the same reason. **Neither view can
  distinguish "no evaluation fired" from "evaluations fired and are invisible
  here."** That retires every branch-filtered claim this file used to make
  (#2464's "no eval fired", and the like). To count evaluations, list
  `pr-gate.yml`'s runs **unfiltered** and read `event` + `created_at`.

  Two measurements did exactly that on 2026-09-10 and reached different
  conclusions, and both are recorded here pending the owner's ruling:

  | measurement | method | finding |
  |---|---|---|
  | #2859 | 100 most recent runs, unfiltered, plus two green PRs timed end to end | verdicts flip **late**, not never (14m18s on #2846, 11m48s on #2847 — see the table below); a park's cause is undiagnosed |
  | Wave C0 packet 0.3 (#2863, `M-T9.57`) | `/actions/workflows/pr-gate.yml/runs?created=<10:00–16:00Z>` unfiltered, every completion of a listed workflow on a non-`main` branch matched by time | **178 eligible completions → 172 `PR gate` runs of any event; 13 produced no run at all** (never created), clustered in multi-minute windows, 9 of 13 on `gh-readonly-queue/**`; ten of the last 30 merged PRs parked ≥5 min fully green, each on one missing dispatch on the SHA's last completion |

  Whichever is right, the gate does not depend on `workflow_run` delivery
  alone. The tail watch above is the in-run answer (bounded: it arms only on
  a near-green SHA, `pending < total`, one watcher per SHA, 15 minutes — so if
  the packet's premise is wrong it costs one runner briefly on a SHA about to
  go terminal), and two older defenses remain: the trigger carries
  `branches-ignore: [main]`, so the ~60 push-to-main completions per merge
  stop creating (skipped) eval runs at all — the storm source; and the
  **sweep** re-derives the verdict for every open PR and posts only where it
  differs from what's published. Both are pinned by
  `test/system/pr-gate.test.ts`. The sweep is a reconciler, not a backstop for
  a dropped dispatch: it rides the same event stream, and
  `fetchOpenPrHeads` maps `/pulls?state=open` to head SHAs, so it enumerates
  **open PRs only** — a `gh-readonly-queue/**` head is not a PR head and is
  invisible to it. That was the known gap left by #2835, and the tail watch
  is what covers it.

  **What the latency actually looks like**, measured 2026-09-10 on two green
  PRs that reached a terminal verdict with no human lever:

  | PR | last non-`pr-gate` check completed | `pr-gate` went terminal | lag |
  |---|---|---|---|
  | #2846 | 15:36:35Z | 15:50:53Z | 14m18s |
  | #2847 | 16:12:20Z | 16:24:08Z | 11m48s |

  So the shape #2859 expects under load is a LATE verdict, not an absent one:
  the final evaluation is dispatched by the last completion, sits queued while
  the pool is saturated, then reads a fresh snapshot and publishes. #2859
  **rejected** a tail re-read on that reading (nothing in its record showed a
  final evaluation publishing a non-terminal verdict off a stale read, and an
  evaluation that sleeps re-introduces the runner parking v1 died of). The
  tail watch that landed with Wave C0 (above) is narrower than what was
  rejected — it never sleeps on a SHA that is not already near-green, so it
  cannot park a runner from PR-open — and it answers the packet's finding
  (a dispatch that never arrives), not a stale read. The two measurements
  are laid out side by side below.

  `gh-readonly-queue/**` was ignored alongside `main` and no longer is.
  `pr-gate` is a **required** check, and GitHub applies one required-checks
  list to a pull request and to a merge group alike — there is no per-context
  list to leave it out of, so it has to be able to report inside the queue.
  Its `merge_group:` arm posts one evaluation when the group forms, when every
  other check is still pending; ignoring completions from inside the group
  would leave nothing to move that verdict off `in_progress`, and the entry
  waits forever. That is the stall observed on 2026-09-07: entries formed, ran
  their whole sweep green, and sat with zero runs left, `PUT /merge` answering
  `Required status check "pr-gate" is expected`. Pinned by the
  "pr-gate stays IN the queue" block in
  `test/system/merge-queue-readiness.test.ts`.
- **The sweep rides repo ACTIVITY, not the cron.** The workflow asks for
  `*/15`, and this doc, `pr-gate.yml` and `scripts/pr-gate.mjs` all used to
  claim it therefore capped a dropped-event outage at one interval. Measured,
  it does not. Re-measured 2026-09-10: the 30 most recent `schedule`-event
  runs of `pr-gate.yml` span **100.9 hours** — mean gap **3.48 h**, median
  **3.49 h**, shortest gap anywhere in that window **91 min** — not one
  15-minute gap in 29. (The earlier reading of the same call was 4.7 h /
  4.6 h / 110 min, so the order of magnitude is stable and the exact numbers
  are not. Re-measure rather than quoting these: list the workflow's runs
  filtered to `event=schedule` and diff `created_at`.) Actions cron is
  best-effort and a high-frequency schedule on a busy account is heavily
  deprioritised.

  And "slow" was the good case. **Five** of those 30 runs are `failure`, not
  late — 2026-09-09T21:55Z through 2026-09-10T13:37Z, the window in which the
  scheduled sweep collided with its own job-level concurrency group (#2835,
  fixed in #2846). For those ~16 hours the idle backstop was not slow, it was
  absent.

  That is the setting for #2819 on 2026-09-09: **all 241** of its checks green
  or skipped, gate still blocking for ~46 minutes — its last check completed
  at 05:49:10Z, the next evaluation VISIBLE on the head is a hand re-run
  (`pull_request`-event `pr-gate-eval`) at 06:34:59Z. The head's own
  check-run record cannot say whether a `workflow_run` evaluation ran in
  between (the measurement trap above). The packet's unfiltered listing says
  none did: no `PR gate` run of any event existed repo-wide between 05:48:26Z
  and 06:35:29Z, with exactly one eligible completion in that window — and
  that timeline is what the tail watch is mutation-proved against. #2859
  reads the same park as "measured duration, undiagnosed cause".

  So the sweep is now a **second job** in `pr-gate.yml` that also fires on
  `workflow_run` — the one event stream this repo produces both reliably and
  in volume. Two brakes keep it affordable, since a sweep costs one call to
  list open PRs plus a paged check-run fetch per PR:

  | brake | what it does |
  |---|---|
  | `endsWith(format('{0}', github.run_number), '0')` | one sweep per ten evaluations — no API call to decide, deterministic, and it scales with activity, which is the right correlate because a park can only happen where events flow. (GitHub expressions have no arithmetic, hence a last-digit string test rather than a modulo.) **Measured 2026-09-10 under a fleet burst: 91 evaluations in 18.4 min (~300/h), of which 10 were sweep-eligible and exactly 1 survived — the other 9 were cancelled as superseded *pending* runs, taking their sweep job with them. So the DELIVERED cadence was ~1 sweep per 18 min, not the ~4/h the arithmetic suggests.** |
  | a **constant** job-level concurrency group | the workflow-level group is keyed per SHA, so it would let sweeps for different SHAs pile up. One shared group is capped by GitHub at one running plus one pending, with a superseded pending cancelled. |

  It never runs on `pull_request` or `merge_group`, so it never posts a check
  run onto a SHA the gate evaluates; on those paths it is skipped, and because
  a skipped job still surfaces as a check run, `pr-gate-sweep` is in
  `SELF_NAMES`. Pinned by `test/system/pr-gate.test.ts`, including a control
  arm that fails if the reader stops finding the job at all.

  Both levers for a parked gate work; see the measurement section above for
  what does not (re-running the red check itself) and why.

  | lever | works? | evidence |
  |---|---|---|
  | a new SHA | **yes** | #2812 was parked on `5e0995d` and unparked the moment `027454e` was pushed |
  | a re-run of a workflow on the branch | **yes, since #2822** | it did not before — measured twice, on #2812 and #2792, where `rerun_workflow_run` returned 201 and no verdict ever reached the head SHA. The cause was `cancel-in-progress`, now settled and fixed (below) |

  **"Is my PR actually in the queue?" — ask the merge API, not the refs.**
  The obvious probe is wrong.
  `git ls-remote origin 'refs/heads/gh-readonly-queue/*'` lists the refs of
  merge-queue **batches that are currently running**; the ref name embeds the
  batch's base SHA (`gh-readonly-queue/main/pr-<n>-<sha>`), and it does not
  exist until the entry's batch forms. Its silence therefore says nothing
  about a PR that has been accepted into the queue. Reading it as membership
  is what sent one session down two dead diagnoses — a `cancel-in-progress`
  cancellation already fixed by #2822, and a "rejected auto-merge method" that
  was really the direct-merge refusal.

  The probe that answers is the merge endpoint itself: it refuses, and the
  refusal names the reason. Verified 2026-09-10 against this repo:

  | PR at the time | `PUT /repos/:owner/:repo/pulls/:n/merge` answered |
  |---|---|
  | #2849 — in the queue, its batch ref present | `405 Pull Request is in the merge queue.` |
  | #2859 — open, draft | `405 Pull Request is still a draft` |

  Read the **message**, not the status code: both are `405`, and only the
  first means "queued". Anything else means it is not queued, and says why.
  Note what makes this safe to run: it is a WRITE endpoint made inert by the
  repository requiring the merge queue on `main`, so do not reach for it
  against a base branch that has no such requirement. There is no read-only
  probe for queue membership today.

  **The sweep's bound, stated honestly.** `sweep()` enumerates
  `GET /pulls?state=open` and reconciles those heads. So:

  | situation | backstop |
  |---|---|
  | an open PR while the repo is busy | the activity-riding sweep — ~1 delivered sweep per 18 min at the burst measured above |
  | an open PR while the repo is idle | the cron alone — mean/median gap ~3.5 h, and absent entirely for the ~16 h #2835 was live |
  | a head **inside the merge queue** | **none.** A merge-group head is not an open PR's head, so no sweep ever re-derives its verdict. Event-driven evaluation does still run there (the `merge_group:` arm, plus `workflow_run` completions from inside the group), but if that stream is what failed, nothing reconciles it: the entry's only bound is the queue's checks timeout, which EJECTS rather than heals. |

  **The cancellation cause, measured and closed.** This passage used to record
  it as "suspected, not proven" and asked for the success-versus-cancelled
  ratio. That ratio: of the last 100 `event=workflow_run` runs of
  `pr-gate.yml`, **94 cancelled, 4 queued, 2 pending, 0 successful**. An
  evaluation takes ~2m20s but sits queued far longer under load, so the next
  completing check superseded it before it ever reached the publish step, and
  the stream never ended. #2822 set `cancel-in-progress` to a flat `false`;
  the demonstration is the pr-2738 merge group, which sat 42 minutes with all
  42 gates green and a cancelled evaluation, then merged **30 seconds** after
  that one evaluation was re-run. Note that cancellations do not go to zero
  afterwards and are not meant to: a superseded *pending* run is still
  cancelled, having burned no runner. Re-measured 2026-09-10 over the same
  call (100 runs of `pr-gate.yml`, of which 91 `event=workflow_run`):
  **66 cancelled, 20 success, 5 queued** — about a fifth of dispatched
  evaluations actually execute. That is by design and it is also the mechanism
  behind the 12–14-minute verdict lag above: under a burst a SHA gets at most
  one running plus one pending evaluation, so its verdict advances twice per
  storm, not forty times. Read parked groups, not cancel counts.

  Separately: `workflow_dispatch` on `pr-gate.yml` can return **403** to a
  GitHub-App token (`rerun_workflow_run` did **not** here — it returned 201),
  so from an agent session a genuine push may be the only lever available.
- The decision core is pure and pinned by `test/system/pr-gate.test.ts` —
  including the fail-closed arms (unknown conclusions, cancelled runs,
  pending-never-green) and the `workflow_run.workflows` list's completeness
  both ways (a workflow missing from the list completes without
  re-evaluating; a stale name re-evaluates nothing).
- **One SHA can carry more than one check suite, and the verdict collapses
  them by name (`latestPerName`) before judging.** The API's `filter=latest`
  dedupes per name *within* a suite only. Marking a draft PR ready fires a
  second event on the same head SHA; the new suite's `cancel-in-progress`
  kills the draft suite mid-flight, and without the collapse the fail-closed
  "cancelled counts as FAILED" rule reads that corpse and reds the PR
  permanently — no re-evaluation or sweep can clear it, because the cancelled
  run never changes. Observed on #2467 and #2477, both green in every
  component check; fixed in #2481. If a PR is ever red with a culprit list of
  `*-passed` rollups that all show green, this is the shape to check first.

**Branch protection requires exactly two checks: `tests passed` and
`pr-gate`.** Everything else stays non-required by name but becomes *binding
through pr-gate* the moment it triggers.

Now that the queue is on, these two are the **entry** bar — what a PR must
clear to be enqueued — and the queue's own required set (the manifest below)
is the **landing** bar, evaluated on the rebased candidate. Keeping `pr-gate`
required is deliberate: dropping it would let a PR that is red on its own
branch consume a queue slot and a full heavy run before being ejected.

> **Unverified from here:** the *contents* of the branch-protection required
> list are repo settings, not something any file in this repo can assert.
> If you are auditing, read them in Settings → Rules and reconcile against
> [`test/system/merge-queue-required-checks.ts`](../test/system/merge-queue-required-checks.ts).

## Draft PRs and the runner queue

The account's GitHub-hosted runner pool allows ~20 concurrent jobs
(Free plan), and a substantive PR push fires 30–50 jobs across the fan-out.
With this repo's claim-first culture — every PR *starts* as a draft and
pushes repeatedly while in progress — draft pushes were the bulk of the
queue load, and the queue was the bulk of CI latency (jobs have sat queued
for an hour before starting).

So the fan-out is **draft-gated**: on a draft PR only the fast lane runs —
`test.yml` (the required floor), `langium-generated`, `workflow-lint`, and
`pr-gate` (which waits on whatever ran). Every other per-PR workflow carries

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
jobs:
  <entry-job>:
    if: github.event_name != 'pull_request' || github.event.pull_request.draft == false
```

Marking the PR **ready for review** fires the full fan-out (that's what the
`ready_for_review` type is for), and every push after that runs it too. The
`if` sits only on entry jobs — `needs:`-chained jobs cascade-skip, and the
`<stem>-passed` rollups treat skipped needs as OK, exactly as in the merge
queue. `pr-gate` also triggers on `ready_for_review`, so its verdict always
covers the full set. Drafts can't merge anyway, so nothing is lost — a
draft gets fast feedback, and "ready" means "now spend the fleet on me."

The label-gated heavy workflows (`run-tenancy`, `run-channels`, …) are
deliberately NOT draft-gated: applying the label to a draft is an explicit
request and still works. The converse is why a promotion must *drop* `labeled`
from `types:` rather than keep it alongside the new `pull_request` types —
`test/system/draft-gate.test.ts` classifies a workflow carrying `labeled:` as
label-opt-in and stops requiring the guard, so a half-promoted file rejoins the
draft fan-out unchecked.

One deliberate side effect of the slot economy: `test.yml`'s `web-tsc` job
was folded into its `lint` job (`lint + web-tsc`) — each half was ~1 minute
of mostly-install, and a runner slot is the scarce resource here, not
wall-clock. The playground typecheck + DDL guard thereby joined the
`tests passed` rollup, which only makes the floor stricter.

## Enabling the merge queue (the structural fix)

A merge queue runs the required checks on the **rebased** merge candidate
before it lands, so the exact combination that will be on `main` is what gets
gated — this is what closes the "never ran on the PR" hole for the push-only
gates without charging every push.

### What the queue requires, and what it does not

**Branch protection requires exactly two names — `tests passed` and
`pr-gate`** (verified against the repo's settings, 2026-09-08).  There is no
22-name required list configured, and nothing here should be read as saying
there is: `merge-queue-required-checks.ts` describes which gates are WIRED
into the queue, not which names branch protection waits on.

That distinction is easy to lose because it does not change what is binding.
`pr-gate` fails on any non-passing check run present on the head SHA, so
every gate that RUNS in a merge group gates it, required by name or not.
Which is exactly why the lever is the trigger and not the manifest: 22 gates
now carry `merge_group:` and the other 18 do not, so those 18 neither run nor
cost a runner slot in the queue.  Marking them "not required" would have
changed nothing on its own.

The split is read off the workflows rather than judged, and
`merge-queue-readiness.test.ts` ratchets it BOTH ways: a `queueRequired: true`
row must carry the trigger, a `queueRequired: false` row must not.

The queue exists to catch one thing per-PR CI structurally cannot: two PRs
each green against their own base and red combined. The live instance is
#2739 adding `??` to the grammar while #2761 pinned `??` as a parse error —
each green alone, `main` red on the merge. **`tests passed` caught it.** No
per-backend docker boot could have.

Every gate here carries `pull_request:`, so the trigger says nothing. The
`if:` guard on the required job decides it, and there are exactly two idioms:

| guard | meaning | in the required set? |
|---|---|---|
| `github.event_name != 'pull_request' \|\| draft == false` | runs on every non-draft PR **and** again in the queue | **no** — the queue run is a re-run; the entry's own head already ran it, and `pr-gate` (a required check) is green only if it passed |
| `github.event_name != 'pull_request' \|\| <run-* label>` | needs a label on a PR; `merge_group` is not `pull_request`, so **the queue is its only run** | **yes** — dropping one deletes the coverage rather than saving cost |

So the 18 excluded are every docker-booting per-backend leg (8 `behavioral-*`,
5 `*-obs-e2e`, 4 native `*-oidc-e2e`) plus the `pages` build. The four kept on
the second row are `tenancy-e2e`, `migration-evolution-e2e`,
`elixir-oidc-compose-e2e` and `auth-oidc-compose-e2e` — the post-merge blind
spot named at the top of this file. **Trimming for cost must never reach
them**, and `merge-queue-readiness.test.ts` enforces that: it reads each job's
guard (following `needs` for rollups, whose own `if:` is `!cancelled()`) and
fails if a `runs-on-every-pr` waiver is really label-guarded, or a
`queueIsOnlyRun` row is really draft-guarded.

**The cost being accepted:** a PR-interaction bug that manifests *only* in a
booted per-backend stack can now reach `main`. Judged unlikely — an emitter
collision bad enough to break a booted backend would almost certainly break
`corpus-build-passed` (corpus × 5 backends) or headless `behavioral` first —
but not zero. If it happens, the fix is to promote that one gate back, not to
restore all 18.

### Status: LIVE since 2026-09-07.

Every workflow in the required set (a) carries a `merge_group:` trigger,
(b) exposes exactly **one stable check name** suitable for branch-protection
"required status checks", and (c) behaves correctly on a `merge_group` event.
The queue is switched on and enforced; the runbook below is kept as the
record of how it was configured and how to change it.

The set is written down once, in
[`test/system/merge-queue-required-checks.ts`](../test/system/merge-queue-required-checks.ts),
which is the **source of truth** — the table below is a rendering of it.
`test/system/merge-queue-readiness.test.ts` (fast suite) asserts against the
real workflow files that every entry exists, has `merge_group:`, resolves to a
real job, and — for rollups — is `always()` over a non-empty `needs`. Drift is
a red per-PR test today rather than a stalled queue on flip day.

Two shapes of check name:

- **Single-job workflows** expose the job's own name (its `name:` if declared,
  else its job id). Nothing was added to these.
- **Matrix / multi-job workflows** cannot: their cell names are dynamic
  (`${{ matrix.backend }} × …`) and un-nameable in branch protection. Each got
  one `<file-stem>-passed` rollup job — `if: always()`, `needs:` every job in
  the workflow, fails when any need failed or was cancelled. A *skipped* need
  counts as OK, which is what makes a label-guarded job legitimate on an
  unlabelled PR run (in the queue it actually runs).

#### The required-checks list (40)

Per-PR lane — cheap, already runs on every push:

| Workflow | Required check name |
|---|---|
| `test.yml` | `tests passed` |
| `langium-generated.yml` | `check` |
| `workflow-lint.yml` | `workflow-lint` |
| `hono-build.yml` | `build-generated-ts` |
| `dotnet-build.yml` | `build-generated-dotnet` |
| `java-build.yml` | `build-generated-java` |
| `python-build.yml` | `build-generated-python` |
| `elixir-vanilla-build.yml` | `elixir-vanilla-build-passed` |
| `corpus-build.yml` | `corpus-build-passed` |
| `corpus-elixir-build.yml` | `corpus-elixir-build-passed` |
| `generated-react-build.yml` | `generated-react-build-passed` |
| `generated-vue-build.yml` | `generated-vue-build-passed` |
| `generated-svelte-build.yml` | `generated-svelte-build-passed` |
| `generated-angular-build.yml` | `generated-angular-build-passed` |
| `generated-feliz-build.yml` | `feliz-build` |
| `generated-flutter-build.yml` | `flutter-build` |
| `conformance-parity.yml` | `parity` |
| `behavioral-e2e.yml` | `behavioral` |

Queue-heavy lane — the docker/boot gates. Several of these are no longer
`push:main`/label-only (the `behavioral-e2e-*` legs, the five `*-obs-e2e`, the
four native `*-oidc-e2e` and `pages` fire per-PR path-scoped); they are listed
here because the queue must run them *unconditionally* on the rebased
candidate, not only when a path matches:

| Workflow | Required check name |
|---|---|
| `behavioral-e2e-dotnet.yml` | `behavioral-dotnet` |
| `behavioral-e2e-java.yml` | `behavioral-java` |
| `behavioral-e2e-python.yml` | `behavioral-python` |
| `behavioral-e2e-elixir.yml` | `behavioral-elixir` |
| `behavioral-e2e-dapper.yml` | `behavioral-dapper` |
| `behavioral-e2e-mikroorm.yml` | `behavioral-mikroorm` |
| `behavioral-ui-e2e.yml` | `behavioral-ui` |
| `behavioral-heex-ui-e2e.yml` | `behavioral-heex-ui` |
| `tenancy-e2e.yml` | `tenancy-e2e-passed` |
| `hono-obs-e2e.yml` | `hono-obs-e2e` |
| `dotnet-obs-e2e.yml` | `dotnet-obs-e2e` |
| `java-obs-e2e.yml` | `java-obs-e2e` |
| `python-obs-e2e.yml` | `python-obs-e2e` |
| `elixir-vanilla-obs-e2e.yml` | `vanilla-obs-e2e` |
| `hono-oidc-e2e.yml` | `hono-oidc-e2e` |
| `dotnet-oidc-e2e.yml` | `dotnet-oidc-e2e` |
| `java-oidc-e2e.yml` | `java-oidc-e2e` |
| `python-oidc-e2e.yml` | `python-oidc-e2e` |
| `elixir-oidc-e2e.yml` | `elixir-oidc-compose-e2e` |
| `auth-oidc-compose-e2e.yml` | `auth-oidc-compose-e2e` |
| `migration-evolution-e2e.yml` | `migration-evolution-e2e-passed` |
| `pages.yml` | `pages-passed` |

> **`tests passed`, not `tests-passed`.** `tests-passed` is the *job id* in
> `test.yml`; the check-run name GitHub reports is the job's `name:`, which is
> `tests passed`. Branch protection matches the check-run name. Paste the name
> from this table, and do not rename that job — it is the only required check
> `main` has today.

Everything *not* in these two tables stays out of the queue — `conformance-full`,
`differential-report`, `channels-e2e`, `api-call-e2e`, the `k8s-*` gates, the
`generated-*-e2e` SPA smokes, `playground-*`, `frontend-fullstack-e2e`,
`generated-a11y`, `phoenix-ui-e2e`, `elixir-vanilla-vo-e2e`, `ci-red-alarm`,
`cleanup-artifacts`, `email-e2e`, `context-integration-e2e`. They must **not**
be added to required checks (a required check with no `merge_group` trigger
stalls the queue forever). Note that "out of the queue" is not "out of the PR":
the four `generated-*-e2e` smokes and `elixir-vanilla-vo-e2e` now run per-PR
path-scoped and are binding through `pr-gate` — they simply have no
`merge_group:` trigger, so they cannot be required names. Pulling one in is the
recipe below.

### The activation runbook (repo settings — the only remaining step)

Nothing below is code; it is an admin action on `github.com/lemmit/Loc`.

1. **Do not remove `tests passed` at any point.** It stays required from the
   first click to the last, so there is never an unprotected window.
2. **Settings → Rules → Rulesets** (or **Settings → Branches → branch
   protection rule for `main`**, if the repo is still on classic protection).
   Target branch: `main`.
3. Enable **Require merge queue**. Configuration in force, and why:
   - merge method: **Squash** (matches how `main` lands today);
   - build concurrency: **1** (2026-09-08, after 5 → 3 → 1 in one day).
     Speculative groups are only worth their cost when the pool has slack, and
     this pool does not.  Each extra concurrent group runs the WHOLE
     merge_group gate set, so at 3 a three-PR batch costs ~120 jobs on top of
     every open PR's own checks — and one open PR here routinely spawns 200+.

     Measured, not inferred: at concurrency 3 on 2026-09-08 the queue built
     three speculative prefixes ([A], [A,B], [A,B,C]) for 93 minutes and
     merged nothing; **300 workflow runs were queued against 13 running**, and
     23 of the batch's own jobs had not STARTED 93 minutes after creation.
     Every group that succeeded earlier the same day, at lower load, finished
     in 35-45 minutes.  Starvation, not slow tests — and a starved group
     eventually ejects on the queue's timeout having merged nothing, which is
     how #2786 and #2804 were lost that afternoon.

     Raise it again once the queue set is 22 rather than 40 (the trim in this
     PR): three prefixes then cost ~66 jobs instead of ~120, and the
     arithmetic changes.  Re-measure the queued-vs-running ratio before and
     after rather than assuming.
   - minimum group size **3**, maximum **3**, wait **10 min**. Batching is not
     just throughput here: a group RE-FORMS whenever the PRs ahead of it
     change, restarting its whole gate set, and this repo lands PRs from
     parallel agents continuously. On day one a single PR went through four
     successive entries in three hours, two of which had already passed
     `tests passed` when they were discarded. Grouping PRs into one entry is
     what stops that churn.
   - "Require all queue entries to pass required checks": **off, and leave it
     off for now.** It is NOT what makes the trim below sound — that was this
     doc's claim and it was wrong. What makes the trim sound is `pr-gate`: a
     PR reaches the queue through auto-merge, auto-merge waits on the required
     checks, `pr-gate` is one of them, and `pr-gate` is green only when every
     check that ran on the PR's head passed — the 18 trimmed gates included.
     So the entry's own head is verified either way.

     What enabling it would buy is FAILURE ISOLATION: with it off, only the
     group's head commit must pass, so one bad entry fails the whole batch and
     GitHub bisects to find it. What it COSTS is the part that decides the
     question, and it is easy to get wrong because `pr-gate` looks cheap: each
     *evaluation* takes seconds, but as a REQUIRED CHECK it does not go green
     until everything else on that SHA has finished — it reports `in_progress`
     until then, so its wall-clock is the slowest gate in the set. Requiring
     it per entry therefore means running the WHOLE merge_group gate set on
     every entry's intermediate commit — up to 5× per group at maximum size,
     not one extra fast-suite run — which cancels most of the reason to batch.

     The cheap version of the same protection is a smaller **maximum group
     size**, and that is what is configured: max **3**, lowered from 5 on
     2026-09-08. Still one gate-set run per batch, but a failure implicates
     three PRs rather than five — which matters here, because the common batch
     failure in this repo is not a bad PR but two PRs that conflict with each
     OTHER, and today produced four such pairs in a day. Revisit enabling the
     setting once the queue set is 22 rather than 40 and the docker
     behavioural legs — the long pole — are out of it; per-entry validation is
     affordable then.
4. Enable **Require status checks to pass**. The repo requires **two** names
   today (`tests passed`, `pr-gate`), which is sufficient because `pr-gate`
   aggregates everything that ran. Requiring the 22 by name instead is the
   stricter alternative — it stops a dropped/renamed workflow from going
   unnoticed — and if you take it, add **exactly** the 22 names
   marked `queueRequired: true` in the manifest. Add them by pasting the name —
   the search box only offers checks GitHub has seen recently.
5. Save. From then on, PRs merge via the queue: GitHub builds a rebased
   candidate, runs the 22 required checks on it, and lands it only if they are green.
6. **Watch the first day.** A check that never reports leaves candidates
   pending — if that happens, the cause is a missing `merge_group:` trigger or
   a mistyped check name. `npx vitest run test/system/merge-queue-readiness.test.ts`
   re-verifies the workflow half in ~1s; the mistyped-name half is settings-only.

To pull a further gate into the queue later: add `merge_group:` to its `on:`
block, give it one stable check name (a `<stem>-passed` rollup if it is a
matrix), add the row to `test/system/merge-queue-required-checks.ts` — the
readiness test will then fail until the workflow matches — and add the name to
the required-checks list in settings.

**Scriptable alternative.** The same configuration can be applied as a repo
ruleset via `gh api --method POST /repos/lemmit/Loc/rulesets` with a
`merge_queue` rule plus a `required_status_checks` rule whose
`required_status_checks[]` are the 22 required names above. It is the reproducible path
and worth capturing once the settings are stable, but the UI path is primary:
ruleset JSON silently accepts check names that do not exist, which is the one
mistake that stalls the queue.

### The wait window has to cover the SLOWEST check, not the average

**Measured 2026-09-08.** With the window at GitHub's 60-minute default, `main`
sat at one commit for roughly four hours: entries for #2786, #2804, #2792 and
#2766 each formed, ran the ~40-check heavy set, and were removed without
merging — then the next entry re-formed on the *same* base and re-rolled the
same dice. Two independent causes, and it takes both to explain the rotation:

1. **A required check went red.** `java-obs-e2e` failed on two candidates — a
   docker probe that read its own timeout as "docker is missing" (fixed in
   #2816). `scripts/pr-gate.mjs` also fail-closes a `cancelled` run into red,
   which took a third candidate whose every step had concluded `success`.
2. **A fully green group ran out of window.** On a saturated pool the queue
   times are not the job times: measured on one group,
   `generated-angular-build` was queued 86 min and `elixir-vanilla-build`
   51 min, both against a 60-minute limit. Nothing was failing; the candidate
   simply could not finish being checked in time.

Raising the window to **120 minutes** cleared it — the very next entry merged.
So size the window against the slowest check's *queued + run* time under load,
not its runtime on an idle pool, and re-measure it whenever the required set
grows. Trimming that set is the other half of the same lever.

Symptom to recognise: the `gh-readonly-queue/main/pr-*` ref keeps changing PR
number while `main`'s SHA does not move. Enumerate the `merge_group` runs on
each departed ref — if their conclusions are all `success`, it was the window,
not a gate.

### Two merge-group behaviours worth knowing

- **`pages.yml` builds in the queue but never deploys.** The workflow is split
  into `build` (everything: docs render, playground typecheck, DDL unit, Node
  smoke, npm-mirror + vendor + vite build) and `deploy`
  (`if: github.event_name != 'merge_group'`, carrying the `github-pages`
  environment). The split is not cosmetic: the `github-pages` environment is
  branch-restricted to the Pages source, so a job carrying `environment:` would
  be rejected on a `gh-readonly-queue/**` ref *before any step ran* — the queue
  would see a hard failure on every candidate. `pages-passed` rolls the two up.
- **Label guards already pass in the queue.** The uniform idiom
  `github.event_name != 'pull_request' || github.event.label.name == '<label>'`
  short-circuits to `true` on `merge_group`, so every labelled gate runs
  unconditionally on a merge candidate with no edit. The readiness test pins
  that: a required job whose `if:` reads `github.event.pull_request` or
  compares `event_name` must use this idiom.

## Force a post-merge gate with a label

The push-only gates are invisible on a PR — the queue catches them on the
candidate, but only *after* you enqueue, so a surprise there costs a full
heavy run and an ejection. To see one before that, use a **label trigger**:
each of those gates carries a `pull_request: types: [labeled]` trigger plus a job-level `if`
that runs the job *only* when a specific label is present. Add the label to a
PR and the otherwise-post-merge gate runs against that branch before merge.

The label names a **feature / blast-radius**, and one label fires every backend
of that feature at once — agents reason about *what they touched* ("I changed
the OIDC emitter"), not about the workflow-file inventory. So there is no
per-workflow label (`run-hono-oidc`), and no single mega `run-e2e` grab-bag —
the size that matches the blast radius is one label per feature family:

| Label | Fires | Notes |
|---|---|---|
| ~~`run-obs`~~ | — | **No longer bound to anything.** The five `*-obs-e2e` legs are per-PR path-scoped since wave G1; the label drives no workflow and applying it does nothing. |
| `run-oidc` | `elixir-oidc-e2e` + `auth-oidc-compose-e2e` | The two *compose* OIDC legs only. The four native legs (`hono/dotnet/java/python-oidc-e2e`) are per-PR path-scoped since wave G1 and no longer answer to the label. |
| `run-tenancy` | `tenancy-e2e` | already a 10-leg matrix internally |
| `run-migration-e2e` | `migration-evolution-e2e` | migrate-chain ≡ fresh-create + data-survival, 5 SQL backends |
| `run-conformance` | `conformance-full` | cross-backend runtime conformance |
| `run-channels` | `channels-e2e` | cross-deployable eventing |
| `run-differential` | `differential-report` | the nightly all-pairs DISCOVERY sweep over the wider compose stack. The **enforcement** half is no longer here: since M-T9.11 slice (c) each backend diffs its recorded responses against `test/behavioral/wire-golden/` inside its own `behavioral-e2e*.yml` leg, so runtime-value parity is a per-PR blocking gate needing no label |
| `run-e2e` | `phoenix-ui-e2e`, `playground-e2e` | legacy cluster — a coherent Phoenix/playground group, *not* a run-everything button. `elixir-vanilla-vo-e2e` left this cluster in wave G1 (per-PR path-scoped). |
| `frontend-fullstack` | `frontend-fullstack-e2e` | non-React fullstack round-trip |
| `a11y` | `generated-a11y` | axe-core WCAG-AA scan |
| `e2e-k8s` | `k8s-e2e` | kind-cluster smoke |

The job `if` is uniform: `github.event_name != 'pull_request' || github.event.label.name == '<label>'`
— so push, `merge_group`, and `workflow_dispatch` always run; a PR runs the gate
only when tagged with that exact label. (`migration-evolution-e2e` spells the
same rule as `contains(github.event.pull_request.labels.*.name, 'run-migration-e2e')`
because it also accepts `synchronize`, so a push to an already-labelled PR
re-runs it.) Concurrency on these files is keyed so that a labeled PR run
never collides with or cancels a `push:main` run — some use `github.ref`, some
`github.event.pull_request.number || github.ref`; read the file rather than
assuming one shape. A *promoted* gate is different: it must use the PR-aware
key with `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`, so a
superseded PR push cancels its own in-flight run instead of leaking a runner
slot, while `push: main` runs keep per-commit attribution.

This is a manual pre-merge check, **not** a replacement for the merge queue
above — the queue is the structural fix; labels are the interim "80/20."
**When you add a new post-merge gate, wire it to the matching `run-<feature>`
label (or mint a new one) and add a row here + in `CLAUDE.md`.**

## Sizing a job's `timeout-minutes`

**A timeout is not a flake.** When a job is cancelled at its cap, nothing
misbehaved — the budget was set below the work. Re-running it is not a
diagnosis, and on a saturated pool it costs another full slot to re-roll the
same dice. So a budget is a measurement, not a round number.

### The rule

```
timeout-minutes = max(10, ceil_to_5min( p95(job execution time) × 1.5 ))
```

over **at least 10 recent successful runs** of that job. 50 % margin over the
p95 covers a leg's own run-to-run variance with room left, and the round-up to
5 minutes keeps the value readable without inviting a fresh guess.

Three things the definition has to pin down, because each of them was got wrong
here at least once:

- **"Job execution time" is the SUM of the job's step durations.** Not
  `run.updated_at − run.created_at` (queue **plus** run), and not
  `job.completed_at − job.started_at`: the API sets `started_at` at *queue*
  time for some jobs, and one `behavioral-python` entry reads **80m against a
  15-minute cap** for exactly that reason. Steps only exist once a runner holds
  the job, so their sum is what `timeout-minutes` actually gates. On jobs that
  ran cleanly the two agree within ~10s, which is the sanity check.
- **Measure the STEP, but budget the JOB.** The test step is where a leg's time
  and all of its variance live; the prelude (checkout, `setup-*`, `npm ci`,
  toolchain build) is ~35s–1m20s and nearly constant. Read the step to
  understand a leg, but set the cap against the whole job — the cap gates the
  job.
- **A cap that has fired censors its own measurement.** A killed run is not a
  successful run, so it never enters the sample — the cap deletes precisely the
  tail you need in order to size it, and the surviving p95 is a *lower bound*
  that looks reassuringly close to the budget. **Count the kills first.** If a
  leg has any, raise it enough to stop them, let it run uncensored, then
  re-apply the rule. This is not a hypothetical: `behavioral-java` sat at a
  measured p95 of 19m46s against a 20-minute cap — 10 seconds of headroom —
  while separately killing 13 of the ~74 runs that reached a verdict in its
  last 100.

### Re-deriving it

```bash
GITHUB_TOKEN=<token with actions:read> node test/behavioral/ci-budget-report.mjs
```

prints, per behavioral leg: n, median, p95, max, the declared budget, the
headroom at max, the budget the rule asks for, and a loud `CAP KILLS` warning
when the sample is censored. Re-run it when a leg starts getting killed, when
the corpus case list grows materially, or when a backend's build changes.

### Raise, or split?

Both cost something, and the trade is not symmetric:

- **Raising** the cap is a legitimate fix and needs no apology — but a
  genuinely hung job then holds a runner slot for longer, against a pool of
  ~20.
- **Splitting** bounds each half, but spends a second slot *on every run* (not
  just hung ones), re-pays the prelude, and needs a shard manifest — the
  behavioral runners take an explicit case list, so a new corpus case that no
  shard names would run in neither half. A split that silently drops cases is
  worse than a slow leg.

Prefer raising unless the leg is slow enough that its own variance no longer
fits any sane budget. **A leg that is slow is a different problem from a leg
that is tight-budgeted, and it wants a different fix** — the budget stops the
bleeding, cutting the runtime is the repair.

### The 2026-09-10 baseline

All seven behavioral legs, measured at step level from the Actions API
(`behavioral-java` at n=40, the rest at n=15):

| leg | test-step median | job p95 | job max | was | now |
|---|---:|---:|---:|---:|---:|
| `behavioral-e2e` (node) | 2m47s | 3m24s | 3m25s | 15m | **10m** |
| `behavioral-e2e-python` | 3m41s | 4m37s | 4m37s | 15m | **10m** |
| `behavioral-e2e-java` | 17m56s | 19m46s † | 19m50s | 20m | **30m** |
| `behavioral-e2e-dotnet` | 7m08s | 8m19s | 8m19s | 20m | **15m** |
| `behavioral-e2e-dapper` | 6m00s | 7m14s | 7m18s | 20m | **15m** |
| `behavioral-e2e-mikroorm` | 9m22s | 10m35s | 10m35s | 25m | **20m** |
| `behavioral-e2e-elixir` | 10m14s | 11m27s | 11m34s | 30m | **20m** |

† censored — see the third bullet above.

Six of the seven were **over**-provisioned by 57–77 %, which is its own cost: an
over-wide cap is how long a hung job squats a slot. Fixing the class rather than
the one leg that was visibly bleeding therefore *pays for itself* — worst-case
slot exposure across the tier drops from 145 to 120 minutes even though Java
goes up by 10.

`behavioral-java` remains the outlier that a budget cannot fix: 17m56s median in
the test step against 6m–10m for every other backend leg, because
`run-java.mjs` pays a `gradle --no-daemon bootJar` — cold JVM, full Spring
compile — per corpus case, sequentially. Its run-to-run spread is
13m02s–18m49s; that **5m47s swing alone was 35× the 10s of headroom** the old
cap left, which is why the kills read as random. Cutting that runtime is a
separate mission.

## Guardrails added alongside

- **`workflow-lint.yml`** — validates every workflow file parses (YAML) and
  runs actionlint, on any `.github/workflows/**` change. Catches the
  `startup_failure` class (the dapper bug) on the PR.
- **`ci-red-alarm.yml`** — `workflow_run` notifier; opens/updates a single
  `ci-red`-labelled tracking issue when a monitored gate concludes `failure`
  on `main`. The red signal that was missing. Add a workflow's `name:` to its
  list when you add a new main gate.

  **Claim the repair before you make it.** The alarm names the breakage but
  nothing claims the fix, and a main-red repair is exactly the kind of small,
  obvious change several agents reach for at once: on 2026-08-16 the missing
  `read-gates` golden was captured twice independently (#2578 and inside
  #2576), each burning its own full CI cycle for a one-file change. Before
  fixing a red `main`, `list_pull_requests` for an open repair — they are easy
  to spot, titled `Main-red #N` by convention — and if none exists, say so in a
  draft PR first, the same rule CLAUDE.md already applies to feature work.
- **`cancel-in-progress: false`** on the push-only post-merge gates, so a
  failure is attributed to the commit that caused it instead of being masked
  by the next merge.

## [historical] If the merge queue is too big a lift right now — the 80/20, and where it got to

Superseded — the queue is on. Kept because the reasoning still applies to any
gate you are deciding whether to promote into the per-PR lane.

The 80/20 without a queue is to give a post-merge gate a `pull_request:`
trigger scoped to its real blast radius (not the full matrix), so the common
breakers are caught pre-merge. It costs per-push CI time — the queue is still
the better answer — but it closes the holes, and it needs no repo-settings
change: binding is emergent, since `pr-gate` fails on any non-passing check run
on the head SHA and a path-skipped workflow produces none.

**Done.** The behavioral cross-backend legs and `pages` went first; wave G1 of
[`docs/new-plan/verification-waves-2026-09.md`](new-plan/verification-waves-2026-09.md)
then promoted the five `*-obs-e2e`, the four native `*-oidc-e2e`, the four
`generated-{react,vue,svelte,angular}-e2e` SPA smokes and `elixir-vanilla-vo-e2e`
— each with a narrow `paths:` block, the literal draft guard, and PR-aware
concurrency. §3 of that plan is the checklist a further promotion should follow
(no YAML anchors in `paths:`; drop `labeled` from `types:`; the guard string is
matched verbatim by `test/system/draft-gate.test.ts`; no `pr-gate.yml` edit).

**Remaining, and deliberately so** — the reasons are recorded in §2 and §4 of
that plan, not re-argued here:

| Still post-merge / label | Why it was not promoted |
|---|---|
| `tenancy-e2e` | its matrix plus rollup is over half the ~20-slot pool from one workflow; a promotion needs an event-conditional matrix that fires only the `flat` legs per-PR |
| `migration-evolution-e2e` | the longest single leg in the fleet (35-minute cap); promoting it moves the pr-gate cycle, so it wants the cycle measured before and after |
| `channels-e2e`, `api-call-e2e` | docker-in-runner brokers, large cell counts, and neither carries `merge_group:` — declined outright |
| `phoenix-ui-e2e` | blocked on its flake budget (#2718): a promoted gate that fails intermittently reds `pr-gate` on unrelated PRs, and `scripts/flake-budget.mjs` only ever sees `main` |
| `elixir-oidc-e2e`, `auth-oidc-compose-e2e` | both build images inside the runner (Phoenix release / generated compose stack), which is the cost the narrow-paths answer does not fix |

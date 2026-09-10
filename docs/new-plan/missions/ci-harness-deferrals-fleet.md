# CI-harness deferrals — a three-packet Opus fleet

*Program doc. Status: minted 2026-09-10; nothing below is in flight. Scope is
narrow and mechanical: the deferred findings from merged-PR comments that **no
open PR is fixing**. Each packet has its own mission entry — M-T9.58, M-T9.57
and M-T9.6 in [`T9-toolchain-health.md`](../T9-toolchain-health.md) — and this
doc holds only what those entries cannot: the packet split, the file fences, the
measured starting evidence, and the kickoff prompts.*

---

## 0. How the scope was drawn, and what it deliberately excludes

An audit of comments on the 30 most recently merged PRs, re-verified against
`main` @ `bc7ed8f`, found six deferrals. Three were already fixed on `main` and
are not restated here (the LSP neighbour-map isolation leak → #2845; the
sourceType registry leak → #2770; the `pr-gate` superseded-suite corpse →
`liveRuns` in `scripts/pr-gate.mjs`).

Of the remaining three, **one was claimed by a fix PR and is out of scope**: the
`workspace-persistence` playground spec was [#2848](https://github.com/Loom-Harness/Loc/pull/2848),
which also found a better root cause than the deferring comment proposed — focus
loss during a raw-keystroke burst, not a marginal assertion timeout. It **merged
2026-09-10** (`42fce9e`). Do not re-open it.

**One was claimed by a plan, not by a fix.** The `behavioral-java` 20-minute cap
is packet C0.2(e) of the completion-waves plan, which **merged 2026-09-10** as
[#2849](https://github.com/Loom-Harness/Loc/pull/2849) (`54750de`). That plan owned
the row and had no code behind it. Packet **P2** below *is* that row, measured; it
landed as [#2855](https://github.com/Loom-Harness/Loc/pull/2855) citing C0.2(e)
rather than forking a second claim. **DONE — see §5.**

The scope rule for this fleet, stated once: **a deferral is in scope only while
no PR is fixing it.** Re-run the claim check on fresh `main` before starting —
`list_pull_requests` (open, drafts included) plus a `git log` on the fenced tree
— exactly as the "verify the task isn't already done" rule in `CLAUDE.md`
requires. Two of these six rows were already fixed by the time this doc was
written; a third was claimed within a day.

## 1. The three packets

All three are file-disjoint by construction, so they run **fully parallel**.
Each is its own PR: `.github/workflows/**` and `scripts/pr-gate.mjs` edits are
their own PR by the standing rule, and P1's tree is test-only.

| | packet | mission | tree fence |
|---|---|---|---|
| **P1** | Generated-project installs name their cause and retry once | M-T9.58 | `test/e2e/**` |
| **P2** | The behavioral-tier timeout budgets, measured as a class — **DONE, [#2855](https://github.com/Loom-Harness/Loc/pull/2855)** | C0.2(e) | `.github/workflows/behavioral-e2e*.yml`, `test/behavioral/**` |
| **P3** | The `pr-gate` stuck verdict, and the queue runbook's missing probe | M-T9.57 + M-T9.6 | `scripts/pr-gate.mjs`, `.github/workflows/pr-gate.yml`, `docs/ci-gating.md` |

### P1 — installs that name their cause (M-T9.58)

The mission entry carries the full finding. What the packet adds: the 49 sites
across 23 files want **one shared helper**, not 49 edited `execSync` calls, and
the helper is where the `--prefer-offline` reasoning currently stranded in
`test/e2e/generated-react-build.test.ts:212-219` belongs.

**Exit:** a failed install in any of the 23 files prints npm's own `npm error`
lines; a transient failure produces exactly two install attempts and a green
cell; a deterministic one produces exactly two and a red cell. Both halves
mutation-proved separately, by file copy (§84), each naming the assertion that
failed. A green cell's exit code and wall time are unchanged.

### P2 — the timeout budgets, as a class

**Measured before minting, so the packet starts from evidence rather than from
the three-strikes anecdote.** `behavioral-e2e-java.yml` sets
`timeout-minutes: 20`. The test step (`Run Java behavioral tier`) alone:

| run | event | test step | job wall | verdict |
|---|---|---|---|---|
| `34499574433` | merge-queue push | 14m25s | 15m35s | success |
| `34493124709` | pull_request | **18m22s** | 19m29s | success |
| `34098516293` | pull_request | 19m01s (cut) | 20m17s | **cancelled at the cap** |

So the slowest *green* run finishes with **1m38s of headroom — 8% of budget**,
and the distribution straddles the cap. That is not a flake and not three
unlucky draws; it is a budget set below the observed spread.

**Do the class, not the instance.** The seven behavioral legs carry four
different budgets — python 15, node 15, java 20, dotnet 20, dapper 20,
mikroorm 25, elixir 30 — none of them derived from a measurement on record. The
packet's first job is the same headroom table for **all seven**, from the API
rather than from the summary UI; java is simply the one whose margin already
closed. Only then decide per leg between raising the cap and splitting the leg,
and write the chosen rule down (a stated margin over the observed p95 beats a
round number, and makes the next re-measure mechanical).

**Exit:** a headroom table for all seven legs in the PR body; every budget
either justified against it or changed; the rule that sets a budget written into
`docs/ci-gating.md`. A raised cap is a real fix here and needs no apology — but
a cap raised without the table is the thing this packet exists to stop.

### P3 — the stuck verdict and the missing probe ⚠ verify-first

**Do not build the fix first.** M-T9.57's whole point is that the dropped-
dispatch premise behind `pr-gate.yml`'s header comments, `docs/ci-gating.md`,
#2835 and several session notes rests on a **measurement artifact**:
`workflow_run` runs are attributed to the default branch, so
`list_workflow_runs(branch=<pr-branch>)` structurally cannot return a `pr-gate`
evaluation. Re-measure without the branch filter. The read-after-write race is
the *better-fitting* hypothesis, not an established cause, and closing this row
with "the premise was wrong, here is the corrected prose" is a full, acceptable
outcome.

Folded in, because it is the same file and the same subject: **M-T9.6's queue-
runbook item.** `docs/ci-gating.md` has no honest "is my PR actually in the
queue?" probe, and the obvious one is wrong — an accepted entry has no
`gh-readonly-queue` ref until its batch forms, so an `ls-remote` for that ref
answers "not queued" for a queued PR. That wrong probe cost [#2832](https://github.com/Loom-Harness/Loc/pull/2832#issuecomment-5609067588)
about 95 minutes and two dead diagnoses. The merge API answers it:
`405 Pull Request is in the merge queue`. One paragraph beside the lever table.

**Exit:** the re-measurement reported either way; the tail re-read built only if
the re-measurement supports it, with a mutation proof that a corpse-only or
mid-write snapshot yields `pending` rather than `failure` **and** a control that
a genuinely failed check still fails; the two honest bounds documented (~30 min
active, ~3.3 h idle, unbounded in-queue); the queue-membership paragraph landed.
Every prose claim this packet touches either re-grounded on the new measurement
or deleted.

## 2. Rules that bind all three

These are not new rules — they are the ones this fleet's subject matter breaks
most often, restated so a packet agent does not have to find them.

1. **Never push to see a check's verdict.** Every gate here runs locally; the
   reverse index is `docs/testing.md` → "Running any CI gate locally". A fleet
   working *on* CI is the worst possible place to burn the shared runner pool.
2. **Mutation-prove by file copy, never `git checkout -- <path>`** (§84), and
   **read which assertion failed**, not just that one did.
3. **A green first run proves nothing** (§59, §63). Every packet here touches an
   instrument; each fix needs the control that shows the assertion goes red
   without it. P1's half 1 and P3's tail re-read are both easy to land vacuous.
4. **Fix the class, not the next instance.** P1 is a shared helper, not 49
   edits; P2 is seven budgets, not one; P3 is the premise, not the symptom.
5. **Re-check the claim on fresh `main` before starting**, per §0.

## 3. Kickoff prompts

> **P1** — Implement packet **P1** of `docs/new-plan/missions/ci-harness-deferrals-fleet.md`, mission **M-T9.58**, tree **`test/e2e/**`**. Re-verify on fresh `main` that no open PR claims it. Build the shared install helper, land both halves (name the cause; retry once, not in a loop), mutation-prove each half separately by file copy and name the failing assertion, and run the affected gates locally — never push to see a verdict.

> **P2** — Implement packet **P2** of `docs/new-plan/missions/ci-harness-deferrals-fleet.md` (row C0.2(e) of `completion-waves-2026-09.md` if #2849 has merged — cite it, do not fork the claim), tree **`.github/workflows/behavioral-e2e*.yml`, `test/behavioral/**`**. Start by reproducing and extending the headroom table in §1 to all seven behavioral legs, from the Actions API rather than the summary UI. Then justify or change each budget against it, and write the budget-setting rule into `docs/ci-gating.md`. The table goes in the PR body.

> **P3** — Implement packet **P3** of `docs/new-plan/missions/ci-harness-deferrals-fleet.md`, missions **M-T9.57 + M-T9.6**, tree **`scripts/pr-gate.mjs`, `.github/workflows/pr-gate.yml`, `docs/ci-gating.md`**. This is verify-first: re-measure the dropped-dispatch premise WITHOUT the branch filter before building anything, and report the result either way. Closing the row as "the premise was a measurement artifact, prose corrected" is a full outcome. Land the queue-membership paragraph regardless.

## 4. What the fleet is done when

- P1: 0 of 49 install sites can fail without naming a cause; retry count is exactly one, proved in both directions.
- P2: 7 of 7 behavioral legs have a budget justified by a measured headroom table, and the rule that sets one is written down.
- P3: the dropped-dispatch premise is either re-grounded or deleted everywhere it appears; the queue runbook answers "am I queued?" correctly.

Three PRs, no shared files, no sequencing between them.

---

## 5. Outcomes

### P2 — landed as [#2855](https://github.com/Loom-Harness/Loc/pull/2855) (2026-09-10)

Every budget re-sized from one rule, now written down in
[`ci-gating.md`](../../ci-gating.md) § "Sizing a job's `timeout-minutes`":
`timeout-minutes = max(10, ceil_to_5min(p95(job exec) × 1.5))` over ≥10
successful runs, with `node test/behavioral/ci-budget-report.mjs` as the
one-command re-derivation and `test/behavioral/timeout-budgets.test.ts` pinning
each budget to what the rule *generates* from the recorded p95.

| leg | n | median | job-exec max | was | headroom @ max | now |
|---|---:|---:|---:|---:|---:|---:|
| node | 15 | 2m47s | 3m25s | 15m | 77% | 10m |
| python | 15 | 3m41s | 4m37s | 15m | 69% | 10m |
| java | 40 | 17m56s | 19m50s | 20m | **1%** | 30m |
| dotnet | 15 | 7m08s | 8m19s | 20m | 58% | 15m |
| dapper | 15 | 6m00s | 7m18s | 20m | 64% | 15m |
| mikroorm | 15 | 9m22s | 10m35s | 25m | 58% | 20m |
| elixir | 15 | 10m14s | 11m34s | 30m | 61% | 20m |

**Four corrections that outlive the fix**, each of which changes how the next
budget question should be asked:

1. **The premise undercounted by 4×.** The cap was hit **13 times in the last
   100 runs** — ~18% of those reaching a verdict — not the three occurrences
   this row was filed on. And the headroom in §1 was measured on too small a
   sample: it is **10s / 1%**, not 1m38s / 8%.
2. **A capped leg's p95 is censored, so the cap hides the data needed to size
   the cap.** Killed runs never enter the success sample. Any budget derived
   from successes alone on a leg that is *already* timing out is biased low by
   construction — which is why the new budget is explicitly not a final answer
   for java, only enough to stop the censoring.
3. **Java is slow, not tight-budgeted** — 17m56s median against 6–10m for its
   peers, from a sequential per-case `gradle --no-daemon bootJar`, with a
   run-to-run spread **35× the headroom**. That ratio is why the kills looked
   random. Separate mission; the raise only stops the bleeding. A split was
   declined with its reason recorded: a second slot on *every* run, plus a shard
   manifest that `run-java.mjs`'s explicit case list would let a new corpus case
   fall out of entirely.
4. **The over-provisioned legs paid for the raise.** Six of seven had 58–77%
   headroom, so re-sizing the class dropped worst-case slot exposure **145 → 120
   min** even while raising java.

**One measurement trap, worth carrying forward:** the Actions API sets a job's
`started_at` at **queue** time, so job *wall* duration includes queue wait — one
python job reads 80m against a 15m cap and would have scored as a cap hit. Size
budgets from the **sum of step durations**, never from wall.

**And one vacuous gate caught in the act**, which is the §59/§63 shape again:
the new test's sixth mutation *passed on first run*, because its fixture used
`{null, null}` steps that contribute 0 either way and never reached the filter
they named. The real hazard is a **started-but-never-finished** step — exactly
what a cap-killed job has in flight — whose duration goes hugely negative and
drops the whole job below the `> 0` guard, so **a leg that is timing out
measures as if it never ran**. Retargeted; it now fails with
`expected -1789056165 to be 16`.

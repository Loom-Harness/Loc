# Wave C0 — packet 0.3 hand-off: the `pr-gate` mechanism, measured (M-T9.57)

*Branch `claude/c0-pr-gate`, folded 2026-09-10. Full measurement table: `docs/ci-gating.md` → "Why the gate parked, measured once (2026-09-10)" and M-T9.57's body.*

## Method

A `workflow_run`-triggered run is attributed to the repo's **default branch** (`head_branch: main` on 100 of 100), so `list_workflow_runs(branch=<pr-branch>)` structurally cannot show an evaluation — F65 confirmed for branch-filtered listing in general. The census listed `/actions/workflows/pr-gate.yml/runs?created=<window>` unfiltered and matched by time.

| measurement | result |
|---|---|
| eligible completions → evaluations, 10:00–16:00Z 09-10 | 178 completions on non-`main` branches → **172** `PR gate` runs; **13 produced no run at all** (never created), in multi-minute windows; 9 of 13 on `gh-readonly-queue/**` |
| parks among the last 30 merged PRs | 10 of 22 never-red PRs parked ≥ 5 min fully green (12 m … 58 m) |
| each park's cause | one missing dispatch — #2819: last check completed 05:49:11Z, last evaluation created 05:48:26Z, zero `PR gate` runs repo-wide until 06:35:29Z |
| tail size at the last delivered evaluation | outstanding checks median 1, max 7; minutes to last completion median 1.2, 9/10 ≤ 5, max 16.9 |
| #2822's cancellation theory | refuted — 479/759 evaluations still `cancelled` after `cancel-in-progress: false`; the tail evaluation is never the evicted one |
| M-T9.57's read-after-write race | refuted — an evaluation dispatched by a completion reads strictly after it |
| the `*/15` cron | six consecutive `schedule` runs gapped 2.0 / 4.5 / 4.6 / 4.5 / 3.6 h |

**Mechanism.** `workflow_run` dispatch delivery is lossy at ~7 % in multi-minute windows. The gate was a pure event handler, so a drop on a SHA's *last* completion left nothing to re-evaluate it and the published `pr-gate` stayed `in_progress` ("expected"). #2835's dispatch-drop observation was right; what it lacked was a merge-queue backstop (its sweep maps `/pulls?state=open` heads, so a merge-group head is invisible to it).

**Remedy.** A bounded tail watch inside the evaluation (`scripts/pr-gate.mjs` `shouldWatchTail`/`watchTail`): arms when ≤ 8 checks are outstanding, none failed, and ≥ 1 has reported; re-reads the SHA every 30 s for up to 15 min, publishing on change. The gate no longer depends on a *future* dispatch. `pr-gate.yml` eval-job timeout 10 → 20 min. Covers merge-group heads because they receive evaluations too.

**Mutation proof** (`test/system/pr-gate.test.ts`, 132 tests): the CONTROL arm replays #2819's timeline through the pre-fix path and asserts only `in_progress` is ever published. Deleting the watch call site → 1 failure; forcing `shouldWatchTail` false → 4 failures; restoring `timeout-minutes: 10` → 1 failure.

**Gates:** proof set (7 suites) 663 passed; `actionlint` 0 findings on `pr-gate.yml`; YAML load OK; docs build OK.

**Follow-up (`8cdc06d`):** the attribution corrected in `docs/ci-gating.md`, M-T9.57 and `experience_gathered.md` §114 — F65 is true of branch-filtered listings in general, not of #2835, whose #2819 diagnosis was unfiltered and right on mechanism, incomplete on coverage; the in-queue backstop stated: the tail watch arms on queue heads too (same single-SHA path; `merge_group: checks_requested` + in-group `workflow_run`), with one residual — the formation evaluation cannot arm it (`pending < total`), so a queue head whose every dispatch is dropped parks until the queue's 180-min timeout; the "main is red on biome" item retracted (a format diff in the packet's own test file, misread).

**Hand-offs:** `CLAUDE.md` still says "re-running a red check does NOT reliably re-evaluate the gate … per the lever table" — refuted (the dispatch was never delivered); M-T9.57 flipped in place, archive move is 0.4's.

**Composed with #2859 (2026-09-11, coordinator):** #2859 merged first and rewrote the same four files to say the dropped-dispatch premise is a measurement artifact. Neither side falsified the other's measurement (filtered vs. unfiltered listings measure different things), so the fold keeps both: the tail watch and its proofs stay (bounded either way), #2859's additive content stays, and the prose states the disagreement instead of a verdict. Owner ruling requested on which reading `docs/ci-gating.md` should settle on; until then a reader sees both tables side by side.

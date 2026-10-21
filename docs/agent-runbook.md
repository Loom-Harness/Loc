# Agent runbook — how a session executes one issue

*The standing protocol for any work item. The kickoff prompt is two lines (below). Work state lives in GitHub issues; this file is the protocol only, and changes only when the protocol does. Sessions that started on a `docs/new-plan/` mission before 2026-10-18 finish under [`new-plan/RUNBOOK.md`](new-plan/RUNBOOK.md).*

## 0. Inputs
You were given an issue (`#N`), or asked to find one. Everything else is discoverable:
- The issue: goal, acceptance, `area:` labels, links. A legacy `M-Tx.y` mission is picked up by filing an issue that links its section in `docs/new-plan/T<x>-*.md` (title prefix `M-Tx.y:`); its design docs under `docs/old/` and `docs/new-plan/missions/` still apply.
- Repo ground rules: `CLAUDE.md` and `experience_gathered.md`.
- Pinned decisions: `docs/decisions.md` — a `D-*` tag wins; re-open it explicitly rather than diverging.

## 1. Sync and verify the gap still exists
- `git fetch origin main && git switch -c <branch> origin/main`.
- Code-verify the issue's premise on fresh `main` (grep the gates/emitters/tests it names, `git log --oneline -20`). Search open issues and open PRs in the same `area:` and for the same `loom.*` code / error text. If it is already fixed, close the issue with the evidence (commit or `file:line`, `state_reason: completed`). If someone else holds it, stop and pick something else.

## 2. Claim on the issue
Assign yourself, add the `in-progress` label, and comment:

```
Claimed — session <link>, branch <branch>.
Touches: <files / area>. Plan: <one line>.
```

Re-read the issue; if another claim landed first, back off. Update the comment when the scope changes. A claim with no update or branch push for 24h is stale — a new session may take it over by saying so in a comment.

**No draft PR, no doc edit to claim.** Both cost CI and neither expires. (A draft PR is for a train member's finished work — see "Trains" below — not a claim.)

## 3. Design before code (when the issue says so)
Grammar-touching or `design` work: read the linked design records, follow the matching skill (`language-feature-developer`, `dependency-upgrade`, `generated-stack-verifier`, `parity-auditor`), and put the resolved open questions in the issue (decisions that will hold go in `docs/decisions.md` with the code PR).

## 4. Implement to the repo's bar
- Every target, or an honest `loom.*` gate on the rest — never a silent gap, crash or emitted TODO. A new `*-unsupported` gap cites its owning issue as `mission: "#NNNN"` in `src/diagnostics/unsupported-register.ts`.
- New behavior: a parsing test, a negative validator test, a generator test per affected backend, completeness-pin updates.
- Run the gates locally before pushing (`docs/testing.md` → "Running any CI gate locally"). Never push to see a check's verdict.

## 5. Stay inside the issue — file what you find
Anything you discover that the issue's acceptance does not need is **filed, not fixed**:
1. Search for a duplicate (code, error text, file). If found, comment your repro there.
2. Otherwise open a *Found while working* issue (`found-in-flight` + `area:` labels): where you found it, smallest repro you already have, observed vs expected, suspect `file:line` only if seen. Two minutes, no root-causing.
3. Fix it in your PR only if your own acceptance gate cannot pass without it — minimally, and file the remainder.

Too big for one session? Split the issue into sub-issues, finish one, leave the rest unclaimed.

## 6. Close the loop
- Open the PR ready-for-review when it is built and green locally, body `Fixes #N` plus what changed and the gates you ran.
- Docs that describe behavior (reference docs, `decisions.md`, `experience_gathered.md`) change in the same PR as the code. Status, progress notes and handoffs go in issue comments — never a PR of their own.
- Drive the PR to green / into the merge queue.
- **Done** = acceptance met, PR green or queued, discoveries filed. The final report lists the PR and every issue you filed. Then stop — don't take the next issue unless you were asked to.

## Waves and evals
- A wave is a parent issue; each packet is a sub-issue with disjoint `Touches:`. A coordinator files and orders them; workers claim one each.
- An eval / audit session's deliverable is a parent issue with one sub-issue per finding. Fix sessions claim those.

## Trains — how a fleet lands its work

A fleet does not send one PR per worker through the merge queue. Each queue entry re-runs the whole queue gate set (~75 jobs, ~240 runner-minutes); an entry ejected for a conflict or a red check costs that again plus a round trip; and parallel PRs in one area conflict with each other in the queue, one ejection at a time. A **coordinator** stacks the workers' changes into one **train** and puts only the train through the queue.

**Workers**
- Work the issue as above (§1–§5), but open the PR as a **draft**, based on `main`, with no `run-*` labels. A draft runs only the seconds-cheap lane (`langium-generated`, `workflow-lint`, `pr-gate`); the fan-out and the fast suite are draft-gated (`docs/ci-gating.md` → "Draft PRs and the runner queue"), so a member push costs almost no runner time.
- Run the gates locally — the fast suite, the push preflight (typecheck + censuses on `origin/main + HEAD`), and the heavy gates for your area. CI will not run them for you until the train does.
- **Never mark a member ready for review** — that fires the full fan-out on it. Tell the coordinator the branch is done (issue comment or message).

**Coordinator**
1. Branch the train from fresh `main`. Merge each finished member in with a **merge commit** — never squash or rebase — so each member's commits survive, `git bisect` can walk them, and a member PR based on `main` is closed as merged when the train lands.
2. **3–8 members**, preferably one `area:`. Resolve conflicts between members once, here, instead of in the queue.
3. Before queueing: merge `origin/main` once, run the push preflight and the heavy gates for every area the train touches. Then open **one** ready-for-review PR (title `Train: #a #b #c`, members listed in the body, each `Fixes #N` carried over), push **once**, enable auto-merge.
4. **Red, in CI or after a queue ejection:** read which check failed and find the member from the log; when that is not obvious, `git bisect` over the member merges **locally** — never re-run CI to bisect. Rebuild the train without that member (do not revert on top), push once, and hand the member back to its worker on its draft.
5. A member that keeps conflicting with `main` lands first, alone: ask the owner to jump it to the front of the queue rather than syncing it again.

**Rules learned the hard way**
- No pushes while the train is queued — GitHub refuses them (GH006), and a sync of a queued PR re-runs everything for nothing.
- A member PR whose base is another member (a stacked PR) is **not** auto-closed when the train lands; close it by hand.
- One push per fix. A conflict with `main` is the only reason to sync an open train.

## The kickoff prompt

> Work issue **#N** in Loom-Harness/Loc. Follow `docs/agent-runbook.md` end to end — verify on fresh `main`, claim on the issue, file anything you discover instead of fixing it, and stop when the PR is green.

To let a session pick its own work: replace the first sentence with *"Pick the highest-priority unassigned open issue labelled `area:<x>` (or none)."*

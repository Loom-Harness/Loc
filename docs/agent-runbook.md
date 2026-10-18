# Agent runbook — how a session executes one issue

*The standing protocol for any work item. The kickoff prompt is two lines (below). Work state lives in GitHub issues; this file is the protocol only, and changes only when the protocol does.*

## 0. Inputs
You were given an issue (`#N`), or asked to find one. Everything else is discoverable:
- The issue: goal, acceptance, `area:` labels, links. Every open legacy `M-Tx.y` mission is already an issue titled `M-Tx.y: …`; decisions the owner still has to make are collected in #3316. Design records the issue links into the legacy record (removed from the tree; [browse it in history](https://github.com/Loom-Harness/Loc/tree/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs)) still apply.
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

**No draft PR, no doc edit to claim.** Both cost CI and neither expires.

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

## The kickoff prompt

> Work issue **#N** in Loom-Harness/Loc. Follow `docs/agent-runbook.md` end to end — verify on fresh `main`, claim on the issue, file anything you discover instead of fixing it, and stop when the PR is green.

To let a session pick its own work: replace the first sentence with *"Pick the highest-priority unassigned open issue labelled `area:<x>` (or none)."*

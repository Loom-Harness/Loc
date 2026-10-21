# Agent runbook — how a session executes one issue

*The standing protocol for any work item. The kickoff prompt is two lines (below). Work state lives in GitHub issues; this file is the protocol only, and changes only when the protocol does. Sessions that started on a `docs/new-plan/` mission before 2026-10-18 finish under [`new-plan/RUNBOOK.md`](new-plan/RUNBOOK.md).*

## 0. Inputs
You were given an issue (`#N`), or asked to find one. Everything else is discoverable:
- The issue: goal, acceptance, `area:` labels, links — and its **comments**, which carry scope changes, blockers and earlier attempts. The issue is the work's only status record: there is no second copy to update in a doc.
- A legacy `M-Tx.y` mission is picked up through an issue too. **Search first** — issues open *and* closed whose title or body names the id — and use the one you find; file a new one (title `M-Tx.y: …`, linking the section in `docs/new-plan/T<x>-*.md`) only when none exists. Its design docs under `docs/old/` and `docs/new-plan/missions/` still apply; its status in `docs/new-plan/` does not — `docs/new-plan/` is not edited for status.
- Repo ground rules: `CLAUDE.md` and `experience_gathered.md`.
- Pinned decisions: `docs/decisions.md` — a `D-*` tag wins; re-open it explicitly rather than diverging.

## 1. Verify the issue still stands — before any code
Issues rot like mission statuses did: fixed by a neighbouring PR, half-done by a session that stopped, or duplicated by an issue filed an hour later. Every check below is cheap next to building something twice.

1. **Sync.** `git fetch origin main && git switch -c <branch> origin/main`.
2. **Still open, still the same work?** Read the issue body and every comment. A comment that narrows scope or names a blocker wins over the body.
3. **Held by someone?** It is held when any of these is true; then stop and pick something else:
   - an assignee, or the `in-progress` label, with a claim comment or a branch push in the last 24h;
   - an open PR — draft included — that says `Fixes #N` / `Refs #N`, or a train PR that lists it (search open PRs for `#N`).
   An assignee or label with nothing newer than 24h is a stale claim: take it over by saying so in a comment (§2).
4. **Premise on fresh `main`.** Code-verify what the issue says is broken or missing: grep the gates / emitters / tests it names, check `git log --oneline -30` for the area.
   - **Already done** → close it with the evidence (commit or `file:line`), `state_reason: completed`.
   - **Partly done** → comment what is done (with evidence) and what remains, edit *Acceptance* down to the remainder, then claim that.
   - **Premise wrong** (the behaviour is intended, or the repro no longer reproduces) → comment why and close as `not_planned`.
5. **Duplicate?** Search open issues for the same `loom.*` code, error text, files and `M-Tx.y` id. Two issues for one piece of work: keep the older (or the better-specified), close the other as `duplicate` with a link, and move anything new from it into the survivor.

## 2. Claim on the issue
Assign yourself, add the `in-progress` label, and comment:

```
Claimed — session <link>, branch <branch>.
Touches: <files / area>. Plan: <one line>.
```

Re-read the issue; if another claim landed first, back off — the earliest claim comment wins. Update the comment when the scope changes. A claim with no update or branch push for 24h is stale — a new session may take it over by saying so in a comment.

**No draft PR, no doc edit to claim.** A claim is the issue's assignee, label and comment, nothing else. (A draft PR is how a train member hands over finished work — see "Trains" — not a claim.)

**Letting go.** If you stop before the acceptance is met — blocked, out of time, re-scoped — release the claim: comment what is done and what remains (with branch and evidence), edit the body so the next session inherits reality, unassign yourself and remove `in-progress`. An abandoned claim with no comment costs the next session a day.

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
- Open the PR ready-for-review when it is built and green locally, body `Fixes #N` plus what changed and the gates you ran. Use `Fixes` only when the PR meets the whole acceptance; for part of it use `Refs #N` and say on the issue what remains, so the merge does not close unfinished work.
- If the work turned out bigger, smaller or different than the issue says, edit the issue (body and *Acceptance*) so the next reader inherits reality — the issue, not a doc, is the record.
- Docs that describe behavior (reference docs, `decisions.md`, `experience_gathered.md`) change in the same PR as the code. Status, progress notes and handoffs go in issue comments — never a PR of their own.
- Drive the PR to green / into the merge queue.
- **Done** = acceptance met, PR green or queued, discoveries filed. The final report lists the PR and every issue you filed. Then stop — don't take the next issue unless you were asked to.

## Waves and evals
- A wave is a parent issue; each packet is a sub-issue with disjoint `Touches:`. A coordinator files and orders them; workers claim one each.
- An eval / audit session's deliverable is a parent issue with one sub-issue per finding. Fix sessions claim those.

## The kickoff prompt

> Work issue **#N** in Loom-Harness/Loc. Follow `docs/agent-runbook.md` end to end — verify on fresh `main`, claim on the issue, file anything you discover instead of fixing it, and stop when the PR is green.

To let a session pick its own work: replace the first sentence with *"Pick the highest-priority unassigned open issue labelled `area:<x>` (or none)."*

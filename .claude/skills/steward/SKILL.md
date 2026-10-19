---
name: steward
description: Repo-specific rules for driving a Loom PR to merge — how to react to CI-red, a red `main`, merge conflicts and base-branch drift WITHOUT starving the shared CI runner pool. Read it before acting on any PR event (CI failure, review, "base branch recovered", merge-conflict notice) or before pushing to an open PR. Reach for it whenever the impulse is "port the fix from PR #N into mine", "merge main to stay current", "re-sync all my PRs", or "re-run CI to see".
---

# Steward — driving a Loom PR without burning the pool

Loom's CI is one shared pool of about 20 runners, and **each push to a PR starts about 100 check runs**. On 2026-10-18, ~69 agents each copied the same .NET advisory fix into their own PR while the one fix PR (#3296) waited behind them. That queued 1,500+ runs, and `main` stayed frozen for 7 days (#3591). These rules exist so that never happens again. They take precedence over the generic PR-driving defaults on conventions and proactivity.

## 1. A red `main` is not your PR's to fix

When a check is red on your PR **because `main` is red too**, or because of an external cause your diff doesn't touch (a new CVE advisory, a registry outage, an image tag that vanished):

- **Do NOT copy a fix from another open PR into yours.** Not the commit, not an equivalent edit. A fix PR exists → it lands once, and every PR picks it up from `main`.
- If no fix PR exists, **open one** (title prefix `base-fix:`), small and alone, then do the next step.
- Comment **once** on your PR: which check, why it isn't this PR's, which PR fixes it. Add the `blocked-on-base` label. Then stop. No re-runs, no pushes.
- When the fix lands, **one** deliberate sync picks it up: `LOOM_ALLOW_SYNC=1 git push …` (the push preflight refuses sync-only pushes otherwise). Do this only if your PR's checks were actually red on that cause; a PR that was green doesn't need it.

## 2. Don't sync just to stay current

- The merge queue re-tests every entry on top of current `main`. A PR does **not** need to contain the latest `main` to merge.
- Merge `main` into a PR only when (a) it **conflicts** with `main`, or (b) its own checks are red on something `main` has since fixed (rule 1).
- Never "re-sync all open PRs". Never push a merge of `main` when `main` hasn't moved.
- The push preflight (`.claude/hooks/pre-push-merge-check.sh`) denies a push whose only new commits are merges of `main`, unless the old head conflicted or the push carries `LOOM_ALLOW_SYNC=1`. Don't bypass it by reflex: if you can't name the conflict or the fixed failure, don't push.

## 3. Spend CI deliberately

- **Run gates locally first** (`docs/testing.md` → "Running any CI gate locally"). Push once, when it's green locally.
- **Batch fixes into one push.** Three review nits are one commit and one push, not three.
- **Re-run a job at most once**, and only for the reasons the generic rules allow (it died before any test ran, or it passed earlier on this exact commit).
- **Don't open a PR while more than ~20 non-draft PRs are open.** Help land the existing ones instead: review, resolve conflicts, fix red heads.
- **No claim PRs.** Claim on the issue (see CLAUDE.md); open the PR when there is something to review.

## 4. Order of work when the queue is backed up

1. A `base-fix:` PR goes first. Ask the owner to jump it to the front of the merge queue.
2. Then PRs that are green and `clean`, smallest first.
3. Stacks land bottom-up; a stacked PR waits for its base rather than merging the base in repeatedly.
4. Large folds (hundreds of files, or deleting a corpus other PRs edit) land last, after the backlog drains, so they rebase once instead of conflicting with everything.

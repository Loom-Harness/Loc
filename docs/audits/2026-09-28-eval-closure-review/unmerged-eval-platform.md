# u-platform audit — `eval-platform/` register (origin/claude/loom-platform-eval-3aiinh)

Audited against origin/main d2a0bc02 (2026-09-28). Register = FINDINGS.md (F-1a, F-1b, F-2..F-6 + 2 minor observations),
EVALUATION-REPORT.md (same ids, F-1 merged), FIX-PLAN.md (PR-1..PR-5). Branch = 3 commits, only `eval-platform/**`; never merged.
Every repro re-run with `node bin/cli.js parse|generate system` on main (scratch: review/tmp-u-platform/).

| id | sev | register-status | true-status | evidence | notes |
|---|---|---|---|---|---|
| F-1a primitive member access (`money.amount`, `label.bogusThing`) | S2/S1 | "ALREADY CLAIMED AND FIXED" by #2949 | OPEN-TRACKED | main: `repro/money-amount/{main,bogus2,precond}.ddd` → `0 error(s)`; node emits `this._total.amount >= 0` (api/domain/invoice.ts:37); elixir precond emits `ensure(record.total.amount > 0, …)` (lib/api/c.ex:41). `loom.unknown-primitive-member` absent from src/. #2949 still **draft, mergeable_state=dirty**, opened 09-14, last touched 09-27. | "FIXED" is true only on the PR branch — nothing landed. #2949 has sat 2 weeks with conflicts; highest-value stuck PR here. |
| F-1b elixir drops invariants outside allow-list | S1 | unclaimed → PR-1 | OPEN-TRACKED | main: 5-invariant repro on `platform: elixir` → `0 error(s), 0 warning(s)`; no `String.trim`/`Enum.count`/`qty > 100` in order_changeset.ex (isBig only in controller serialize). `structEvaluable` still gates (changeset-invariant-emit.ts:43). PR **#3023** (claude/elixir-invariant-coverage) open, non-draft, not merged: widens carrier + `loom.elixir-invariant-unenforced` warning. | #3023's one red leg (dotnet-obs-e2e) argued unrelated in its comment; awaiting merge. No docs/new-plan mission. |
| F-2 .NET `Task` aggregate collides with BCL (starter `ddd new --template crud` does not build) | S2 | unclaimed → PR-2 | OPEN-TRACKED | main: new-templates.ts:167 still `aggregate Task with crudish`; no alias/qualify code in src/generator/dotnet (`collidingNamesOfAggregate`/`taskInScopeOfAggregate` absent). PR **#3043** (claude/dotnet-bcl-type-collision) open, rebased on d2a0bc02, mergeable_state=blocked (checks pending). | This is the "dotnet BCL type collision" session work — belongs to THIS register (F-2 / FIX-PLAN PR-2). Local remote-tracking ref is stale (edb6de28b, 4 ahead/183 behind); PR head is 4656dd0f. PR also covers dapper emitters + Type/Stream/Queue/Random/Timer. |
| F-3 inferred column rename (drop+add same type → RENAME, silently) | S1→S3 | unclaimed → PR-3 (warning `loom.migration-rename-inferred`) | OPEN-UNTRACKED (+ partial WRONG-CLAIM) | main: v1(title)→v2(description) emits `ALTER TABLE "c"."products" RENAME COLUMN "title" TO "description";` with `0 error(s), 0 warning(s)`. No `rename-inferred` code anywhere; no PR; M-T2.1 is explicit-intent only. | WRONG part: register/FIX-PLAN say docs/migrations.md "documents the explicit block without warning" — false: docs/migrations.md:151-170 ("heuristic fallback… It is a *guess*… silent misattribution") landed 09-14 (ccdb50fbb), before the eval. Only the diagnostic is missing. |
| F-4 flutter `design:` unvalidated silent no-op | S3 | unclaimed → PR-4 | OPEN-UNTRACKED | main: `expectedPackFormatFor` (platform-rules.ts) has no flutter arm; `checkDeployableDesignPack` (deployable.ts:440) has feliz theme arm but nothing for flutter. Repro (orderly with console→`platform: flutter`) `design: mantine` vs `design: shadcn`: 0 errors, only 2 unrelated by-id warnings, `diff -r` of the two trees empty. | No PR, no mission. |
| F-5 `ddd new` template says `crudish(requires:)` hasn't landed | S3 | unclaimed → PR-4 | FIXED-VERIFIED | main new-templates.ts:370-372 now "gate them by naming a policy … `aggregate X with crudish(requires: <Policy>)`". Commit 67dfde148, PR **#3026** (merged 09-28) as its **F-116** (eval-claims register, not this one). | FIX-PLAN's pinning test ("no 'until … lands' string") was not added; fix rests on no regression test. |
| F-6 `ddd breakpoints` resolves file but `:1` line | S3 | unclaimed → PR-5 | OPEN-UNTRACKED | main: orderly --sourcemap, `breakpoints --line 74/80/100` → `order.ts:1`, `order.routes.ts:1`, `order-repository.ts:1`; line 85 → `order.ts:60` — byte-for-byte the register's output. 51943196b (F-021, 09-14, per-operation decl region) predates the eval and does not cover fields/invariants/finds. | Nearest plan item M-T8.2 (sourcemap fan-out to other backends, P3 deferred) does not cover TS line granularity. |
| M-1 HTTP API command-oriented (`POST …/update`, PUT 405) | obs | observation | N/A (by design) | — | Not a defect; nothing to track. |
| M-2 Feliz Dockerfile `dotnet/sdk:8.0` vs .NET backend net10.0 | obs | observation | OPEN-UNTRACKED (minor) | main feliz/index.ts:1957 `sdk:8.0`, :1806 `<TargetFramework>net8.0`; dotnet/emit/program.ts:1544 spa-build `sdk:8.0` beside `sdk:10.0`. | Internally consistent (Feliz project is net8.0), so not a build break; a currency item (net8 EOL Nov 2026) for the dependency-upgrade track. |

## FIX-PLAN PR status

| plan PR | finding | landed? |
|---|---|---|
| PR-1 elixir invariants | F-1b | #3023 open (ready, unmerged) |
| PR-2 .NET BCL collision | F-2 | #3043 open (ready, checks pending/blocked) |
| PR-3 announce inferred rename | F-3 | never opened |
| PR-4 flutter design + stale template | F-4, F-5 | never opened; F-5 half landed independently via #3026 (F-116); F-4 half not |
| PR-5 breakpoints granularity | F-6 | never opened (not even the diagnosis/doc-fix step) |
| (F-1a, deferred to #2949) | F-1a | #2949 draft, conflicting |

## The 09-27/28 sessions

- **dotnet BCL type collision** (branch claude/dotnet-bcl-type-collision) = THIS register's F-2 / FIX-PLAN PR-2 → PR #3043, open. PR body cites `eval-platform/` on this branch.
- **F-012 migration journal ordering** (branch claude/fix-migration-journal-ordering, 5 ahead / 0 behind main) is NOT from this register: it is **eval-cargo F-012** ("HIGH / operational: the first in-place model evolution silently skips its own migration…") on the sibling branch origin/claude/loom-platform-eval-mc2v5j (eval-cargo/FINDINGS.md:321). PR #3049 open, not merged. (Other F-012s exist on main in eval-clinica/eval-fieldops/eval — unrelated.)

## Register reached main?

No. `git grep` on main for `eval-platform`, `loom-platform-eval`, the Task collision, flutter design no-op: zero hits in docs/, docs/new-plan/, experience_gathered.md, or the eval*/ registers on main. The only durable carriers are PR bodies (#3023, #3043) — which die with the PRs if closed. F-3, F-4, F-6 exist nowhere but the unmerged branch.

## Top problems

1. **F-3 inferred rename is silent and untracked** — S1 data misattribution with 0 warnings; the planned `loom.migration-rename-inferred` warning was never started.
2. **F-4 flutter `design:` accepts anything, byte-identical output** — untracked; trivial fix (warning arm in `checkDeployableDesignPack`).
3. **F-6 breakpoints `:1`** — untracked; documented feature not delivering; not even the doc-softening happened.
4. **F-1a stuck** — #2949 draft + merge conflicts for 2 weeks while the register calls it "FIXED"; elixir precondition still compiles into a runtime KeyError.
5. **F-1b / F-2 fixes built but unmerged** (#3023, #3043) — S1 and S2 still live on main.
6. Register never merged; three open findings have no home on main.

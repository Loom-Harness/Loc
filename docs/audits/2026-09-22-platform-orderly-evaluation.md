# Stack-switching platform evaluation (Orderly) — findings register (ported)

> **Ported 2026-09-29** from the unmerged branch `claude/loom-platform-eval-3aiinh` (`51e7c6cde 2026-09-22`), register `eval-platform/`. The branch was never merged and is not meant to be: it carries generated trees. This page keeps the **findings and the repro sources only** — the generated output, the application models and the evaluation report stay on the branch ([browse it](https://github.com/Loom-Harness/Loc/blob/claude/loom-platform-eval-3aiinh/eval-platform)). Relative links in the ported text point at the branch.
>
> It is a snapshot: the verified-status section below is the 2026-09-28 re-verification against `main` @ `d2a0bc02` (repros re-run with `ddd parse` / `generate system`, emitted code read, no stack booted), updated 2026-09-29 with what has landed or been claimed since. The live plan is `docs/new-plan/` (this register's row is in `coverage.md`). Finding ids are this register's own; the same `F-0nn` means different defects in other registers.

A stack-switching probe: one order-management model (`orderly/main.ddd` on the branch) regenerated across 5 backends × 6 frontends. Findings F-1a, F-1b, F-2–F-6 plus two minor observations, and a five-PR fix plan (`FIX-PLAN.md` on the branch).

## Verified status (re-verified 2026-09-28, updated 2026-09-29)

### Since 2026-09-28

- **F-1b** (elixir drops invariants outside the allow-list): #3023 **merged** after this table was written. **F-2** (.NET `Task` / BCL collision): #3043 **merged**. Neither re-verified here.
- **F-1a** (member access on a primitive receiver): [#2949](https://github.com/Loom-Harness/Loc/pull/2949) still open; the array-receiver twin is item **#9**, [#3078](https://github.com/Loom-Harness/Loc/pull/3078).
- **F-3** (inferred column RENAME is silent): item **#1**, claimed by [#3073](https://github.com/Loom-Harness/Loc/pull/3073) (`loom.migration-rename-inferred`).
- **F-4** (Flutter `design:` is a silent no-op): item **#33**, [#3071](https://github.com/Loom-Harness/Loc/pull/3071).
- **F-6** (`ddd breakpoints` answers `:1`): item **#34**, diagnosed in [#3074](https://github.com/Loom-Harness/Loc/pull/3074).
- **M-2** (Feliz on `sdk:8.0`): no owner → [M-T9.79](../new-plan/T9-toolchain-health.md) row R2.

### The 2026-09-28 re-verification

Column key: *register-status* is what the register itself said; *true-status* is what re-running it on `main` showed (FIXED-VERIFIED / OPEN-TRACKED / OPEN-UNTRACKED / DECLINED / WRONG-CLAIM / UNVERIFIABLE). "Items #N" elsewhere on this page are the evaluation-closure review's deduplicated item numbers.

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

#### FIX-PLAN PR status

| plan PR | finding | landed? |
|---|---|---|
| PR-1 elixir invariants | F-1b | #3023 open (ready, unmerged) |
| PR-2 .NET BCL collision | F-2 | #3043 open (ready, checks pending/blocked) |
| PR-3 announce inferred rename | F-3 | never opened |
| PR-4 flutter design + stale template | F-4, F-5 | never opened; F-5 half landed independently via #3026 (F-116); F-4 half not |
| PR-5 breakpoints granularity | F-6 | never opened (not even the diagnosis/doc-fix step) |
| (F-1a, deferred to #2949) | F-1a | #2949 draft, conflicting |

#### The 09-27/28 sessions

- **dotnet BCL type collision** (branch claude/dotnet-bcl-type-collision) = THIS register's F-2 / FIX-PLAN PR-2 → PR #3043, open. PR body cites `eval-platform/` on this branch.
- **F-012 migration journal ordering** (branch claude/fix-migration-journal-ordering, 5 ahead / 0 behind main) is NOT from this register: it is **eval-cargo F-012** ("HIGH / operational: the first in-place model evolution silently skips its own migration…") on the sibling branch origin/claude/loom-platform-eval-mc2v5j (eval-cargo/FINDINGS.md:321). PR #3049 open, not merged. (Other F-012s exist on main in eval-clinica/eval-fieldops/eval — unrelated.)

#### Register reached main?

No. `git grep` on main for `eval-platform`, `loom-platform-eval`, the Task collision, flutter design no-op: zero hits in docs/, docs/new-plan/, experience_gathered.md, or the eval*/ registers on main. The only durable carriers are PR bodies (#3023, #3043) — which die with the PRs if closed. F-3, F-4, F-6 exist nowhere but the unmerged branch.

#### Top problems

1. **F-3 inferred rename is silent and untracked** — S1 data misattribution with 0 warnings; the planned `loom.migration-rename-inferred` warning was never started.
2. **F-4 flutter `design:` accepts anything, byte-identical output** — untracked; trivial fix (warning arm in `checkDeployableDesignPack`).
3. **F-6 breakpoints `:1`** — untracked; documented feature not delivering; not even the doc-softening happened.
4. **F-1a stuck** — #2949 draft + merge conflicts for 2 weeks while the register calls it "FIXED"; elixir precondition still compiles into a runtime KeyError.
5. **F-1b / F-2 fixes built but unmerged** (#3023, #3043) — S1 and S2 still live on main.
6. Register never merged; three open findings have no home on main.

## The register, as filed

*`eval-platform/FINDINGS.md` on the branch, verbatim except that headings are demoted one level and relative links point at the branch.*

## Loom platform evaluation — defect findings

**Date:** 2026-09-22 · **Repo state:** `86628b3f` (`Loom-Harness/loc`, fresh `main`)
**Scope:** adoption probe focused on *technology/stack claims* and *stack switching*.
Everything below was executed; nothing is quoted from a doc without running it.

Severity key — **S1** silent wrong behaviour at runtime · **S2** silent build break
(`generate` says 0 errors, the target toolchain fails) · **S3** correctness-neutral
friction / drift.

---

### F-1a (S2/S1) — Undefined member access on a scalar field passes validation and reaches codegen

> **ALREADY CLAIMED AND FIXED — do not duplicate.** PR **#2949**
> (`claude/fix-primitive-member-access`, draft since 2026-09-14) closes exactly this,
> with `loom.unknown-primitive-member`, per-primitive wording for `money`/`json`/`File`,
> and a 408-file differential blast-radius sweep. **Verified by execution, not by
> reading its body:** built that branch in a worktree and ran my own repros through it —
> both `money.amount` and `label.bogusThing` are now refused at `file:line:col`.
> Recorded here because the finding was reached independently and its evidence
> (the five-backend outcome table below) corroborates that PR's case.

The validator does not check that a member EXISTS on a primitive-typed receiver.
Both of these parse with `0 error(s), 0 warning(s)`:

```
label: string
total: money
invariant label.bogusThing > 0          // string has no `bogusThing`
invariant total.completelyBogusMember >= 0
```

and the member is emitted verbatim into the target language:

```ts
// api/domain/invoice.ts:37
if (!(this._label.bogusThing > 0)) throw new DomainError("Invariant violated: label.bogusThing > 0");
```

This contradicts the architectural claim that the IR is "fully resolved ... every member
access carries `receiverType` and `memberType` ... backends never re-resolve": the
access is *typed*, but its existence is never checked, so the error surfaces in the
target toolchain instead of the compiler.

#### The realistic instance: `money.amount`

`money.amount` / `money.currency` are not in `docs/stdlib.md` and are supported by no
backend — but they are the obvious spelling, and they validate clean. One line,
`invariant total.amount >= 0`, produces five different outcomes:

| backend | outcome |
|---|---|
| node    | ❌ `tsc` — `Property 'amount' does not exist on type 'Decimal'` |
| python  | ❌ `mypy --strict` — `"Decimal" has no attribute "amount"` |
| dotnet  | ❌ `CS1061` — `'decimal' does not contain a definition for 'Amount'` |
| java    | ❌ `javac` — `symbol: method amount(), location: variable total of type BigDecimal` |
| elixir  | ⚠️ **compiles clean — and then fails two different silent ways (below)** |

Four backends fail loudly and late (S2). **Elixir never fails at build time at all**,
and which silent failure you get depends on *where* you wrote the expression:

**(a) In an `invariant` — the rule is silently DROPPED.** The changeset emits the
aggregate's *other* invariants (`label.length > 0` → `validate_change`, `qty >= 1` →
`validate_number`) plus a generic `__loom_money_range` bounds check, but the authored
rule is absent from the entire tree:
`grep -rn ">= 0\|amount\|Invariant violated" lib/` returns nothing, and
`mix compile --warnings-as-errors` is green. The business rule simply never runs.

**(b) In a `precondition` — the expression IS emitted, and CRASHES at runtime.**

```elixir
# lib/api/c.ex
with :ok <- ensure(record.total.amount > 0, {:precondition_failed, "..."}),
```

`record.total` is a `Decimal`, whose struct keys are `[:exp, :__struct__, :sign, :coef]`
— there is no `:amount`. Verified in the compiled project:

```
Decimal struct keys: [:exp, :__struct__, :sign, :coef]
d.amount RAISES: KeyError -- key :amount not found in: Decimal.new("5")
```

So the guard compiles green and raises `KeyError` the first time the operation is
invoked — a 500, not the 422 the author intended.

Both halves defeat the loud compile-time failure the other four backends give.

**Why this is the key stack-switching finding:** moving `platform: node` → `platform:
elixir` silently converts a build error into an unenforced business rule. The model that
refused to compile now ships.

**Scope (measured):** on Elixir, money-component access is dropped in `invariant`
position and emitted-but-runtime-fatal in `precondition` position; scalar and string
expressions are correct in both positions.

**Repro:** `eval-platform/repro/money-amount/` — `main.ddd` (money case), `scope.ddd`
(which invariant shapes survive on Elixir), `precond.ddd` (the runtime-crash half),
`bogus2.ddd` (the general member-check gap).

---

### F-1b (S1) — Elixir silently drops any invariant outside a narrow allow-list

**This is the finding that survives #2949, and it is the more serious one.** #2949 stops
you *writing* `money.amount`; it does nothing about Elixir dropping invariants it cannot
render. Verified against PR #2949's own branch: the repro below still validates
`0 error(s), 0 warning(s)` there.

Five invariants, all **legal Loom** (no invented members, nothing #2949 would reject):

```ddd
aggregate Order {
  sku: string   qty: int   contains lines: Line[]
  derived isBig: bool = qty > 100
  invariant sku.length > 0            // single-field native
  invariant qty >= 1                  // single-field native
  invariant sku.trim().length > 0     // method call
  invariant lines.count > 0           // collection walk
  invariant isBig == false            // derived getter
  entity Line { amount: int }
}
```

| backend | invariants enforced |
|---|---|
| node | **5 / 5** |
| dotnet | **5 / 5** |
| java | **5 / 5** |
| python | **5 / 5** |
| **elixir** | **2 / 5** — `sku.trim().length`, `lines.count` and `isBig` are absent from the entire generated tree |

`ddd generate system` reports `0 error(s), 0 warning(s)` for all five. Three declared
business rules are simply not enforced on Elixir, and nothing anywhere says so.

**Root cause, located.** `src/generator/elixir/vanilla/changeset-invariant-emit.ts`
gates every cross-field invariant through `structEvaluable()`, which returns `false` for
`member`, `method-call`, `call`, `match`, `new`, `object`, `list` and `this-derived`
refs. `changeset-emit.ts` handles only single-field natives via `singleFieldConstraints`.
An invariant matching neither path falls through **silently**.

The module's own header comment states the consequence plainly — and shows the drop is
known in the cross-field case it was written to close:

> "Without this module such an invariant is **silently dropped on every path** — create,
> PATCH and operation persist all skip it — while the other four backends 400 it at the
> domain floor."

…and then scopes itself to scalar comparisons, leaving everything else to "keep their
(absent) domain-level story". That residual is what this finding measures: the fail-open
was narrowed, not closed, and it is not announced.

**Repro:** `eval-platform/repro/elixir-invariant-drop/`.

---

### F-2 (S2) — The `.NET` backend cannot compile the shipped `ddd new --template crud` starter

`node bin/cli.js new X --platform dotnet --template crud` emits an aggregate named
`Task`. On .NET that collides with `System.Threading.Tasks.Task`, and `dotnet build`
fails with **17 errors** (`CS0104` ambiguous reference, plus `CS0535`/`CS0738`
interface-implementation failures on the generated repository) while `generate system`
reported `0 error(s), 0 warning(s)`.

**Mutation proof:** renaming only the aggregate `Task` → `Job` in the same model turns
the build into `Build succeeded. 0 Warning(s)`. Nothing else changed.

This is the first thing a new adopter on .NET does. Note the repo *does* carry a
`test/fixtures/corpus/java-reserved-words.ddd` fixture, so the reserved-word problem is
known for Java — the C# `Task` collision is not covered.

**Repro:** `eval-platform/repro/dotnet-task-collision/`.

---

### F-3 (S1, but a DELIBERATE trade-off — reframed after reading the code)

Loom's destructive gate is good. Dropping a field emits a precise refusal:

```
main.ddd: migration for module "S" contains 1 destructive change(s):
  - DROP COLUMN c.products.title
... re-run `generate system` with --allow-destructive to apply them.
```

But **drop-one-field + add-an-unrelated-field of the same type in one edit** is silently
classified as a rename, so the gate never fires:

```
v1: sku, title, price        v2: sku, description, price
emitted: ALTER TABLE "c"."products" RENAME COLUMN "title" TO "description";
```

`title`'s data now lives in `description` with `0 error(s), 0 warning(s)` and no flag
required.

**Correction to my first reading.** I initially wrote this up as an oversight. It is not.
`src/system/migrations-builder.ts` (~line 1329) carries a long, explicit rationale for the
collapse, names F-018 directly, and shows that F-018's *backfill-discard* half **was
fixed** — a declared backfill is now contrary signal (1), a scalar field default contrary
signal (2), a nullability mismatch contrary signal (3). The author's argument is stated
and reasonable: the collapse fires only where the author gave no contrary signal.

So the residual is a **known, documented guess**, not a bug. What is genuinely missing is
that the guess is **silent**: there is no `loom.migration-rename-*` diagnostic for the
INFERRED case (only for the explicit-intent structural errors), and `docs/migrations.md`
documents the explicit `migration { Agg.old -> new }` block without warning that the
absence of one lets a drop+add be reinterpreted.

That reframes the fix from "change the heuristic" (which would break real renames) to
"**announce the guess**" — see `FIX-PLAN.md` PR-3.

**Repro:** `eval-platform/migr/` (`out2` = the mis-inferred rename, `out3` = the correctly
gated pure drop).

---

### F-4 (S3) — `design:` on a Flutter deployable is an unvalidated, silent no-op

Every other frontend rejects a framework-mismatched design pack with an excellent
diagnostic that lists the valid packs:

```
error: Design pack 'mantine' is a tsx pack but framework 'vue' renders vue.
       Use one of: vuetify, shadcnVue.
```

Flutter accepts **any** value — including `mantine`, which is rejected for vue, svelte,
angular and feliz — and generates **byte-identical** output for `design: mantine` and
`design: shadcn`, with no error and no warning. Root cause: `expectedPackFormatFor()`
(`src/language/validators/data/platform-rules.ts:133`) returns `undefined` for
`flutter`, so the pack check is skipped entirely.

The author believes they selected a design; nothing happened and nothing said so.

---

### F-5 (S3) — The `ddd new` starter template documents a limitation that has since been fixed

`src/cli/new-templates.ts:273` ships this in every scaffolded `main.ddd`:

> hand-write those three on any aggregate you want gated until
> `crudish(requires: <Policy>)` lands.

`crudish(requires: <Policy>)` **has** landed (`src/macros/stdlib/crudish.macro.ts:85`),
and the validator's own diagnostic correctly tells you to use it. Verified working in
this evaluation. The stale text is in the one file every new adopter reads first.

---

### F-6 (S3) — `ddd breakpoints` resolves the file but rarely the line

`--sourcemap` + `ddd breakpoints --line N` names the right generated **files** for every
construct tried, but the line number is `:1` for most of them:

```
main.ddd:74 (a field)      -> api/domain/order.ts:1, api/http/order.routes.ts:1
main.ddd:80 (an invariant) -> api/domain/order.ts:1, api/http/order.routes.ts:1
main.ddd:85 (a requires)   -> api/domain/order.ts:60, api/domain/order.ts:1, ...
main.ddd:100 (a find)      -> api/db/repositories/order-repository.ts:1
```

Useful as "which file"; not yet usable as the breakpoint-setting feature it is
documented as.

---

### Environment constraints (NOT Loom defects — recorded so they are not misread)

- **.NET/NuGet, Elixir/hex, Feliz/nodesource** fail TLS inside containers until the
  sandbox proxy CA is installed and `HTTPS_PROXY` is exported into the container. The
  Elixir Dockerfile Loom *generates* already anticipates exactly this (it ships a
  `certs/` dir wired to `SSL_CERT_FILE`/`HEX_CACERTS_PATH`) — a genuinely thoughtful touch.
- **Angular** needs Node ≥ 22.22.3; this host has 22.22.2. Loom's generated Angular
  Dockerfile correctly pins `node:24-alpine`, so the supported path is unaffected.
- Installing `node_modules` on the glibc host and then building in an Alpine container
  breaks `oxc-parser`'s native binding. My error, not Loom's.
- Docker Hub returned `429 Too Many Requests` during the Feliz runtime stage.

### Minor observations

- The generated HTTP API is **command-oriented, not REST**: updates are
  `POST /api/<plural>/{id}/update`, and `PUT` returns 405. Defensible for a DDD tool,
  but an adopter expecting REST verbs should know before writing clients.
- The Feliz frontend Dockerfile pins `mcr.microsoft.com/dotnet/sdk:8.0` while the .NET
  backend targets `net10.0` — two .NET major versions in one generated tree.

## Repro sources

*Every `.ddd` repro the register cites, copied from the branch. They are kept here as text so the repo-wide `.ddd` census does not treat deliberately-broken models as fixtures; copy one to a `.ddd` file to run it.*

### `eval-platform/migr/out2/main.ddd`

```ddd
system Shop {
  subdomain S {
    context C {
      aggregate Product {
        sku: string
        description: string
        price: money
      }
      repository Products for Product { }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000 }
}
```

### `eval-platform/migr/out3/main.ddd`

```ddd
system Shop {
  subdomain S {
    context C {
      aggregate Product {
        sku: string
        price: money
      }
      repository Products for Product { }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000 }
}
```

### `eval-platform/migr/v1.ddd`

```ddd
system Shop {
  subdomain S {
    context C {
      aggregate Product {
        sku: string
        title: string
        price: money
      }
      repository Products for Product { }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000 }
}
```

### `eval-platform/repro/dotnet-task-collision/main.ddd`

```ddd
// Acmeship — scaffolded by `ddd new` (template: crud, platform: node).
// Edit this model, then regenerate:
//   npx ddd generate system main.ddd -o . && docker compose up

system Acmeship {

  // Authorization is opt-in in a fresh model.  When you wire real auth, prefer
  // deny-by-default: every client-reachable command (operations, creates,
  // destroys, workflow starters + handlers) and every DECLARED read (repository
  // finds, projections) must then carry a `requires <expr>` gate —
  // `requires true` is the explicit "intentionally public" escape.  Mark the
  // deployable `auth: required` to enforce it.
  //
  // Two limits to know before you turn it on.  The synthesised LIST read is
  // coverable — declare `find all(): <T>[] requires <expr>` on the repository
  // and the gate lands on `GET /<plural>`.  The synthesised BY-ID read is not:
  // `GET /api/<plural>/{id}` has no author surface to attach a gate to, so
  // under denyByDefault it still serves to any authenticated caller — the
  // build now WARNS about each one (`loom.default-deny-by-id-ungated`) rather
  // than passing silently, until the gate surface lands (mission M-T3.19).
  // A tenancy filter still covers that route (a foreign tenant reads 404); what
  // it does not cover is role separation within a tenant.
  // And `with crudish` generates its
  // create/update/destroy, which likewise cannot carry a gate today:
  // hand-write those three on any aggregate you want gated until
  // `crudish(requires: <Policy>)` lands.  In both cases the gate is named at
  // the declaration — an INHERITED aggregate-level default was rejected, because
  // a deny rule invisible at the member it guards is the wrong trade.
  //   user {
  //     id: string
  //     role: string
  //     permissions: string[]
  //   }
  //   auth {
  //     enforcement: denyByDefault
  //     oidc { issuer: env("OIDC_ISSUER") clientId: env("OIDC_CLIENT_ID") }
  //   }

  subdomain Core {
    context Projects {
      aggregate Project with crudish {
        name: string
        invariant name.length > 0
        derived display: string = name
      }

      repository Projects for Project { }

      aggregate Job with crudish {
        title: string
        done: bool
        project: Project id
      }

      // A list read is a criterion + retrieval pair, not a bespoke repository
      // find: a list-returning "find byX(...)" is deprecated
      // (loom.repository-find-deprecated), and the starter used to ship one — so
      // a fresh "ddd new" warned on its own first parse.
      criterion InProject(p: Project id) of Job = project == p
      retrieval JobsInProject(p: Project id) of Job {
        where: InProject(p)
        sort: [title asc]
      }

      repository Jobs for Job { }
    }
  }

  ui WebApp with scaffold(subdomains: [Core]) {
  }

  storage primary { type: postgres }
  resource appState { for: Projects, kind: state, use: primary }

  deployable api {
    platform: dotnet,
    contexts: [Projects],
    dataSources: [appState],
    port: 3000
  }

  deployable webApp {
    platform: react,
    targets: api,
    ui: WebApp,
    port: 3001,
    design: mantine
  }
}
```

### `eval-platform/repro/elixir-invariant-drop/main.ddd`

```ddd
// All four invariants below are LEGAL Loom (no invented members).
// node/.NET/java/python enforce all four. Elixir emits only some.
system InvDrop {
  subdomain S {
    context C {
      aggregate Order {
        sku: string
        qty: int
        contains lines: Line[]

        derived isBig: bool = qty > 100

        invariant sku.length > 0                 // single-field native
        invariant qty >= 1                       // single-field native
        invariant sku.trim().length > 0          // method call
        invariant lines.count > 0                // collection walk
        invariant isBig == false                 // derived getter

        entity Line { amount: int }
      }
      repository Orders for Order { }
    }
  }
}
```

### `eval-platform/repro/elixir-invariant-drop/o-dotnet/main.ddd`

```ddd
// All four invariants below are LEGAL Loom (no invented members).
// node/.NET/java/python enforce all four. Elixir emits only some.
system InvDrop {
  subdomain S {
    context C {
      aggregate Order {
        sku: string
        qty: int
        contains lines: Line[]

        derived isBig: bool = qty > 100

        invariant sku.length > 0                 // single-field native
        invariant qty >= 1                       // single-field native
        invariant sku.trim().length > 0          // method call
        invariant lines.count > 0                // collection walk
        invariant isBig == false                 // derived getter

        entity Line { amount: int }
      }
      repository Orders for Order { }
    }
  }

  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: dotnet, contexts: [C], dataSources: [st], port: 3000 }
}
```

### `eval-platform/repro/elixir-invariant-drop/o-java/main.ddd`

```ddd
// All four invariants below are LEGAL Loom (no invented members).
// node/.NET/java/python enforce all four. Elixir emits only some.
system InvDrop {
  subdomain S {
    context C {
      aggregate Order {
        sku: string
        qty: int
        contains lines: Line[]

        derived isBig: bool = qty > 100

        invariant sku.length > 0                 // single-field native
        invariant qty >= 1                       // single-field native
        invariant sku.trim().length > 0          // method call
        invariant lines.count > 0                // collection walk
        invariant isBig == false                 // derived getter

        entity Line { amount: int }
      }
      repository Orders for Order { }
    }
  }

  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: java, contexts: [C], dataSources: [st], port: 3000 }
}
```

### `eval-platform/repro/elixir-invariant-drop/o-python/main.ddd`

```ddd
// All four invariants below are LEGAL Loom (no invented members).
// node/.NET/java/python enforce all four. Elixir emits only some.
system InvDrop {
  subdomain S {
    context C {
      aggregate Order {
        sku: string
        qty: int
        contains lines: Line[]

        derived isBig: bool = qty > 100

        invariant sku.length > 0                 // single-field native
        invariant qty >= 1                       // single-field native
        invariant sku.trim().length > 0          // method call
        invariant lines.count > 0                // collection walk
        invariant isBig == false                 // derived getter

        entity Line { amount: int }
      }
      repository Orders for Order { }
    }
  }

  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: python, contexts: [C], dataSources: [st], port: 3000 }
}
```

### `eval-platform/repro/money-amount/bogus.ddd`

```ddd
// Minimal repro: `invariant <moneyField>.amount >= 0` is accepted by the Loom
// validator (0 errors) but behaves differently on all five backends.
system MoneyRepro {
  subdomain S {
    context C {
      aggregate Invoice {
        label: string
        total: money
        invariant total.completelyBogusMember >= 0
      }
      repository Invoices for Invoice { }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000 }
}
```

### `eval-platform/repro/money-amount/bogus2.ddd`

```ddd
// Minimal repro: `invariant <moneyField>.amount >= 0` is accepted by the Loom
// validator (0 errors) but behaves differently on all five backends.
system MoneyRepro {
  subdomain S {
    context C {
      aggregate Invoice {
        label: string
        total: money
        invariant label.bogusThing > 0
      }
      repository Invoices for Invoice { }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000 }
}
```

### `eval-platform/repro/money-amount/main.ddd`

```ddd
// Minimal repro: `invariant <moneyField>.amount >= 0` is accepted by the Loom
// validator (0 errors) but behaves differently on all five backends.
system MoneyRepro {
  subdomain S {
    context C {
      aggregate Invoice {
        label: string
        total: money
        invariant total.amount >= 0
      }
      repository Invoices for Invoice { }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000 }
}
```

### `eval-platform/repro/money-amount/precond.ddd`

```ddd
system PreCond {
  subdomain S {
    context C {
      aggregate Invoice {
        label: string
        total: money
        operation approve() {
          precondition total.amount > 0
          precondition label.length > 0
          label := label + "!"
        }
      }
      repository Invoices for Invoice { }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: elixir, contexts: [C], dataSources: [st], port: 3000 }
}
```

### `eval-platform/repro/money-amount/scope.ddd`

```ddd
system MoneyScope {
  subdomain S {
    context C {
      aggregate Invoice {
        label: string
        qty: int
        total: money
        invariant label.length > 0
        invariant qty >= 1
        invariant total.amount >= 0
        invariant total.currency == "USD"
      }
      repository Invoices for Invoice { }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: elixir, contexts: [C], dataSources: [st], port: 3000 }
}
```

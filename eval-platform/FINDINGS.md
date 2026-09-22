# Loom platform evaluation — defect findings

**Date:** 2026-09-22 · **Repo state:** `86628b3f` (`Loom-Harness/loc`, fresh `main`)
**Scope:** adoption probe focused on *technology/stack claims* and *stack switching*.
Everything below was executed; nothing is quoted from a doc without running it.

Severity key — **S1** silent wrong behaviour at runtime · **S2** silent build break
(`generate` says 0 errors, the target toolchain fails) · **S3** correctness-neutral
friction / drift.

---

## F-1a (S2/S1) — Undefined member access on a scalar field passes validation and reaches codegen

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

### The realistic instance: `money.amount`

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

## F-1b (S1) — Elixir silently drops any invariant outside a narrow allow-list

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

## F-2 (S2) — The `.NET` backend cannot compile the shipped `ddd new --template crud` starter

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

## F-3 (S1, but a DELIBERATE trade-off — reframed after reading the code)

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

## F-4 (S3) — `design:` on a Flutter deployable is an unvalidated, silent no-op

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

## F-5 (S3) — The `ddd new` starter template documents a limitation that has since been fixed

`src/cli/new-templates.ts:273` ships this in every scaffolded `main.ddd`:

> hand-write those three on any aggregate you want gated until
> `crudish(requires: <Policy>)` lands.

`crudish(requires: <Policy>)` **has** landed (`src/macros/stdlib/crudish.macro.ts:85`),
and the validator's own diagnostic correctly tells you to use it. Verified working in
this evaluation. The stale text is in the one file every new adopter reads first.

---

## F-6 (S3) — `ddd breakpoints` resolves the file but rarely the line

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

## Environment constraints (NOT Loom defects — recorded so they are not misread)

- **.NET/NuGet, Elixir/hex, Feliz/nodesource** fail TLS inside containers until the
  sandbox proxy CA is installed and `HTTPS_PROXY` is exported into the container. The
  Elixir Dockerfile Loom *generates* already anticipates exactly this (it ships a
  `certs/` dir wired to `SSL_CERT_FILE`/`HEX_CACERTS_PATH`) — a genuinely thoughtful touch.
- **Angular** needs Node ≥ 22.22.3; this host has 22.22.2. Loom's generated Angular
  Dockerfile correctly pins `node:24-alpine`, so the supported path is unaffected.
- Installing `node_modules` on the glibc host and then building in an Alpine container
  breaks `oxc-parser`'s native binding. My error, not Loom's.
- Docker Hub returned `429 Too Many Requests` during the Feliz runtime stage.

## Minor observations

- The generated HTTP API is **command-oriented, not REST**: updates are
  `POST /api/<plural>/{id}/update`, and `PUT` returns 405. Defensible for a DDD tool,
  but an adopter expecting REST verbs should know before writing clients.
- The Feliz frontend Dockerfile pins `mcr.microsoft.com/dotnet/sdk:8.0` while the .NET
  backend targets `net10.0` — two .NET major versions in one generated tree.

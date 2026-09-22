# Loom platform evaluation — defect findings

**Date:** 2026-09-22 · **Repo state:** `86628b3f` (`Loom-Harness/loc`, fresh `main`)
**Scope:** adoption probe focused on *technology/stack claims* and *stack switching*.
Everything below was executed; nothing is quoted from a doc without running it.

Severity key — **S1** silent wrong behaviour at runtime · **S2** silent build break
(`generate` says 0 errors, the target toolchain fails) · **S3** correctness-neutral
friction / drift.

---

## F-1 (S2/S1) — Undefined member access on a scalar field passes validation and reaches codegen

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
| elixir  | ⚠️ **compiles clean; the rule is silently dropped** |

Four backends fail loudly and late (S2). **Elixir fails silently (S1)** — the changeset
emits the aggregate's *other* invariants (`label.length > 0` → `validate_change`,
`qty >= 1` → `validate_number`) plus a generic `__loom_money_range` bounds check, but
the authored rule is absent from the entire tree:
`grep -rn ">= 0\|amount\|Invariant violated" lib/` returns nothing, and
`mix compile --warnings-as-errors` is green.

**Why this is the key stack-switching finding:** moving `platform: node` → `platform:
elixir` silently converts a build error into an unenforced business rule. The model that
refused to compile now ships.

**Scope (measured):** on Elixir, invariants reaching into money components are dropped;
scalar and string invariants survive.

**Repro:** `eval-platform/repro/money-amount/` — `main.ddd` (money case), `scope.ddd`
(which shapes survive on Elixir), `bogus2.ddd` (the general member-check gap).

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

## F-3 (S1) — The migration rename heuristic routes around the destructive gate

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
required. The gate exists and works; the heuristic that reclassifies the change bypasses
it. (This reproduces F-018 from the 2026-09-13 evaluation — still open 9 days later.)

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

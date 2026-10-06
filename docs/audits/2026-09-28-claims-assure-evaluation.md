# Claims-platform ("Assure") dev-experience evaluation — findings register (ported)

> **Ported 2026-09-29** from the unmerged branch `claude/loom-dev-experience-test-xukeqa` (`11f96125e 2026-09-28`), register `eval-claims/`. The branch was never merged and is not meant to be: it carries generated trees. This page keeps the **findings and the repro sources only** — the generated output, the application models and the evaluation report stay on the branch ([browse it](https://github.com/Loom-Harness/Loc/blob/claude/loom-dev-experience-test-xukeqa/eval-claims)). Relative links in the ported text point at the branch.
>
> It is a snapshot: the verified-status section below is the 2026-09-28 re-verification against `main` @ `d2a0bc02` (repros re-run with `ddd parse` / `generate system`, emitted code read, no stack booted), updated 2026-09-29 with what has landed or been claimed since. The live plan is `docs/new-plan/` (this register's row is in `coverage.md`). Finding ids are this register's own; the same `F-0nn` means different defects in other registers.

A dev-experience build of an insurance-claims platform over three model versions (`v1/`–`v3/` on the branch): findings F-101–F-117. Its fix PRs (#3026, #3029, #3031, #3044, #3050) merged 2026-09-28; the register itself never did. M-T1.35 and M-T5.39 were minted from it.

## Verified status (re-verified 2026-09-28, updated 2026-09-29)

### Since 2026-09-28

- **F-103** (a `requires`-gated operation reached from a reactor): item **#3**, owner ruling **D1** — reactors run as a tenant-scoped `system` principal, with `currentUser.isSystem`; command-workflow half on Java/.NET in [#3066](https://github.com/Loom-Harness/Loc/pull/3066), the rest is eval-closure wave C1. #2966 closed unmerged.
- **F-105** (unit `test` body op-call args unchecked): item **#32**, M-T5.41, [#3092](https://github.com/Loom-Harness/Loc/pull/3092) (Wave B1).
- **F-108** (scaffold over a context the `targets:` backend no longer serves): item **#18**, [#3088](https://github.com/Loom-Harness/Loc/pull/3088) (`loom.ui-aggregate-unserved`).
- **F-112 kafka sibling** (consumers start at `latest`): item **#13**, ruling **D3** (`earliest` for a new group on work queues), eval-closure wave C4.
- **Keycloak demo user has no `permissions` attribute**: item **#26**, wave C3 (#2948 closed unmerged).
- The register's headline "15 of 17 closed" overstates: 12 fixed, 1 missioned (F-110 → M-T5.39), 1 declined (F-117), 3 open (F-103, F-105, F-108) as of 2026-09-28.

### The 2026-09-28 re-verification

Column key: *register-status* is what the register itself said; *true-status* is what re-running it on `main` showed (FIXED-VERIFIED / OPEN-TRACKED / OPEN-UNTRACKED / DECLINED / WRONG-CLAIM / UNVERIFIABLE). "Items #N" elsewhere on this page are the evaluation-closure review's deduplicated item numbers.

Branch: 2 commits (f4b580297 evaluation, 11f96125e disposition). **No PR was ever opened from this branch** (list_pull_requests head=… → empty). The register never reached main; `eval-claims/` absent on main; `docs/new-plan/coverage.md` does not disposition it (sibling registers `eval-fieldops/`, `eval-clinica/` and 4 `docs/audits/*-dev-experience.md` ARE on main). Only on-main traces: M-T1.35 ("Minted … by the 'Assure' dev-experience evaluation"), M-T5.39 (date scalar), M-T9.66 (mission-count collisions), plus fix PR bodies #3026/#3029/#3031/#3044/#3050 (all merged 2026-09-28).

Method: every repro/ file + v1/v2/v3 main.ddd re-run with `ddd parse` / `generate system` on current main; F-102/F-103 re-generated on all 5 backends; F-106/F-107 on react/vue/svelte/angular/flutter; F-108 reproduced by splitting Claims onto its own deployable in v2; one-liner probes for F-109/110/111/115; emitter greps for F-112 siblings. Static only (no docker, no tsc of output).

| id | sev | register-status | true-status | evidence | notes |
|---|---|---|---|---|---|
| F-101 | S1 | fixed #3029 | FIXED-VERIFIED | repro now emits `createInProcessDispatcher/createOutboxDispatcher/startOutboxRelay` in api/http/workflows.ts; fix in src/platform/hono/v4/workflow-builder.ts; corpus fixture `channels-broker-workflow` | node-only defect class; v5 delegates to v4 |
| F-102 | S1 | fixed #3029 | FIXED-VERIFIED | node api_a no longer imports `Addr`; dotnet/java/python/elixir api_a also free of `Addr`; fixture `projection-split-deployables` | all 5 backends clean |
| F-103 | S1 | "claimed elsewhere — #2966 owns it; my note widens theirs" | OPEN-UNTRACKED (+WRONG-CLAIM) | Current main, repro: node workflows.ts:103 `currentUser.permissions` unbound; .NET CloseOrderStartShippedHandler.cs:35 same; java OrdDispatcher.java:41 same; python dispatch.py:28 `o.finish()` gate absent; elixir start_shipped.ex:18 `finish_order(o, %{})` → `current_user` nil → crash. #2966 is a DRAFT, `mergeable_state: dirty`, idle since 2026-09-21, scoped **Java only**; it has **0 comments** — the "widening note" was never posted. No new-plan mission. | Language gap ("saga-only operation" / reactor principal) also untracked anywhere in docs/new-plan |
| F-104 | S1 | fixed #3031 | FIXED-VERIFIED | repro → `error: 'R.create' field 'a' expects 'A id' but got 'B2 id' …` | |
| F-105 | S1 | OPEN, unclaimed | OPEN-UNTRACKED | repro still `0 error(s)`; control (workflow body) still 2 errors. No mission/PR mentions it (grep docs/new-plan, PR search) | disposition accurate |
| F-106 | S1 | fixed #3050 | FIXED-VERIFIED | `.round(0)`/`.round(2)` on projection money → `toDecimalPlaces(n, Decimal.ROUND_HALF_UP)` on react/vue/svelte/angular (angular exposes `Decimal` on the class) | |
| F-107 | S2 | fixed #3050 | FIXED-VERIFIED | original repro → `loom.money-in-text-slot` error (projection `of:` now reached); interpolated form compiles via `.toString()` | fires also for flutter/vue (refusal, not MoneyValue rendering) — non-React frontends refused rather than formatted |
| F-108 | S2 | "half fixed — refused + M-T1.35" | OPEN-UNTRACKED (+WRONG-CLAIM) | Re-ran the register's actual scenario (v2, Claims moved to `claimsApi`, `ui Portal with scaffold`, `targets: api`): `parse` 0 errors, `generate` → **26 error(s)** `loom.method-call-unresolved-receiver`/`page-ref-unreachable` in unwritten portal pages, none naming `targets:`/context. The new `loom.ui-multi-backend-unsupported` only fires for ≥2 api handles bound to distinct deployables — a different shape. M-T1.35 text covers only per-handle routing; it never mentions the scaffold/`targets:` mismatch message. | Refusal for multi-handle shape is real (ui-backend-binding-checks.ts) but doesn't touch F-108's repro |
| F-109 | S2 | fixed #3026 | FIXED-VERIFIED | `migration "r" { A.description -> summary }` (also message/key/page) → 0 errors; `PropertyName` rule at ddd.langium:104/159 | |
| F-110 | S2 | filed M-T5.39 | OPEN-TRACKED | T5-language-core.md:319 `M-T5.39 … open · L · P1`; `date` still unknown type | |
| F-111 | S2 | fixed #3026 | FIXED-VERIFIED | `string(guid)`, `string(datetime)` → 0 errors; json/File refused with corrected vocabulary text | |
| F-112 | S3 | fixed #3029 | FIXED-VERIFIED (rabbitmq only) | v2 broker-init/bus-definitions.json now has 3 exchanges / 4 queues / 4 bindings incl. `loom.Claims.ClaimEvents.payoutsApi`; test/generator/channels-auth.test.ts pins bindings | Sibling on **kafka** open & untracked: node kafkajs `consumer.subscribe({topic})` (no fromBeginning), java `AUTO_OFFSET_RESET "latest"` (java/emit/channels.ts:720), .NET `AutoOffsetReset.Latest` (dotnet/emit/channels.ts:545) — a new group misses queue/work events published before its first boot; v2 with `type: kafka` validates clean. Static finding, not booted. |
| F-113 | S3 | fixed #3044 | FIXED-VERIFIED | repro → 2 × `loom.workflow-param-unused` warning | |
| F-114 | S3 | fixed as advisory #3044 | FIXED-VERIFIED | v1/v2/v3 print `loom.aggregate-not-constructible` suggestions for Policy/Claim (true positives) | advisory, not warning — by design |
| F-115 | S3 | fixed #3026 | FIXED-VERIFIED | `date` → no bogus hint; `Adr` → "Did you mean 'Addr'?" even with scaffold ui | |
| F-116 | S3 | fixed #3026 | FIXED-VERIFIED | "until `crudish(requires` " gone from src/cli/new-templates.ts | |
| F-117 | S4 | dropped (wrong to file) | DECLINED | sales-ui.ddd still fails parse by design; documented README.md:264, examples/README.md:18, pinned in test/_helpers/ddd-corpus.ts, ddd-source-census, etc. | |

Unnumbered items in EVALUATION-REPORT.md:
- Keycloak demo user has no `permissions` attribute / no unmanagedAttributePolicy → every gated write 403s out of the box. Still live (v2 realm.json: demo user attributes = `{tenantId}` only; no "unmanaged"). "Owned" by #2948 item 1 — DRAFT, dirty, idle since 2026-09-21. OPEN (weakly tracked by stale draft).
- "Authorization has no internal door" (saga-reachable-only operation; reactor principal): untracked.
- M-T3.19 (by-id ungated) referenced — exists, open.

#### Counts
FIXED-VERIFIED 12 (101,102,104,106,107,109,111,112*,113,114,115,116) · OPEN-TRACKED 1 (110) · OPEN-UNTRACKED 3 (103,105,108) · DECLINED 1 (117) · WRONG-CLAIM 3 (103 ownership, 108 half-fixed/M-T1.35, "15 of 17 closed" headline) · UNVERIFIABLE 0.

#### Top problems
1. **F-103 is the worst open item and effectively orphaned**: uncompilable on node/.NET/java, silently ungated on python, runtime crash on elixir — "owned" by a stale Java-only draft (#2966) that never received the widening note. Needs a mission covering all 5 backends + the language question (reactor principal / saga-only operation).
2. **F-108's disposition is wrong**: the shipped refusal covers a different shape (multi-handle binding); the register's own scenario (move a context off the `targets:` backend under a scaffolded ui) still yields 26 misdirecting generated-page errors after a clean `parse`, and M-T1.35 does not own the message fix.
3. **F-105** (unit-`test` body operation-call args unchecked) — open, no mission.
4. **F-112 fixed on rabbitmq only**; kafka consumers on all three kafka emitters start at `latest`, same lost-event class, untracked.
5. **"15 of 17 closed" overstates**: 12 fixed, 1 filed as mission, 1 declined, 3 open.
6. Register itself never reached main and isn't dispositioned in `docs/new-plan/coverage.md`, unlike sibling evals (`eval-fieldops/`, `eval-clinica/`, docs/audits/*-dev-experience.md).

#### Recommendation
Port (not merge verbatim) to main: add `eval-claims/FINDINGS.md` + repro/ (or a docs/audits entry) with the corrected disposition, disposition it in coverage.md, and mint missions for F-103 (5-backend + language), F-105, F-108 message, and the kafka F-112 sibling. The v1–v3 models are useful corpus candidates (axis combinations).

## The register, as filed

*`eval-claims/FINDINGS.md` on the branch, verbatim except that headings are demoted one level and relative links point at the branch.*

## Loom dev-experience evaluation — "Assure", a claims platform

Three iterations of an insurance/banking claims system, built the way a new
user would: `ddd new`, then grow the model, regenerate, compile, boot, and
evolve it under simulated user feedback.

Baseline: `main` @ `86628b3f` (2026-09-22). Every repro below was re-run on
that tree. Where a stack was booted, it was booted **for real** (postgres 18 +
RabbitMQ 4 + Keycloak 26 + the generated node backend), not simulated.

Severity **S1** doesn't compile/boot, silently wrong, or data-unsafe ·
**S2** blocked or expensively worked around · **S3** repeated friction ·
**S4** polish.
Class **SILENT** (`0 error(s)`, broken output) · **HONEST** (a `loom.*`
diagnostic) · **DOCUMENTED**.

| | S1 | S2 | S3 | S4 |
|---|---|---|---|---|
| count | **6** | **5** | **5** | **1** |

SILENT: 9 · HONEST-but-wrong-target: 3 · gap/friction: 5

---

## Disposition — added 2026-09-28, after the fix batch landed

The register below is the evaluation as written. This table is what happened to
each finding afterwards. **15 of 17 are closed**; the two that are not are named,
with who owns them.

| | disposition | where |
|---|---|---|
| F-101 | **fixed** — the durable-events check hoisted out of the `workflows.length === 0` early return | [#3029](https://github.com/Loom-Harness/Loc/pull/3029) |
| F-102 | **fixed** — the VO import intersected with the hosted pool, python's `.filter(refersTo)` pattern | [#3029](https://github.com/Loom-Harness/Loc/pull/3029) |
| F-103 | **claimed elsewhere** — [#2966](https://github.com/Loom-Harness/Loc/pull/2966) (draft) owns it. My note widens theirs: it was filed there as Java-only and is live on node and .NET too, with python dropping the gate and elixir passing `nil`. Not touched by this batch. | #2966 |
| F-104 | **fixed** — a `create({…})` argument whose expected and actual are both `kind: "id"` with *different* targets is no longer a wire coercion | [#3031](https://github.com/Loom-Harness/Loc/pull/3031) |
| F-105 | **OPEN, unclaimed** — split out of #3031 deliberately rather than absorbed. Nothing inside a unit `test` body is validated at all. [#2958](https://github.com/Loom-Harness/Loc/pull/2958) (merged) did the analogous job for `test e2e` payloads; this is its unit-`test` sibling. | — |
| F-106 | **fixed** — root-caused to `ofReadResultType` recognising only `<handle>.<Aggregate>.<verb>`, so the fifth documented `of:` form typed every row field as `string` | [#3050](https://github.com/Loom-Harness/Loc/pull/3050) |
| F-107 | **fixed** — same root cause; `loom.money-in-text-slot` now reaches a projection row via an IR fast path, not only `wireFieldsForAggregate` | [#3050](https://github.com/Loom-Harness/Loc/pull/3050) |
| F-108 | **half fixed** — a ui bound to two backends is now **refused** with a diagnostic instead of emitted half-wired. Per-handle api clients + base URLs (the emission fix), and a better message for the scaffold/`targets:` mismatch, are **M-T1.35**, which owns the ui↔backend surface. | [#3029](https://github.com/Loom-Harness/Loc/pull/3029) + M-T1.35 |
| F-109 | **fixed** — a `PropertyName` rule mirroring what `Property` admits, used only by the migration `ColumnStep`; 81 names admitted | [#3026](https://github.com/Loom-Harness/Loc/pull/3026) |
| F-110 | **filed as a mission, not fixed** — `M-T5.39`, sized **L**. A new scalar walks the whole pipeline and needs its semantics decided first (comparison against `datetime`, `today()`, wire format, what `date` means under a tenant in another timezone). | mission M-T5.39, filed with [#3044](https://github.com/Loom-Harness/Loc/pull/3044) |
| F-111 | **fixed** — the false "any primitive" wording corrected, and `string(guid)` / `string(datetime)` re-admitted (both have unambiguous canonical forms), which also un-blocks the circular interpolation advice | [#3026](https://github.com/Loom-Harness/Loc/pull/3026) |
| F-112 | **fixed** — `exchanges`/`queues`/`bindings` added to the generated broker definitions. Proved at a live RabbitMQ 4 in both directions: with the topology a message published to no consumer is sitting in `loom.Ord.Lifecycle.consumer`; without it, lost. | [#3029](https://github.com/Loom-Harness/Loc/pull/3029) |
| F-113 | **fixed** — `loom.workflow-param-unused`, with carve-outs for an empty body, an event binding, and the correlation parameter | [#3044](https://github.com/Loom-Harness/Loc/pull/3044) |
| F-114 | **fixed as an ADVISORY, deliberately** — `loom.aggregate-not-constructible` on the advisory channel, not as a warning. The repo had already rejected the general form of this check at 233/496 aggregates; with carve-outs for `abstract`, inheritance bases, `appliers`, and seeded tables it fires on 61/318, which is a suggestion and not a gate. | [#3044](https://github.com/Loom-Harness/Loc/pull/3044) |
| F-115 | **fixed** — the hint set restricted to declared *types* instead of `streamAllContents(root)` | [#3026](https://github.com/Loom-Harness/Loc/pull/3026) |
| F-116 | **fixed** — the stale "until `crudish(requires:)` lands" comment deleted from the `ddd new` scaffold | [#3026](https://github.com/Loom-Harness/Loc/pull/3026) |
| F-117 | **dropped, not fixed — I was wrong to file it.** `examples/sales-ui.ddd`'s unparseability is an existing deliberate decision, pinned in five places and documented in the README example table. Changing it would churn five pinned references to restate a call already made and written down. | [#3026](https://github.com/Loom-Harness/Loc/pull/3026) |

**One finding from the batch is not in this register**, because it was found while
fixing rather than while building: the `docs/new-plan/README.md` mission-counts
region is a committed derivation of every mission heading, so two
mission-touching PRs collide by construction — three times across these five
PRs, and once as a merge-queue `CI_FAILURE` on a batch whose every entry was
green on its own head. Filed as **M-T9.66**.

**What the fix batch confirmed about the register's own headline claim.** Every
S1 here was predicted to be "an emitter condition that doesn't match the
condition at the reference site, in an axis *combination* the corpus doesn't
contain", and the fixes bear that out: F-101's regression fixture is
`channels-broker-workflow`, whose sibling `channels-broker` is the same producer
*without* a workflow — which is precisely why the corpus never caught it.

---

## S1 — the generated tree does not compile, or is silently wrong

### F-101 · SILENT — a context with a workflow but no reactor drops the outbox dispatcher

```ddd
context Ord {
  aggregate Order with crudish { code: string  derived display: string = code }
  repository Orders for Order { }
  event OrderPlaced { order: Order id, at: datetime }
  channel Lifecycle { carries: OrderPlaced  delivery: queue  retention: work }
  workflow place {
    create(code: string) {
      let o = Order.create({ code: code })
      emit OrderPlaced { order: o.id, at: now() }
    }
  }
}
// + storage bus { type: rabbitmq }, channelSource, deployable channels: [lifeBus]
```

```
$ ddd parse            → 0 error(s), 0 warning(s).
$ ddd generate system  → 0 error(s). Wrote 48 file(s)
$ cd out/api && npm i && npx tsc --noEmit
http/index.ts(40,35): error TS2304: Cannot find name 'createOutboxDispatcher'.
index.ts(7,10): error TS2305: Module '"./http/workflows"' has no exported member 'createInProcessDispatcher'.
index.ts(7,37): error TS2305: … 'createOutboxDispatcher'.
index.ts(7,61): error TS2305: … 'startOutboxRelay'.
```

**Root cause.** `src/platform/hono/v4/workflow-builder.ts:126`

```ts
if (ctx.workflows.length === 0) return buildProducerOutboxFile(ctx, usingMikro);
```

The workflow-**less** producer shape emits the outbox machinery whenever the
context has durable events. The with-workflows path emits it only inside the
*subscription* block (`:1318-1323`), which runs per reactor. A context with a
workflow and **no** reactor emits neither — while `index.ts` / `http/index.ts`
import and call all three factories unconditionally (`emit.ts:1794-1800`,
`routes.ts:255`), keyed off "durable events exist", not "a reactor exists".
Emitter condition ≠ reference condition.

**Mutation-proved**: deleting the workflow from the same fixture restores all
three exports.

**Impact.** Any producer-only service on a broker-bound `queue`/`work` channel
— the ordinary "this service publishes, that one consumes" saga — is
uncompilable the moment it also owns one workflow. Hit on the first
`tsc --noEmit` of iteration 2. Workaround: give the context a reactor it does
not need.

---

### F-102 · SILENT — a query-time projection imports value objects from contexts the deployable does not host

20-line repro: two contexts on two deployables, one projection, one value
object in the *other* context.

```
$ ddd generate system → 0 error(s), 0 warning(s). Wrote 72 file(s)
$ cd out/api_a && npx tsc --noEmit
http/query-projections.ts(11,22): error TS2306: File 'domain/value-objects.ts' is not a module.
```

`query-projections.ts` emits `import { Addr } from "../domain/value-objects"`
where `Addr` belongs to context `B`; `api_a` hosts only `A`, so its
`value-objects.ts` is empty. The enum pool is scoped to hosted contexts
correctly — only the **value-object** pool spans the whole system.

Reproduced in the real model too (`import { Money, Coverage, BankAccount, … }`
on a deployable hosting neither `BankAccount`'s context nor its aggregate).

Any multi-deployable system with a projection is affected.

---

### F-103 · SILENT — an operation `requires` gate inlined into an event reactor: four backends, four different wrong answers

25-line repro: an aggregate operation carrying
`requires currentUser.permissions.contains(permissions.close)`, invoked from an
event-triggered workflow (`create(e: Shipped) by e.order { o.finish() }`).
`0 error(s), 0 warning(s)` on all five.

| backend | what it emits in the reactor | result |
|---|---|---|
| **node/Hono** | `if (!((currentUser.permissions).includes("d.close"))) throw …` | **TS2304 — does not compile** |
| **.NET** | `if (!((currentUser.Permissions).Contains("d.close")))` | **does not compile** |
| **java** | `if (!(currentUser.permissions().contains("d.close")))` | **does not compile** |
| **python** | `o.finish()` — the gate is **not emitted at all** (it lives only in the HTTP route) | **compiles; gate silently absent on this path** |
| **elixir** | `finish_order(o, %{})` against `def finish_order(record, params, current_user \\ nil)` → `Enum.member?(nil.permissions, …)` | **compiles; crashes at runtime on every reactor call** |

**Overlap**: PR **#2966** item 1 claims exactly this shape **for Java only**,
and locates it in `src/generator/java/emit/workflow.ts`. The same defect is
live on **node and .NET**, and python/elixir have their own two variants. This
is a cross-backend defect, not a Java one.

**And the model has no correct way to express the intent.** The three options:

| spelling | outcome |
|---|---|
| `operation markPaid() { requires <gate> … }` | the codegen defect above |
| `operation markPaid() { requires true … }` | a public, ungated `POST /claims/{id}/mark_paid` that any authenticated caller can hit |
| `private operation markPaid()` | `loom.workflow-private-operation`: "Workflows can only call public operations" |

There is no "reachable from the saga, not from the wire" operation. I shipped
`requires true` — i.e. the evaluation's own model has an unguarded state
transition because the language offers nothing better.

---

### F-104 · SILENT — `X id` is not type-checked in a `create({…})` argument, so the wrong aggregate's id can be written to a reference column

```ddd
aggregate A with crudish { code: string  derived display: string = code }
aggregate B2 with crudish { code: string  derived display: string = code }
aggregate R with crudish { a: A id  n: int }

workflow wonky2 {
  create(bid: B2 id) { let r = R.create({ a: bid, n: 1 }) }   // 0 error(s)
}
```

A **production workflow** writes a `B2 id` into a field declared `A id`.
`ddd parse` → `0 error(s), 0 warning(s)`.

The type system knows the difference everywhere else — the same confusion in an
**assignment** or a **comparison** is caught precisely:

```
error: Cannot assign 'B2 id' to 'A id'.
error: Operator '==' cannot compare 'A id' with 'B2 id'.
```

The `create` check only asks "is this a text value":

```
error: 'R.create' field 'a' expects a text value ('A id') but got 'int'.
```

so a bare `"not-a-guid"` string passes too. `create` is the one place where the
wrong id becomes a persisted row.

---

### F-105 · SILENT — operation-call arguments in a `test` body are not type-checked at all

```ddd
test "arg type confusion" for R {
  let r = R.create({ a: "s", n: 1 })
  r.retarget(42)               // retarget(x: A id)
  r.bump("not-a-number")       // bump(by: int)
  expect(r.n).toBe(1)
}
```
→ `0 error(s), 0 warning(s)`, then:
```
domain/r.test.ts(9,16): error TS2345: Argument of type 'number' is not assignable to parameter of type 'AId'.
domain/r.test.ts(10,12): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
```

The **same two calls inside a `workflow` body are caught perfectly**:

```
error: Argument 1 of 'bump' expects 'int' but got 'string'.
error: Argument 1 of 'retarget' expects 'A id' but got 'int'.
```

So the check exists and is correct — it just never runs over `test` bodies.
On python/elixir this lands as a silent runtime bug instead of a compile error.
(Sibling of the merged #2958, which did this for `test e2e` payloads; the unit
`test` body's *operation calls* are still open.)

---

### F-106 · SILENT — `money.round(n)` is mis-lowered on the React frontend

| | emitted | verdict |
|---|---|---|
| backend (hono) | `this._price.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)` | correct |
| React page walker | `claimStats.data.exposure.round(0)` | `TS2554: Expected 0 arguments, but got 1` |

Same `decimal.js` runtime on both sides; `Decimal.prototype.round()` takes no
argument. `docs/stdlib.md` documents `round` as `(places?: int): money`.

---

## S2 — blocked, or expensively worked around

### F-107 · money cannot be displayed on a hand-written page — while the scaffold displays it correctly

```ddd
QueryView { of: Ap.Totals, data: s => Group { Stat { "Gross", s.gross } } }   // gross: money
```
→ `0 error(s)`, then `src/pages/home.tsx: error TS2322: Type 'Decimal' is not assignable to type 'ReactNode'`.

The recommended interpolated form fails too:

```ddd
Text { `Gross: {s.gross}` }
→ TS2322: Type 'Decimal' is not assignable to type 'string | number | boolean | Date'
```

**The machinery exists.** The *scaffolded* page for the same field emits
`<MoneyValue value={ row.claimedTotal } />`. Only the hand-written walker path
emits the raw value — which is the customization-gradient promise breaking at
exactly the step it advertises.

Cross-frontend, same model:

| frontend | emitted | verdict |
|---|---|---|
| React | `{totals.data.gross}` | **TS2322 — build fails** |
| Vue | `{{ totals.data.gross }}` | compiles; raw `Decimal`, no `MoneyValue`, no currency |
| Svelte | `{totals.data.gross}` | compiles; unformatted |
| Angular | `{{ … }}` | compiles; unformatted |
| Flutter | `final String gross` | correct (money is a string on the wire) |
| React **scaffold** | `<MoneyValue value={…} />` | correct |

**Overlap**: PR **#2871** D4 adds `loom.money-in-text-slot`, covering thirteen
slots including `Stat` ("wrap in place"). Two things that PR should check
against this repro: its row-type resolution is described as reading
`wireFieldsForAggregate` off a `QueryView`'s `of:` — **my `of:` is a
projection**, not an aggregate, so a projection-typed money field may still slip
through; and it turns the break into a refusal, which leaves the four
non-React frontends still rendering money unformatted rather than through
`MoneyValue`.

---

### F-108 · HONEST-but-misdirecting — splitting a context onto its own deployable produces 18 generated-page errors that never name the cause

Iteration 2's evolution step: move `context Claims` onto its own `claimsApi`.

```
$ ddd parse             → 0 error(s), 0 warning(s).
$ ddd generate system   → exit 2
loom.method-call-unresolved-receiver portal/src/pages/claims/detail.tsx:18: method-call Claim.byId(id): receiver did not resolve
  …16 more…
loom.page-ref-unreachable portal/src/pages/claims/detail.tsx:64 warning: Form(data.startReview): 'data' is not an in-scope aggregate instance
18 error(s), 3 warning(s) in generated pages.
```

The cause is one line of wiring — `ui Portal` is mounted on
`deployable portal { targets: api }` and `api` no longer hosts `Claims`.
Nothing in the 18 messages mentions `targets:`, the ui, the deployable or the
context; they point at line numbers in files the user never wrote and which
were never written to disk (the generate aborted).

**And there is no fix to apply.** `targets:` is a *single* deployable reference
(`ddd.langium:304` — `targets=[Deployable:LooseName]`), so `targets: [api,
claimsApi]` is a parse error. A UI over a subdomain whose contexts live on two
backends **cannot be expressed**. `docs/architecture.md:287` comments the
clause "the backend(s) this frontend talks to" — plural in prose, singular in
grammar.

Expected: one phase-⑦ diagnostic naming the ui, the deployable and the
unhosted context — the same shape as the good `loom.ui-id-ref-no-display` and
`loom.deployable-channel-unrelated` messages already in the language.

---

### F-109 · the `migration` rename/backfill surface rejects 81 legal field names, including `description`

```ddd
aggregate Claim { description: string … }      // parses fine

migration "rename-claim-description" { Claim.description -> summary }
→ error: 'description' is a Loom keyword, so it cannot be used as a name here.
  Rename it — 'descriptionRef' or a domain-specific synonym.
```

`Property` (`ddd.langium:1814`) accepts `ID | CommonSoftKeywords | 'await' |
'ignoring' | 'page'`; the migration `ColumnStep` (`:104`) accepts
`UserFieldName = ID | 'id' | 'permissions' | 'migration'`. Measured: **78 of the
79 `CommonSoftKeywords`** are legal property names and illegal in a migration
step — `description, key, kind, message, parent, query, body, action, schema,
config, error, option, response, title, state, sort, group, …` — plus `await`,
`ignoring`, `page`.

So a field with one of those names can be declared but can **never** be renamed
or backfilled through the supported surface. The only escapes are
`--allow-destructive` (data loss) or a raw `sql "…"` step. The error's advice
("Rename it") is the operation being blocked.

`message` additionally gets a *different*, worse error:
`Unexpected 'message'. Expected one of: 'id', 'p…`.

The grammar comment shows the author considered exactly one keyword:
> `migration` is hard only at the top-level `Migration` block head; soft in
> field-name position so a domain field named `migration` parses.

---

### F-110 · there is no `date` (or `time`) scalar

`policy.startsOn`, `policy.endsOn`, `claim.incidentOn`, a due date, a date of
birth. The type list is `bool, datetime, decimal, File, guid, int, json, long,
money, string`.

The diagnostic is excellent (it prints the whole list), so this is HONEST — but
the only workaround is `datetime`, which re-introduces the timezone class of
bug the type exists to prevent (a policy that ends `2026-01-01T00:00:00Z` ends
on Dec 31 for half the world). `docs/language.md` never mentions `date`, not
even as unsupported. The i18n layer already has the concept: `{at, date}` is a
shipped interpolation format spec.

---

### F-111 · `string(x)` documents "any primitive" and rejects four of nine; the interpolation advice is circular

```
$ derived d: string = string(ref)          // ref: guid
error: Cannot convert 'guid' to 'string': not supported.  Today's conversion
vocabulary admits: string ← any primitive | enum | X id; …
```

The message states the rule and violates it in the same breath. One probe per
primitive:

| | guid | datetime | json | File | bool | int | long | decimal | money |
|---|---|---|---|---|---|---|---|---|---|
| `string(v)` | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |

Same hole via interpolation — `` `G-{ref}` `` is rejected by
`loom.interp-hole-type`, whose advice is *"Convert it first (e.g. wrap in a
'derived' that formats it)"*: **circular**, because that conversion is the one
that does not exist. An `X id` interpolates fine and an `X id` *is* a guid, so
the rule is internally inconsistent too.

Concrete block: `aggregate Payout { claimRef: guid … }` cannot produce the
`derived display: string` the UI layer *requires* of a referenced aggregate
(`loom.ui-id-ref-no-display`).

---

## S3 — friction

### F-112 · SILENT — a `retention: work` event published before its consumer's first boot is dropped

Live, against the booted stack. `broker-init/bus-definitions.json` declares
**vhost, users and permissions only** — no queues, exchanges or bindings. Each
consuming deployable declares its own queue at boot.

With `payoutsApi` not yet started, `api` published `ClaimApproved` (outbox row
`dispatched = t`) and:

```
$ rabbitmqctl list_bindings -p loom
loom.Claims.ClaimEvents   loom.Claims.ClaimEvents.api      ← only the producer's own group
loom.dlx                  loom.dlq.loom.Claims.ClaimEvents
$ rabbitmqctl list_queues -p loom
loom.Claims.ClaimEvents.api            0
loom.dlq.loom.Claims.ClaimEvents       0
```

No `.payoutsApi` queue exists, the event is in no queue and no DLQ. The whole
point of `retention: work` is at-least-once delivery; here the saga's trigger
event is lost to deploy ordering. The generator already emits a definitions
file and already knows every (channel × consuming deployable) pair, so
pre-declaring the queues and bindings there is nearly free.

### F-113 · SILENT — unused `workflow create` parameters become required request fields and are discarded

```ddd
workflow make { create(code: string, ignoredNote: string, ignoredQty: int) { let t = T.create({ code: code }) } }
```
→ `0 error(s)`, and the generated contract:
```ts
ignoredNote: z.string(),                                   // REQUIRED on the wire
ignoredQty: z.number().int().min(-2147483648)…,            // REQUIRED on the wire
const ignoredNote = body.ignoredNote;                      // never read
```

I hit this for real: `submitClaim(… firstLine: string, firstAmount: Money)`
returned `204` and the claim came back with `lines: []`. The API contract
obliges a client to send data the system throws away, with no warning.

### F-114 · SILENT — an aggregate no code path can create validates clean

`aggregate Policy` has no `create`, no `with crudish`, and no workflow factory.
`0 error(s)`; `POST /api/policies` → `405 Method Not Allowed`; the table can
never hold a row. The scaffold correctly omits the "new" page, so the
information is present in the compiler — it is just never surfaced as a
warning.

### F-115 · SILENT — "Did you mean …?" for an unknown type suggests operation names and page-state variables

```
aggregate A with crudish { occurredOn: date }
→ Unknown type 'date'. Did you mean 'update'?     // the crudish operation

… + a `ui … with scaffold(…)`
→ Unknown type 'date'. Did you mean 'data'?       // a synthesised page state var
```

`src/language/ddd-linker.ts:70-84` builds the candidate set from
`streamAllContents(root)` — every named node in the **macro-expanded** document
— instead of the declared types. The suggestion is confidently wrong and tells
the user to write `occurredOn: update`.

### F-116 · stale — `ddd new`'s own scaffold says `crudish(requires:)` "hasn't landed"; it has

`src/cli/new-templates.ts:271-273`, emitted verbatim into every new project's
`main.ddd`:

> `with crudish` generates its create/update/destroy, which likewise cannot
> carry a gate today: hand-write those three on any aggregate you want gated
> **until `crudish(requires: <Policy>)` lands**.

It shipped (`src/macros/stdlib/crudish.macro.ts:85`), and the
`loom.default-deny-ungated` diagnostic itself recommends it. A reader who
trusts the file they were handed hand-writes three members per gated aggregate
for nothing.

---

## S4

### F-117 · `examples/sales-ui.ddd` does not parse, and its `Table { …, columns: […] }` is the shape the compiler now rejects

```
$ ddd parse examples/sales-ui.ddd
examples/sales-ui.ddd:133:26 error: Expecting token of type ')' but found ':'.
```
It is the only non-parsing file in `examples/` and it says so in its own header
— but it is also the only file in `examples/` that shows hand-written pages, so
it is what a reader browsing for page syntax finds. I copied
`Table { rows, columns: [...] }` straight out of it. (The diagnostic that
caught me, `loom.page-primitive-unknown-arg`, is one of the best in the
language — it lists every accepted argument and explains why an unknown one is
dangerous.)

---

## Notes on the environment (not Loom defects)

- Containers in this sandbox have **no outbound network**, so `docker compose
  up --build` cannot finish: every generated Dockerfile runs `npm install` /
  `mix deps.get` / `gradle` at image-build time. I booted the stack natively
  instead (postgres + rabbitmq + keycloak in containers, the node backend on
  the host) and got full runtime coverage that way.
- Generated node projects ship **no lockfile** (the Dockerfile comments on it:
  "the generator emits no package-lock.json so npm ci exits with EUSAGE"), so
  image builds are neither reproducible nor offline-capable.
- The generated Java project requires **JDK 25**; only 21 is installed here, so
  `payouts_api` was verified by reading the emitted source, not by compiling.

## Repro index (verbatim)

*`eval-claims/repro/README.md` on the branch.*

### Minimal repros

Each file is a self-contained `.ddd`. Unless noted, all report
`0 error(s), 0 warning(s)` from `node bin/cli.js parse`.

| file | finding | how to see it |
|---|---|---|
| `F-101-outbox-workflow-no-reactor.ddd` | F-101 | `generate system`, then `cd out/api && npm i && npx tsc --noEmit` → 4 × TS2304/TS2305 |
| `F-101-control-workflow-less.ddd` | F-101 control | same model minus the workflow — all three factories are emitted |
| `F-102-projection-cross-context-vo.ddd` | F-102 | `cd out/api_a && npx tsc --noEmit` → TS2306 "not a module" |
| `F-103-reactor-unbound-currentuser.ddd` | F-103 | generate for each of `node/java/dotnet/python/elixir` and grep the reactor for `currentUser` |
| `F-104-create-arg-id-confusion.ddd` | F-104 | parse alone: a `B2 id` is accepted for a field declared `A id` |
| `F-105-test-body-untyped-args.ddd` | F-105 | `cd out/api && npx tsc --noEmit` → 2 × TS2345 |
| `F-105-control-workflow-body-typed.ddd` | F-105 control | the same two calls in a workflow body — **2 parse errors**, correctly |
| `F-106-F-107-money-in-page-slot.ddd` | F-106, F-107 | `cd out/web && npm i && npx tsc --noEmit` → TS2322 (and TS2554 with `.round(0)`) |
| `F-113-unused-workflow-params.ddd` | F-113 | grep `out/api/http/workflows.ts` for `ignoredNote` — required on the wire, never read |

One-liner probes (no fixture file needed):

```bash
# F-109 — 78 of 79 soft keywords are legal field names and illegal in a migration step
printf 'context C { aggregate A with crudish { description: string  derived display: string = description } repository As for A { } }\nmigration "r" { A.description -> summary }\n' > /tmp/m.ddd
node bin/cli.js parse /tmp/m.ddd

# F-110 / F-115 — no `date` type, and the hint suggests a crudish operation
printf 'context C { aggregate A with crudish { occurredOn: date  n: string } repository As for A { } }\n' > /tmp/d.ddd
node bin/cli.js parse /tmp/d.ddd     # → Did you mean 'update'?

# F-111 — `string ← any primitive` is false for guid / datetime / json / File
for t in guid datetime json File bool int; do
  printf 'context C { aggregate A with crudish { v: %s\n derived d: string = string(v) } repository As for A { } }\n' "$t" > /tmp/p.ddd
  printf '%-9s ' "$t"; node bin/cli.js parse /tmp/p.ddd 2>&1 | head -1
done
```

## Repro sources

*Every `.ddd` repro the register cites, copied from the branch. They are kept here as text so the repo-wide `.ddd` census does not treat deliberately-broken models as fixtures; copy one to a `.ddd` file to run it.*

### `eval-claims/repro/F-101-control-workflow-less.ddd`

```ddd
system S {
  subdomain D {
    context Ord {
      aggregate Order with crudish { code: string  derived display: string = code }
      repository Orders for Order { }
      event OrderPlaced { order: Shipment id, at: datetime }
      channel Lifecycle { carries: OrderPlaced  delivery: queue  retention: work }
      aggregate Shipment with crudish { code2: string
        operation go() { emit OrderPlaced { order: id, at: now() } }
      }
      repository Shipments for Shipment { }
    }
  }
  storage primary { type: postgres }
  storage bus { type: rabbitmq }
  channelSource lifeBus { for: Lifecycle, use: bus }
  resource ordState { for: Ord, kind: state, use: primary }
  deployable api { platform: node, contexts: [Ord], dataSources: [ordState], port: 3000, channels: [lifeBus] }
}
```

### `eval-claims/repro/F-101-outbox-workflow-no-reactor.ddd`

```ddd
system S {
  subdomain D {
    context Ord {
      aggregate Order with crudish { code: string  derived display: string = code }
      repository Orders for Order { }
      event OrderPlaced { order: Order id, at: datetime }
      channel Lifecycle { carries: OrderPlaced  delivery: queue  retention: work }
      workflow place {
        create(code: string) {
          let o = Order.create({ code: code })
          emit OrderPlaced { order: o.id, at: now() }
        }
      }
    }
  }
  storage primary { type: postgres }
  storage bus { type: rabbitmq }
  channelSource lifeBus { for: Lifecycle, use: bus }
  resource ordState { for: Ord, kind: state, use: primary }
  deployable api { platform: node, contexts: [Ord], dataSources: [ordState], port: 3000, channels: [lifeBus] }
}
```

### `eval-claims/repro/F-102-projection-cross-context-vo.ddd`

```ddd
system S {
  subdomain D {
    context A {
      aggregate Thing with crudish { code: string  n: int  derived display: string = code }
      repository Things for Thing { }
      criterion AllThings() of Thing = n > 0
      projection ThingStats { total: int  from Thing as t  where AllThings  select total = count }
    }
    context B {
      valueobject Addr { street: string }
      aggregate Place with crudish { where2: Addr  label: string  derived display: string = label }
      repository Places for Place { }
    }
  }
  storage primary { type: postgres }
  resource aState { for: A, kind: state, use: primary }
  resource bState { for: B, kind: state, use: primary }
  deployable apiA { platform: node, contexts: [A], dataSources: [aState], port: 3000 }
  deployable apiB { platform: node, contexts: [B], dataSources: [bState], port: 3001 }
}
```

### `eval-claims/repro/F-103-reactor-unbound-currentuser.ddd`

```ddd
system S {
  user { id: guid  permissions: string[] }
  subdomain D {
    permissions { close }
    context Ord {
      aggregate Order with crudish { code: string  done: bool  derived display: string = code
        operation finish() {
          requires currentUser.permissions.contains(permissions.close)
          done := true
        }
      }
      repository Orders for Order { }
      event Shipped { order: Order id, at: datetime }
      aggregate Box with crudish { label: string  derived display: string = label
        operation ship(o: Order id) { emit Shipped { order: o, at: now() } }
      }
      repository Boxes for Box { }
      workflow closeOrder {
        orderRef: Order id
        create(e: Shipped) by e.order {
          let o = Orders.getById(e.order)
          o.finish()
        }
      }
    }
  }
  storage primary { type: postgres }
  resource st { for: Ord, kind: state, use: primary }
  deployable api { platform: node, contexts: [Ord], dataSources: [st], port: 3000, auth: required }
}
```

### `eval-claims/repro/F-104-create-arg-id-confusion.ddd`

```ddd
system S {
 subdomain D {
  context C {
    aggregate A with crudish { code: string  derived display: string = code }
    aggregate B2 with crudish { code: string  derived display: string = code }
    aggregate R with crudish { a: A id  n: int
      operation retarget(x: A id) { a := x }
      operation bump(by: int) { n := n + by }
    }
    repository As for A { } repository B2s for B2 { } repository Rs for R { }
    workflow wonky2 {
      create(bid: B2 id) {
        let r = R.create({ a: bid, n: 1 })
      }
    }
  }
 }
 storage primary { type: postgres }
 resource st { for: C, kind: state, use: primary }
 deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000 }
}
```

### `eval-claims/repro/F-105-control-workflow-body-typed.ddd`

```ddd
system S {
 subdomain D {
  context C {
    aggregate A with crudish { code: string  derived display: string = code }
    aggregate R with crudish { a: A id  n: int
      operation retarget(x: A id) { a := x }
      operation bump(by: int) { n := n + by }
    }
    repository As for A { } repository Rs for R { }
    workflow wonky {
      create(id: R id) {
        let r = Rs.getById(id)
        r.bump("not-a-number")
        r.retarget(42)
      }
    }
  }
 }
 storage primary { type: postgres }
 resource st { for: C, kind: state, use: primary }
 deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000 }
}
```

### `eval-claims/repro/F-105-test-body-untyped-args.ddd`

```ddd
system S {
 subdomain D {
  context C {
    aggregate A with crudish { code: string  derived display: string = code }
    aggregate R with crudish { a: A id  n: int
      operation retarget(x: A id) { a := x }
      operation bump(by: int) { n := n + by }
    }
    repository As for A { } repository Rs for R { }
    test "arg type confusion" for R {
      let r = R.create({ a: "s", n: 1 })
      r.retarget(42)
      r.bump("not-a-number")
      expect(r.n).toBe(1)
    }
  }
 }
 storage primary { type: postgres }
 resource st { for: C, kind: state, use: primary }
 deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000 }
}
```

### `eval-claims/repro/F-106-F-107-money-in-page-slot.ddd`

```ddd
system S {
  subdomain D {
    context A {
      aggregate Thing with crudish { code: string  price: money  derived display: string = code }
      repository Things for Thing { }
      criterion AllThings() of Thing = price > money("0")
      projection Totals { n: int  gross: money  from Thing as t  where AllThings  select n = count, gross = sum(t.price) }
    }
  }
  api DApi from D
  ui U {
    api Ap: DApi
    page Home {
      route: "/"
      body: QueryView { of: Ap.Totals, loading: Loader { }, error: Alert { "e" }, empty: Text { "none" },
        data: s => Group { Stat { "Count", s.n }, Stat { "Gross", s.gross } } }
    }
  }
  storage primary { type: postgres }
  resource aState { for: A, kind: state, use: primary }
  deployable api { platform: node, contexts: [A], dataSources: [aState], port: 3000, serves: DApi }
  deployable web { platform: react, targets: api, ui: U { Ap: api }, port: 3001, design: mantine }
}
```

### `eval-claims/repro/F-113-unused-workflow-params.ddd`

```ddd
system S {
 subdomain D { context C {
   aggregate T with crudish { code: string  derived display: string = code }
   repository Ts for T { }
   workflow make { create(code: string, ignoredNote: string, ignoredQty: int) { let t = T.create({ code: code }) } }
 } }
 storage primary { type: postgres }
 resource st { for: C, kind: state, use: primary }
 deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000 }
}
```

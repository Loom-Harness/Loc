# NorthBank evaluation — findings log

Persona: a backend developer building a small retail-banking system with Loom,
evolving it over three iterations driven by simulated user feedback.
Severity: **S1** wrong/unsafe behaviour or broken build from a valid model ·
**S2** blocks a realistic workflow / needs a hand hack · **S3** DX friction.

Base: `origin/main` @ bce7f409 (2026-10-04).

## Iteration 1 (v1/bank.ddd — customers, accounts, deposit/withdraw/transfer)

| # | Sev | Finding | Evidence |
|---|---|---|---|
| B-01 | S1 | **`expect(<money>).toBe(<money>)` always fails on node.** Unit-test matchers are type-blind: `expect(a.balance).toBe(money("15"))` renders `expect(Decimal).toBe(new Decimal("15"))` (reference equality). Same for `toBeGreaterThan` on money (vitest needs number/bigint). | `src/generator/typescript/emit/tests.ts:302` `renderExplicitMatcher`; run `v1/out/api && npx vitest run` → `expected 15 to be 15 // Object.is equality` |
| B-02 | S2 | **Workflow `precondition … message "…"` drops the message.** Lowering ignores `stmt.message` though the IR type has the slot; HTTP 422 detail becomes `Precondition failed: fromAccount != toAccount` (leaks source, loses the user text). | `src/ir/lower/lower-workflow.ts:543`; runtime: self-transfer → 422 with generic detail |
| B-03 | S2 | **Workflows return 204 with no body** — `openAccount` creates an Account but the caller never learns its id (had to list + guess). Elixir's return-shape derivation (`computeWorkflowReturnType`) exists but node returns 204. | `v1/out/api/http/workflows.ts` |
| B-04 | **S1** | **Phantom events from rolled-back transactions (node).** In a `transactional` workflow, `repo.save(tx)` opens a nested savepoint and dispatches the aggregate's events as soon as *that save* returns. If a later step fails, the workflow rolls back, but the events have already been delivered. **Proven:** `repro/B04-events-before-commit.ddd` — 1×204 + 2×409 (duplicate `reference`) → balance shows **one** debit, while the `Debited` consumer committed **three** Audit rows. `docs/workflow.md` says drainage happens inside the transaction. For a bank this means notifications for transfers that never happened. | `api/db/repositories/*-repository.ts save()`; repro |
| B-05 | S2 | **Money scale silently truncated.** `deposit {"amount":"0.00001"}` → 204, balance unchanged (NUMERIC(19,4) rounds). No wire validation of scale for money. | runtime |
| B-06 | S3 | `from` / `to` are reserved — the two most natural names for a transfer. Error is clear, but a banking DSL user hits it on minute 1. | parse |
| B-07 | S3 | Leaked Chevrotain internal warning `Ambiguous Alternatives Detected … PostfixSuffix` printed to the console whenever `loom.throw-kind-custom-message` fires. | `eval-banking/repro/ambiguous-warning.ddd` |
| B-08 | S3 | `toThrow(precondition)` is unusable whenever the precondition has a `message` (`loom.throw-kind-custom-message`) — a backend implementation detail (message-prefix matching) restricts a language feature. Users must pick between good error messages and precise tests. | parse |
| B-09 | S3 | Aggregate literal `Account { … }` in a test → raw `Expecting token '}' but found 'id'`; and there is no documented id literal for tests (`owner: "c1"` works only inside `Agg.create({…})`). | parse |
| B-10 | S3 | A single-result `find byNumber(…): Account?` on a non-unique column is accepted silently; duplicates were created and the find returned an arbitrary row. A suggestion "single-result find over a non-`unique` key" would have caught it. | runtime |
| B-11 | S3 | Scaffolded UI: FK shows a truncated uuid (`01a107a4…`) instead of the target's `display`; money renders as `55.1` (no scale/currency); `Version` column is exposed; every operation button is shown regardless of state (Unfreeze on an Active account). | `evidence/v1/*.png` |
| B-12 | S3 | No retry story on optimistic-concurrency conflicts: 20 parallel transfers → 3×204, 17×409. Correct and money-conserving, but no `retry` knob on workflows. | runtime |

## Iteration 2 (v2/bank.ddd — auth, roles, ledger, limits, approvals)

| # | Sev | Finding | Evidence |
|---|---|---|---|
| B-13 | **S1** | **`datetime == datetime` is reference equality on node** → always false. `function sameDay(a,b) = a.startOfDay() == b.startOfDay()` renders `new Date(…) === new Date(…)`. The daily withdrawal limit was **never enforced** (10 + 995 + 990 withdrawn on one day against a 1000 limit). Java uses `Objects.equals`; TS has no datetime arm for `==`/`!=`. | `src/generator/typescript/render-expr.ts:599`; runtime |
| B-14 | **S1** | **Explicit `find all(): T[] requires …` breaks the generated React build.** The list route becomes a bare array, but scaffolded workflow forms' id-pickers still read `.items` → `TS2339 Property 'items' does not exist`. Valid model, `ddd parse` clean, `docker compose build` fails. Default-deny practically *requires* gating `find all`, so every authed scaffolded app hits this. | `project/web/src/pages/workflows/*.tsx:48` |
| B-15 | **S1 (security)** | **By-id read is ungateable** (known: `loom.default-deny-by-id-ungated`, M-T3.19) — confirmed at runtime: customer *mallory* reads Alice's account, balance and full ledger via `GET /api/accounts/{id}`. For banking this is a release blocker; there is also no owner-scoped (non-tenant) row-level read policy (`policy { allow … }` is tenancy-only). | runtime |
| B-16 | S2 | **`create` body `precondition` is not emitted on state-based aggregates** (`loom.lifecycle-body-dropped`). Constructor validation must move to invariants. The grammar accepts it; only an error saves you. | parse |
| B-17 | S2 | **Named `create register(…)` reaches no backend** (`loom.named-lifecycle-dropped`). Why does the grammar accept it? | parse |
| B-18 | S2 | **No `if` in workflow bodies** (`loom.workflow-unrecognised-statement`, message omits the `if let`/`for` forms it does allow). "Execute now if ≤ 10 000, else park for approval" had to be split into two workflows with mirrored preconditions. | parse |
| B-19 | S2 | **Named policy functions don't survive into scaffolded page gates.** Using `requires IsStaff()` on a `find` makes the scaffold copy it onto the page gate, which must be client-evaluable → hard error ×3 (and two different codes for the same root cause). Policy functions are documented as *inlined* — the UI gate path just doesn't inline them. | parse |
| B-20 | S2 | **Raw `sql` migration steps run after the structural DDL**, so a dedupe cannot precede a new `unique (number)` index. v1 data had a duplicate → migration 2 failed at boot (rolled back cleanly, good), and the `sql` fix landed in migration **3**, behind the failing one. Only exit: hand-edit the DB. Also no "adding unique on a populated table" warning. | runtime, `project/api/db/migrations/` |
| B-21 | S2 | **Generated Keycloak persona is unusable for an id-typed claim**: realm seeds `customerId: "demo-customer-id"` (not a uuid) → `GET /accounts/mine` 500s. The `demo` user also carries no `permissions`, so no permission-gated route can be exercised. Users created via the admin API lose custom attributes (KC 26 unmanaged-attribute policy not enabled in the generated realm). | runtime |
| B-22 | S3 | 403 `detail` leaks the gate source (`Forbidden: IsStaff() \|\| OwnsAccount(owner)`) to the caller. | runtime |
| B-23 | S3 | `migration "…" { }` is top-level only; inside the system it's a bare `Expecting '}' but found migration`. Same for `find … where … requires …` (order must be `requires` then `where`). Parse errors don't name the expected position. | parse |
| B-24 | S3 | Scaffold-once `README.md` goes stale on evolution (doesn't mention the keycloak service / auth added in v2). | `project/README.md` |
| B-25 | S3 | No `date` type — business dates (limit day, value date, statement period) are `datetime` + `startOfDay()`. | — |

## Iteration 3 (v3/bank.ddd — rename, currency, notify service over redis, monthly interest timer)

What worked well: the rename+backfill migration (`kind -> accountType`, `currency = "EUR"`, `interestRate = accountType == Savings ? 0.02 : 0.0` → `CASE WHEN`, enum check re-added `NOT VALID`); node → redis → **python** eventing worked on the first boot; the pg-boss cron scheduler fired and accrued correct interest (15057 × 0.02/12 = 25.095).

| # | Sev | Finding | Evidence |
|---|---|---|---|
| B-26 | S2 | **Adding a deployable to a running system can't boot.** `db-init/` (`CREATE DATABASE notify`) only runs on a fresh pg volume, so the new `notify` service crash-loops with `database "notify" does not exist`. Nothing in generate output says so. | runtime |
| B-27 | S2 | **A stateless cron job needs a saga.** `on(e: MonthEnd)` alone → `workflow-correlation-required` + `reactor-without-starter`. I had to invent a do-nothing `InterestRun` aggregate so the tick event could carry an id (the `timers.ddd` pattern). A `create(e: MonthEnd)` without `by` silently becomes a **client-reachable HTTP command** (then `default-deny-ungated` fires), which is surprising. | parse |
| B-28 | S2 (risk) | **Timer batch isn't idempotent under retry.** The interest workflow saves account-by-account (non-transactional), and pg-boss is configured `retryLimit: 3`; each retry gets a *fresh* `run` id, so a failure mid-batch re-accrues interest on accounts already processed. Needs a per-boundary key or a transactional batch. (code reading) | `api/scheduler.ts`, `http/workflows.ts monthlyInterestStartMonthEnd` |
| B-29 | S3 | No operator hook to fire a timer (backfill a missed month, test in staging); had to call `pgboss.send("timer_monthEnd")` from inside the container. | runtime |
| B-30 | S3 | After v2 the `web` image failed to build (B-14), and `docker compose up` silently kept serving the **v1** web container against the v3 API. | runtime |
| B-31 | S3 | Without `derived display` on an aggregate, the generated form puts a **compiler hint into the end-user placeholder**: `<id> — Aggregate 'Acct' has no 'derived display' — declare …`. | `repro/B14…` first attempt |
| B-32 | S3 | `find mine(): T[] … where … currentUser…` (the idiom `docs/auth.md` teaches for row-level visibility) is flagged `wire-shaped list query … deprecated`, and the suggested `retrieval` replacement has no HTTP route (M-T5.31). It only started warning in v3, not v2, for the same declaration. | parse |

## Cross-backend check (repro/B13-datetime-eq.ddd)

| | node | python | java | .NET |
|---|---|---|---|---|
| `datetime == datetime` | `Date === Date` ✗ | `==` ✓ | `Objects.equals` ✓ | `a.Date == b.Date` ✓ |
| `expect(money).toBe(money)` | `toBe(new Decimal)` ✗ | `== Decimal` ✓ | `compareTo == 0` ✓ | — |

Both are **node-only divergences** that the conformance/behavioural tiers did not catch.

## Overlap with in-flight work (checked 2026-10-04 against open PRs + `docs/new-plan/`)

| Finding | Already claimed / tracked |
|---|---|
| B-14 declared `find all` breaks picker | **open PR #2942** (fixes all 6 frontends; unmerged) |
| B-15 by-id read ungated | **draft #3109** (L1-SEC, M-T3.19) |
| B-11 ref shows uuid / version column / op buttons ignore state | drafts **#3113**, **#3119**, **#3112** (and #3117 for HEEx) |
| B-22 403 echoes gate source | draft **#3104** (dev-stub only) |
| B-23 misplaced-declaration parse errors | draft **#3115** (Fleet F) — check it covers top-level `migration` and `requires`/`where` order |
| B-16/B-17 create body / named create | tracked **M-T3.16** (refused today, rendering unowned) |
| B-25 no `date` type | tracked **M-T5.39** |
| B-32 retrieval has no route | tracked **M-T5.31** |
| VO `==` on node (sibling of B-13) | draft **#3124** — value objects only, **not datetime** |
| **B-01, B-02, B-03, B-04, B-05, B-07, B-08, B-10, B-12, B-13, B-18, B-19, B-20, B-21, B-26, B-27, B-28, B-29** | **no claim found** |

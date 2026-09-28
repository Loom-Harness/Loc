# Testability audit — 2026-09-13

*An empirical audit of Loom's **generated** test surface, run from the outside: build a
real app that exercises a broad slice of the language, generate it on all five backends
plus a React frontend, then **boot it and run every emitted suite** — unit, api-e2e,
context-integration and ui-e2e — against a real Postgres and a real browser. Every claim
below was produced by running the toolchain on `main` @ `619708fd`, not by reading code.
Sources and outputs are reproducible from the `.ddd` listings inline.*

> **Re-verified 2026-09-14 against `main @ 9e03c0ff`** (233 commits later). **Ten of twelve
> findings stand unchanged.** F8 is half fixed — `ddd verify` now exits 1 and diagnoses the
> mismatch instead of reporting a silent pass, but the join still cannot match what any
> runner reports. F4 narrowed — a new `loom.e2e-unrouted-verb` gate checks the verb; the
> payload is still unchecked. F1's root cause is now pinned exactly (the binding types as
> `string`), and F11's catalogue is 10 entries, not 9. The re-verification table, the
> per-packet file ownership and the four gating decisions are in
> [`2026-09-14-testability-fleet-plan.md`](2026-09-14-testability-fleet-plan.md).

Scope note: this audits the **test tier a user gets in their generated project** (the
`test` / `test e2e` DSL and what it emits), not Loom's own ~14k-test internal suite. The
internal suite's own coverage plan is [`docs/new-plan/testing-quality-improvement-plan.md`](../new-plan/testing-quality-improvement-plan.md).

---

## Verdict

**The generated test tier is real, and it is not hollow.** All three tiers execute out of
the box and all three were **mutation-proved** to go red when the thing they claim to
cover is broken. That is further than most codegen toolchains get, and the cross-backend
story (one `test e2e` file, byte-identical on five backends) is genuinely delivered.

**It is not production-ready as a standalone quality gate**, for four structural reasons,
none of which is a small fix:

1. **The emitted e2e suite has no isolation** — it is green on a fresh database and red on
   the second run of the same one. Nothing in the DSL or the harness resets state, and the
   documented run recipe doesn't mention it.
2. **The e2e body is unchecked against the model it drives.** The compiler validates the
   aggregate and the method name, then stops: request-body field names, field types,
   missing required fields and response-field reads are all unvalidated, though the
   compiler holds the wire shape that would decide them.
3. **Whole feature areas are untestable from the DSL**: workflows (no accessor),
   authorization/tenancy denial paths (no principal vocabulary), emitted events (no
   matcher), and negative paths in UI tests (structurally can't work).
4. **`verifies` on a `test e2e` block is inert** — the requirement→test join fails on every
   e2e test in the repo, including the checked-in examples, and the repo's own per-PR DoD
   rollup under-reports because of it.

Plus two **new product bugs** the audit surfaced (F1, F2), both of which make a
`ddd parse`-clean model emit a backend that does not compile.

---

## Method

A ~300-line app (`FieldOps`) exercising: value objects with invariants, enums, `crudish`,
containment + entity parts, derived properties, `function`, operations with preconditions,
guarded + collection invariants, domain events, a channel, a folded `projection`, filtered
and paged repository finds, two domain services (pure + reading), a transactional
`workflow`, a scaffolded UI with a hand-written page, traceability
(`requirement`/`testCase`/`verifies`), and all three test tiers.

What was actually executed:

| Leg | Result |
|---|---|
| `ddd generate system` × {node, python, java, dotnet, elixir} | 107 files each, 0 errors |
| Generated Hono backend: `npm install`, boot, migrate against Postgres 18 | ✅ clean boot, migrations applied |
| Emitted **unit** suite (node, `vitest run`) | ✅ 6/6 |
| Emitted **unit** suite (python, `uv run pytest`) | ✅ 6/6 |
| Emitted **api-e2e** suite against the booted backend | ✅ 4/4 **on a fresh DB**; ❌ 1/4 red on re-run (F3) |
| Emitted **context-integration** rung (real DB, migrations, repositories) | ✅ 1/1 |
| Generated React frontend: `tsc --noEmit && vite build` | ✅ clean |
| Emitted **ui-e2e** + smoke specs (Playwright, headless Chromium) | ✅ 9/9 |
| `ddd verify` rollup | ⚠️ reports 100% verified with 2 red e2e tests (F8) |
| `npx tsc --noEmit` on the generated backend | ❌ 3 errors (F1, F2) |
| `uv run mypy` on the generated backend | ❌ 6 errors (F1, F2) |
| Mutation proofs (domain guard / projection fold / rendered field) | ✅ all three tiers go red |
| `docker compose up -d --build` of the generated stack | ⛔ **not completed** — `npm install` inside the image fails `SELF_SIGNED_CERT_IN_CHAIN` against the sandbox's agent proxy. A documented environment limitation (`/root/.ccr/README.md` § "docker build"), not a Loom defect; the fix would require editing the generated Dockerfile, i.e. no longer testing the shipped artifact. The backend and frontend were booted natively instead. |

---

## What genuinely works

- **Faithful translation.** The emitted unit tests are idiomatic per backend and carry the
  author's intent — vitest on TS, pytest on Python, ExUnit on Elixir (`assert_raise
  Api.GuardError`), xUnit on .NET, JUnit on Java — from one source, on all five.
- **One e2e suite, five backends.** `e2e/FieldOps.e2e.test.ts` is **byte-identical** across
  the node/python/java/dotnet/elixir generations. The "drop-in backend" claim holds at the
  test-source level.
- **The generated page objects are good.** Playwright objects handle Mantine `<Select>`
  listboxes, checkbox state, testid-scoped waits, and a `field()` accessor per wire field.
  The emitted `ui.spec.ts` drove a real create→detail round-trip first try.
- **Non-hollowness, proved.** Three mutations, three reds:
  - removed the `isEditable()` precondition from the generated aggregate → unit suite red;
  - dropped one arm of the projection fold dispatcher → api-e2e red on the exact assertion;
  - replaced the detail page's rendered field with a constant → ui-e2e red.
- **The validator carries its weight.** Along the way it caught a member-receiver
  repository read, a nullable deref in a domain service, an uncarried projection event
  ("this fold never runs"), an unresolvable page receiver, and two wrong primitive
  arguments — each with a remediation sentence. This is the best part of the system.
- **The context-integration rung** (`test "…"` hoisted to a `context`) emits a real
  DB-backed test that migrates and saves through the repository. It ran green.

---

## Findings

### F1 — A domain service that reads a repository list emits code that does not compile · **P1**

A reading-tier `domainService` taking `.count` off a bound repository list emits the member
access **verbatim** instead of the target's collection op. `ddd parse` is clean.

```ddd
domainService Roster {
  operation hasTier(tier: string): bool {
    let found = Owners.byTier(tier)   // find byTier(tier: string): Owner[]
    return found.count > 0
  }
}
```

| Backend | Emitted | Outcome |
|---|---|---|
| node | `return found.count > 0;` | **TS2339** `Property 'count' does not exist on type 'Owner[]'` |
| python | `return found.count > 0` | **mypy** `Unsupported operand types for < ("int" and "Callable[...]")`; `TypeError` at runtime |
| java | `return found.count() > 0;` over `List<Owner>` | **compile error** — `List` has no `count()` |
| elixir | `found.count > 0` over a list | runtime crash |
| dotnet | `found.Count > 0` | ✅ compiles — by C# naming coincidence only |

Two aggravating details:

- The *same* `.count` inside an aggregate lowers correctly (`tasks.count` → `this._tasks.length`),
  so this is receiver-typing on the let-binding of a repo read, not a missing collection op.
- The **validator prescribes the broken form**. Writing `Owners.byTier(t).count > 0` is
  rejected by `loom.domain-service-read-unsupported` with "Bind it first (`let x = …`) and
  read the member off the binding" — and the prescribed fix is what emits the broken code.

The adjacent honest gate exists: the same array-returning read inside a **workflow** is
refused with `loom.workflow-load-array-unsupported`. Domain services have no equivalent, so
the shape falls through to silent misgeneration. Repro:
`test/e2e/fixtures/` candidate is the two-aggregate system in the audit scratch
(`repro.ddd`, 55 lines).

### F2 — Generated unit tests don't type-check: id and datetime literals are passed raw · **P1**

A `test` block calling an operation whose parameter is `<Agg> id` or `datetime` emits the
string literal unwrapped, against a branded/typed signature:

```ddd
operation assign(owner: Owner id) { ownerId := owner }
test "…" { w.assign("00000000-0000-0000-0000-000000000001") }
```

```
domain/widget.test.ts(8,14): error TS2345: Argument of type 'string' is not assignable
  to parameter of type 'OwnerId'
tests/test_work_order.py:20: error: Argument 1 … incompatible type "str"; expected "TechnicianId"
tests/test_work_order.py:20: error: Argument 2 … incompatible type "str"; expected "datetime"
```

The brand constructor the emitter needs is right there in the same generated project
(`export const OwnerId = (value: string): OwnerId => …`). The tests still **run** green
(vitest and pytest don't typecheck), so the failure is invisible to every behavioral tier
and only appears when the user runs their own project's `npm run typecheck` / `mypy` —
which is also the shape of the generated project's own `build` script.

The `datetime` half is worse than cosmetic: the value **stored in the aggregate** is a
`str`/`string` where the field is `datetime`/`Date`.

**This is live in a shipped example.** `web/src/examples/sales-system.ddd:106` (and its
vue/svelte/angular/feliz siblings) does `order.addLine("00000000-…-000002", 2)`. The
per-PR gates miss it because `generated-build.test.ts` typechecks `examples/*.ddd`, not
`web/src/examples/*.ddd`, and the behavioral tier runs the tests without typechecking them.

Also caught in the same run, and worth a separate look: mypy flags
`Non-overlapping equality check` on a generated state-machine assertion
(`assert wo.status == Completed` after an earlier `== Scheduled` assert narrowed the type),
so a perfectly reasonable progression test is not `mypy --strict`-clean.

### F3 — The emitted e2e suite is not idempotent, and nothing says so · **P1**

Same suite, same backend, twice in a row:

```
run 1 (fresh DB):   Tests  4 passed (4)
run 2 (same DB):    Tests  1 failed | 3 passed (4)   → expected 1 to be 2
```

There is no `beforeEach`, no truncate, no per-test transaction, and no reset hook anywhere
in the emitted `e2e/` project — and no vocabulary in the DSL to ask for one. Every `it()`
also shares state with its predecessors *within* a run, so a count assertion in test *n*
is coupled to what tests *1..n-1* created. The author's only defence is fuzzy assertions
(`toBeGreaterThanOrEqual`) or hand-namespaced fixture data.

Loom's own harness sidesteps this by giving **each case** a fresh PGlite instance
(`run.mjs`) — isolation that exists in the toolchain and does not ship to users.

[`docs/tools.md`](../tools.md) § "Generated DSL-level e2e suite" documents the run recipe as
`docker compose up -d` then `cd e2e && npm install && npm test`, with no mention that the
database must be empty. Since compose uses a named `pgdata` volume, the documented recipe
is red on the second run.

### F4 — The e2e body is not checked against the model it drives · **P1**

Seven deliberate defects in one `test e2e` body; the compiler catches two:

| Probe | Diagnostic |
|---|---|
| unknown operation `api.widgets.noSuchOperation(w)` | ✅ `loom.e2e-unknown-method` (lists the real ones) |
| unknown aggregate `api.gadgets.create(…)` | ✅ `loom.e2e-unknown-aggregate` |
| misspelled **create** body key (`kode` for `code`) | ❌ silent |
| misspelled **operation** body key (`amt` for `amount`) | ❌ silent |
| **missing required field** in a create body | ❌ silent |
| **wrong scalar type** (`qty: "not-a-number"` for an `int`) | ❌ silent |
| read of a **response field that does not exist** | ❌ silent |

The compiler has `wireShape` + `createInput` (derived in enrichment for exactly this) and
the operation's parameter list, so all five are decidable. The cost is not only the
round-trip to find out — it is that a **negative test silently passes for the wrong
reason**: `expect(api.widgets.create({ kode: "A" })).toThrow(422)` is green because of the
typo, not because of the domain rule it claims to prove.

This bit during the audit: `schedule(techId: …)` called with `{ technicianId: … }` generated,
ran, and failed at runtime with a 422 on an unknown field.

### F5 — Workflows cannot be driven from a `test e2e` · **P2**

`api.<workflow>.run({…})` and every spelling tried are rejected:

```
loom.e2e-unknown-aggregate: unknown aggregate 'api.restockAll' on this deployable.
Available aggregates: widgets.
```

The backend mounts `POST /workflows/restock_all`, the frontend gets a generated
`WorkflowForm` page object — but the `test e2e` DSL reaches aggregates and projections
only. The transactional orchestration layer, which is where multi-aggregate consistency
bugs live, has **no DSL-level runtime test path at all**. (The testing plan acknowledges
this in passing — "the e2e DSL has no workflow accessor" — as a per-fixture waiver rather
than a tracked gap.)

### F6 — The authorization surface has no test vocabulary · **P1 for the auth feature area**

`TestBlock` for e2e is `'test' 'e2e' name 'against' deployable ('verifies' …)? '{' … '}'`.
There is no principal, claims, or "as user" clause. The emitted harness carries exactly
**one** identity per run, from the environment (`E2E_BEARER_TOKEN`, or base64
`E2E_DEV_CLAIMS`).

So for a model using `permissions` / `requires` / `policy` / `mask unless` / `tenancy`, a
user can express the **authorized** path and nothing else. The denial half — 403 for the
authenticated-but-unpermitted caller, the row a tenant filter must hide, the field a mask
must redact — is not expressible. Loom's own repo covers this with `AUTHZ_LADDERS`, a
hand-maintained register in `test/behavioral/cases.mjs`, which is harness-side and does not
ship with a generated app.

For a toolchain whose authorization layer is a headline feature, the generated app has no
generated proof of it.

### F7 — UI e2e has no working negative path · **P2**

`expect(ui.x.create({…})).toThrow(422)` parses clean, and then:

- the **status argument is silently dropped** — emitted as a bare `.rejects.toThrow()`;
- the assertion cannot work anyway. `submit()` awaits the detail page's testid, which never
  appears when the form is invalid, so the promise never rejects. Measured: the test hangs
  for the full 30s Playwright timeout and then **fails**.

So the natural way to test client-side validation is a 30-second red. The locator matchers
(`toHaveText`/`toHaveCount`/`toBeVisible`) are the whole usable UI vocabulary.

### F8 — `verifies` on a `test e2e` block never joins, so the DoD rollup lies · **P1**

The emitted vitest title appends the target (`it("creates a widget against api")`); the
verification join (`src/verify/verification.ts`) matches the **DSL name** exactly. They
never match. Isolated repro — one requirement, one testCase, one passing e2e test that
declares `verifies TCE-1`:

```
Verified 0/1 requirements (0 failing, 1 unverified, 0 untested).
| TCE-1 | UNVERIFIED | creates a widget (missing) |
Diagnostics — results matching no declared test:
  - VerifyProbe e2e › creates a widget against api (pass)
```

**This is not hypothetical**: 12 `verifies`-carrying e2e blocks across 10 checked-in `.ddd` files,
including `web/src/examples/storefront-system.ddd`, which rides the per-PR behavioral gate.
Running the repo's own harness on it:

```
$ node run.mjs storefront-system
  ✓ [api] top up a wallet then check out an order against api      ← backs TC-002
  ⟐ requirements: 1/4 verified, 2 unverified, 1 untested
6 passed, 0 failed
```

A passing test, its requirement reported UNVERIFIED, and the leg exits 0 — because only
`FAILING` requirements gate the run. Fix is a one-line normalization on either side; the
value is that the per-PR DoD number becomes true.

Related: `ddd verify` on the audit app printed **"Verified 3/3 requirements … Verification
gate"** and **exit 0** while two e2e tests in the same results file were red — they are
listed under "Diagnostics: results matching no declared test" and excluded from the gate.
`ddd verify` is a requirement rollup, not a test gate; the headline wording invites the
opposite reading.

### F9 — The built-in `auditable` capability is unusable with any frontend · **P2**

Minimal, complete repro:

```ddd
aggregate Widget with crudish, auditable { code: string }
deployable web { platform: react  targets: api  ui: Console  port: 3001 }
```

```
loom.ui-id-ref-unknown-aggregate web/Widget.createdBy: 'Widget.createdBy' references
User id, but no aggregate 'User' is declared in the system.
```

`auditable` stamps `createdBy: User id` / `updatedBy: User id` where `User` is the
*principal* type, not an aggregate — so any UI-mounting deployable hard-fails. The
workaround is to declare an aggregate literally named `User` **and** give it a
`derived display`, which is undocumented in [`docs/capabilities.md`](../capabilities.md).
Every checked-in example that uses `auditable` is backend-only, which is why this has
never surfaced.

### F10 — `toThrow(404)` is not the cross-backend parity assertion it is documented to be · **P2**

[`docs/language.md`](../language.md) says `toThrow(N)` asserts that every backend rejects
with the same status. For the canonical "missing row" case that is not reliable, because
the id never reaches the domain on some backends:

```
GET /api/work_orders/00000000-0000-0000-0000-0000000000ff  → 422 (Hono: zod `z.uuid()` rejects it)
GET /api/work_orders/ffffffff-ffff-ffff-ffff-ffffffffffff  → 404
```

Python's emitted route takes the same id through
`Path(pattern=r"^[0-9a-fA-F]{8}-…$")`, which accepts it → 404. So the same `.ddd`
`expect(api.x.getById("…")).toThrow(404)` passes on Python and fails on Hono depending on
which placeholder UUID the author typed. `examples/showcase.ddd:959` and
`test/fixtures/corpus/inheritance.ddd:96` use different placeholder conventions, one of
which happens to be safe.

### F11 — The unit tier cannot say *which* rule rejected · **P3**

`toThrow()` takes no message or error-type argument outside e2e, so a precondition failure
and an invariant violation are indistinguishable. Demonstrated by accident during the
mutation proofs: deleting the `status == InProgress` precondition from `complete()` left
the test **green**, because the guarded collection invariant (`tasks.count > 0 when status
== Completed`) threw instead. The test claims "a fresh work order cannot be completed" and
would keep claiming it with the guard gone.

The full matcher catalogue is 10 entries (`src/util/intrinsic-matchers.ts`): no
`toContain`, no null/absence matcher, no object equality, no error-shape matcher, and no
way to assert that an **event was emitted** — notable, given events drive projections and
sagas.

### F12 — No generated README, and the test projects are undiscoverable · **P3**

`ddd generate system` writes `api/`, `web_app/`, `e2e/`, `web_app/e2e/`, `docker-compose.yml`
and `.loom/` — and no README. Nothing in the output says the two test projects exist, need
their own `npm install`, want a fresh database (F3), or how to point them at a running
stack. (`ddd new` does scaffold a README; `generate system` does not.)

---

## Cross-cutting observation

The three findings with the widest blast radius (F1, F2, F8) share one shape: **the gate
that would have caught it exists, and doesn't reach the artifact.**

- F1: the compile gate runs on the corpus; no corpus fixture has a reading-tier domain
  service over a list find.
- F2: the compile gate typechecks `examples/*.ddd`; the offending shape lives in
  `web/src/examples/*.ddd`, which only the behavioral tier consumes — and that tier runs the
  generated tests without typechecking them.
- F8: the DoD rollup runs per-PR, but an UNVERIFIED requirement is not a failure, so a
  broken join is silent by construction.

The pattern is stated in `CLAUDE.md` already ("a check that never reaches the thing it
names") and is worth applying to the **generated test tier itself**: nothing currently
typechecks emitted `*.test.ts` / `tests/*.py` as part of the per-PR set, and nothing asserts
that a `verifies` reference resolves to a result the runner actually produces.

## Suggested order of attack

1. **F8** (one-line join fix + a test that a `verifies` on an e2e resolves) — smallest
   change, immediately makes the per-PR DoD number honest.
2. **F2** (wrap id/datetime literals in the test emitter) + add the emitted test files to a
   typecheck gate — this is the one already shipping in an example.
3. **F1** (type the let-binding of a repo read, or extend the honest gate to domain
   services the way workflows have it).
4. **F4** (validate e2e request bodies against `createInput` / operation params — the data
   is already derived).
5. **F3** (a reset seam for the emitted suite: per-test truncation, a transaction wrapper,
   or at minimum a documented `--fresh-db` contract).
6. **F6 / F5** are feature work, not fixes: a principal clause for `test e2e`, and a
   workflow accessor. Both are prerequisites for the generated test tier to cover the
   feature areas Loom markets most heavily.

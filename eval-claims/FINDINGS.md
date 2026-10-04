# Claims-handling evaluation: findings

This evaluation used a developer persona to build an insurance claims system over three iterations, on `main` @ `bce7f409` (2026-10-04).
Each model was generated, typechecked, booted (Postgres, Valkey and Keycloak in Docker; the node and python backends on the host) and driven over HTTP and Playwright.
The raw chronological log is in `RAW-LOG.md`. The models are in `v1/` through `v3/`, and the scripts that exercised them are `smoke*.sh`.

| Iteration | Scope | Shape |
|---|---|---|
| v1 | MVP: Policyholder, Policy (+ coverages), Adjuster, Claim lifecycle, scaffolded React | 2 contexts, node + react |
| v2 | Ops feedback: claim must match an active policy (kind + period), deductible, fraud flag (loss within 30 days of start), adjuster capacity, unique numbers | local policy replica fed by `PolicyActivated`/`Cancelled`, `fileClaim`/`assignClaim` workflows, delta migration over live v1 data |
| v3 | Security + finance: OIDC, permissions, only the assigned adjuster approves, >10k needs a supervisor, separate **python** Payments service over redis, payment → claim Paid | 3 contexts, node + python + react, Keycloak |

**Severity:**

- **S1:** silent wrong output (validates with 0 errors, but the code doesn't compile, crashes, or does the wrong thing).
- **S2:** blocks a realistic requirement, or needs a hand hack.
- **S3:** DX friction.

**Status:**

- **NEW:** not found in the banking eval (#3137), the helpdesk eval (#3126), any open PR, or `docs/new-plan/`.
- **DUP:** already reported by a sibling eval or claimed by a PR or mission (the reference is given).

## A. New findings (not claimed anywhere)

| # | Sev | Finding | Evidence |
|---|---|---|---|
| C-01 | **S1** | **A cross-context enum breaks generated code.** `Claim.kind: CoverageKind`, where the enum is declared in the sibling context `Underwriting`. Results per target: <br>• **node:** `domain/claim.ts`, `claim-repository.ts` and the unit tests don't import or qualify it (tsc TS2304). <br>• **python:** NameError at import time. <br>• **react:** the form default is `kind: ""` (tsc error) and the field renders as a free-text input instead of a Select. <br>• **angular:** the option list is empty. <br>• **elixir:** silently uses `:string` instead of `Ecto.Enum`. <br>**M-T6.80 tracks only 6 sites and misses the ones above** (`typescript/emit/aggregate.ts:104`, `typescript/repository-imports-builder.ts:46`, `_frontend/form-helpers.ts:188`, `angular/form-fields.ts:469`, `python/emit/aggregate.ts:213`, `python/repository-builder.ts:426`, `python/routes-builder.ts:248`, the TS tests emitter, the hono workflow/projection builders…). | v1 tsc; root-cause sweep: 67 `ctx.enums` sites |
| C-02 | **S1** | **A negative test can pass for the wrong reason.** Because of C-01, `expect(Claim.create({… kind: Fire …})).toThrow()` throws `ReferenceError: Fire is not defined` and goes **green**. A bare `toThrow()` accepts any error, including codegen bugs. | v3 vitest |
| C-03 | **S1** | **A workflow can't read a projection, but the code still generates.** `let terms = PolicyTerms.byKey(policy)` validates, and node emits an undefined `PolicyTerms.byKey(...)`. With the receiver unresolved, `terms.effectiveFrom + days(30)` renders as JS `Date + number` (string concatenation). Yet `workflow.md` and `domain-services.md` tell you to "read a local projection" for cross-context data, and there is no way to do that. | v2 tsc |
| C-04 | **S1** | **`emit` inside an `if let` branch of a workflow** makes node push onto a `workflowEvents` array that is never declared and never dispatched. This is the hand-rolled-walk defect class. | v2 tsc |
| C-05 | **S1** | **An aggregate constructed only by a workflow** (no canonical `create`, which the docs call "a legitimate design") makes node emit `Claim.create(...)` with no static `create` on the class (TS2551). So you can't remove the `POST /claims` route that bypasses the coverage check. #3122 is the elixir twin only. | v2 tsc |
| C-06 | **S1** | **python: a system `user { adjusterId: Adjuster id? }` claim on a deployable that doesn't host `Adjuster`** makes `auth/user.py` and `oidc.py` import `ids.AdjusterId`, which is never emitted (ImportError at boot). `http/workflows_routes.py` also uses `User` without importing it. #3144 may cover the second half. | v3 mypy |
| C-07 | **S1 (auth)** | **python with `audience: env("OIDC_AUDIENCE")` and the env var unset rejects every token.** It calls `jwt.decode(audience="", verify_aud=True)`, while node treats `""` as "skip the check" (the documented opt-out). The exception is swallowed with no log line, so the only symptom is a bare 401. The compiler's own warning tells you to declare `audience`, and compose doesn't set it. | v3 runtime |
| C-08 | **S2 (security)** | **There is no workflow-only operation.** Workflows can't call a `private operation` (`loom.workflow-private-operation`), so `Claim.intake` (which sets the deductible and fraud flag) must be a public route. An op `requires` gate *is* re-evaluated inside the workflow, so `requires Nobody()` blocks the workflow too. But the aggregate `create { requires … }` gate is **not** evaluated when a workflow calls `Agg.create`, which is inconsistent. Demonstrated: adjuster Alice POSTed `/claims/{id}/intake {"deductible":"0"}`, and the payout went out at 2500 instead of 2300. | v3 runtime |
| C-09 | S2 | **The declared `create(...)` param list doesn't shape the wire.** Optional, operation-owned fields (`approvedAmount`, `rejectionReason`, `assignedTo`) are accepted on `POST /claims`, so an "approved" amount of 99999 was stored at creation. It's warned only when a *required* field is omitted. The workaround is `managed` on each such field, but nothing suggests it. Related: helpdesk H-01 (`when` state bypass via create). | v1 runtime |
| C-10 | S2 | **A new subscriber never sees history.** The replica / folded projection added in v2 doesn't know policies activated in v1 (they show up as "unknown policy" forever). There's no replay/backfill/seed-from-source story for a new reactor or projection. M-T4.2 parks replay as "needs durable log". | v2 runtime |
| C-11 | S2 | **No `Repo.count(Criterion)`.** An inline repo call is refused, and `findAll(...).count` works but earns `loom.findall-no-page`. So "adjuster below capacity" can't be both bounded and correct. | v2 |
| C-12 | S3 | **Name casing and pluralization.** The saga table for `workflow replicatePolicies` is named `replicate_policieses`. A redundant `_idx` is also emitted next to the `_uq` index on the same column. | v2 migration |
| C-13 | S3 | **An event-only saga gets a "Run →" card** on the Workflows page, plus an instances list page (404 in console). Internal replica aggregates get public routes and sidebar entries. There's no "internal" marker. Related: helpdesk H-19 / H-35. | v2 UI |
| C-14 | S3 | **`requires … message "…"` isn't in the grammar** (`precondition` has it), so a 403 can't explain itself in domain terms. | v3 parse |
| C-15 | S3 | **`status: S = Draft managed`** fails with "Expecting ':' but found `effectiveFrom`". The modifier must precede the default, and the message doesn't say so. | v1 parse |
| C-16 | S3 | **A `tests/*.ddd` file is ignored silently** until it's `import`ed (no orphan-file hint). | v3 |
| C-17 | S3 | **`covers` is reserved.** It's the most natural insurance verb, and joins banking's `from`/`to` (B-06). Worth reviewing which soft keywords really need to be hard. | v1 parse |

## B. Confirmed duplicates (independently re-hit; extra evidence only)

| Mine | = | Claimed by |
|---|---|---|
| Workflow `precondition message` dropped; the end user sees `Precondition failed: terms.kinds.contains(kind)` | B-02 | #3139 |
| Money `toBe` uses `Object.is` on Decimal | B-01 | #3139 |
| Workflow 204: File Claim can't navigate to the new claim | B-03, H-16 | #3140 |
| `unique (claimNumber)` added over duplicate data: boot crash (rolled back cleanly) | B-20 | #3141 |
| List and by-id reads ungated for any authenticated user | B-15, H-11 | #3109, #3143 |
| Cross-context `policy` reference emits an undefined call | — | #3143 (`loom.policy-out-of-scope`) |
| Reactor calling a gated op: `currentUser is not defined` at runtime, and the payment never marks the claim Paid | H-29 | #3066, #3103, #3131 |
| A failed channel consume is dropped (warn only) | H-28 | partial |
| 403 detail echoes the gate source | B-22 | #3104 |
| `X id` shows a truncated UUID; `version` column; op buttons ignore state | B-11 | #3113, #3119, #3112 (only `when`; *preconditions* still don't drive enablement) |
| Named policy in a workflow header breaks the scaffolded page gate | B-19, H-12 | none |
| `create` body inert (can't emit `ClaimSubmitted`, default status, …) | B-16, H-05 | M-T3.16 |
| `retrieval` has no route; the starter teaches it anyway | B-32, H-04 | M-T5.31 |
| Stateless event handler needs a saga + correlation + state table | B-27, H-35 | none |
| Keycloak demo user: no `permissions`, non-uuid id claim, unmanaged attrs dropped | B-21, H-21 | none |
| Chevrotain "Ambiguous Alternatives" printed; `toThrow(kind)` vs custom message | B-07, B-08 | none |
| No long-text field; `AGGREGATES` jargon in the sidebar; badges truncated | H-07, H-19 | none |

## C. What worked well

- **Deny-by-default.** It listed every ungated route, with the exact fix for crudish and `create` placement.
- **Migrations.** The delta (ADD COLUMN with default, then DROP DEFAULT) was correct. A failed migration rolled back atomically. Regenerating names locally edited files, and the missing-snapshot refusal is clear.
- **Eventing.** The in-process event → saga starter → replica path worked first time. The cross-deployable node → redis → python → redis → node chain also worked first time once auth was sorted.
- **Errors and wire format.** Problem+json errors carry custom messages, a `unique` violation becomes 409, and money goes over the wire as a fixed-scale string.
- **Auth plumbing.** OIDC came out of the box: a Keycloak realm, a compose service and PKCE routes. Row-relative gates (`assignedTo == currentUser.adjusterId`) and the >10k supervisor rule enforced correctly.

## D. Proposed plan (to discuss)

**P0: silent-codegen fixes.** Each is small, mechanical and mutation-provable.

1. **Cross-context enum pool sweep.** Expand M-T6.80 to every `ctx.enums` name-resolution site (C-01), and add a census test banning `ctx.enums` outside `enumPool`. Coordinate with #3144 (M-T9.84 derived imports).
2. **Workflow `if let` emit (C-04).** Make the workflow emit-collector ride `walkWorkflowStmtsDeep`. Check against #3142 first, since it restructures workflow event dispatch.
3. **Workflow-only aggregate on node (C-05).** Emit the internal factory whenever a workflow constructs the aggregate. This is the node twin of #3122.
4. **Unresolved workflow receiver (C-03).** Make `loom.workflow-unknown-name` fire for `Projection.byKey`. Then decide whether a folded projection becomes a sanctioned workflow read (the docs already promise it).
5. **python id/User imports (C-06)** and **python empty audience (C-07)**. Align with node's `""` = skip, and log the verify failure reason at debug level.
6. **Test-matcher hardening (C-02).** Consider making a bare `toThrow()` exclude `ReferenceError`/`TypeError` (or warn on it), so codegen bugs can't pass as negative tests.

**P1: design gaps** (each needs a ruling before building):

- **Internal/workflow-only operations (C-08).** Either let workflows call `private operation`, or add an `internal` op modifier: no route, gate not re-applied (or applied consistently with `create`).
- **Create-surface narrowing (C-09).** Make the declared params the wire, or auto-suggest `managed` for op-owned optionals.
- **`Repo.count(Criterion)` in workflows (C-11).**
- **Subscriber backfill/replay (C-10)**, building on M-T4.2's deferred replay.

**P2: DX polish.** C-12 through C-17.

# Wave C5 · moment 5c — M-T5.1 exception-less completion: measured, three rows built, two dispositioned

Branch `claude/c5-exceptionless`, base `4816dda14` (the C5 coordinator head = `main` @ `fc1880a05` + the wave log).
Plan row: [`../wave-c5.md`](../wave-c5.md) §Packets, "5c M-T5.1 A4 `Repo.getById` → `X or NotFound`, A5, A6, VO `invariant` → 422".

**Verdict.** The moment's premise was measured before anything was built, and two of its
load-bearing assumptions are stale on this head. **VO→422 is built on all five backends**
(runtime-proven on three booted legs, golden-pinned for the other four CI legs), **A4's
consumer half is built** (a new gate + the load-path 404 parity), **A6 is superseded** by
the design note that revisits the proposal, **A5 is blocked** on the effect-form `match`,
and **A4's letter — retyping `getById` to `X or NotFound` — is not built and needs an owner
ruling** (§5). **No existing wire golden moves**; one NEW golden was captured for the new case.

---

## 1. The measurement that reshaped the moment

| premise (mission text) | on this head | evidence |
|---|---|---|
| "`match` is boolean-guard-only today" | **stale.** The VALUE form `match r { Order o => o.code, NotFound => … }` ships on all five over union finds and `or`-returning ops, lowered to a presence check for the absence shape (`subjectShape: "absence"`, `src/ir/types/loom-ir.ts:3970`). Only the EFFECT form (arms that run statements) is frontend-only — `loom.variant-match-placement`, M-T5.28. | a probe workflow with both union finds + value-form matches generated on node/.NET/java/python/elixir (`r !== null ? r.code : …`, `switch (r) { case null -> … }`, `if r != nil, do: …`) |
| A4 needs `NotFound` to exist | there is **no stdlib `NotFound`**; every corpus use is a user-declared `error NotFound { resource: string }` | `test/fixtures/corpus/union-find-absence.ddd:5` |
| A4 is wire-visible | the wire half **already ships**: every single-row find shape (`: X`, `: X?`, `X option`, `X or NotFound`) answers 404 on a miss on all five; only the BODY differs (framework `about:blank` "Order <id> not found" vs the declared `/errors/not-found` + `resource`). Retyping `getById` to the declared `NotFound` body would move **~60 existing goldens** (every `GET /api/<aggs>/{id}` miss the goldens record) — 5a's capture. | `jq` over `test/behavioral/wire-golden/*.json`: 404 entries are `about:blank` "X {id} not found" except `union-find-absence` / `operation-returns` |
| A5 re-shapes parse intrinsics | **no parse intrinsic exists** (`parse X from Y` is not grammar; `src/util/intrinsics.ts` has none); the external-call site is the typed in-system api call (M-T4.8, `callKind: "remote-api-op"`) | grammar grep; `src/generator/typescript/render-expr.ts:428` |
| A6 re-shapes `validate for X` | **not grammar**, and `failure-taxonomy.md` (which revisits exception-less) calls it "a hallucination in an earlier draft" — validation is the VO `invariant`, routed to 422 | `docs/old/proposals/failure-taxonomy.md` §"Verdict against the shipped slices" |

And one defect the measurement found in passing: **reading a union find straight through
validated `0 error(s)`** and emitted an unguarded dereference on all five (§2.1).

## 2. Rows → outcome

### 2.1 A4 — the consumer half: `loom.union-read-undiscriminated` (built)

`let r = Orders.byCode(code)` (`Order or NotFound`) then `r.code` validated clean. `memberType`
(`src/ir/lower/lower-expr.ts:3021`) has no `union` arm, so the read typed as the catch-all
`string`, and every backend dereferenced a value its own port types as nullable: TS18047 on node,
CS8602 on .NET, NPE / AttributeError / KeyError (500) on java / python / elixir. The statement
twin `r.touch()` lowered to an `op-call` with `aggName: "Unknown"`.

- Gate: `src/ir/validate/checks/union-read-checks.ts:64` (`validateUnionReads`), wired at
  `src/ir/validate/validate.ts:375`. Member / method reads over every non-UI expression
  (`forEachModelExpr`) + workflow / command-handler `op-call`s (`walkWorkflowStmtsDeep`). A read
  of a `match` subject INSIDE one of its own arms is the discriminated read and stays legal.
- Message `src/diagnostics/messages.ts` (`loom.union-read-undiscriminated` + `#op-call`), anchor
  `src/diagnostics/code-docs.ts` → `09-payloads-and-unions.md#reading-a-union-in-a-body--match-first`,
  firing fixture `test/system/diagnostic-firing-census.test.ts`, 7 cases in
  `test/ir/union-read-checks.test.ts`.
- **Zero firings** across 402 corpus / example / behavioural / e2e-fixture sources × five platforms.
- Docs: `docs/language-reference/09-payloads-and-unions.md` (new §, `.ddd` + all five outputs),
  `docs/payloads.md` (validation table row; the "deferred `match`" line corrected).

### 2.2 A4 — the `getById` miss on every load path (built)

The new behavioural case asserts the declared 404 problem+json from the GET route, an operation
route and a workflow step. Node, python and .NET/java (by construction) agreed; **elixir's
workflow step answered `"Resource not found"`** — the context facade's miss is a bare
`{:error, :not_found}`, which the workflows dispatcher could not name. The load now tags its miss
(`src/generator/elixir/vanilla/workflow-execution-emit.ts:471`) and the dispatcher carries a
`{:not_found, detail}` arm (`src/generator/elixir/vanilla/denial.ts:431`, gated on a workflow
that loads by id — `workflowLoadsById`). The golden caught it: elixir's first run diverged at
`#17 POST /api/workflows/bump $.detail`; after the fix it matches.

### 2.3 VO→422 (built, all five)

A value object BUILT by a body (`qty := Qty { value: n }`) and refused by its constructor now
answers the domain-floor status/title, the message as `detail`, and ONE `errors[]` entry
`{pointer: "", message, code?}` (`code` for a messaged rule; `""` because the body computed the
value and it names no request member). Before: the bare domain floor on node/.NET/java/python,
and **no check at all on elixir** (the op persists through `force_change`, which runs no
validator — `resize(0)` answered 204 and stored `{"value": 0}`).

| backend | carrier | file:line |
|---|---|---|
| node | `ValueObjectInvariantError extends DomainError`; `valueObjectProblem` answered first in the route / workflow / explicit-handler `DomainError` arms | `src/platform/hono/v4/emit.ts:148,166`; `routes-builder.ts:1493`, `workflow-builder.ts:405`, `explicit-handlers-builder.ts:730`; `src/generator/typescript/emit/value-objects.ts`; helper `src/generator/typescript/value-object-problem.ts` |
| .NET | `ValueObjectInvariantException` (own sealed type — `DomainException` is sealed and emitted everywhere) + a filter arm ahead of `DomainException` | `src/generator/dotnet/emit/api.ts:859`, `emit/common.ts`, `emit/enums-vos.ts` |
| java | `ValueObjectInvariantException extends DomainException` + its own (more specific) advice handler | `src/generator/java/emit/api.ts:910`, `emit/common.ts`, `emit/enums-vos.ts`, `index.ts` |
| python | `ValueObjectInvariantError(DomainError)` + its own exception handler | `src/generator/python/index.ts:1790`, `emit/errors.ts`, `emit/value-objects.ts` |
| elixir | `<Agg>Changeset.validate_body_value_objects/1` piped into the op persist tail; ProblemDetails answers a `loom_body_value_object` changeset error on the domain-floor rung | `src/generator/elixir/vanilla/changeset-emit.ts:527`, `context-emit.ts:1441`, `problem-details-emit.ts:222`, `changeset-validators.ts` (`aggregateBodyValueObjectFields`) |

Every piece is gated on `hasValueObjectInvariants` (`src/ir/util/value-object-invariants.ts`), so
a project without a value-object invariant emits byte-identically (pinned by the last case of
`test/generator/vo-invariant-in-body.test.ts`). The rule is written into RS-9
(`docs/conformance-semantics.md`) and `docs/language-reference/07-invariants-derived-functions.md`
(new §, `.ddd` + all five outputs + the wire body).

**Scoped out, stated:** a MESSAGE-LESS rule's refusal is compiled but not in the golden — its text
is each backend's derived default, and elixir's value-object carrier is Ecto's native chain
("should be at least 1 character(s)") where the other four derive "Invariant violated: …", the
same native-chain split the wire rung already has for message-less rules. The mission's other
half — the domain floor carrying a `code` for preconditions / aggregate invariants — is
M-T1.11 (c), moment **5b**'s row; this moment touched only the value-object subclass, so 5b
extends the same answer rather than colliding with it (§6).

### 2.4 A6 — superseded (not built)

`validate for X` never existed; the design note that revisits exception-less routes validation to
the VO `invariant` → 422, which is §2.3. Recorded on the mission.

### 2.5 A5 — blocked (not built)

No parse intrinsic exists to re-shape. The external call is the typed in-system api call; making
it `T or ApiError` needs (a) an `ApiError` vocabulary (no stdlib error payloads exist — every
`error` is user-declared) and (b) a way to ACT on the success variant, i.e. the effect-form
`match` in a workflow body. With `?` dropped, a value-form `match` alone cannot run the workflow's
next step.

### 2.6 The effect-form `match` — sized, handed off (L)

What it needs, measured on this head: a new `WorkflowStmtIR` kind (`lower-workflow.ts` has no
`MatchStmt` arm), a `WorkflowStmtTarget` leaf on four backends plus the elixir `with`-chain
branch (a branch inside a `with` is not a clause — the chain has to split), five `StmtTarget`
leaves for domain bodies (the `src/generator/_stmt/target.ts` frontend-only throw), `walk.ts` +
`ir-walk-census`, and flipping `loom.variant-match-placement` from "permanent placement rule" to
lifted for those owners. **L on its own** — per the brief, not widened into this moment.

## 3. Mutation proofs (file copy, never `git checkout --`)

| gate | mutation | failing assertion |
|---|---|---|
| `loom.union-read-undiscriminated` | unwire `validateUnionReads(loom, diags)` | 5 of 7 in `union-read-checks.test.ts` (`refuses a member read…`, `…option spelling…`, `…operation invoked…`, `…domain-service body`, `…OUTSIDE the arm…`) + `diagnostic-firing-census › loom.union-read-undiscriminated fires` |
| arm guard | drop `guarded.add(inner)` | `allows the discriminated read: a bound arm, and the subject read inside its own arm` |
| op-call arm | `st.kind === "op-call" && false` | `refuses an operation invoked on a union-bound workflow local` |
| node VO answer (RUNTIME) | `valueObjectProblem` always `undefined` | node behavioural wire differential: `#3 POST /api/orders/{id}/resize at $.errors — golden [...] ≠ node (absent)` and `#7 POST /api/workflows/bump at $.errors` |
| python VO answer (RUNTIME) | handler registered for `ValueError` instead | python behavioural wire differential: `2 divergence(s) from wire-golden/vo-invariant-in-body.json on python` |
| elixir VO pipe | `bodyVoPipeOn = false && …` | `elixir: the op persist re-runs the body-built value object's constructor` |
| elixir workflow 404 detail | `st.method === "getByIdX"` | `elixir: a workflow getById miss answers the 404 naming the row`; RUNTIME before the fix: `#17 POST /api/workflows/bump at $.detail — golden "Order {id} not found" ≠ elixir "Resource not found"` |

## 4. Local gates

- **Runtime (booted, golden-compared) — three legs:** node (`run.mjs`, PGlite) ✓; python
  (`run-python.mjs`, postgres:17 in docker) ✓ matches golden; elixir (Phoenix booted in the
  hexpm image against the same postgres, `run-elixir.mjs` via `LOOM_BH_ELIXIR_BASE`) ✓ matches
  golden. .NET / java / dapper / mikroorm legs were NOT booted here (no host SDK / JDK 25); they
  are compared against the same golden in CI.
- **Existing goldens:** node re-run of the three golden cases whose emission changed
  (`domain-services`, `validation-messages`, `vo-field-default`) — `0 divergence(s)`.
- **Compile, new fixture:** node `tsc` corpus tier ✓; .NET `dotnet build /warnaserror`
  (sdk:10.0) ✓ 0 warnings; java `gradle testClasses bootJar` (gradle:9-jdk25) ✓; python corpus
  tier (ruff + mypy) ✓; elixir corpus tier (`mix compile --warnings-as-errors`, hex mirror) ✓.
- **Compile, every affected corpus fixture** (the emission marker grep: node/.NET/java/python —
  `domain-services`, `validation-messages`, `vo-field-default`, `vo-id-reference`; elixir —
  `domain-services`, `tenancy-hierarchy`, `vo-field-default`, `vo-id-reference`): see §8.
- `npx tsc -b`, `node scripts/test-typecheck.mjs`, `npx biome ci . --diagnostic-level=error`,
  `node scripts/mission-counts.mjs --check`, `node scripts/ledger-counts.mjs --check`,
  `node docs/build.mjs`, full `npm test`: see §8.

## 5. Decisions wanted from the owner

1. **A4's letter — retype `Repo.getById` to `X or NotFound`?** Recommended default: **no; ratify
   the softened form that ships.** Reasons: (a) `?` is dropped and the effect-form `match` does
   not exist, so every `let o = Repo.getById(id); o.op()` in the corpus (dozens) becomes a type
   error with no replacement spelling; (b) `failure-taxonomy.md` classifies not-found-on-load as
   a *policy* ("declarative, auto-mapped, never named") and softens A4 "from law to default +
   `: X?` opt-out" — which is exactly the shipping surface: a find opts into the union by
   declaring `X or NotFound` / `X option`, and `loom.union-read-undiscriminated` now makes that
   union sound in bodies; (c) switching the 404 body from framework `about:blank` to a declared
   `/errors/not-found` would move ~60 goldens and needs a stdlib `NotFound` that does not exist.
   If the owner wants the letter, the recipe is: land the effect-form `match` (§2.6) first, then
   retype, then one capture.
2. **`: X?` → `X option`** (the other half of A4's letter). Recommended default: **keep `: X?` a
   native nullable** (failure-taxonomy: "`option` / `T?` erases to native nullability") and point
   the refusal at the `option` spelling — done: `loom.workflow-load-nullable-unsupported` now names
   "`… option` (or `… or NotFound`) read through a variant `match`" as the branch-on-absence remedy.
3. **The body-rung pointer `""`.** Taken as the default: the whole-request pointer, because a
   body-computed value names no request member (pointing at the value object's own field would
   bind the denial to a form control the request never carried). 5b's domain-floor `code` row
   should adopt the same entry shape for preconditions / aggregate invariants if it adds an
   `errors[]` entry at all.

## 6. Open-PR overlaps (cited, not duplicated)

- **#2918** (M-T5.35, `routes-builder.ts`): no textual overlap — it edits `zodFor` (~:2482);
  this moment's hunks are the import block, the `DomainError` arm (:1493) and one
  `problemNamed` push (:1630).
- **#3024** (explicit `route` prefix): shares only `test/ir/api-caller-census-pins.ts` (one new
  entry each, different keys). It does not touch `src/platform/hono/v4/explicit-handlers-builder.ts`,
  where this moment changed one line (:730).
- **#3040** (`domainService` body env, language half): composes — once it lands, domain-service
  `let`s type in the AST too; `loom.union-read-undiscriminated` is IR-level and already reaches
  domain-service bodies.
- **#3023** (elixir invariant coverage): shares `docs/language-reference/07-invariants-derived-functions.md`,
  `src/diagnostics/{code-docs,messages}.ts`, `src/ir/validate/validate.ts`,
  `test/system/diagnostic-firing-census.test.ts` — all additive entries in different places.
  Different elixir files (`changeset-invariant-emit.ts` vs this moment's `changeset-emit.ts`).
- **5b** (M-T1.11 (c) domain-floor `code`): the node / .NET / java / python `DomainError` arms are
  touched here only for the value-object SUBCLASS; 5b's change to the base arm composes on top.
- **5a** (goldens): this moment adds ONE new golden (`wire-golden/vo-invariant-in-body.json`,
  captured from node, no decimals in the case, so 5a's arithmetic change cannot move it) and
  moves none. If 5a lands first and re-captures "all", this file is unaffected by construction.

## 7. Hand-offs outside the fence

- **The effect-form `match`** (§2.6) — a `language-feature-developer` mission; the prerequisite
  for A5 and for A4's letter.
- **A stdlib error vocabulary** (`NotFound`, `ApiError` = `TransportFailure | UnexpectedStatus |
  DeserializeError`) — only if the owner keeps A4's letter / A5; today every `error` is
  user-declared.
- **Message-less value-object text parity** — the native-chain split (elixir's Ecto defaults vs
  "Invariant violated: …") is the same one the wire rung has; the fix is the wire rung's, not
  this moment's.

## 8. Gate results on the merged tree

(filled below)

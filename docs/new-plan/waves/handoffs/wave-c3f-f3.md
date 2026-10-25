# Wave C3F packet F3 — node / MikroORM — hand-off

*Branch `claude/c3f-f3`, base `origin/main` @ `4233416e6` (#3110 L1-N node decimal merged). Re-run
after a container loss; every item re-verified on that base. Nothing pushed, no PR opened.*

## Outcomes

| item | defect (3d D-table) | outcome | commit |
|---|---|---|---|
| **D6** | MikroORM does not enforce `unique (...)` — a duplicate create answers 201 | **fixed** — root `EntitySchema`s emit `uniques:` (`<table>_<cols>_uq`; a `softDeletable` key as its partial-index DDL `expression`) | `af609d894` |
| **D7** | the drizzle schema object has no `uniqueIndex`; `synthDDL` drops `unique` — no golden mintable | **fixed** — the drizzle schema emits `uniqueIndex(...)` (partial `.where(sql…)`) on the relational root and the TPH shared table; `synthDDL` keeps `UNIQUE` and the predicate, and refuses a predicate it cannot render. The golden was already mintable on this base (the node harness boots the emitted migrations since #2988), so `corpus/unique-conflict` + its golden land here | `af609d894` |
| **D15** | MikroORM: a value-side intrinsic in a find (`q.trim()`) → 500 | **already fixed on main by #3133** (`06481a2ca`, `filterValue`'s `method-call` arm). Not asserted by any runtime tier, so `corpus/intrinsics` now carries the value-side arm (`q.trim()`, `toLower()` both sides) | `0e851e1b0` |
| **D18** | MikroORM: a `transactional` workflow → 500 | **fixed** — the workflow builder emitted drizzle's `db.transaction(...)` on every adapter; an `EntityManager` has no `transaction` ("db.transaction is not a function"). Now `db.transactional(cb)`, isolation as `IsolationLevel.X` (imported from `@mikro-orm/core`) | `1e865b341` |
| **D20** | node saga money compound 500s on a reloaded row | **fixed** — not covered by #3110 / #3127 (re-verified: still reproduced on this base). `load<Wf>`/`save<Wf>` now convert `money`/`decimal` state at the persistence boundary (text → `Decimal`/`number` on load as a fresh object, back to text on save, money at the fixed scale through `TS_NUMERIC`); state type and allocate default carry the domain form. A workflow without numeric state emits byte-identically | `62e52d865` |
| **D21** | MikroORM saga money serialised without scale ("9.5") | **fixed by the same codec** — the identity-map entity held the request's `Decimal`; save now writes the fixed-scale text, load never mutates the managed entity | `62e52d865` |

`#3139` (Fleet A node correctness, open) touches `workflow-builder.ts` (precondition message) and
`render-expr.ts` (datetime `==`) — no overlap with these items; textual neighbours only.

## The 409 body (coordination with F2)

Every node 23505 arm (aggregate router, workflow router, explicit-handlers router, legacy
`typescript/emit/routes.ts`) and elixir's `problem_details` now answer the shared
`UNIQUE_CONFLICT_DETAIL` (`src/ir/util/openapi-errors.ts`):

```json
{ "type": "about:blank", "title": "Conflict", "status": 409,
  "detail": "A resource with these values already exists.", "instance": "/api/members" }
```

That is the sentence .NET (EF and the `DomainExceptionFilter` Dapper shares), java and python
already served — node said "A Member with these values already exists.", elixir "A record with
these values already exists.".  F2 makes Dapper answer EF's body, so `corpus/unique-conflict`
promotes with this one golden.  The dotnet/java/python literals are unchanged (left as literals
so this packet does not touch F2's file; switching them to the constant is a one-liner each).

## Mutation proofs (file-copy revert; the failing assertion read)

- **D6** — `mikroUniquesLines` dropped from the entity block → mikroorm leg on `unique-conflict`:
  `✗ [api] … expected the call to reject, but it resolved` (the duplicate create answered 2xx).
  Unit: `unique-index-schema-agreement` mikroorm arm.
- **D7** — the drizzle `uniqueIndex` entries dropped → `unique-index-schema-agreement` drizzle arm:
  `expected [[animals_tag_uq …]] to deeply equal [[animals_tag_uq …], …(3)]`. `synthDDL`'s
  `UNIQUE` dropped → `web/scripts/test-ddl.mjs`: `FAIL keeps a uniqueIndex UNIQUE`, `FAIL keeps a
  partial uniqueIndex's predicate`.
- **409 detail** — node's aggregate arm back to `A ${agg.name} …` → node leg: 3 golden
  divergences at `$.detail` (`#2`, `#4`, `#12`).
- **D15** — `filterValue`'s `method-call` arm made to throw → mikroorm leg on `intrinsics`:
  `GET …/by_trimmed_query?q=++Bob++ → 500`.
- **D18** — `workflow-builder.ts` at HEAD~ → mikroorm leg on `domain-services`:
  `POST /api/workflows/register_account → 500`; unit `mikroorm-transactional-workflow` mikroorm arm.
- **D20/D21** — the codec branch disabled → node leg on `workflow-create-state`:
  `expected "Pending" to be "Shipped"` (the reactor threw on `.minus`); mikroorm leg: 5 golden
  divergences, `golden "9.5000" ≠ mikroorm "9.5"`. Unit `hono-workflow-own-state-assign` (both arms).
- A read-route money re-encoding was also tried as a second guard; with the codec in place it
  changed nothing observable (mutation-proved inert), so it was removed rather than shipped unproven.

## Runtime evidence

| case | node (PGlite) | mikroorm (docker pg17) | python (host uv + docker pg) | dotnet / dapper / java / elixir |
|---|---|---|---|---|
| `unique-conflict` (new, golden node-minted) | ✓ golden | ✓ golden | ✓ golden | **CI** — dapper needs F2's D5; elixir answers the new detail (one-line change, not booted here) |
| `intrinsics` (value-side arm, golden re-minted) | ✓ | ✓ | ✓ | **CI** (the value-side copies on those four were green string tests; the kept 3d note says only mikroorm failed) |
| `domain-services` (both transactional workflows, golden re-minted) | ✓ | ✓ | ✓ | **CI** |
| `workflow-create-state` (money arm, golden re-minted) | ✓ | ✓ | ✓ | **CI** (3d recorded "9.5000" on every other leg) |

Java could not build here (`gradle bootJar` fails on the host JDK 21 / dependency fetch); .NET and
Elixir have no host toolchain.  Those four legs must confirm the four goldens in CI
(`behavioral-e2e-{dotnet,dapper,java,elixir}`).  The generated node (drizzle) and mikroorm
projects for `workflow-create-state` and a `transactional(serializable)` variant of
`domain-services` typecheck clean (`tsc --noEmit`, only missing dev-tool modules on drizzle).

A softDeletable arm (destroy frees the key, the partial index lets it be re-taken, a second
duplicate is refused) was booted on node and mikroorm and is green on both; it is NOT in the
committed fixture because no other leg was booted on it — a follow-up once the CI legs confirm.

## String copies deleted (carried by the fixtures)

- `test/generator/hono/hono-unique-conflict.test.ts` (file).
- `test/generator/typescript/intrinsic-trim.test.ts`: the value-side trim and the both-sides
  `toLower` cases (legacy-path ratchet 5 → 3).
- `test/generator/typescript/domain-service-mutating.test.ts` (file; ratchet row removed).
- `test/generator/typescript/hono-workflow-own-state-assign.test.ts` rewritten: it pinned the
  broken `state.total.minus(...)` spelling; it now pins the boundary codec (both adapters).

The other backends' `unique-conflict` / `domain-service-*` / own-state money copies are kept
until their legs confirm in CI; deleting them then is the remaining M-T9.42 promotion step
(unique-conflict, domain-service-reading/-mutating, the money arm of workflow-own-state-assign).

## Fence crossings

- `src/ir/util/openapi-errors.ts` — the shared `UNIQUE_CONFLICT_DETAIL` constant.
- `src/generator/elixir/vanilla/problem-details-emit.ts` — one literal → the constant (F1/F8 tree).
- `web/src/runtime/ddl.ts` + `web/scripts/test-ddl.mjs` — `synthDDL` (D7's second half).
- `docs/workflow.md` — the MikroORM isolation spelling.

## Gates

- `npx tsc -b` ✓ · `node scripts/test-typecheck.mjs` ✓ · `npx biome ci .` ✓ · `web/scripts/test-ddl.mjs` ✓
- `test/generator/{typescript,hono,_numeric}` 127 files / 749 ✓ · `test/adapters` 24 / 304 ✓
- `test/generator/elixir/vanilla-unique-conflict`, `test/conformance/{override-status-census,corpus-coverage}`,
  `test/behavioral/golden-coverage` ✓
- `test/ir` 316/318 files: `api-caller-census` caught two real gaps, both fixed (`89242407c`:
  `unique-conflict` now calls every listing route; `domain-services`' workflow runs pinned as the
  not-lifted workflow-run class).  `model-exprs-completeness` times out at 30 s — it walks only
  `examples/*.ddd`, untouched here; load average was ~20 on the shared machine.
- `test/system` 139/146 files: `harness-schema-source` caught a `synthDDL` mention in the new
  agreement test's comment — fixed (`f87e02458`).  The other eight failures are all
  `Test timed out` (openapi-component-uniqueness, ddd-source-census, diagnostic-firing,
  e2e-fixture-validation, e2e-state-reset, emitted-unbound-symbols, playground-remaining-examples,
  unknown-cascade) plus worker OOM exits under the same load; `e2e-state-reset` re-run alone
  passed.  CI's per-PR run must confirm these.
- Conformance spot-run (`behavioural-coverage`, `problem-arm-census`, `feature-doc-coverage`,
  `semantics-rules`, `internal-fault-parity`) ✓; `corpus-mutation` 4 timeouts on untouched fixtures.

No mission rows touched.  M-T9.42's count (T9 "20 of 42") is the coordinator's to re-derive: this
branch adds `unique-conflict`, the domain-service workflow tiers and the own-state money arm as
runtime-carried scenarios, with the other backends' string copies still to delete once CI confirms.

# Wave C3F · packet F5 — audit & principal cluster

Branch `claude/c3f-f5`, cut from `main` @ `e389606bb` (after #3093 and #3110). Re-run of a
packet whose first run was lost with its container; every item was re-verified on this base
before it was fixed.

Open PRs checked first: **#3160** (absent claim → `null`) is merged and touches nothing here.
**#3103** / **#3131** (system principal; event origin) are open and edit every backend's
`auth-emit` — this packet edits no `auth-emit` file. Their one overlap with this packet is
elixir's `Process.put(:loom_current_user, user)`, which #3103 makes unconditional; this packet
reaches the same effect from the CALLER (`vanilla/index.ts` passes `hasFieldMask: true` for an
audited context too), so the two merge textually clean, and once #3103 lands the caller-side
condition is merely redundant.

## Item → outcome

| item | outcome | fix (root cause) |
|---|---|---|
| **D1** audit `actor` diverges four ways under auth | **fixed** — RS-39 minted | Every backend records the principal projected onto the declared `user { … }` fields, by declared name — the `/api/auth/me` body — or null. node: a new `audit/actor.ts` `auditActor()` (it stored the principal object, i.e. the dev stub's merged claim bag); .NET: `RequestContext.PrincipalJson()` serialises a declared-name dictionary (it serialised the `User` record: PascalCase + computed tenancy members); java: a per-service `auditActor()` `LinkedHashMap` (Jackson record introspection); python: `app/db/audit.py` `audit_actor()`, read inside `record_audit` (no call site passed an actor → null); elixir: `Audit.record/2`'s `actor/0` over the plug-stashed principal (it carried only `%{id: …}`). |
| **D2** elixir: aggregate-wide `audited` writes no row for the crudish update | **fixed** | `update_<agg>` was a bare `defdelegate` to the repository's field update, which skips the op body where every other operation stages audit. When the `update` op is audited the context now emits a `def` that runs the repository update and `Audit.record/2` in one `Repo.transaction` — the seam both the REST action and the LiveView edit form call (`vanilla/context-emit.ts`). |
| **D3** java: audited + `stamp` datetime → create 500 | **fixed** | `jpa.save` of an assigned-id entity MERGES and returns a managed copy; only the copy carries the persist-time `@CreatedDate`/`@LastModifiedDate` stamps. The audited create projected the un-stamped original (`createdAt().truncatedTo` on null). It now snapshots `var __saved = repository.save(aggregate)`; events stay on `aggregate` (`java/emit/service.ts`). |
| **D4** `mask unless` without auth validates clean, then fails downstream | **refused at validation** — `loom.field-mask-principal-without-auth` | An honest gap, not a runtime fix: docs/auth.md defines the predicate as a caller check over `currentUser` only, and with no auth there is no principal — the field could only ever read `null`. It is the read-side sibling of three existing refusals of the same class (`loom.guard-principal-without-auth`, `loom.stamp-principal-without-auth`, `loom.context-filter-no-principal`), so it lives beside the guard rule in `ir/validate/checks/principal-guard-checks.ts` and shares its `readsPrincipal` (both the resolved and the unresolved `currentUser` spelling). Documented in docs/auth.md's diagnostic table; code-docs anchor; firing-census entry. |
| **D9** python auditable `updatedBy` is "" on a fresh row | **fixed** | `_stamp_on_create` applied the create set only, so the update-only columns kept their empty defaults. A fresh row is now stamped with the create ∪ update set (a create assignment wins on a shared field) — what node's `stampInsert` and JPA's persist-time auditing already do. One helper, `pyStampAssignments`, shared by the aggregate emitter and the routes builder (which threads `current_user` by it). |
| **3c #2** audit-history 403 `detail` spelled three ways | **fixed**, census RATCHET waiver deleted | The history read is the derived find `history`, so its refusal carries the declared-find detail `Forbidden: find history` on all five (node and python answered bare `Forbidden`, elixir `Forbidden: history <Agg>`). `test/conformance/authz-status-census.test.ts`'s ratchet block is now a positive five-way assertion; `HISTORY_DETAILS` in `test/ir/authz-emitted-census.ts` narrowed to the one spelling. |

No mission minted: nothing in the six items is left open.

## Witnesses (fixtures + goldens, node-minted)

- `field-mask.ddd` — its e2e now reads the trail (`api.employees.history(e)`: three entries,
  the crudish update's masked changes DROPPED, only `name` visible). Its golden pins each
  entry's `actor` = `{ id, permissions: ["ops.manage"], role: "agent" }` — the dev-stub claims
  carry `tenantId`/`orgId`, which the `user` block does not declare, so the raw-claim-bag shape
  fails it. (D1, D2)
- `audit-history.ddd` — `Order implements timestamped` (`stamp onCreate/onUpdate` datetimes):
  the audited create must 201, and no trail entry names a stamp column. The fixture header's
  "could NOT be promoted" paragraph is replaced. (D3; null actor without auth)
- `stamps-principal.ddd` — a second context `Journal` with `Note with crudish, auditable`:
  `updatedBy == createdBy` on the fresh row, and after an update. (D9)
- RS-39 in `test/conformance/semantics-rules.ts` + `docs/conformance-semantics.md` +
  `semantics-spec.json`; docs/audit.md's `actor` row.

**RS number:** RS-39 was the next free id on this base. Packet F4 is told to mint an RS rule for
the message-less default (`D-MESSAGELESS-DEFAULT`); whichever folds second renumbers (the
registry's gap-free gate will say so).

## Mutation proofs (seeded by file copy, restored by file copy, `git status` clean after)

| fix | seed | what failed |
|---|---|---|
| D1 node | `auditActor()` returns the principal object | node behavioural `field-mask`: `#8 GET /api/employees/{id}/history at $[0].actor.orgId — golden (absent) ≠ node "<volatile:key>"` (+ `tenantId`, all three entries) |
| D1 python | `record_audit` sets `actor = None` | python behavioural `field-mask`: `#8 … at $[0].actor — golden {"id":…,"permissions":["ops.manage"],"role":"agent"} ≠ python null` (×3) |
| D9 python | `pyStampAssignments("create")` returns the create set only | python behavioural `stamps-principal` api tier: `expected "" to be "admin"` |
| D3 java | `__after = OrderResponse.from(aggregate)` | java behavioural `audit-history`: `POST /api/orders → 500 : {"detail":"internal",…}` — the api tier fails before the wire leg |
| D2 elixir | the audited `update_<agg>` seam back to the plain `defdelegate` | elixir behavioural `field-mask` api tier: `expected 2 to be 3` (the trail count — no row for the update) |
| D4 | the mask arm skipped (`… \|\| true) continue`) | `test/ir/guard-principal-without-auth.test.ts`: `rejects it when the system declares no auth at all`, `… HAS auth but this deployable opts out`, `names the masked field and the remedy` |
| 3c #2 | python history gate back to `ForbiddenError("Forbidden")` | `authz-status-census.test.ts` › `every backend's history gate answers \`Forbidden: find history\`` — the diff names `python` |

## Runtime evidence (booted, golden-compared)

Postgres 17 in docker (`f5-pg`, :55435); host toolchains lifted from the images
(`/opt/jdk25` + `/opt/gradle-9`, `/opt/dotnet10`, `/opt/elixir-toolchain`).

| leg | field-mask | audit-history | stamps-principal |
|---|---|---|---|
| node (`run.mjs`, PGlite) | ✓ golden (minted) | ✓ golden (minted) | ✓ golden (minted) |
| python (`run-python.mjs`) | ✓ matches | ✓ matches | ✓ matches |
| dotnet (`run-dotnet.mjs`, EF) | ✓ matches | ✓ matches | ✓ matches |
| java (`run-java.mjs`) | ✓ matches | ✓ matches | ✓ matches |
| elixir (`run-elixir.mjs`) | ✓ matches | ✓ matches | ✓ matches |

Not booted here (CI confirms against the same goldens): dapper, mikroorm.

## Fence crossings

- `test/fixtures/corpus/{field-mask,audit-history,stamps-principal}.ddd` and their three
  goldens — the witnesses for the items.
- `src/platform/hono/v4/workflow-builder.ts` (one actor line + its import) — the node audit
  write inside an inlined workflow op-call is an audit emitter.
- `src/generator/python/emit/aggregate.ts` (the stamp-set helper) — the python stamp emitter.
- `docs/new-plan/T9-toolchain-health.md` — one sentence closing the 3c #2 note.

## Gates (this branch)

- `npx tsc -b` ✓ · `node scripts/test-typecheck.mjs` ✓ · `npx biome ci .` ✓ (0 errors).
- Touched + related unit suites — every `*audit*`/`*stamp*`/`*mask*`/`*principal*`/`request-context`
  test file (61 files) + the authz/override status censuses + `authz-emitted-census` +
  `semantics-rules` / `semantics-spec-sync`: 66 files, 703 tests ✓ (after re-pinning
  `vanilla-audit.test.ts`'s "the snapshot projector never reads the principal" to the
  `Audit.Wire` module — the sink's `actor/0` now does, by design).
- `npx vitest run test/system test/ir --maxWorkers=2`: 7073 passed; the 4 failures it showed
  were all fixed or load-induced and re-run green: `api-caller-census` (field-mask's
  `history` call pinned in `UNATTRIBUTED_CALLS` beside audit-history's; stamps-principal's
  `Note` list/destroy now called by the e2e), `wire-contract-divergence` (two new A1 rows —
  `Order implements timestamped`, `Note with auditable` — new-fixture witnesses of the same
  capability-injected-field class, not regressions), and
  `e2e-fixture-validation › elixir-vanilla-build` (a 120 s timeout at load average ~45; every
  fixture in the leg parses with 0 errors, and the suite passes with `--testTimeout`).
- Behavioural legs: table above (node, python, dotnet, java, elixir × the three witnesses), the
  final `stamps-principal` golden re-checked on all five after its last edit.
- Mission counts not touched (no mission row added).

# Wave C3 — packet 3d (corpus promotion + evaluated value table) hand-off

*Branch: `claude/c3-promote`, base `7d8b26a0c`. Thirteen commits, `534983390` … `028fb420a`, plus this
note. Test-only: no `src/` file is changed. Nothing pushed, no PR opened.*

## Headline

- **M-T9.42 reads 20 of 42.** 19 scenarios were promoted in this wave; `temporal` had already landed.
  Each promoted scenario is a fixture, a manifest row, a `test e2e` block that asserts values, and a
  node-minted wire golden verified on all seven legs (node, mikroorm, python, dotnet, dapper, java,
  elixir). Only after that were its string copies deleted.
  - About 234 per-target `it` blocks were deleted, including 4 whole files.
  - `test/generator` shrinks by about 2,300 LOC net (−3,403 / +1,099). The +1,099 includes the
    M-T9.43 harness.
  - Every deleted claim is listed below, with a named kept claim for each one no runtime tier carries.
- **M-T9.43 is `done`, on four backends** (node, python, java, dotnet).
  - The evaluated table fails exactly the mutated backend in 12 of 12 seeded mutations.
  - The string tables it replaces caught 9 of the 12.
- **M-T9.52 is `done` as a decision: the boundary stays.** Measured on both sides, a verifier at
  `generateDotnetForContexts` catches **0** tests that the wrapper's verifier does not already catch.
- **Promotion found 25 defects (D1–D25). All were handed off with a repro; none was fixed** (the
  packet is test-only).
  - Six of them are claims that a deleted-or-kept string test pinned *as broken code*. The worst case
    is D20: `hono-workflow-own-state-assign.test.ts` pins `state.total.minus(...)`, and that line
    throws at run time on a reloaded row.

## M-T9.42 — the promoted scenarios

"Carried" means that a seeded defect in the emitter fails the named assertion, on node, against the
committed golden. Every row is green on all seven legs.

| # | scenario | fixture · manifest | e2e claim (values) | golden | commit |
|---|---|---|---|---|---|
| 1 | `temporal` | `corpus/temporal` (pre-wave) | — | `temporal.json` | pre-wave |
| 2 | `audit-history` | `corpus/audit-history` (extended) | second Order's trail by `target_id` (2 not 5); soft-deleted Memo's history 404 | `audit-history.json` | `534983390` |
| 3 | `provenance` | `corpus/provenance` (extended) | self-referential `adjust(delta)` lineage: snapshot is the pre-write value (100, not 105) | `provenance.json` | `7e7961350` |
| 4 | `projection-groupby` | `corpus/projection-groupby` (existing golden) | deletion-only: the booted golden already carried them | existing | `78dfc1d10` |
| 5 | `field-mask` | `corpus/field-mask` (existing golden) | deletion-only | existing | `cd1597273` |
| 6 | `seed` | `corpus/seed-values` + `Meetup` | datetime, `datetime?` and a VO with an omitted optional, read back after boot seeding | `seed-values.json` | `61d56a47b` |
| 7 | `stamping` | **new** `corpus/stamps-principal` + row | `createdAt`/`createdBy := currentUser.id` capability stamps, a context stamp `ownerRole := currentUser.role`; update leaves create stamps alone | `stamps-principal.json` | `61d56a47b` |
| 8 | `render-expr-kinds` | M-T9.43 value table (below) | 46 rows × 4 backends, evaluated | n/a (unit tier) | `e687f1987` |
| 9 | `lifecycle-audit` | `corpus/audit-history` + `Invoice` | create audited (before null, after the wire), destroy audited, `pay` not audited → 1 row | `audit-history.json` | `9f653cb3a` |
| 10 | `intrinsic-trim` | **new** `corpus/intrinsics` + row (`doc: stdlib`) | derived `trim`/`trim().toLower()`/money `round(0)` (18.50→19)/`abs`; column-side `trim`/`toLower`/`floor`/`abs` finds; a criterion | `intrinsics.json` | `a104e7fb7` |
| 11 | `generator` (.NET batch) | carried by every booted .NET/Dapper leg | GET-all routing, `where`→LINQ, CQRS per op, validators, `ValidationBehavior`, `Program.cs`/csproj wiring | existing | `a104e7fb7` |
| 12 | `message-clause` | `corpus/validation-messages` (extended) | messaged invariant tripped on create → 422 with text, code and pointer | `validation-messages.json` | `0eadb0490` |
| 13 | `projection` | `corpus/projection` (extended) | the folded projection's LIST route (one row, "Shipped") beside by-key | `projection.json` | `95107ab0f` |
| 14 | `workflow-instances` | `corpus/eventsourced-workflow` (extended) | ES saga instances LIST (1) and by-key (paid 0, cancelled true); the absent-key probe answers 404 | `eventsourced-workflow.json` | `95107ab0f` |
| 15 | `query-projection-join-missing` | `corpus/datetime-wire` (extended) | an absent joined STRING member reads `null`, like datetime/int | `datetime-wire.json` | `95107ab0f` |
| 16 | `workflow-own-state-assign` | `corpus/saga` + `corpus/workflow-create-state` (extended) | event-started create `attempts := 1; += 1`, reactor `+= 1` → instance 3; command create and reactor `retries` 1 then 2 | `saga.json`, `workflow-create-state.json` | `78c72ca1c` |
| 17 | `saga-starter-guard` | `corpus/eventsourced-workflow` + `ArchiveTracker` | `create` AND `on` for one event: archive → 1, archive → 2 (never 3) | `eventsourced-workflow.json` | `78c72ca1c` |
| 18 | `tenancy-registry-self-scope` | `corpus/tenancy-owned` (extended) | registry bootstrap create 201; by-id 404 and list empty under the non-uuid claim, never 500 | `tenancy-owned.json` | `78c72ca1c` |
| 19 | `wire-numeric-ingress` | **new** `corpus/wire-ingress` + row | malformed money on an op param → 422, `/newPrice`, `Invalid decimal: "…"` on all seven; controls | `wire-ingress.json` | `78c72ca1c` |
| 20 | `document-capability-filter` (non-principal arm) | `corpus/document` + `Draft` | `filter !this.archived` in-app: shelved draft by-id 404, list 1, custom `byTitle` 1 (capability narrows first); update/destroy through the scope | `document.json` | `bb7b04b48` → `028fb420a` |

Census follow-through (`test/ir/api-caller-census-pins.ts`): each instance, projection-list and
history read is pinned as a not-lifted workflow/read-model route. Three tenant-registry pins are
drained (`tenantRegistryRow` 23 → 20). The two ratchets were kept exact:
- `legacy-generate-path-ratchet`: TS intrinsic-trim 7 → 5, dotnet 3 → 1, generator-dotnet 66 → 58,
  and two `PARSE_STRING_ALONGSIDE` entries dropped;
- `direct-generate-systems-ratchet`: two stale pins dropped.

`generator-dotnet.test.ts` before/after: **66 → 58 pinned sites** (8 tests deleted).

## M-T9.42 — tests deleted, and the claim each carried

Line ranges are pre-edit, per commit. "Kept" names each claim that stays string-only, and why.

**audit-history (`534983390`)**
- Deleted:
  - `test/generator/audit-history-node.test.ts:113-131` — reachability scope
  - `dotnet/audit-history-dotnet.test.ts:59-64` — serves the route
  - `dotnet/audit-history-dotnet.test.ts:107-125` — snapshot indexes
  - `dotnet/audit-history-dotnet.test.ts:127-145` — key casing
  - `dotnet/audit-history-dotnet.test.ts:188-198` — reachability
  - `elixir/audit-history-elixir.test.ts:68-75, 156-168`
  - `java/audit-history-java.test.ts:53-60, 127-139`
  - `python/audit-history-python.test.ts:52-57, 107-116`
- Kept:
  - `target_type` discriminator (unobservable with uuid ids)
  - mask DROP
  - fail-closed unauthenticated
  - gate 403 (3c ladder)
  - stamp/version key loop (java 500, D3)
  - RS-4 `at` (the golden normalises timestamps)
  - no-history-when-unaudited
  - Elixir OpenAPI PathItem, LiveView seam, python Protocol/imports, dotnet port layering

**provenance (`7e7961350`)**
- Deleted:
  - `elixir/vanilla-provenance.test.ts:88-93, 95-110, 112-121, 225-238` — column, capture, self-ref,
    update recapture
  - `java/java-provenance.test.ts:78-88, 102-111, 113-123, 144-159`
  - `python/python-provenance.test.ts:117-122, 124-135, 137-146, 165-186, 202-210`
- Kept:
  - transactional flush (×3)
  - `provenance_records` model and indexes
  - SDK internals (ContextVar, logger, governance stamps)
  - the gated no-op

**projection-groupby (`78dfc1d10`), deletion only**
- Deleted:
  - hono `46-54, 63-67, 69-71, 73-87, 89-94`
  - python `57-62, 64-68, 77-84, 86-98`
  - dotnet `73-81, 83-97, 99-115, 117-137, 166-172`
  - java `80-89, 91-106, 108-113`
  - elixir `67-77, 79-87, 89-94, 98-116, 133-137`
  - datekey `65-75, 77-82, 84-91, 110-117, 119-131, 140-148, 150-153, 157-164, 166-179`
- Kept:
  - no-repo-load (hono, python, dotnet, java)
  - java single-column bare scalar
  - every gate
  - python has no read-model table
  - java/elixir normaliser only when needed

**field-mask (`cd1597273`)**
- Deleted:
  - dotnet `77-85, 143-151, 153-164`
  - java `92-99`
  - python `77-83, 85-96`
- Kept:
  - fail-closed null-principal arms (×4)
  - audited snapshot UNMASKED
  - Elixir plug stash
  - java imports
  - python helper detection

**seed + stamping (`61d56a47b`)**
- Seed deleted:
  - `dotnet-seed 53-74, 91-97`
  - `hono-seed 59-78, 80-113, 115-145`
  - `generator-java-seed 49-55, 57-61, 126-159`
  - `python-seed 32-41, 43-68, 93-101`
- Seed kept:
  - ship-once marker
  - `LOOM_SEED` gating
  - raw explicit-id / schema-qualified / Dapper DDL
  - ES seed
  - legacy per-context dotnet
  - seed-less omission
  - hono `index.ts`/`package.json` wiring
- Stamping deleted:
  - `dotnet-stamping 64-92, 109-144, 146-190`
  - `elixir-stamping 72-99`
  - `hono-stamping 169-182`
  - `python-stamping 48-55, 65-74, 87-113`
- Stamping kept:
  - `private set`
  - the no-auth and ES gates
  - the elixir changeset does not cast `created_by` (client injection)
  - elixir drops `timestamps()`
  - claim nil-safety
  - hono entity purity and the `save()` version guard
  - python `updated_by` (D9)

**render-expr-kinds (`e687f1987`)**
- Deleted:
  - python `render-expr-kinds` 12 arms: count/length, trim, case, substring, sum without selector,
    `&&`/`||`, `!`/unary −, money native, ternary, match, int/int widening
  - java 14 arms: trim, substring, int sum, int comparison, string equals, concat, money methods,
    boxing, money `compareTo`, decimal remainder, match chain, unary −, int/int divide, divTrunc
- Kept:
  - python `trunc_div` (the >2^53 long no row holds)
  - `contains` parenthesisation
  - `firstOrNull`
  - java array `.count`/`.length`
  - the A2 string batch
  - money-sum reduce
  - collection transforms
  - decimal negate

**lifecycle-audit (`9f653cb3a`)**
- Deleted:
  - dotnet `46-55`
  - java `44-58, 60-63, 65-74`
  - python `42-49, 51-53, 55-64`
- Kept:
  - destroy-audit before/after (the row is gone, so unobservable)
  - dotnet "staged in the save tx"

**intrinsic-trim + generator (.NET) (`a104e7fb7`)**
- intrinsic-trim deleted:
  - ts `26-29, 31-35, 37-42`
  - dotnet `26-29, 31-35, 37-41`
  - java `44-47, 49-54, 56-60, 74-85`
  - elixir `52-55, 57-66, 68-76, 143-150, 152-159`
  - python `45-48, 50-61, 63-68, 122-126, 128-133, 182-191, 193-204`
- generator-dotnet deleted:
  - `312-321` auto GET-all
  - `336-342` where→LINQ
  - `344-355` CQRS per op
  - `1750-1765, 1781-1791` validators
  - `1811-1819` ValidationBehavior
  - `1821-1831` Program.cs
  - `1833-1842` csproj refs
- Kept:
  - value-side trim on five backends (D15)
  - TS A2 substring/toUpper/split and A3 math
  - python A3 and value-side round
  - elixir A3 (7)

**message-clause (`0eadb0490`)**
- Deleted:
  - hono `53-58, 65-73, 87-96, 100-108, 110-115, 117-120`
  - dotnet `75-84`
  - elixir `103-108`
  - java `61-70`
  - python `67-76` (the domain floor rides `corpus/domain-floor-messages`)
- Kept:
  - every check-carrier test (D16)
  - the message-less native chain
  - elixir cross-field `loom_code` metadata
- `vo-invariant-422` was tried and restored (D17).

**projection, workflow-instances, join-missing (`95107ab0f`)**
- Projection deleted:
  - `elixir/vanilla-projection` fold handler, dispatcher fan-out, read routes
  - `java/generator-java-projection` repo, `@EventListener`, routes, DTO
  - `python/python-projection` fold, routes, mount
- Workflow-instances deleted:
  - `dotnet-workflow-instances` DTO and controller
  - `elixir/vanilla-workflow-instances`: schema, controller, routes, stream-fold routing, bare list
  - `java-workflow-instances`: record, controller, JdbcTemplate LIST fold, byId fold + 404, accessors
  - `python-workflow-instances.test.ts` — **file removed**, 7 tests
  - `hono-workflow-instances`: DTOs, routes, `loadAll` fold, byId fold, fold helpers once, DTO
- Join-missing deleted: the string/datetime/source-row guard tests in dotnet, java, python and ts.
- Kept:
  - every decimal/money join arm (D19)
  - nullable non-key read-model rows
  - additivity / no-correlation negatives
  - OpenAPI wrapper/customizer pins
  - node's uuid byId param

**own-state, starter guard, registry self-scope, wire ingress (`78c72ca1c`)**
- Own-state deleted:
  - hono `35-44, 79-85`
  - dotnet `34-41, 43-49, 84-91`
  - elixir-vanilla `34-41, 71-78`
  - phoenix `93-104`
  - java `43-47, 49-53, 94-99`
  - python `34-39, 74-79`
- Own-state kept: every money `-=` arm (D20/D21); phoenix's final-write bare call (the elixir leg
  does not compile with `--warnings-as-errors`).
- Starter guard deleted:
  - hono `61-73, 75-82`
  - dotnet `59-75`
  - elixir `58-73`
  - java `52-68`
  - python `66-77, 79-86`
- Starter guard kept: every unpaired byte-identical negative (×5).
- Registry self-scope deleted:
  - `hono/tenancy-registry-self-scope.test.ts` — **file removed**, 3 tests
  - `elixir/vanilla-tenancy-registry-self-scope.test.ts` — **file removed**, 3 tests
  - `python/generator-python-tenancy-registry-self-scope.test.ts` — **file removed**, 3 tests
  - dotnet `87-95`
  - java `49-53, 55-59, 67-79`
- Registry self-scope kept:
  - dotnet `HasQueryFilter` hoist + per-request DI (one principal cannot see static baking)
  - guid-claim no-parse (dotnet, java)
  - java Criteria accessor
  - java entity free of `@SQLRestriction`
  - `docs/tenancy.md` now names the runtime gate.
- Wire ingress deleted:
  - dotnet `114-124` filter envelope
  - java `79-84` advice envelope
  - python `59-77` same-message
  - elixir `48-56` with-chain guard
- Wire ingress kept: grammar char-for-char (java, python, elixir), create/update/VO/workflow-param
  guards (D22, D24, D25), int guards (D23), strict numeric, CA1720, 422-declared.

**document-capability-filter (`bb7b04b48`, relocated in `028fb420a`)**
- First landed on `corpus/tenancy-filter` with a principal filter too. The full suite then showed
  that an authenticated principal filter mints `tenancy` gates, which `authz-gate-census` (3c's
  `test/ir/authz-*`) requires a refused caller or a pin for. So the promotion moved to
  `corpus/document` (no auth) with the non-principal arm only, and the principal-arm deletions were
  restored.
- Deleted: ts `42-47, 55-61, 63-67` — the non-principal by-id gate, list narrowing and
  filter-before-find.
- Kept:
  - node slice B (principal) entirely
  - all python arms (their assertions pin the combined principal and non-principal predicate)
  - `findManyByIds` (no route reaches it)
  - the byte-identical negative
  - every elixir arm (policy ladders and bypass: packet 3c's surface)
- **Hand-off to 3c:** promoting the principal arm needs `AUTHZ_LADDERS` probes or `AUTHZ_GATE_PINS`
  for a document aggregate on an authenticated fixture.

## M-T9.42 — the unpromoted rows

The audit's list of 42 was never committed. Recomputing it on this base, with the same rule
(scenario name duplicated across ≥ 3 target test dirs), gives **71** names. The rule also counts
frontend-only and `test/ir`/`test/language` copies, which the audit's count evidently did not.
Every name that was not promoted has a reason below.

- **Frontend (no api-tier `test e2e` can carry it; the corpus is a backend matrix):**
  data-grid, realtime, extern-functions, dynamic-sub-form, table-filter, auth-ui-emit,
  page-requires-gate, table-sort, table-pagination, extern-components, walker-for.
- **Frontend + LiveView (the same reason; the HEEx half is not driven by the e2e tier either):**
  i18n-runtime, store, projection-read, user-components, chart, variant-match-await,
  table-controls, menu-link-gate, page-derived, operation-button-gate, named-actions, action,
  error-boundary, modal-state-controlled; sourcemap (a `.loom/` artefact, not a wire claim).
- **Blocked by a defect this wave found:**
  - unique-conflict (D5–D7: the constraint is missing on Dapper, MikroORM and the node oracle)
  - vo-invariant-422 (D17)
  - domain-service-reading, domain-service-emit, domain-service-mutating (D18: MikroORM 500s every
    `transactional` workflow in `corpus/domain-services`)
- **Blocked by harness capability:**
  - concurrency-conflict (the e2e cannot send `If-Match`)
  - eventsourced-conflict (needs a concurrent append race)
  - timer-scheduler (clock-dependent; needs a freezable harness clock, the `R.clockDependentFind`
    class)
  - filter-bypass (two principals, #2976)
  - channels-transport, channels-kafka, channels-rabbit (brokers; `channels-e2e` owns them)
  - realtime-emission (no subscribe verb)
  - file-upload (the golden only drives the absent-file probe; no multipart body)
- **Owned elsewhere:**
  - explicit-handlers (waits on #3024's handler-route addressing)
  - find-gate (the authz ladder, packet 3c)
  - migrations-emit (`migration-evolution-e2e` owns schema evolution; one boot cannot)
  - api-client (register of external-`api` clients; no runtime peer in the harness)
- **Not runtime-observable:**
  - access-modifiers (compile visibility)
  - test-placement-subjects and context-integration-test (which emitted test file a block lands in)
  - api-surface-render and response-contract (spec shape; `conformance-parity` diffs the specs)
- **Not attempted this wave (candidates for the next batch):**
  - workflow-event-sourced (its fold/append arms likely ride `corpus/eventsourced-workflow` already)
  - query-projection-capability-filters (`corpus/projection-agg-filters`)
  - query-projection-document-source (`corpus/projection-document-aggregation`)
  - resource-ops (object-store/queue resources)
  - the rest of `generator` (java/react/svelte/ts copies)
  - the money arms of workflow-own-state-assign, which wait on D20/D21

## M-T9.43 — the evaluated value table

- **Files:**
  - `test/generator/_expr/expr-value-table.ts` holds 46 `ValueRow`s, each an `ExprIR` and its
    expected value.
  - Named divergences, rather than silent skips:
    - `string_substring_astral` diverges on python (D10);
    - `string_upper_eszett` diverges on dotnet (D11).
  - `test/generator/_expr/expr-value.test.ts` renders every row through each backend's REAL
    renderer, runs one program per backend and compares values.
- **How each backend runs:**

  | backend | how it evaluates |
  |---|---|
  | node | in-process; `decimal.js` resolved from `test/behavioral` |
  | python | `python3` with the EMITTED `NUMERIC_PY` |
  | java | single-file launch, imports from `collectJavaExprImports` |
  | dotnet | file-based `dotnet run`, with hand-rolled JSON because reflection JSON is off |

- **Vacuity guard:**
  - A missing toolchain skips that backend unless it is named in `LOOM_EXPR_VALUES_REQUIRE`.
  - On CI, python and java are required.
  - Every backend that does run must answer every row.
- **Mutation proof: 12 mutations**, three per backend, each file restored by copy.
  - The mutations: `&&`→`||`, `divTrunc`→float division, and money `+` via float/rounding.
  - The value table failed **exactly the mutated backend 12/12**.
  - The string tables caught 9/12: `&&`→`||` passes the TS, java and .NET string tables.
  - The reverse case: a value-preserving respelling of TS `divTrunc` FAILS the string table and
    passes the value table. That is the false positive this shape removes.
- **Hand-off recipe for the remaining two:**
  - **elixir:** `src/generator/elixir/render-expr.ts` exists. The harness needs `elixir -e` with the
    `decimal` hex dependency on the code path (the local toolchain is at `/opt/elixir-toolchain`;
    `Mix.install([:decimal])` needs the hex mirror in `docs/tools.md`). Write one `def rNN` per row,
    `IO.puts` `id\ttype\traw`, and add `"elixir"` to `ValueBackend`.
  - **node on CI:** add `decimal.js` to the fast-suite job (or `npm ci` in `test/behavioral`) and
    add `node` to CI's required set.

## M-T9.52 — decision: the boundary stays

- **Method:** seed M-T9.40's `enumName: undefined` at the context-local enum-value arm of
  `src/ir/lower/lower-expr.ts`, then run the seven `generateDotnetForContexts` importers:
  - `dotnet-find-gate`
  - `dotnet-schema-id-collisions`
  - `dotnet-tph-capability-filter`
  - `dotnet-tph`
  - `field-mask-dotnet`
  - `generator-dotnet`
  - `legal-model-did-not-compile`
- **Results:**
  - **Without** a verifier at the entry: 41 failed / 104. All 41 are in `generator-dotnet`, via the
    `generateDotnet` wrapper's verifier (82 "IR verification failed" messages).
  - **With** a temporary `assertLoomModelVerifies` at the `generateDotnetForContexts` entry: 41
    failed / 104, the identical set.
  - **Previously-silent tests that now fail: 0.** The other six importers gained nothing.
  - Unmutated with the verifier in place: 104 / 104 passed, so a verifier there would cost nothing
    but also add nothing.
- **Why the boundary stays:**
  - The `ForContexts` entry is what `src/system/` calls in production, where
    `generateSystemFiles`/the CLI already verify.
  - The choice is symmetric with Hono, whose ratchet gates `generateHono`, not
    `generateTypeScriptForContexts`.
  - The measurement shows the wrapper already carries the whole catch.
- The script is `mt952.py` (scratch); the temporary verifier was reverted by file copy.

## Mutation proofs (all node, compare mode, restored by file copy)

| promotion | seeded defect | failing assertion |
|---|---|---|
| audit-history target pair | drop `target_id` from the trail filter | `otherTrail.count()` "expected 5 to be 2" |
| audit-history reachability | skip the soft-deleted 404 | `memos.history(...).toThrow(404)` "expected the call to reject" |
| provenance | `wrapProvCapture` snapshots after the write | "expected 105 to be 100" |
| stamps-principal | `updateStampEntries` += create entries | `createdAt` changed on update |
| stamps-principal | claim stamp reads `actorId` | "expected admin to be agent" |
| seed | drop the `new Date(...)` coercion | boot fails "value.toISOString is not a function" |
| lifecycle-audit | `routes-builder.ts` audits every public op (drops `o.audited`), so `pay` writes a row | "expected 2 to be 1" |
| intrinsics | `pg-intrinsics.ts` `string.trim` renders the bare column (no `btrim`) | `exact.count()` "expected 0 to be 1" |
| validation-messages | `zod-refine.ts` drops the `loomCode` param | node wire key-set divergence |
| datetime-wire join | absent join fills "absent" | "expected absent to be null" |
| eventsourced instances | `loadAll` fold sliced | `running.count()` "expected 0 to be 1" |
| projection list | list sliced | `boards.count()` "expected 0 to be 1" |
| own-state compound | compound loses its read-back (`lower-workflow.ts`) | saga "expected 1 to be 3"; workflow-create-state "expected 1 to be 2" |
| starter guard | hono starter `if (false)` | second archive "expected 3 to be 2" |
| registry self-scope | raw claim bind | `getById(org)` "…→ 500… to match /→ 404/" |
| wire ingress | node money message drifts | node wire divergence ×2 at `$.errors[0].message` |
| document filter | node document by-id gate removed | `getById(shelved).toThrow(404)` "expected the call to reject" |
| M-T9.43 | 12 leaf mutations | see above |

## Defects handed off (not fixed; test-only packet)

Each is reproducible from the named fixture plus the named line.

| id | backend | defect | repro |
|---|---|---|---|
| D1 | node/.NET/python/java | the audit `actor` JSON diverges four ways under auth: node sends the raw claim bag, .NET PascalCase, python null, java camelCase | `corpus/field-mask` + `api.employees.history(e)` |
| D2 | elixir | aggregate-wide `audited` writes no row for the crudish update | same, count 2 vs 3 |
| D3 | java | audited aggregate + `stamp onCreate/onUpdate` datetime → create 500 (NPE projecting the un-stamped instance) | audit-history `Order implements timestamped` |
| D4 | .NET/java/python | `mask unless` without auth validates clean, then CS1061 / missing package / boot exit 1 | any mask on a no-auth deployable |
| D5 | Dapper | `unique(...)` not enforced (no index in `DbSchema.cs`); a duplicate create answers 201 | `unique-conflict.repro.ddd` |
| D6 | MikroORM | `unique(...)` not enforced | same |
| D7 | node oracle | the drizzle schema object has no uniqueIndex and `synthDDL` drops `unique`; no golden is mintable | same |
| D8 | .NET/Dapper | an aggregate named `Event` → CS0104 against `EventId` | seed-values with `aggregate Event` |
| D9 | python | auditable `updatedBy` is "" on a fresh row | stamps-principal + `auditable` Ticket |
| D10 | node/java/.NET vs python | `substring` counts UTF-16 units vs code points (lengths are code points everywhere) | value row `string_substring_astral` |
| D11 | .NET | `ToUpperInvariant` keeps ß | value row `string_upper_eszett` |
| D12 | .NET | a find param named `x` → CS0019 (EF lambda variable) | intrinsics `byFloorPrice(x: money)` |
| D13 | python | a message-less invariant 422 carries the "Value error," prefix and an empty pointer | intrinsics + name "   " |
| D14 | elixir | a whitespace-only string gives "can't be blank" before the invariant runs | same |
| D15 | MikroORM | a value-side intrinsic in a find (`q.trim()`) → 500 | intrinsics `where this.name == q.trim()` |
| D16 | elixir | a messaged check tripped by "" → 500 | validation-messages + `name: ""` |
| D17 | elixir | a messaged VO invariant 422 omits `errors[].code` | validation-messages `sku: { code: "G" }` |
| D18 | MikroORM | a `transactional` workflow → 500 | `domain-services.repro.ddd` |
| D19 | elixir | a joined `decimal` in a query-time projection serialised as the string "2.5" | datetime-wire + `fee: decimal` join |
| D20 | node | a saga money compound 500s: drizzle reloads numeric as a string and the fallback row is `"0"`, so `state.x.minus` is not a function. **`hono-workflow-own-state-assign.test.ts` pins exactly this spelling** | workflow-create-state + `credit: money`, reactor `credit -= money("2.50")` → `POST /orders/{id}/ship` 500 |
| D21 | MikroORM | a saga money field serialised without scale ("9.5" vs "9.5000") | workflow-create-state + `credit := money("10.00"); credit -= money("0.50")` |
| D22 | .NET + Dapper | a money "12,50" is ACCEPTED as 1250: `decimal.TryParse(…, NumberStyles.Number, …)` allows the invariant thousands separator. It is the very example `dotnet/wire-numeric-ingress.test.ts`'s header cites; the test pins `TryParse`'s presence, not its style | wire-ingress + `reprice(p, { newPrice: "12,50" })` → resolves |
| D23 | all | int32 range refusal has no contract: node 422 (zod text), python 422 (pydantic text), java and .NET **400** "Malformed JSON" | wire-ingress + `restock(n: 3000000000)` |
| D24 | elixir | a malformed money INSIDE a value object on create is accepted | wire-ingress + `best: { price: "1.2.3" }` |
| D25 | elixir | a malformed top-level money on crudish create/update answers Ecto's "is invalid", not `Invalid decimal: "…"` (the op-param path is right) | wire-ingress + create `price: "1.2.3"` |

Overlaps cited, not duplicated:
- #2976 (two-principal harness; filter-bypass)
- #2977 and #2978 (sibling C3 packets)
- #3024 (explicit-handlers)
- 3a's `E2E_LESS_CORPUS_FIXTURES` and `gate-ledger.test.ts`: untouched. No new fixture was added to
  the E2E-less register; each new fixture carries a block.
- 3c's `test/ir/authz-*`, `cases.mjs` and `test/conformance/**`: untouched.

## Local gates (on the branch tip, which contains `origin/main` `d2a0bc02c`)

See the results section appended at the end of this note.

### Results (branch tip `028fb420a` + this note)

| gate | result |
|---|---|
| `npx tsc -b` | exit 0 |
| `node scripts/test-typecheck.mjs` | OK — test/ and src/ clean |
| `npx biome ci . --diagnostic-level=error` | 3,415 files, 0 errors |
| `NODE_USE_ENV_PROXY=1 node scripts/mission-counts.mjs --check` | up to date (after `--write`: 164 live / 122 archived; T9 39 / 17; the M-T9.42 "outside the legend" status is gone) |
| `node scripts/ledger-counts.mjs --check` | `.md` matches the JSON |
| `node docs/build.mjs` | exit 0 |
| `npm test`, first full run | 4 failed. Three were real and fixed in `028fb420a`: `authz-gate-census` ×2 (the tenancy-filter placement) and `wire-contract-divergence` (the two A1 witnesses). One was `cli-tooling-truth` at a 33 s timeout, which passed alone (27/27). |
| `npm test`, second full run | **27,113 passed, 5 failed**. All 5 are `Test timed out in 30000ms` in files this branch never touched, on a box at load ≈ 14 whose files took ~20 min: `java-workflow-dispatch`, `heex-inline-emphasis`, `vanilla-eventsourced-applier-fold`, `feliz/workflow-instance-model-fields`, `elixir/domain-service-mutating`. **Re-run alone: 5 files, 33/33 passed.** |
| Behavioural legs | every promoted fixture green on node + the six non-node legs, all against the committed golden (run tags b3–b13) |

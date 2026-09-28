# Wave C5 · moment 5b — the second golden moment: F2-W-06 (RS-38), M-T1.11 (c), M-T3.16 C2

Branch `claude/c5-golden2`, base `f7a9866e2`. Six signed commits `cc41dd46c..` (this note is the last). `origin/main` has moved only by the C5 wave log since the base (`8202fb632`, #3055). It merges cleanly (`git merge-tree`).
Plan row: [`../wave-c5.md`](../wave-c5.md) §Packets, "5b the second golden moment".

**Verdict.** All three rows are **built on all five backends, golden-pinned, green on all seven behavioural legs, and mutation-proven.**

- **M-T1.11** and **M-T3.16** are closed: each row was the mission's last item. Both missions are archived.
- The three ledger rows are closed: open **118 → 115**, done **171 → 174**, P2 **3 → 1**.
- The conformance registry gains **RS-38**, and RS-34's .NET value-typed arm is closed.
- **No existing wire golden moves.** Two goldens are new (`datetime-wire`, `domain-floor-messages`). One gains two appended entries (`lifecycle-guard`, the C2 ladder surface).

| commit | content |
|---|---|
| `cc41dd46c` | F2-W-06: datetime in milliseconds on all five (RS-38); RS-34's value-typed arm; the narrowed normaliser; `datetime-wire` witness + golden |
| `99171d963` | M-T1.11 (c): the domain floor carries the rule's code on all five; `domain-floor-messages` witness + golden |
| `e033d2b4c` | M-T3.16 C2: elixir validates before the create gate; the `lifecycle-guard` ladder surface + golden entries |
| `4f3f61f78` | test re-pins the three rows moved; the widened witness |
| `b9fdf9df4` | docs: mission archives, ledger, counts, language-reference §07, `migrations.md` |
| (this) | this note |

---

## 1. Rows → outcome

### 1.1 F2-W-06: a `datetime` crosses the wire in milliseconds (RS-38, D-ABSENT-JOIN-DATETIME-WIRE)

Before this row, one stored instant had four spellings:

| backend | spelling |
|---|---|
| node | `…30.12Z` (every trailing zero trimmed) |
| .NET | same trim, through a regex |
| java | `…30.120Z` |
| python | `…30.120000Z` |
| elixir | `…30Z`: the column was `:utc_datetime`, second precision, so the client's fraction was **lost on write** |

The differential tier could not see any of it, because every ISO timestamp collapsed to one `<timestamp>` token.

The rule now:
- at most three fractional digits;
- exactly three when a fraction is present;
- none on a whole second (RS-4's `…00Z` survives);
- sub-millisecond input is **truncated at ingress, never rounded**, so `.9996` reads `.999`, not the next second.

| backend | egress | ingress |
|---|---|---|
| node | `canonicalIsoExpr` → `toISOString().replace(/\.000Z$/, "Z")`, `src/generator/typescript/repository-wire-builder.ts:139`; `/prepare`'s `now()` too, `src/platform/hono/v4/routes-builder.ts:1113` | a JS `Date` already holds ms |
| .NET | `csCanonicalInstantWire`, a `fff` format with `.000Z` trimmed, `src/generator/dotnet/dto-mapping.ts:140`; `CanonicalInstant.Format`, `emit/canonical-instant.ts:58`; audit `at` | `AddTicks(-(Ticks % TicksPerMillisecond))`, `dto-mapping.ts:498` |
| java | `javaInstantWire` → `truncatedTo(MILLIS).toString()`, `src/generator/java/emit/wire.ts:188`, used by DTO/element mappers, projection reads, audit history, channels, realtime | `WireFormatException.instant(...).truncatedTo(MILLIS)`, `emit/common.ts:207` |
| python | `iso()`: no fraction below 1 ms, else `timespec="milliseconds"` (which truncates), `src/generator/python/index.ts:1608` | `pyWireToDomain` → `replace(microsecond=µs // 1000 * 1000)`, `routes-builder.ts:818` |
| elixir | new custom Ecto type `Loom.Datetime` (`src/generator/elixir/vanilla/datetime-type-emit.ts`, emitted to `lib/<app>/loom_datetime.ex` by `shell-emit.ts:186`). It wraps `:utc_datetime_usec` and normalises to `{ms*1000, 3}` or `{0, 0}`, so `to_iso8601` / Jason print the canonical form. Every declared-datetime site maps to it: schema (incl. `created_at` / `updated_at`), document, value collection, changeset validators. The migration column is `:timestamptz` (`src/generator/elixir/migrations-emit.ts:861`). Stamps (`stamp-emit.ts:124`), op-param coercion (`context-emit.ts:259`), `force_change` (`context-emit.ts:1068` `__truncate_dt`), the dispatch fold and the projection group key all normalise through `Loom.Datetime.normalize` | the same type's `cast` |

**RS-34, the value-typed arm.** A query-time projection's joined member whose target is ABSENT is wire `null` on every backend. Before, .NET's `default!` read `0` for an `int`, java's unboxed row component 500'd, and python's non-nullable row model 500'd.

- The shared fact is `joinReadFieldNames(proj)` (`src/generator/_projection/join-read.ts`).
- **.NET** row members are nullable, with a `TryGetValue(…) ? (T)(v) : null` arm (`query-projection-emit.ts:330`).
- **java** row components are boxed (`query-projection-reads.ts:330`).
- **python** row fields are `T | None` and still required (`query-projections-builder.ts:296`).
- **elixir**'s follow load now applies the joined aggregate's capability filter (`query-projections-emit.ts:485`). Before, a soft-deleted join target was still joined, which the witness caught.

**Normaliser.** `test/_helpers/response-diff.ts:89` is now `ISO_DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.(?!000)\d{3})?Z$/`. It collapses only the two canonical spellings. `.000Z`, `.12Z`, `.120000Z` and `+00:00` now diverge instead of hiding.

**Registry.**
- RS-38 is minted: `test/conformance/semantics-rules.ts:1281`, with prose at `docs/conformance-semantics.md` §RS-38.
- RS-34 is flipped to five conforming backends, tier `behavioral` (`:1066`).
- The spec mirror is regenerated (`UPDATE_SEMANTICS_SPEC=1`).

**Witness.** `test/fixtures/corpus/datetime-wire.ddd` (manifest `:519`) and `test/behavioral/wire-golden/datetime-wire.json` (26 requests). Every value is asserted **as a string**, because the spelling is the contract:

| value | what it separates |
|---|---|
| `.120Z` | a trailing zero |
| `…30Z` | a whole second |
| `.9996Z` | truncation vs rounding |
| `.050Z` | through an operation parameter (elixir's `force_change` seam) |
| `.2509Z` | through update |

It also covers a soft-deleted join target (`venueOpenedAt` and `venueCapacity` both `null`), and every derived route has a caller (the api-caller census).

**Docs.** `docs/migrations.md` §"A column type that moved without a migration" covers what an existing elixir database needs (the ALTER recipe).

### 1.2 M-T1.11 (c): the domain floor carries the rule's `msg.<hash>` code

A MESSAGED `invariant`, field `check` or operation `precondition` that trips at the **domain floor** now answers on all five backends with the domain-floor 422 ("Unprocessable Entity", the message as `detail`). Such a rule reads aggregate state, so no wire validator sees it. The answer carries **one** `errors[]` entry `{pointer, message, code}`: the 5c value-object shape, through the 5c serializer seam.

- `code` is the wire rung's hash, so one catalog entry localises both rungs.
- `pointer` is `/<field>` for a single-field-shaped rule, else `""`.

Shared seam: `src/generator/_i18n/domain-floor.ts`:
- `hasDomainFloorMessages` `:42` (aggregate invariants, part invariants, and operation preconditions found by `walkStmtsDeep`);
- `hasDomainFloorAnswer` `:66`;
- `domainFloorCode` `:74`;
- `domainFloorPointer` `:80`.

The catalog (`validation-catalog.ts:93`) now holds every messaged rule either rung surfaces.

| backend | throw carries the code | answered by |
|---|---|---|
| node | `DomainError(message, code, pointer)` (`src/platform/hono/v4/emit.ts:187`); precondition throw via `TraceCtx.domainFloorCodes` (`src/generator/typescript/render-stmt.ts:299`); invariants (`emit/aggregate.ts:670`) | `domainFloorProblem` (was `valueObjectProblem`; one serializer for both refusals), in the route, workflow and explicit-handler `DomainError` arms |
| .NET | `DomainException(message, ruleCode?, pointer?)` (`emit/common.ts:25`); entity (`emit/entity.ts:736`); precondition (`render-stmt.ts:208`) | `domainFloorErrorsArm` template (`emit/api.ts:864`), shared by the VO arm and the new `DomainException dfe && dfe.RuleCode != null` arm (`:917`) |
| java | `DomainException` gains `ruleCode` / `pointer` + a 3-arg ctor (`emit/common.ts:94`); entity (`emit/entity.ts:831`); precondition (`render-stmt.ts:216`) | `domainFloorWithEntry` (`emit/api.ts:1025`); `onValueObjectInvariant` delegates to it; `onDomain` short-circuits when a code is present (`:1063`) |
| python | `DomainError(message, code=None, pointer=None)` (`emit/errors.ts:32`); aggregate raise (`emit/aggregate.ts:672`); precondition (`render-stmt.ts:138`) | `_domain_floor_with_entry` (`index.ts:1809`); `_domain` uses it when `err.code` is set (`:1991`) |
| elixir | a messaged precondition's denial is `{:precondition_failed, %{detail, code, pointer}}` (`vanilla/denial.ts:254`); a messaged invariant's `add_error` gains `loom_pointer:`, and the op persist runs the new `validate_domain_floor/1` (`vanilla/changeset-invariant-emit.ts:213`), which tags the errors it adds `loom_domain_floor` | `ProblemDetails` (`vanilla/problem-details-emit.ts`): the VO body sender also matches `loom_domain_floor` (`:238`); a new map clause of `problem_response/4` (`:442`) |

Elixir moves in two ways:
- A messaged invariant tripped by an operation used to answer the **wire** rung's shape ("Validation failed"). It now answers the domain floor like the other four.
- A messaged precondition used to answer `detail` only. That was the last divergence M-T6.20 recorded.

**M-T6.20 waiver.** M-T6.20 is already archived as done, and `WIRE_WAIVERS` is empty on this head. The T1 text claiming a remaining waiver was stale. The one behaviour it described (elixir's messaged precondition without a code) is the one this row closes.

**Witness.** `test/fixtures/corpus/domain-floor-messages.ddd` (manifest `:511`) and `wire-golden/domain-floor-messages.json`:

| entry | request | answer |
|---|---|---|
| #4 | `withdraw` | 422 "Insufficient funds", `errors: [{code: msg.p55wf6, pointer: ""}]` |
| #5 | `overdraw` | `msg.11ks9e`, pointer `/balance` |
| #6 | `deposit` | `msg.aim2kq`, pointer `""` (a two-field rule) |
| #7 | `drain` | a message-less rule: 422, **no** `errors[]` |

**Docs.** `docs/language-reference/07-invariants-derived-functions.md` §"A messaged rule at the domain floor" has the `.ddd` source and all five outputs.

### 1.3 M-T3.16 C2: the wire rung precedes the canonical `create` gate

| before | answer to a guarded create with an invalid body |
|---|---|
| node / .NET / java / python | 422: they validate at the route boundary, ahead of the handler that evaluates the gate |
| elixir | 403: Phoenix gated in the context before casting the changeset |

- **Fix.** `create_<agg>/2` first runs `Ecto.Changeset.apply_action(base_changeset(attrs), :insert)`, or `document_changeset` for a document aggregate. That is the same changeset the insert builds, run before `ensure/2`. It is in `src/generator/elixir/vanilla/context-emit.ts:740`, so both the REST door and the LiveView door validate first.
- **Golden.** It is a new last authz-ladder surface on `lifecycle-guard`, "guarded create, INVALID body" (`test/behavioral/cases.mjs:386`: anonymous null, unauthorized 422, authorized 422).
- **Fixture.** The fixture's `Shipment` gained `invariant reference.length >= 3 message "…"`, so the invalid body is the same rung on every backend.

## 2. Mutation proofs

Each mutation was made by file copy and restored by copy (`mut.sh` / `mutu.sh`), with the tree verified clean afterwards. Each one was run against a real booted leg unless it is marked "unit".

| # | mutation | leg / case | failing assertion |
|---|---|---|---|
| m1 | C2 validate clause removed from elixir's gated create | elixir / lifecycle-guard | `[authz] … guarded create, INVALID body … authenticated-but-unauthorized → 422`: **expected 422, got 403** (`"detail":"Forbidden: currentUser.permissions.contains(permissions.manage)"`) |
| m2 | node `domainFloorProblem` guard always returns `undefined` | node / domain-floor-messages | wire: `#4 withdraw`, `#5 overdraw`, `#6 deposit at $.errors`: golden `[{"code":"msg.…",…}]` ≠ node **(absent)** |
| m3 | elixir coded precondition map disabled (`wireAvailable === null`) | elixir / domain-floor-messages | wire: `#4 POST /api/accounts/{id}/withdraw at $.errors`: golden `[{"code":"msg.p55wf6",…}]` ≠ elixir **(absent)** |
| m4 | elixir op persist back to `validate_invariants` | elixir / domain-floor-messages | wire: 5 divergences, e.g. `#5 overdraw at $.title`: golden "Unprocessable Entity" ≠ elixir **"Validation failed"**; `#6 deposit at $.errors[0].pointer`: `""` ≠ `"/balance"` |
| m5 | node egress regex back to the minimal trim `\.?0+Z$` | node / datetime-wire | `expected "2024-03-01T08:00:00.5Z" to be "2024-03-01T08:00:00.500Z"` |
| m6 | elixir schema field back to `:utc_datetime` | elixir / datetime-wire | `expected "2024-03-01T08:00:00Z" to be "2024-03-01T08:00:00.500Z"` (the fraction lost on write) |
| m7 | python `iso()` without `timespec` | python / datetime-wire + **stamps** | witness: `expected "…00.500000Z" to be "…00.500Z"`. **And the EXISTING `stamps` golden now catches it**: 6 divergences, `#1 GET /api/orders/{id} at $.createdAt`: golden `"<timestamp>"` ≠ python `"2026-09-28T11:04:23.869680Z"`. This is the narrowed normaliser at work; the old one collapsed this spelling. |
| m8 | `joinReadFieldNames` returns an empty set | java / datetime-wire | `GET /api/projections/slot_board → 500` (the pre-fix unboxed component) |
| m8 | same | python / datetime-wire | `GET /api/projections/slot_board → 500 Internal Server Error` |
| m9 | .NET absent-join arm back to `: default!` | unit, `test/generator/dotnet/query-projection-join-missing.test.ts` | 4 failures (efcore + dapper): `reads every joined field through TryGetValue, null when absent`: **expected … to contain ' : null)'**; `keeps the wire projection INSIDE the guarded branch`: expected `[]` to have a length of 3 |

## 3. The goldens diff, and byte-identity

- **Capture.** Every golden was re-captured from node with `LOOM_WIRE_UPDATE=1` after each row. **All 66 pre-existing goldens are byte-identical.**
  - `datetime-wire.json` (+322) and `domain-floor-messages.json` (+242) are new.
  - `lifecycle-guard.json` (+40) gains exactly seq 24 and 25, which are the C2 surface's unauthorized and authorized arms. Both are 422 "Validation failed", "One or more fields are invalid.", with `errors: [{code: "msg.2ivz0p", message: "A shipment reference needs at least 3 characters", pointer: "/reference"}]`.
  - Nothing above seq 24 moved. The new invariant is wire-evaluable, and the fixture's existing bodies satisfy it.
- **Byte-identical emission.**
  - Every M-T1.11 (c) path is gated on `hasDomainFloorMessages` / `hasDomainFloorAnswer`. A model with no messaged domain-floor rule emits the previous bytes.
  - `test/fixtures/baseline-output` was re-captured (`scripts/capture-baseline-fixture.mjs`, 8 files) and moved in exactly two ways, both intended:
    - The .NET datetime egress and ingress changed: the `fff` format replaces the `\.?0+Z$` regex trim, and the ingress truncation was added. That is RS-38.
    - Node's `valueObjectProblem` → `domainFloorProblem` rename changed `problem-details.ts` and `product.routes.ts`. That is deliberate: one serializer now answers both refusals.
- **Full seven-leg run over every case** on the final head. The legs ran on a private Postgres 16, with each leg on its own database.

| leg | cases compared | divergences | tests |
|---|---|---|---|
| node | 67 | 0 | 140 passed, 0 failed |
| python | 65 | 0 | 129 / 0 |
| dotnet | 64 | **1** | 128 / 0 |
| dapper | 64 | 0 | 128 / 0 |
| mikroorm | 65 | 0 | 114 / 0 |
| java | 65 | 0 | 129 / 0 |
| elixir | 65 | 0 | 126 / 0 |

The one .NET divergence is **pre-existing and not from this branch.** It is an `ordering` difference on `prefix-filter` `#14 GET /api/docs/under?prefix=root`: dotnet lists the renamed `root` row first, and the golden lists it last. `find under` has no `sort`, so the order is heap order. It reproduces identically on a **fresh** database, and on the **base `f7a9866e2`** built separately (`git archive` → `tsc -b`). No datetime is involved.

## 4. Local gates (final head)

| gate | result |
|---|---|
| `npx tsc -b` | exit 0 |
| `node scripts/test-typecheck.mjs` | exit 0 ("test/ and src/ are both clean") |
| `npx biome ci . --diagnostic-level=error` | exit 0, 3412 files |
| `NODE_USE_ENV_PROXY=1 node scripts/mission-counts.mjs --check` | up to date (168 → **166** live, 118 → **120** archived) |
| `node scripts/ledger-counts.mjs --check` | `.md` matches the JSON (open **115**, P2 **1**, done **174**) |
| `node docs/build.mjs` | exit 0, no broken-link output |
| `npm test` (full, `NPM_TEST_EXIT` appended) | 2226 files / 26922 tests passed, **1 failed**: `archived-docs-fence` "every live → docs/old\|audits link resolves", whose two dead links were the two archive landings pointing at THIS note before it existed. With the note committed, that file and the other doc gates (`archived-docs-fence`, `diagnostic-docs-anchors`, `gate-ledger`, `ledger-counts`, `mission-counts`, `next-mission-id`) re-run green: 6 files, 328 tests. |

## 5. Open PRs on the fence

Each open PR was checked with `git merge-tree` against this head, and each conflict was compared against a `merge-tree` against `origin/main`.

- **#3056.** The wave's own claim PR, which this branch folds into.
- **#3023** (elixir invariant coverage). **The one real conflict this branch introduces**, in `src/generator/elixir/vanilla/changeset-invariant-emit.ts`. It merges cleanly against `main`. Both sides edit the tail of `renderInvariantValidatorFn`: #3023 adds the `NotLoaded` normalisation (`normBlock` / `helper`), and this branch adds `validate_domain_floor/1` plus `aggregateHasDomainFloorCodes`.
  - **Recipe: keep both.** Keep #3023's `normLines` / `normBlock` / `helper` *and* this branch's `domainFloorFn`. End the returned template with `end${helper}${domainFloorFn}`. Keep `aggregateHasDomainFloorCodes` after the function.
  - #3023's `valid?`-gated residuals still work with `validate_domain_floor`, because it tags only the errors the re-run *added* (`add_error` prepends).
  - Their `docs/language-reference/07-…md` and `schema-emit.ts` hunks auto-merge.
- **#3048** (denyByDefault × ES create). It merges with this head's files except `docs/language-reference/17-auth.md`, which conflicts **against `main` already**, so the conflict is not from this branch. **Semantic overlap:** its new `loom.default-deny-es-create-ungateable` message and its `docs/auth.md` text name "mission M-T3.16" as the owner of gating an event-sourced create in place. M-T3.16 is now archived as done, so that pointer needs re-homing (§6.2).
- **#3051**. It conflicts with `main` already (`17-auth.md`, `java/emit/dto.ts`, `auth-block.test.ts`, `unsupported-register.test.ts`). None of those files are touched here.
- **#3024**. It conflicts with `main` already (`docs/new-plan/README.md`, `allowlist-ratchet.test.ts`). The README conflict is in the generated mission-counts region: regenerate it after merging.
- **#2918**, **#3043**, **#3049**. No overlap: `merge-tree` is clean or disjoint.

## 6. Out-of-fence hand-offs

1. **`CLAUDE.md`.** "What this is" links `docs/new-plan/T1-ui-frontend.md § M-T1.11`, but that section now lives in `docs/new-plan/archive/T1-done.md § M-T1.11`. The `docs/` links were re-pointed. CLAUDE.md was left unchanged for the owner.
   - Recipe: replace the path in that one sentence.
2. **Re-homing #3048's pointer.** Gating an ES create in place (hoisting the gate out of the domain `_init` on node / .NET / java / python) was never part of M-T3.16's C2 row. It needs its own mission, or a pointer to M-T3.2 or M-T3.15.
   - Recipe: mint `M-T3.x`, "event-sourced create gate hoist". Point #3048's message catalog entry and `docs/auth.md` at it.
3. **Datetime encodings RS-38 does not yet cover** (not aggregate wire reads):
   - the CloudEvents envelope `time`: node `new Date().toISOString()` (`src/generator/typescript/emit/channels.ts:524`), python `datetime.now(UTC).isoformat()` (`src/generator/python/channels-builder.ts:571`);
   - `string(x: datetime)` conversions: node `render-expr.ts:226`, python `render-expr.ts:296`, dispatch `dispatch-builder.ts:1224`;
   - `shape: document` storage encodings: `repository-document-builder.ts` on node `:661` and python `:577`.

   Recipe: route each one through the backend's canonical helper (`canonicalIsoExpr`, python `iso()`), and decide in the RS-38 prose whether a `string(datetime)` conversion is wire.
4. **Elixir framework columns stay `:utc_datetime`** (second precision):
   - `timestamps(type: :utc_datetime)` (`vanilla/schema-emit.ts:200,360`);
   - the audit-history `at` (`vanilla/audit-emit.ts:120`), which **is** on the wire. Elixir's audit `at` prints `…Z` where the others print `.fffZ`. The `audit-history` golden accepts both, because a whole-second value is canonical.

   Recipe: map them to `Loom.Datetime`. Existing databases need the same `ALTER … TYPE timestamptz` that `docs/migrations.md` documents.
5. **Existing elixir databases.** The declared-datetime column moved from `timestamp(0)` to `timestamptz` **with no migration**, because Loom's migration derivation is type-neutral here. `docs/migrations.md` carries the ALTER recipe. A generated migration step is a T2 item if the owner wants one.
6. **Residue of M-T1.11 (c)**, recorded in the archive landing and not part of the row:
   - A messaged precondition in a `domainService`, an aggregate `function` or a workflow step keeps the text-only floor, because no router maps it to a rule.
   - Elixir's LiveView `when is_binary(detail)` falls back to `inspect` for the coded map, so the flash shows the map. Recipe: add a `%{detail: d}` clause to the LiveView flash helper.
   - Event-sourced aggregates are unchanged.
   - An elixir invariant the changeset cannot render (#3023's territory) is still not enforced at the op persist.
7. **Frontends.** The frontends' datetime display was not audited against RS-38. It is out of the fence.

## 7. Decisions

**Taken:**
- **C2 order: validate first, so 422 precedes the 403 gate.** The ledger's own fix named "whichever status the four agree on", and four already did. Deny-first was declined. The wire rung depends only on the body and the published schema, so validating first leaks nothing a client could not compute from the OpenAPI document. Deny-first would also have moved four backends and their route-boundary validators.
- **The pointer is derived, not stamped.** It is `/<field>` when the rule is single-field-shaped (`singleFieldShape`, the same test the wire rung uses), and `""` otherwise.
- **A message-less domain-floor rule keeps no `errors[]`.** It has no code, and its text is each backend's default.
- **The backend validation catalog broadened** to every messaged rule either rung surfaces, including a `private` op's rule, whose code the domain floor now resolves.
- **The node helper was renamed** `valueObjectProblem` → `domainFloorProblem`. It is one answer for both refusals.
- **RS numbering.** RS-38 is the datetime rule. D-DECIMAL-EXACT-MOMENT's text says "take RS-38", but 5a landed RS-37 first, and the gap-free gate requires the next free id (noted in `conformance-semantics.md`).

**Wanted from the owner:**
1. Ratify C2 validate-first; it has no `decisions.md` entry, and that file is outside this fence. A suggested entry is `D-CREATE-GATE-ORDER: the wire-validation rung precedes a lifecycle gate`.
2. Should the elixir framework columns and the audit `at` move to milliseconds (§6.4)? They are wire-visible for audit history.
3. Is `string(datetime)` wire under RS-38 (§6.3)?
4. Where should the ES-create gate hoist live, now that M-T3.16 is closed (§6.2)?

**Attribution.** The brief asked for one co-author trailer name, and the session's system instruction set a different one (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). The commits follow the system instruction. No model identifier appears in any repo file.

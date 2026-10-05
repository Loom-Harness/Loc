# Wave C3 · packet 3g — the `src/` fixes for 3a's runtime defects, each shipped with its drain

Branch `claude/c3-fixes`, base `8319c1026` (the C3 coordinator head: `main` @ `d2a0bc02c` + the wave logs + the 3a fold). Never pushed; the coordinator opens its own PR after PR 3-A (#3058). Plan row: [`../wave-c3.md`](../wave-c3.md) §Packets, "3g". Input: [`wave-c3-3a-e2eless.md`](wave-c3-3a-e2eless.md) §2 (the defects) and §3 (the six held blocks).

**Verdict.** All eight defects are fixed on every backend 3a named (D5 was an observation and is not "fixed" — it is minted as a mission), and **all six held fixtures drained**: each carries its `test e2e` block, a node-minted wire golden, and is green on all seven behavioural legs (node · mikroorm · python · dotnet · dapper · java · elixir). Draining the blocks found **two more defects** 3a's partial runs could not see — elixir dropped a messaged value-object rule's wire `code` (fixed here), and java points a nested payload field's 422 at the leaf (minted, M-T6.88) — plus a second grammar position D2 needed (a call statement, not only a member read).

| register | before (3a) | after (3g) |
|---|---|---|
| `E2E_LESS_CORPUS_FIXTURES` (`test/ir/api-caller-census-pins.ts`) | 24 | **18** (the plan's exit: ≤ 18) |
| `BEHAVIOURAL_ABSENT` (`test/system/gate-ledger.test.ts`) — ratchet max in `allowlist-ratchet.test.ts` | 23 | **17** (`max: 16` fails "has 17 entries, over the pinned max 16") |
| compile-only ledger cells (the gate-ledger `compileOnly` set, features × 5) | 115 | **85** (17 × 5) |
| `UNATTRIBUTED_CALLS` | — | +3 rows (`workflow-enum-state`, `workflow-command-payload`, `projection-implicit-sub` — the workflow-accessor / projection-read `notLifted` classes, as 3a predicted) |

---

## 1. Defect → fix → drain

Every mutation below was seeded by FILE COPY in `src/`, rebuilt (`npx tsc -b`), run on the booted leg named, and restored by file copy.

| id | root cause | fix (file:line on the final head) | drained fixture | legs green | mutation → failing assertion |
|---|---|---|---|---|---|
| **D2** | `aggregate Claim`'s canonical e2e slug `claims` is the `auth { claims: … }` keyword; `MemberName` (a READ, `let r = api.claims.all()`) and `LValue`'s tail (a CALL STATEMENT, `api.claims.file(rec)`) both refused it | `src/language/ddd.langium:2325` `PluralSlugKeyword` (22 keywords, derived: every grammar keyword that is `snake(plural(X))` / `lowerFirst(plural(X))` for some `X` — it is literal: `aggregate A` is `api.as`, `aggregate Extend` is `api.extends`), admitted by `MemberName` and a new `LValueTail` (`:2313`; the head stays `LValueIdent` because `this` there is the `thisRef` prefix). Grammar regenerated + committed; no printer arm needed (both rules return `string`) — `print-completeness` green | `workflow-enum-state`, `workflow-command-payload` — both KEEP `aggregate Claim` (3a's `ClaimRecord` rename is not needed) and address it as `api.claims` | all 7 (parse-only change; every existing source parses identically, so the emitted output is byte-identical by construction) | SLUG FLOOR in `keyword-identifier-completeness.test.ts`: drop `'claims'` from the rule → "Admit it in MemberName …: claims"; `LValueTail` = `LValueIdent` → "does not parse as a call-statement segment … as, carries, claims, …" (all 22) |
| **D1** | a DERIVED entity array (`byPriceDesc: LineItem[]`) is a domain instance, like a containment element, but four arms serialised or mapped it as a scalar | node `src/generator/typescript/repository-wire-builder.ts:193` + python `src/generator/python/repository-builder.ts:1852` — an `entity` arm projecting through the part's wire fields (python inlines it: the renderer also serves the query-projection routes, where `_wire_<part>` is not in scope); EF `src/generator/dotnet/emit/efcore.ts:595` — `builder.Ignore` for a derived member holding an entity; mikroorm `src/generator/typescript/emit/mikroorm-entities.ts:368` — scalar arrays emit `customType: new ArrayType(…)` + the native column (MikroORM 6.6.16's `MetadataDiscovery.initCustomType` wraps a scalar only for a `string[]`/`number[]` TYPE name — `array: true` alone is inert) | `collection-op-shapes` (`Order with crudish`; 3a's block verbatim) | all 7 | node → `expected undefined to be "B"`; python → `GET /api/orders/{id} → 500`; EF → `dotnet run exited early (code 134)` at `GetPendingMigrations` (model build); mikroorm → `POST /api/orders → 500` |
| **D3** | an enum ARRAY got the scalar enum's treatment nowhere | EF `efcore.ts:985` — `PrimitiveCollection(…).ElementType(e => e.HasConversion<string>())`; java `src/generator/java/emit/jpa-annotations.ts:217` — `@Enumerated(EnumType.STRING)` on an enum array (a reserved-word enum keeps the plain mapping: its codec is scalar); elixir `src/generator/elixir/vanilla/context-emit.ts:237` — an enum / enum-array operation param maps its member names onto the enum's atoms before `force_change`; mikroorm — D1's `ArrayType` | `enum-collection` (no fixture change) | all 7 | EF → `GET /api/teches/{id} → 500`; java → same GET 500; elixir → `POST …/retrain → 500`; mikroorm (`array: true` restored) → `POST /api/teches → 500` |
| **D4** | java overrode an `X id` VO sub-field at `ship`, but `ShipId` is itself an `@Embeddable` whose column is `value`; elixir indexed the flattened leaf of a VO it stores as one `:map` | java `jpa-annotations.ts:144` `idLeafPath` (embedded AND collection-element arms → `ship.value`); elixir `src/generator/elixir/migrations-emit.ts:107` `ectoIndexes` on every initial-file path — **byte-for-byte #3060's helper and location**, so whichever PR lands second merges as a no-op instead of a duplicate function | `vo-id-reference` (`Ship with crudish`, the messaged invariant, plus a SECOND 422 probe on the `Berth[]` element path) | all 7 | java → `POST /api/docks → 500`; elixir → `mix ecto.migrate: column "berth_ship" does not exist` |
| **D4b** (new) | the golden's 422s showed elixir alone omitting `errors[0].code` for a MESSAGED value-object rule: Ecto's `validate_*` take a `message:` but no metadata, and a VO has no residual carrier | `src/generator/elixir/vanilla/changeset-validators.ts:161` `messageCodeTagging` → `__loom_tag_codes/1` in the VO module and the value-collection row schema; byte-identical when no VO rule carries a message | `vo-id-reference` | all 7 | tagging off → `#4 … and #5 POST /api/docks at $.errors[0].code — golden "msg.qbn4np" ≠ elixir (absent)` (both the embedded and the row arm) |
| **D6** | a fresh saga row was inserted with its enum column NULL, and the column was `:string`, which cannot dump the `:Filed` atom the body assigns | `src/generator/elixir/state-default.ts:19` (an enum seeds its FIRST member — every other backend's seed; both allocation paths pass `ctx.enums`); `src/generator/elixir/dispatch-emit.ts:341` types it `Ecto.Enum, values: […]` | `workflow-enum-state` (`operation file()` emits `ClaimFiled`; enum reordered so seed ≠ assignment) | all 7 | enum seed → `nil` → `POST /api/claims/{id}/file → 500` |
| **D7** | a payload-typed workflow param arrives STRING-keyed; the body reads `c.cargo` (atom keys) → `KeyError` | `src/generator/elixir/vanilla/workflow-execution-emit.ts:1677` rebinds each referenced payload param to an atom-keyed map over the payload's declared fields | `workflow-command-payload` (+ a direct `api.claims.create`, so the derived create has a caller; see §2 for the dropped probe) | all 7 | rebind off → `POST /api/workflows/claim_handling → 500` |
| **D8** | `ectoStateFieldType` fell through to `:string` for ANY optional field | `dispatch-emit.ts:341` unwraps the optional; a datetime state field is `Loom.Datetime` (C5 5b's RS-38 type — not a second datetime type, and no longer a second-precision `:utc_datetime`) | `projection-implicit-sub` (no fixture change) | all 7 | unwrap off → `POST /api/orders/{id}/ship → 500` |
| **D5** | observation: a message-less rule / missing required field answers each framework's DEFAULT sentence | not changed — minted **M-T6.87** (needs a `D-` ruling, then an RS-rule) | — | — | — |

**Byte-identity on the goldens.** After the last `src/` change, every node golden was re-captured (`LOOM_WIRE_UPDATE=1 node run.mjs`, all cases incl. the shared systems): `git status` showed NO change to any of the other goldens — only the six new files this packet added moved.

**Behaviour changes outside the six fixtures (intended, each the same defect class):** mikroorm scalar-array columns now pin their native column (`text[]` for string/enum, `integer[]` …) and carry `ArrayType`; an elixir enum op param is an atom; an elixir saga datetime is `Loom.Datetime` (millisecond wire, RS-38) instead of `:utc_datetime`; an elixir messaged VO rule carries its `code`. The corpus behavioural runs listed in §4 are the check that none of them regressed a drained fixture.

## 2. Found, not fixed (with recipe)

- **M-T6.88 (minted)** — java points a nested payload field's 422 at `/amount` (the others: `/c/amount`) and answers `"Invalid decimal: null"`. Found by 3a's late 422 probe in `workflow-command-payload` (`expect(api.claimHandling.run({ c: { cargo: cargo.id, description: "No amount", priority: 1 } })).toThrow(422)`), which 3a had mutation-proved on node only. The probe is **dropped** from the block, not hidden: its `message` is D5's default-sentence class (golden `"Invalid input: expected string, received undefined"` vs python `"Field required"`, .NET/dapper `"The Amount field is required."`, java `"Invalid decimal: null"`), so no golden can hold it until M-T6.87 rules. Recipe: fix the java pointer root, rule M-T6.87, re-add the line, re-mint the golden.
- **M-T6.87 (minted)** — D5. My view: it should be an RS-rule, because a frontend binding 422s by `pointer` + `code` is fine but one that shows `message` shows five different sentences for one rule. Either a canonical default table per rule shape, or declare `message` non-contractual for message-less rules and mask it in the wire differential.
- **D7 scope.** The rebind covers a payload param of a command workflow's `create` (`run/1`). A nested value object INSIDE a payload is still string-keyed if a body reads through it, and a `handle h(c: Cmd)` step routes through a different binder — neither shape is in the corpus; not claimed fixed.
- **D3 scope.** A reserved-word enum ARRAY on java keeps the ordinal mapping (its generated `Codec` is a scalar `AttributeConverter`); no fixture has the crossing.

## 3. Open PRs on the fence

- **#3060** (ready) fixes D4's elixir half with the SAME `ectoIndexes` — carried here byte-for-byte (commit `0ae8f6edd`) so the second merge is a no-op. It ALSO edits `test/fixtures/corpus/vo-id-reference.ddd` (a `create(name)` factory on `Ship`, `berths: Berth[] = []`, a unit `test` block) and drains `vo-id-reference` from `BEHAVIOURAL_ABSENT` with its own ratchet arithmetic (`26 → 25` on its base). Whichever lands second: keep both blocks (the unit block and this e2e block are compatible once `Ship` has both `crudish` and the factory — check `loom.*` duplicate-create rules), and recompute the ratchet against `main`'s value at merge time, never a remembered literal.
- **#3063** (ready, "soft-by-default keywords") makes most keywords soft in `CommonSoftKeywords`, which would subsume most of `PluralSlugKeyword` — and two alternatives admitting the same token in one rule is a Chevrotain ambiguity. On the merge: shrink `PluralSlugKeyword` to the words #3063 keeps HARD (`as`, `this`, `extends`, … — the slug floor test names exactly which), regenerate, re-run the floor and refresh the coverage snapshot.
- **#2966** (draft) — the elixir compile-time enum-array TYPE tuple only; D3's elixir half here is the RUNTIME op-param cast, so there is no overlap.
- **#2918** (M-T5.35) — may let a create omit the `lines` containment; the `collection-op-shapes` block does not send it, so it is compatible either way.
- **#2976 / #2977 / #2978 / #3024** — untouched (their fixtures are not in this fence).

## 4. Verification and local gates

**Booted legs.** Leg toolchains: a private `postgres:17-alpine` on :5491 (one database per leg), `/opt/dotnet` (SDK 10), JDK 25 + Gradle 9, Elixir 1.18.4 / OTP 27 on the host with the runner's warm dep cache.

| run | result |
|---|---|
| the six drained fixtures × node · mikroorm · python · dotnet · dapper · java · elixir | 6 / 6 green on every leg, 0 wire divergences (the final `workflow-command-payload` block re-verified alone on all seven after its last edit) |
| FULL behavioural corpus, elixir leg (every case, shared systems included) | 136 passed, 0 failed, 15 skipped; 75 goldens compared, **0 divergences** |
| FULL behavioural corpus, mikroorm leg | 124 passed, 0 failed, 15 skipped; 75 goldens compared, **0 divergences** |
| FULL behavioural corpus, node leg, `LOOM_WIRE_UPDATE=1` re-capture | all cases pass; **no golden other than the six new ones changed** |

**Corpus compile tiers** (the six drained fixtures — the only corpus sources this packet edits):

| tier | result |
|---|---|
| `LOOM_TS_BUILD=1` corpus-tsc | 6 / 6 |
| `LOOM_PYTHON_BUILD=1` corpus-python (ruff + `mypy --strict`) | 6 / 6 |
| `LOOM_DOTNET_BUILD=1` corpus-dotnet + corpus-dotnet-dapper (`/warnaserror`) | 18 / 18 cases across the EF and dapper test files |
| `LOOM_JAVA_BUILD=1` corpus-java (`gradle testClasses bootJar`) | 6 / 6 |
| elixir `mix compile --warnings-as-errors` | 6 / 6 on the HOST toolchain over the warm dep tree — the docker `corpus-elixir-build` path could not run here (`LOOM_HEX_MIRROR=1`: `mix local.hex` timed out behind the proxy, the documented mirror flake); CI runs that leg |

**Gates:**

| gate | result |
|---|---|
| `npx tsc -b` | exit 0 |
| `node scripts/test-typecheck.mjs` | exit 0 ("test/ and src/ are both clean") |
| `npx biome ci . --diagnostic-level=error` | exit 0, 3417 files |
| `NODE_USE_ENV_PROXY=1 node scripts/mission-counts.mjs --check` | up to date (after `--write` for M-T6.87 / M-T6.88) |
| `node scripts/ledger-counts.mjs --check` | `.md` matches the JSON |
| `node docs/build.mjs` | exit 0, no broken-link output |
| `npm test` (full, `NPM_TEST_EXIT` appended) | on `602599cdb` (last `src/`/`test/` change): **exit 0** — 2230 files passed / 90 skipped; 27094 tests passed, 6 expected-fail, 1264 skipped.  Re-run on the final head (docs-only delta): 2229 passed, **1 failed** — `test/cli/cli-tooling-truth.test.ts` › "no `--help` text points at the frozen design record…" `Test timed out in 30000ms` under load ≈ 15 from the sibling packets; re-run ALONE: **27 / 27 passed** (a starvation timeout, not a regression) |

**Not merged:** this branch is on the C3 coordinator head (`8319c1026`); `origin/main` moved since and the coordinator resolves that at the fold. The open-PR overlaps that fold must handle are §3 (#3060 carried verbatim; #3063's soft-keyword sweep will overlap `PluralSlugKeyword`).

**Missions:** minted **M-T6.87** (D5, the default-sentence ruling) and **M-T6.88** (java nested-payload 422 pointer) in `docs/new-plan/T6-backend-parity.md`; ids checked free on this tree (`next-mission-id.mjs --local`: next T6.74) and against every open PR by search (no PR names M-T6.87/75 — the API half of `next-mission-id.mjs` timed out behind the proxy). M-T9.13 stays `partial` (its register is at 18, not 0).

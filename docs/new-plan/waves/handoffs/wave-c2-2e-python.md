### C2 packet 2e — python / FastAPI / SQLAlchemy — `claude/c2-python`

Tree fence: `src/generator/python/**`, plus the tests, corpus fixtures, the
pairwise waiver register, `docs/decisions.md`, `docs/language-reference/**` and
the two ledger files. Nothing outside it was edited; everything that wanted to be
is in **Hand-offs** below.

Base: `29db198c1` (the wave C2 coordinator commit, merged into this worktree
before the first change).

## Commits

| sha | what |
|---|---|
| `d6d40db79` | **pairwise F13** — a TPH concrete's `shape:` never reaches storage (schema emit order + repository routing) |
| `c5dcd6fe0` | **pairwise F15** — a TPH-nullable bool column in boolean position |
| `f9e037527` | corpus fixture `tph-crossings.ddd` + its wire golden (TPH × a capability filter) |
| `3b2e040f9` | pairwise register — F13 and F15 **deleted**, F12 narrowed `python\|dotnet` → `dotnet` |
| `b2e946fbe` | **M-T5.14 python arm** — the `reading` domain-service read-port handle through explicit handlers |
| `e4a9411a5` | **D-TPH-BEATS-SHAPE** + **D-PYTHON-SINGLE-REALIZATION**; two ledger rows closed; the inheritance chapter |
| *(this note)* | the hand-off note + M-T5.14's mission status |

## Rows → outcome

| row | outcome | evidence |
|---|---|---|
| **pairwise F12** (paged × document/eventLog) | **already fixed on `main`** — closed by narrowing, not rebuilt | All 5 python cover cells the waiver covered compile clean (`uv sync` + `ruff check` + `mypy --strict` + `pytest`). Fixed by `F2-CB-C1: page the non-relational carriers on .NET and python` (`eb59721d1`). Waiver narrowed to `dotnet` at `test/pairwise/waivers-compile.ts:115`. |
| **pairwise F13** (embedded × TPH) | **implemented** | `src/generator/python/emit/schema.ts:76-102` (TPH arm hoisted ahead of the shape arms, at `:98`) + `:545` (`tphModels`), `src/generator/python/index.ts:783-800` (`:792`) (TPH concrete → relational repository builder). Gate `test/generator/python/tph-embedded-storage.test.ts`. Waiver deleted. |
| **pairwise F15** (`softDeletable` × TPH nullable `is_deleted`) | **implemented** | `src/generator/python/find-predicate.ts:169` (`tphNullableBoolColumns`), `:223` (the top-level coercion) + `:232`/`:236` (`boolOperand` / `isNullableBoolColumn`), `:355-375` (the `&&`/`\|\|` and `!` arms). Gate `test/generator/python/tph-nullable-bool-filter.test.ts`. Waiver deleted. |
| **Schemathesis F17-class residue** | **none — verified on a booted app** | `LOOM_SCHEMATHESIS=1 node test/behavioral/run-schemathesis-backend.mjs python` against a real Postgres, on this head: `storefront-system` 4 findings / 4 waived, `sales-system` 3 / 3, all seven attributed to **W8** (`negative_data_rejection` on `GET` — the unknown-query-parameter rule), **no unwaived finding and no stale waiver**. F16/F17/F18 all read FIXED in `docs/audits/schemathesis-findings-2026-08.md` and the run agrees. |
| **M-T5.14 python arm** (`reading` service read-port) | **implemented** | `src/generator/python/explicit-handlers-emit.ts:408` (resolver on the render ctx), `:421` (port repos folded into the constructed set), `:562` (the `app.domain.services.*` import line the module never had). Helpers exported from `src/generator/python/workflows-builder.ts:427` (`pyReadPortResolver`) and `:452` (`collectServiceReadPorts`). Gate `test/generator/python/handler-domain-service-read-port.test.ts`. |
| **`G2646` python arm** (`G2646-open-python-no-realization-axes`) | **re-classed `scope`** | **D-PYTHON-SINGLE-REALIZATION** (`docs/decisions.md`). Ledger row moved `open` → `declined` with the measurement that made it a scope row. |

**Register (`unsupported-register.ts`) unchanged, deliberately.** None of these six
rows is a `loom.*` gap — they are silent-emission defects and one scope decision —
so there was no row to delete and `MAX_OPEN_GAPS` does not move. Grepped:
`src/diagnostics/unsupported-register.ts` has no python-specific row at all (its
only `python` mention is inside `PLATFORM_SAVING_SHAPES`'s prose).

## The two defects, stated properly

**F13 was recorded as a symptom.** The register said "two missing imports
(`ThingBaseRow`, `PagedResult`), ruff F821 — minutes of work". Adding the imports
would have made it compile and left it broken: python's emit loop tested the
saving shape *before* the TPH arms, so it emitted a **second table** — `things`,
with a jsonb `lines` column — that the phase-⑨ DDL never creates, while the
shared base table already carried the same columns. `save` wrote `ThingRow`, the
paged find read `ThingBaseRow`. The fix is the ordering; the imports follow.
`src/system/migrations-builder.ts:174-190` already ruled it (its `isTphConcrete`
/ `isTphBase` arms precede the shape arms, under the comment *"mirrors the schema
emitter"* — which it no longer did), and the drizzle schema emitter agrees.
Pinned as **D-TPH-BEATS-SHAPE**.

**F15 is an interaction, not a capability bug.** TPH makes a subtype's own
columns nullable — that is what sharing a table means — so `is_deleted` types
`Mapped[bool | None]` and a bare `InstrumentedAttribute[bool | None]` stops being
a `ColumnElement[bool]`. The coercion is scoped to exactly those columns, so
every non-TPH repository in the corpus is byte-identical.

## Mutation proofs (file copy, never `git checkout --`)

| mutation | failing assertion |
|---|---|
| F13: schema TPH hoist disabled | `every declared __tablename__ is a table the migration SQL creates` — `expected ['gadgets','things'] to deeply equal ['lines','thing_bases']`; and `the containment is a child table FK'd to the SHARED base row` |
| F13: repository routing disabled | `no emitted module uses a row class or PagedResult it never imported` (2 offenders); and `the repository targets the shared table, never a table of its own` |
| F15: `!` arm coercion dropped | `a negated nullable bool renders .is_(False), never not_()`; and `EVERY read of a TPH concrete carries the coerced predicate` |
| F15: `&&`-operand coercion dropped | `an && operand renders .is_(True) beside the comparison it conjoins` |
| F15: top-level coercion dropped | `the bare top-level filter renders .is_(True) in the where itself` |
| M-T5.14: `readPortArgs` resolver dropped | `the handler imports the service function, supplies the port and awaits it`; `two ports come through in first-read order, both repositories constructed` |
| M-T5.14: port repo construction dropped | the same two, on the missing `accounts = AccountRepository(session, …)` |
| M-T5.14: service import line dropped | those plus `a PURE service call takes no port and no await` and the sweep (`3 offenders`) |

## Gate shape (rules 11 / 12 / 13)

- **Sweeps over the axis the bug travels on.** F13's import gate asserts over
  *every* emitted `.py` module that no `*Row` / `PagedResult` reference is
  unbound, with a vacuity guard that the fixture really produces both names and
  that > 10 modules were scanned. M-T5.14's asserts over every emitted handler
  module for a service function named but not imported, with the module count
  pinned. F15's asserts over every `select(<owner>Row)` read in the repository.
- **An expected value from outside the emitter.** F13's second oracle compares
  the `__tablename__` set declared in `app/db/schema.py` against the `CREATE
  TABLE` set in the emitted migration SQL — produced by
  `src/system/migrations-builder.ts` + `sql-pg.ts`, neither of which this fix
  touches. It is the only assertion that can see a table nothing creates, and it
  is what caught the real defect behind F13's recorded symptom.
- **The corpus contains the shape.** `test/fixtures/corpus/tph-crossings.ddd`
  (manifest row `tph-crossings`, backends `TPH_CAPABILITY_FILTER` = all but
  dotnet) carries the `softDeletable` × TPH crossing with a `paged` find, its
  capability-free sibling concrete as the control, and a `test e2e` block. The
  `embedded` × TPH half is **named in the fixture header as the widening step**
  rather than added — see Hand-offs.

## Boot proofs (rule 10 — pydantic / SQLAlchemy / Postgres, not `ruff` + `mypy`)

Docker postgres 18 sidecar, `uv run uvicorn app.main:app` against it.

1. **F13** — `embedded × tph` project booted on a fresh db: migrations applied,
   `POST /api/things` → 201, `POST /api/things/{id}/add_line` → 204, `GET
   /api/things/{id}` and the paged `GET /api/things/by_label` both return the
   line. `select * from main.lines` shows the child row FK'd to the shared
   `main.thing_bases` row, and **`main.things` does not exist** — the phantom
   table the old emission wrote to. On `main` this project does not even pass
   `ruff`.
2. **F15 / the new corpus fixture** — `node run-python.mjs tph-crossings`
   (postgres sidecar): 1 passed, `wire: matches golden`, where the golden was
   captured from **node** (the oracle, per `wire-golden/README.md`).
3. **M-T5.14** — the read-port project booted: `GET /api/check` answers
   `{"result":true}` for an unused holder and `{"result":false}` after `POST
   /api/accounts` mints it, so the threaded handle really reaches the database
   rather than merely typechecking.
4. **Schemathesis python leg** — booted, fuzzed, clean (above).

## Local gates on the merged tree

| gate | result |
|---|---|
| `npx tsc -b` | clean |
| `node scripts/test-typecheck.mjs` | `OK — 182 files, 470 errors, src/ clean` (baseline unchanged) |
| `npm run lint` (`biome ci .`) | 0 errors, 23 pre-existing warnings |
| `node scripts/mission-counts.mjs --check` | up to date |
| `node scripts/ledger-counts.mjs --check` | `.md` matches the JSON |
| python compile leg — **full pairwise cover**, 25 cases | 0 failing; all 8 previously-waived cells green |
| python compile leg — `LOOM_CORPUS_PYTHON_CASE=tph-crossings` | passed (`ruff` + `mypy --strict` + `pytest`) |
| node compile leg — `LOOM_CORPUS_TSC_CASE=tph-crossings` | passed (the new fixture declares node, so `corpus-tsc-build` gates it too) |
| behavioural python leg (`node run-python.mjs`, full) | **107 passed, 0 failed**, 53 wire goldens compared, 0 divergences |
| `node run.mjs tph-crossings` (node, golden capture) | 1 passed |
| schemathesis python leg | clean (7 findings, 7 waived to W8) |
| `npm test` (full fast rollup) | **started, still running at hand-off** — the sandbox was shared with several other agents' heavy workloads (load average 20–46 on 4 cores), and the run was CPU-starved to ~3 core-minutes in 22 wall-minutes. Every constituent suite this packet's diff can reach was run individually and is green: the whole `test/generator/python` tree (**94 files / 529 tests**), `test/pairwise` (45), `corpus-coverage` + `behavioural-coverage` + `golden-coverage` (586), and `unsupported-register` / `ledger-counts` / `completion-denominators` / `diagnostic-catalog` / `local-run-mapping`. **Rule 14 puts the authoritative full run on the FOLDED tree after the last `git merge origin/main` anyway** — this local one was the pre-check, and the coordinator's is the gate. |

## Open PRs on this fence — cited, not duplicated

| PR | files | overlap |
|---|---|---|
| **#2881**, **#2901** | `repository-builder.ts` (VO id import, nested value object) | **No overlap.** F13 re-routes a TPH concrete *to* the relational builder in `index.ts`; it does not edit `repository-builder.ts`. |
| **#2886** | `routes-builder.ts`, `workflows-builder.ts` | **Overlaps `workflows-builder.ts`**, minimally and by design: three hunks only — `workflowReadPortResolver` renamed `pyReadPortResolver` + exported (line ~422), `collectServiceReadPorts` generalised from `WorkflowIR` to `readonly WorkflowStmtIR[]` + exported (line ~452, one call site updated at ~482), and the read-port section comment. No behaviour change on the workflow path; byte-identical emission. Compose by taking both. |
| **#2903** | `numeric-codec.ts`, `query-projections-builder.ts` | **No overlap.** |
| **#2900** | `auth-emit.ts` | **No overlap.** |

Nothing in this packet touches `routes-builder.ts`, `auth-emit.ts`,
`numeric-codec.ts`, `query-projections-builder.ts` or `repository-builder.ts`.

## Hand-offs (outside the fence — named, not raced)

1. **`shape: embedded` × TPH in the curated corpus — blocked on pairwise F11
   (packet 2c, `src/platform/hono/**`).** The crossing belongs in
   `tph-crossings.ddd` (its header says so, with the exact instruction), but the
   drizzle repository still targets `schema.<own plural>` for a TPH concrete
   whose row lives in the base's shared table, so adding an `embedded` concrete
   there would turn `corpus-tsc-build` red on a defect the fixture is not about.
   **F11 is now a smaller row than the register says**: with D-TPH-BEATS-SHAPE
   pinned, the drizzle *schema* half is already correct (it emits `thingBases` +
   a relational `lines` child table, matching the DDL — verified by generating
   the crossing on node), so only the repository's table target has to move onto
   `tableOwnerName(agg, ctx.aggregates)`. The register's F11 note, written before
   the ruling, says both halves are wrong and calls it "a cross-emitter mission";
   that assessment is stale. Widen the manifest row + add the concrete when 2c
   lands.
2. **The honest alternative to D-TPH-BEATS-SHAPE — packet 2f
   (`src/language/validators/**`).** A silent degrade is still silent: the author
   wrote `shape: embedded` and got relational children. Rule 4 of
   `src/language/validators/inheritance.ts` already refuses `persistedAs:
   eventLog` and `shape: document` under a `sharedTable` base
   (`loom.es-tph-forced-own-table`); extending `forcesOwn` to `agg.shape ===
   "embedded"` would make the crossing an honest refusal on every target at once
   and delete pairwise F11 rather than fix it. That is a language-layer call
   affecting all five backends, so it is recorded in the decision as a follow-up
   and NOT taken here. **A decision the owner may want to make.**
3. **M-T5.14 on dotnet, java and elixir — packet 2f** (which the wave already
   assigns "M-T5.14 read-port on four backends"). The python diff is the
   template and the defect is the same three-in-one: no service import, no port
   argument, no `await`. The shared derivation
   (`src/ir/util/domain-service-read-ports.ts` `readPortsForOperation`) already
   exists and needs no change — each backend's explicit-handler emitter has to
   read it the way its own workflow emitter already does. The ledger row's
   `targets` and `reverified` fields are updated to name exactly those three.
4. **`docs/platforms.md` — one sentence, outside this packet's doc fence.**
   D-PYTHON-SINGLE-REALIZATION says python ships one realization by design;
   `docs/platforms.md` is where a reader looking for the adapter menu will land,
   and it should point at the D-tag so the row is not re-derived. Left to the
   coordinator or a docs packet.
5. **`restore()` is dead on arrival on every backend (RS-27).** Not a new
   finding — `scaffold-macros.ddd` diagnoses it at length and pins the 404 — but
   the new fixture hit it too, so the pin is now on two fixtures and a repair has
   to move both. The underlying call (should a capability's read filter scope an
   operation's LOAD? `softDeletable` and `tenantOwned` want opposite answers)
   remains an owner decision with no D-tag.

## Decisions this packet took (both recorded in `docs/decisions.md`)

- **D-TPH-BEATS-SHAPE** — a TPH concrete's `shape:` never reaches storage; phase
  ⑨ is the authority on what tables exist. Pinned, with the honest alternative
  named as 2f's follow-up.
- **D-PYTHON-SINGLE-REALIZATION** — python ships one realization and that is a
  product statement, not an incomplete implementation. `scope`, owner: the T6
  backend track, on demand.

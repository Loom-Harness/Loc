# Fixture SHAPE coverage audit — why 13 defects walked past ~67 green gates

*Snapshot: 2026-09-29. The scan was taken against `main` @ `cbda916` and the changes are
based on `fb06a53c`; `git diff` reports **zero** `.ddd` changes between the two, so every
count below holds on the newer base. Scope: fixture model SHAPES — not the findings
themselves, and not whether already-fixed findings have regression gates.*

A hands-on platform evaluation found 13 defects in one pass
(`eval-cargo/FINDINGS.md`, branch `claude/loom-platform-eval-mc2v5j`). Four of the five
backends it could compile did not compile. Throughout, ~67 CI workflows were green.

This audit answers why, and it is not "the gates test the wrong things".

## The thesis

> The gates run the right **mechanisms**. What they lack is model **shapes**. A fixture
> that is the simplest model exercising a code path will keep passing over every defect
> that needs a second module, an inheritance base, a cross-context type — a second
> *anything*.

This is the written-up form of `experience_gathered.md` §118, which arrived at it from
F-012: `migration-evolution-e2e` already booted a generated stack **twice against a
populated Postgres** and already asserted a seeded row survived. It passed throughout. Its
fixture had one subdomain and nothing `provenanced`, so there was no later journal entry to
renumber and no year-2999 sentinel to poison the watermark — the positional ordering key
came out monotonic *by luck*.

So the question to ask of a gate is not "does it run the right mechanism" but **"does its
fixture have the shape the defect needs?"**

## Method

A structural scanner lowered **every** `.ddd` in the fleet through the real pipeline
(`lowerProject` → `enrichLoomModel`) and computed shape predicates against the **resolved
IR**, not against source text. Multi-file models were lowered as one project (the entry
document plus every transitive `import`), because lowering only the entry document silently
drops an imported shared kernel's `rootValueObjects`.

- **417** `.ddd` files scanned across `test/fixtures/corpus/`, `test/e2e/fixtures/`,
  `test/behavioral/`, `examples/`, `web/src/examples/`, `journey/`, `docs/audits/models/`.
- **11** are kernel fragments (no `system`, no `context` — an imported type file); **406**
  are models.
- **0** parse failures.

Structural facts (inheritance layout, VO-typed fields, pool of origin for a VO name,
`provenanced`, deployable platforms, projection `groupBy`, precondition statements) come
from the IR. Purely lexical facts (`import`, ICU format specs, `.matches(`,
`enforcement: denyByDefault`) come from source, and are marked as such below.

### Every predicate is positive-controlled

A predicate that cannot fire is a vacuous check — §118's second trap, and the reason a
seeded defect that "passes all six new tests" means the test is the suspect, not the seed.
So each predicate was first shown **firing** on a known-positive model from the
evaluator's own repro set before any zero in the repo column was believed:

| predicate | positive control | fires on control |
|---|---|---|
| VO on a subtype's own field (TPC + TPH) | `eval-cargo/repro/votpc.ddd` | ✅ `Sub` (TPC), `SubT` (TPH) |
| cross-context VO reference | `eval-cargo/repro/voxctx.ddd` | ✅ `Consumer.Code` |
| root VO nested in a context-local VO | `eval-cargo/repro/zodorder/b-root-inner.ddd` | ✅ `C.Outer.a→Code` |
| `domainService` + `precondition` | `eval-cargo/repro/svcproj.ddd` | ✅ `SvcProj.Calc.quote` |
| projection with `group by` | `eval-cargo/repro/svcproj.ddd` | ✅ `SvcProj.ByStatus` |
| `enforcement: denyByDefault` | `eval-cargo/repro/esgate.ddd` | ✅ |

Two predicates were **wrong on the first pass** and were caught by exactly this step:
`projection … group by` read a non-existent `ProjectionIR.groupBy` (it lives on
`query.groupBy`) and `domainService` preconditions were read off a non-existent
`preconditions` array (they are `StmtIR` nodes of `kind: "precondition"` in the body). Both
reported a false **0** until the control forced them to fire. The first version of the
scanner also missed `web/src/examples/erp/**` entirely by not recursing.

## The matrix

Counts are models carrying the shape. `·` is zero. **Bold** rows are shapes with zero or
near-zero coverage that a finding needed. The last column is the evaluator's model
(`eval-cargo/matrix/main.ddd` + its `model/shared.ddd`).

**This table is the state BEFORE the changes in this PR** — it is the finding, not a
scoreboard. The four fixture changes below move six of these cells; the table is deliberately
left as the measurement that motivated them, so a later reader can tell what was missing from
what was added. Column keys: `corpus` = `test/fixtures/corpus/`; `ts`/`java`/`dotnet`/`py`/
`elixir`/`svelte` = the per-backend dirs under `test/e2e/fixtures/`; `migrate` =
`migration-evolution`; `e2e` = files directly in `test/e2e/fixtures/`; `behav`/`behav2` =
`test/behavioral/systems/` and `test/behavioral/`; `web-ex` = `web/src/examples/` (recursive).

| shape | corpus | ts | java | dotnet | py | elixir | svelte | migrate | e2e | behav | behav2 | examples | web-ex | journey | audit | **total** | eval model |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|:--:|
| multi-subdomain (≥2) | · | · | · | · | · | 2 | · | 2 | · | · | · | 3 | 3 | · | 1 | **11** | **yes** |
| multi-context (≥2) | 7 | · | · | 1 | 2 | 2 | · | 2 | · | · | · | 3 | 4 | · | 1 | **22** | **yes** |
| multi-file (`import`) | · | · | · | · | · | · | · | · | · | · | · | · | 4 | · | · | **4** | **yes** |
| root-level VO declared (shared kernel) | · | · | · | · | · | · | · | · | · | · | · | · | 4 | · | · | **4** | **yes** |
| root VO → aggregate field | · | · | · | · | · | · | · | · | · | · | · | · | 4 | · | · | **4** | — |
| **root VO → context-local VO field** | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | **0** | — |
| **cross-context VO reference** | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | **0** | **yes** |
| abstract base declared | 3 | 1 | · | 6 | 1 | 1 | · | · | · | 1 | · | · | 5 | · | · | **18** | **yes** |
| TPC subtype (`ownTable`) | 1 | · | · | 1 | 1 | 1 | · | · | · | · | · | · | 3 | · | · | **7** | **yes** |
| TPH subtype (`sharedTable`) | 2 | 1 | · | 5 | 1 | 1 | · | · | · | 1 | · | · | 3 | · | · | **14** | — |
| VO anywhere under an `extends` subtype | · | 1 | · | · | · | · | · | · | · | · | · | · | · | · | · | **1** | **yes** |
| **VO on a subtype OWN field** | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | **0** | **yes** |
| **… on a TPC subtype** | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | **0** | **yes** |
| **… on a TPH subtype** | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | **0** | — |
| VO on the abstract base own field | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | **0** | — |
| **`tenantOwned` on a subtype** | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | **0** | **yes** |
| `provenanced` field | 1 | · | · | 1 | · | 1 | · | 2 | · | · | · | 1 | 3 | · | · | **9** | **yes** |
| ≥2 backend deployables | 2 | · | · | · | 1 | · | · | · | · | · | · | 4 | 3 | · | 1 | **11** | **yes** |
| projection with `group by` | 3 | · | · | · | · | 1 | · | · | · | · | · | · | 1 | · | 1 | **6** | **yes** |
| `domainService` declared | 2 | · | · | · | · | 3 | · | · | · | · | · | 1 | 1 | · | 1 | **8** | **yes** |
| **`domainService` + `precondition`** | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | **0** | **yes** |
| **ICU format spec in interpolation** | · | · | · | · | · | 1 | · | · | · | · | · | · | · | · | · | **1** | **yes** |
| **`.matches()` regex invariant** | · | · | · | · | · | 1 | · | · | · | · | · | 3 | · | · | · | **4** | **yes** |
| **`enforcement: denyByDefault`** | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | **0** | **yes** |
| `permissions { }` block | 2 | · | · | · | 1 | · | · | · | · | · | · | 1 | 2 | 1 | 3 | **10** | **yes** |
| **named policy fn (`policy X(): bool =`)** | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | **0** | **yes** |
| `tenancy by` | 8 | · | 1 | 2 | 1 | 2 | · | · | · | · | · | · | · | 1 | 2 | **17** | **yes** |
| `crossTenant` | 2 | · | · | · | · | · | · | · | · | · | · | · | · | · | 1 | **3** | **yes** |
| `tenantRegistry` | 3 | · | 1 | 1 | 1 | 1 | · | · | · | · | · | · | · | · | · | **7** | **yes** |
| *(models in family)* | *89* | *24* | *36* | *35* | *31* | *81* | *3* | *8* | *7* | *5* | *3* | *22* | *53* | *5* | *4* | ***406*** | |

## What the zeros cost, finding by finding

| finding | shape its trigger needed | fleet coverage before this audit |
|---|---|---|
| **F-007** zod schemas emitted out of order; react/vue/svelte fail to build | root-level (shared-kernel) VO nested in a **context-local** VO | **0 models** |
| **F-008** cross-context VO ⇒ migration SQL and ORM disagree on column name *and* type (and, on elixir, an undefined serializer) | VO referenced across a context boundary | **0 models** |
| **F-008** (python) VO not flattened for an aggregate that `extends` a base | VO on an inheriting aggregate's **own field** | **0 models** |
| **F-009** `domainService` precondition throws an unimported `DomainError` | `domainService` + `precondition` | **0 models** |
| **F-013** .NET wire validator calls `Regex.IsMatch` with no `using` | a `.matches(<regex>)` VO invariant | **0 corpus**; 4 fleet-wide, **none reaching a .NET or Java gate** (three are `examples/*.ddd`, consumed only by the frontend build matrix; the fourth is elixir-only) |
| **F-004** `denyByDefault` cannot gate a hand-written / ES `create` | `enforcement: denyByDefault` | **0 models** |
| **F-006** `policy` / `permissions` are context-local, not ambient | a **named policy function** (`policy X(): bool = …`) | **0 models** |
| **F-002** ICU format specs dropped; `{x, date}` emits non-compiling TS | an ICU format spec in an interpolation | **1 model** (one elixir fixture) |
| **F-012** first in-place evolution skips its own migration | ≥2 subdomains **and** a `provenanced` field | closed by #3049 |

Three observations sharpen the thesis rather than just restating it.

**1. Inheritance was well covered; the crossing was not.** 17 models carry aggregate
inheritance — TPH, TPC, capability crossings, a document concrete. Not one gives a subtype's
own field a value object. The single fleet-wide near-hit,
`test/e2e/fixtures/ts-build/mikroorm-inheritance-parts.ddd`, puts a VO on an entity **part**
of a subtype, not on the subtype, and it is TPH-only and reaches only the node gate. So the
Python backend — where the defect lived — had never once seen the shape. This is not a
coverage hole in "inheritance" or in "value objects". Both axes are heavily covered
*separately*.

**2. F-007's shape was unreachable by construction, not by omission.** Only four models in
the repo declare a root-level VO, all under `web/src/examples/`. Three are multi-file, and
`react-build-cases.ts` says in its own header that it is single-file-only — *"the build
harness copies one .ddd into a temp dir … so multi-file examples with `import "./…"`
(erp/main.ddd, fulfillment-newest.ddd) can't be built"*. The fourth,
`erp/inventory.ddd`, has no `system` and no `deployable` at all — it is a composition
partial. The react gate builds 20 models: **0 multi-file, 0 with a root-level VO.** The three
gates F-007 breaks could not see a shared kernel even in principle. A shape can be absent
from a gate because the *harness* excludes the only models that carry it — which no
per-fixture review would find.

**3. Not every survival is a shape gap, and the report is weaker if it pretends otherwise.**
`projection … group by` has **6** models, 3 of them in the corpus, compiled by
`corpus-tsc-build`. F-010 (a projection publishing an empty response schema) still survived.
Whatever let that through is not a missing shape, and this audit does not explain it. Same
for F-001 and F-011. Claiming the thesis covers all 13 would be the "plausible fix that
satisfies the easy invariant" §118 warns about.

## What was changed, and the proof for each

Four changes, smallest-diff-first, all in the shared corpus — the one fixture family every
backend's generation gate *and* compile gate reads, so a single `.ddd` reaches five backends
instead of needing a per-backend duplicate. Every change is mutation-proved or caught a live
defect. (The three new fixtures declare fewer than five backends: each excludes, by name and
with a reason, the backend that currently cannot compile the shape — see below.)

### 1. `test/fixtures/corpus/inheritance.ddd` — widened (no new fixture)

Adds `valueobject SiteCode { region, code }` and puts it on a subtype's **own** field on
both layouts: `Vendor extends Party` (TPH — the flattened columns land on the SHARED table
and are NULLABLE there, because `Customer` does not declare them) and `Machine extends Asset`
(TPC — own table, NOT NULL).

It goes on the two **non-`crudish`** subtypes deliberately. `Customer` is the subtype the
fixture's `test e2e` block creates and updates, and those request/response bytes are the
reviewed answer key in `test/behavioral/wire-golden/inheritance.json`. Adding a field to
`Customer` makes `site` a required create *and* update param, so the existing
`api.customers.update(c, { creditLimit: 250 })` call starts answering 422 and every recorded
body changes — a golden re-capture on five booted backends. `Vendor`/`Machine` are only ever
read **empty** by the suite (an empty list and a 404 envelope, neither of which names a
field), so the e2e block stays **byte-identical**, the golden stays valid, and the compile
tiers still see the flattening on both layouts. Verified by diffing the block against the
original.

**Mutation proof — the two-arm form.** A defect was seeded in
`src/generator/python/repository-builder.ts` so a VO field on an aggregate with
`extendsAggregate` hydrates from the *unflattened* column name (F-008's exact asymmetry:
non-inheriting aggregates untouched). Then the *same* seed, the *same* gate, the *same*
command, against the two fixture versions:

| fixture | `corpus-python-build × inheritance` |
|---|---|
| original | **green** — the gate was structurally blind |
| widened | **red** — `"MachineRow" has no attribute "site"` (TPC) and `"PartyRow" has no attribute "site"` (TPH, via `vendor_repository.py`) |

The proof was re-run after the fixture was restructured onto `Vendor`/`Machine`, because a
proof that predates its subject proves nothing.

Showing only the red arm would not prove the widening did anything; the green arm is the
claim. Seed reverted **by file copy**, never `git checkout --` (§84).

### 2. `test/fixtures/corpus/vo-cross-context.ddd` — new

`Billing.Receipt.shipTo` resolves to `valueobject Addr` declared in the sibling context
`Directory`. `Addr.geo: Geo` keeps the nesting in play, since a cross-context lookup that
succeeds at the first level and fails at the second is the likelier bug.

**Mutation proof.** The sibling-context fallback was removed from
`findValueObjectInScope` (`src/ir/util/reachable-types.ts`):

| fixture | `corpus-tsc-build` under the seed |
|---|---|
| `nested-valueobject` (VO in VO, same context) | **green** |
| `optional-valueobject` | **green** |
| `vo-field-default` | **green** |
| `value-collections` | **green** |
| **`vo-cross-context`** (new) | **red** — 8 errors, incl. `'shipTo' does not exist in type … shipTo_line1 … shipTo_geo_lat …` |

The four closest pre-existing VO fixtures all stay green. Only the new shape catches it.

**It also found live defects, unseeded — on TWO backends, for one root cause.** Both emitters
resolve a VO name through `ctx.valueObjects` only, so the **call site** (derived from the
aggregate's wire shape, which spans contexts) is emitted while the **definition** (derived
from the context's own VO list) is not:

- **python** — `db/schema.py` and the migration create `ship_to_line1` / `ship_to_geo_lat` /
  `ship_to_geo_lng`, while `receipt_repository.py` binds `"ship_to": aggregate.ship_to` on
  insert, `root["ship_to"]` on upsert, and reads `ship_to=row.ship_to` on hydrate — a column
  in **neither** artifact. `mypy --strict` sees only the hydrate site; the two bind sites are
  untyped dict literals, so a live request fails on all three.
- **elixir** — `receipt_controller.ex` calls `serialize_addr(record.ship_to)` and defines
  neither `serialize_addr/1` nor the nested `serialize_geo/1`, while the **owning** context's
  `person_controller.ex` defines both. `** (CompileError) undefined function
  serialize_addr/1` — `mix compile --warnings-as-errors` fails outright.

node/dotnet/java are correct and ride as the contrast.

### The elixir half is a correction to this audit, and it belongs in the record

The first version of this document, and of the fixture's own header, recorded elixir as
**free by construction** — "a VO is one `:map`/jsonb cell there, so there is no flattening to
get wrong". The reasoning was sound. The conclusion was wrong, and the reason it was wrong is
the same mistake this audit is about: **I graded elixir by INSPECTING its emitted schema
instead of compiling the project.** Flattening is not the only artifact a VO needs; the
serializer helper is another, and it is emitted from the context-local VO list. `mix compile`
in CI found it within minutes of the PR going out of draft.

Two things follow that are worth more than the defect:

1. **It is the same failure mode one level up.** §118's thesis is that a gate can run the
   right mechanism and still be blind because of its fixture. This was a *reviewer* running
   the right reasoning and still being blind because of the artifact he read. The commons
   dev-experience audit had to make the identical correction for the identical reason
   (`2026-09-13-commons-dev-experience.md` — "targets were graded by INSPECTION rather than
   compiled"), which is now two audits in three weeks.
2. **The fixture did its job before anyone believed it.** The shape was added because the
   *inventory* said nothing in the repo had it, not because anyone suspected elixir. It then
   caught a backend the audit had explicitly written off as safe. A shape-driven fixture finds
   defects its author did not predict — which is the strongest available argument that the
   gap was worth closing, and not one the mutation proof could have made.

The `elixir` column in the verification table below was `gen ✅` on this fixture for exactly
this reason: generation succeeded, so inspection had nothing to catch. Only `mix compile` did.

### 3. `test/fixtures/corpus/vo-root-kernel.ddd` — new

A root-level VO nested inside a context-local one, carrying **both** nesting directions
(root VO → aggregate field, which the examples had; root VO → context-local VO field, which
nothing had).

**No seed needed — it caught F-007 surviving on two backends.** The frontend half was fixed
(`web/src/api/<agg>.ts` now orders correctly); the backends were not:

- **node** — `http/shipment.routes.ts` emits `const OuterSchema` referencing
  `UnLocodeSchema` four lines before `const UnLocodeSchema` is declared:
  `TS2448: Block-scoped variable 'UnLocodeSchema' used before its declaration` + `TS2454`,
  twice. A TDZ read is fatal at module evaluation, so the generated API does not boot — and
  the emitted `Dockerfile` builds with `tsup`/esbuild, which strips types without checking
  them, so `docker compose build` ships it (the evaluation's condition C5).
- **python** — `app/domain/value_objects.py` and `app/http/wire_models.py` both emit
  `class Outer` (annotating `origin: UnLocode`) ahead of `class UnLocode`: `ruff F821
  Undefined name 'UnLocode'`, four times.

One emission-order bug, two backends, from one shape — which is the argument for carrying
the shape in the shared corpus rather than per-backend.
`orderValueObjectsByDependency` (`src/ir/util/reachable-types.ts`) already exists to fix it.
dotnet/java are free (declarations hoist), elixir is free (no per-VO schema const).

### 4. `test/fixtures/corpus/vo-regex-invariant.ddd` — new

A `.matches(<regex>)` VO invariant — the shape that makes a backend lift a regex into a
*second* emitted file (the wire/request validator) beside the domain class that already had
one. The corpus had **zero** regex invariants.

**No seed needed — F-013's defect class is live on a second backend.** dotnet (F-013's own
subject) is fixed and verified with `dotnet build /warnaserror`; node is free (inline
`/re/.test(...)`); java imports `java.util.regex.Pattern`; elixir is free. **Python** emits
`re.search(...)` into `app/http/wire_models.py` whose import block has no `import re`
(`ruff F821 Undefined name 're'`) — while the domain half imports it correctly. Same
two-emitters-one-import shape, second backend.

### All three new fixtures are compile-tier-only, and that is a finding too

None of the three carries a `test e2e` block. `golden-coverage.test.ts` makes "this case
records but has no golden" a failure precisely because the alternative shape has hit `main`
twice — *"a PR mints a recorded case — a corpus fixture that grows a `test e2e` — without
capturing its golden; the fast suite is green, the PR merges, and seven heavy legs go red
afterwards."* A wire golden can only be captured from a **booted** stack on every backend,
and two of these three shapes currently prevent a boot (node's TDZ read, python's unresolved
classes and missing import). Capturing a golden now would either fail or freeze the defect
as the reviewed answer key. So each fixture states `COMPILE-TIER ONLY` and the reason, the
way `find-bypass.ddd` and `projection-agg-filters.ddd` already do, and names the PR that
should add the runtime half — the one that fixes the emitter.

This is worth recording as a constraint on *how* a shape gap gets closed, not just which
gaps exist: **a shape can be added to the compile tier long before the runtime tier can
accept it**, and for a shape whose whole point is that some backend is broken, the compile
tier is the only tier available. The runtime assertion each fixture wants is written down in
its header so the follow-up does not have to re-derive it.

### The three live defects are excluded by name, not hidden — and not by a compile-skip

The first attempt put each broken backend in `PYTHON_COMPILE_SKIP` / `TS_COMPILE_SKIP`, and
`test/system/gate-ledger.test.ts` refused it: *"A cell here emits and is never compiled or
booted. Fix the emitter or the leg — do not add an exemption; `generate` is not a gate, it is
the floor every other tier stands on."* The same file also asserts every corpus
`*_COMPILE_SKIP` map stays **drained**. So a compile-skip was the wrong instrument, and the
gate said so before anything was pushed.

The right one is the manifest's own `backends:` list, which is where this repo already records
a reasoned per-backend exclusion (`TPH_CAPABILITY_FILTER` excludes dotnet for EF Core's
root-only query filters; `IN_APP_DOCUMENT_FILTER` names its own history). Each of the three
gets a **named constant** whose doc comment is the defect report — the emitted artifacts that
disagree, the exact diagnostic, which half is correct, and the one change that returns the
key:

- `SIBLING_VO_RESOLUTION` — excludes python **and elixir** (`vo-cross-context`)
- `ORDERED_ROOT_VO_EMISSION` — excludes node and python (`vo-root-kernel`)
- `WIRE_REGEX_IMPORT` — excludes python (`vo-regex-invariant`)

Each also carries a signed entry in `gate-ledger.test.ts`'s `BEHAVIOURAL_ABSENT`, which is
bidirectional: a new compile-only feature needs a reason, and a feature that gains a
behavioural block must lose its entry. None of the three defects is fixed here —
`src/generator/python/` is another unit's, and this audit's subject is shape coverage.

### Verification actually run

| fixture | declared backends | node `tsc` | python `ruff`+`mypy --strict` | dotnet `/warnaserror` | java `compileJava` | elixir |
|---|---|:--:|:--:|:--:|:--:|:--:|
| `inheritance` (widened) | all 5 | ✅ | ✅ | ✅ | ✅ | gen ✅ |
| `vo-cross-context` | 3 — python + elixir excluded | ✅ | *excluded (live defect)* | ✅ | ✅ | *excluded (live defect, found by CI)* |
| `vo-root-kernel` | 3 — node + python excluded | *excluded (live defect)* | *excluded (live defect)* | ✅ | ✅ | gen ✅ |
| `vo-regex-invariant` | 4 — python excluded | ✅ | *excluded (live defect)* | ✅ | ✅ | gen ✅ |

Every declared cell generates (`corpus-coverage`) and compiles on the tier its backend has.
The excluded cells were each verified to actually disappear from their gate rather than
silently pass — `LOOM_CORPUS_PYTHON_CASE=<id>` reports "No test found" for all three, and
`LOOM_CORPUS_TSC_CASE=vo-root-kernel` likewise, while the other two still run and pass on
node. An exclusion that does not exclude, or that removes more than it names, is the same
vacuous-check failure as a predicate that cannot fire.

Also green: `gate-ledger` (incl. the `generateOnly` and signed-register checks),
`golden-coverage`, `behavioural-coverage`, `feature-doc-coverage`, `npm run lint`,
`npm run test:typecheck`, and `npm test`.

dotnet in `mcr.microsoft.com/dotnet/sdk:10.0`, java in `gradle:9-jdk25` (the host's JDK 21
cannot build the emitted Java-25 toolchain). `bootJar` was not reached — Maven Central
answered `429` through the sandbox proxy — so the java column is `compileJava`/`testClasses`
only. Elixir was verified by generation plus inspection rather than `mix compile` — it needs the
`LOOM_HEX_MIRROR` path — **and on `vo-cross-context` that was not good enough**: CI's
`mix compile` found a defect inspection could not see (see the correction above). Treat the
`gen ✅` cells in the elixir column as "generation only, not compiled", because that is all
they are. The audit's own conclusion here is that an elixir claim in this repo is not safe
until `mix compile` has run, and `docs/tools.md` ships the hex-mirror recipe that makes it
runnable locally.

## Shapes deliberately NOT added, and why

Dropping a shape is the right call when it would cost more than it catches. Each of these is
a real gap; none is closed here.

| shape | why not now |
|---|---|
| `enforcement: denyByDefault` (0 models) | F-004 reports it as partly **unsatisfiable** — `requires` has no grammar slot on `create`, and it is mutually exclusive with `persistedAs: eventLog`. A fixture would encode a language bug as an expectation. Needs the language decision first. |
| named policy function (0 models) | F-006's subject is that a named `policy` is context-local while documented as ambient. Same objection: the fixture would freeze the current scoping, and the finding is a request to change it. |
| `domainService` + `precondition` (0 models) | Worth adding and cheap; not done here only to keep this PR's four changes each individually proved. Next in line — the shape is a one-line addition to `corpus/domain-services.ddd`. |
| ICU format specs (1 model) | F-002 is a whole-feature gap (formats parse and are dropped on every backend), not a fixture-shape gap. A fixture would go red on five backends at once and belongs with the feature work. |
| `tenantOwned` on a subtype (0 models) | Tenancy × inheritance is a genuine uncovered crossing, but no finding needed it and nothing observed fails. Adding it would be decoration until there is evidence. |
| root VO in a **frontend** gate | The blocker is the harness (`react-build-cases.ts` is single-file-only), not a fixture. `vo-root-kernel.ddd` reaches the same emitters through the backend gates at no runner cost; teaching the frontend harness to build a multi-file model is a separate change. |

## What the repo's own ratchets caught, in order

Worth recording because all four were shortcuts that *looked* finished, and none of them
reached CI:

1. **`gate-ledger.test.ts` → "every e2e-declaring case that boots has a golden"** — the three
   new fixtures shipped with `test e2e` blocks and no wire goldens. This is the failure the
   gate's own header says has turned `main` red twice.
2. **`gate-ledger.test.ts` → "no cell is held up by generation alone"** — the fix for (1) was
   to skip-list the broken backends, which left four cells that only *generate*. Refused:
   *"`generate` is not a gate, it is the floor every other tier stands on."* The same file
   asserts every corpus `*_COMPILE_SKIP` map stays drained. The exclusion had to move into the
   manifest's `backends:` list as a named, reasoned set.
3. **`gate-ledger.test.ts` → "the cells that stop at the compile tier are exactly the signed
   ones"** — bidirectional, so each new compile-only feature needed a written reason in
   `BEHAVIOURAL_ABSENT`.
4. **`allowlist-ratchet.test.ts` + `api-caller-census.test.ts`** — the `BEHAVIOURAL_ABSENT`
   count (27 → 30) and the `E2E_LESS_CORPUS_FIXTURES` register both had to be raised *with a
   reviewed line in the diff*, which is exactly what those ratchets exist to force.
5. **`coverage-guarantee.test.ts`** — this very document failed CI until it was dispositioned
   in `docs/new-plan/coverage.md`. The guarantee there ("every doc … is listed here") was
   prose-enforced and drifted twice before it became a test; an audit that files three live
   defects and is not mission-mapped is exactly what it exists to stop.

A sixth was caught by reading rather than by a gate: the first cut put the new value object on
`Customer`, the `crudish` TPH subtype the existing `test e2e` block creates and updates — which
makes `site` a required create *and* update param, so `api.customers.update(c, { creditLimit:
250 })` starts answering 422 and every recorded body in
`test/behavioral/wire-golden/inheritance.json` changes. Moving it to the two non-`crudish`
subtypes keeps the e2e block byte-identical and the golden valid.

The through-line is the same one §118 draws: *a check that never reaches the thing it names
reads as a pass.* Here it ran the other way — the checks reached, and each one named a
specific shortcut. Two of them (1 and 2) would have been invisible to review and red on `main`.

## The reusable lesson

Fixture review asks "does this fixture exercise the feature?" and every fixture here passed
that test. The question that finds these gaps is different, and it is answerable
mechanically:

> For each pair of features the language can combine, does **any** fixture combine them —
> and does that fixture reach the gate for the backend where the combination is emitted?

Both halves matter. Inheritance had 17 fixtures and value objects had dozens; the *crossing*
had zero. Root-level VOs existed in four models and every one of them was excluded from the
gates that would have compiled them.

The scanner that produced this matrix is ~200 lines over the public IR
(`lowerProject` → `enrichLoomModel` → predicates) and is not checked in: as a standing gate
it would need a policy for which crossings are *required*, which is a larger design question
than this audit settles. It is reproducible from this document's method section, and its
per-model output is what every count here was read off.

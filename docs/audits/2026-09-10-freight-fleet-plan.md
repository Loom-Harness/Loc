# Freight-audit fleet plan (rev. 2)

**Snapshot 2026-09-10, `main @ 93bc82d`.** Findings:
[`2026-09-10-freight-dev-experience.md`](2026-09-10-freight-dev-experience.md)
(Part 1 = node+react, Part 2 = the other nine targets). This file is the ORDER,
the FILE OWNERSHIP that keeps a parallel fleet from colliding, and the decisions
that gate part of it.

`docs/new-plan/` remains the only authoritative status table. This is a plan
snapshot; if the two disagree later, the track file wins.

**Rev. 2 replans rev. 1 for three things that changed:** Part 2 (five of nine
retargeted variants do not build), a **fourth** parallel dev-experience audit
(#2865), and #2850 leaving draft. The mission set is now grouped by **root
cause and fix seam** rather than by symptom, because Part 2 showed several
symptoms share one cause — and one of those causes is better closed by a gate
than by four patches.

## The field: four audits, one fleet

| PR | Audit | Claims |
|---|---|---|
| #2861 | Jira-like tracker | parameterized projection parameter drop, Vue attribute escaping, first-run docs, two create-input gates |
| #2862 | e-shop | macro-emitted members vs `denyByDefault`, a codegen crash on a client-unevaluable gate, two walker miscompiles, **the `user{}` `X id?` claim**, the `find` deprecation's hidden costs, a docs-fence ratchet |
| #2864 | freight forwarding (this one) | everything in this plan |
| #2865 | insurance claims | the `softDelete` hook `tsc` error, `currentUser.<undeclared>` falling back to `string`, `crudish update` bypassing `requires`, `policy`/`deny` keyword friction |

Deduped in both directions. Nothing below is claimed by any of the other three.

## The root causes, and why the grouping changed

Rev. 1 had one mission per symptom. Part 2 showed four symptoms are the **same
defect class**: *an emitter names a type it never emits or imports.*

| site | shape | who |
|---|---|---|
| a `valueobject` holding an `X id` → `value-objects.ts` has no imports | missing import | **RC-1a** (this plan) |
| `user { … : X id? }` → missing import on node/python/java; `CustomerId??` on dotnet | missing import + doubled nullability | **#2862** (escalated by my T1) |
| a workflow's enum state field → `<Enum>Schema`, emitted nowhere, imported from an unrelated module on the frontends | missing emission + wrong module | **RC-1b** |
| a workflow's `command` parameter → `<Payload>Response`, emitted on no backend | missing emission | **RC-1c** |

Four emitters, one invariant: **every symbol a generated file references must be
emitted or imported.** That invariant is checkable mechanically, and a gate for
it would have caught all four plus #2862's. So the plan now leads with the gate,
carrying a waiver per known site, and each fix deletes its own waiver — the
repo's standing ratchet convention, applied here instead of "fixture last".

## Wave 0 — the ratchet, first (1 agent)

| Mission | What | Owns |
|---|---|---|
| **M-T9.59 — the unresolved-symbol gate** | Generate the corpus **plus** four new fixtures carrying the shapes above, and assert every referenced symbol in the emitted TypeScript/Python/Java/C#/Elixir resolves. Land it with one waiver per known-broken site, each naming its mission. | a new `test/system/` gate + `test/e2e/fixtures/ts-build/**` |

Landing this first inverts the usual order deliberately: the gate is **red by
construction** on day one, its waiver list *is* the work list, and each fix below
lands with its waiver deleted. That is the repo's own "waivers ratchet" rule, and
it is what stops these four from recurring — the corpus has no value object
holding an `X id`, no enum-stated workflow, and no `managed` field with a default,
which is precisely why three emitters can ship non-compiling output today.

## Wave 1 — the fixes that need no decision (5 agents, disjoint)

Sized at five concurrent, not nine: the runner pool is shared with three other
audit fleets and a merge queue, and every one of these triggers the per-backend
compile gates.

| # | Mission | Fixes | Owns | Proof it must carry |
|---|---|---|---|---|
| 1 | **M-T2.15 — the migration diff models a value-collection field as a root column** | D1 | `src/system/migrations-builder.ts` (`schemaFromModule`) | **The only data-destroying finding.** Seed the pre-fix deriver, show the phantom `ADD COLUMN … JSONB[]` appears; after the fix, gen-2 emits only `CREATE TABLE <agg>_<field>`. Then apply both migrations to a real postgres and insert a row — Part 1's proof, as a test. |
| 2 | **M-T6.63 — a `managed`/`internal` field's declared default is discarded** | D2 | the node create-factory emitter; the `money` default arm on python/dotnet/java | The 3×5 matrix as a table test. **Elixir is the reference — it is already right in every cell.** |
| 3 | **M-T6.64 — a `valueobject` holding an `X id` emits a file with no imports** (RC-1a) | D3 | the TypeScript value-object emitter | `tsc --noEmit` on a project whose VO carries an `X id`; **delete the RC-1a waiver**. Coordinate with #2862 — same class, different emitter. |
| 4 | **M-T6.67a — a `command`-typed workflow parameter has no wire type on any backend** (RC-1c) | D7 / T2 | the workflow request-record emitters, all five backends | All five reference `<Payload>Response`; none emits it (.NET also misses the domain `FileClaim`). A flat record — no design question. **Delete the RC-1c waiver.** Compile-check at least node + one of java/dotnet. |
| 5 | **M-T1.33 — a nullable `X id?` reference emits an unguarded link on all six frontends** | T4 | the reference-link renderer in `src/generator/_frontend/` + the six walker targets | Two of six fail to build (vue TS2345, feliz `string` + `string option`); four render `/locations/null`. **Flutter already null-guards `datetime`/`money` on the same page — reuse that helper.** Proof: build vue, and show feliz no longer concatenates a `string option`. |

## Wave 2 — after wave 1 frees slots (4 agents)

| # | Mission | Fixes | Owns | Notes |
|---|---|---|---|---|
| 6 | **M-T6.65 — the enum-stated workflow, backend AND four frontends** (RC-1b) | D4 / T3 | `src/platform/hono/v4/workflow-builder.ts` + the frontend workflow-client emitter | Opens a file **#2850 owns** — stack on its branch (it left draft today) rather than waiting for merge. The aggregate route emitter is the reference; it emits `const HandlingKindSchema = …` locally. Also corrects T4's "runtime-proven at five-backend parity" line, which cannot have included a node typecheck of an enum-stated saga. **Delete the RC-1b waiver.** |
| 7 | **M-T1.34 — Svelte: two operations on one aggregate redeclare their picker** | T5 | the Svelte page-shell emitter | `Identifier '__locations' has already been declared`. Dedupe per page. Any aggregate with two such operations is un-buildable today. |
| 8 | **M-T5.30 — two validator rulings** | G2, G4 | `src/ir/validate/checks/`, `src/diagnostics/messages.ts` | Reactor-without-starter (the ruling #2850's `create-state.ts` header defers); and the VO-collection-vs-entity-containment create-input asymmetry. Confirm the create-input boundary with #2861 slice 4 and the validator boundary with #2865 D2 — all three touch `src/ir/validate/`. |
| 9 | **M-T9.60 — parser and CLI papercuts** | the `money("…")` ambiguity, the two summary lines | `src/language/ddd.langium`, the CLI reporter | `MoneyLit` and `PrimitiveConversion` both match `money("10.50")`, so every parse of a money-carrying model prints four lines of Chevrotain internals — on the repo's own `examples/showcase.ddd`. Proof: stderr clean. |

## Wave 3 — the tail (4 agents)

| # | Mission | Fixes | Notes |
|---|---|---|---|
| 10 | **M-T2.16 — a scalar-literal field default becomes a SQL column DEFAULT** | G1 | **Stacks on M-T2.15** (same file). Gated on decision D-3. |
| 11 | **M-T3.18 — masked / `secret` fields leave the list-read sort allowlist** | G3 | An unauthorized caller can order by a value they cannot read. |
| 12 | **M-T6.66 — `handle` continuations** | D5 | Gated on decision D-1. Opens the same five workflow emitters as #2850 and mission 6. |
| 13 | **M-T6.68 + M-T1.32 + the Angular notes** | T6, the VO subform, T7 | Small, batchable: the Python channel-tee annotation; the VO subform's missing picker / `datetime-local` / `error=`; the Angular root `tsconfig` including `e2e` with no `@playwright/test` declared anywhere. |

Also free, now, no mission needed: **`docs/language.md:435`** still says a
`create` body "populates a fresh `this`", which is backwards for the default
persistence mode. #2862's docs-fence ratchet will not catch prose. One line.

## The decisions that gate waves 2 and 3

### D-1 — `handle` continuations: implement, or reject? (gates mission 12)

Documented as the multi-command saga surface (`docs/workflow.md:318`), emitting
nothing anywhere, silently. **(a)** implement on all five backends — marginal
cost is lowest right now, since #2850 is building the instance load/mutate/save
seam for `create`; **(b)** reject with a `loom.*` code and drop the surface from
the docs, consistent with the frozen saga-compensation decision; **(c)** reject
now, implement later.

**Recommendation: (c).** The silence is the bug. Mint the code in wave 2 (it is
disjoint from #2850) and let the emitter be a separate, unhurried decision.

### D-2 — entity-part parameters: materialize, or reject? (gates the 67b half)

Rev. 1 posed this for both parameter kinds. Part 2 settled the payload half —
it is a flat record with no identity question, so mission 4 just emits it, no
decision. What remains is the **entity** half, which hides a language question
the DSL has never answered: does a client-supplied part *replace* the collection
(new ids, orphaning history) or *merge* by id?

**Recommendation: reject entity-typed parameters** with a `loom.*` code pointing
at the value-object alternative — which is what a DDD-literate author should
reach for anyway (a `Leg` in an itinerary is a value object in Evans' own model)
— and defer the identity question to a proposal rather than guessing at it in an
emitter.

### D-3 — should a DSL field default reach the DDL? (gates mission 10)

Today `status: string = "pending"` never reaches the DDL, so the natural way to
add a required column non-destructively does not work and the author restates
the value in a `migration {}` block. Against: a column default is a second
source of truth for a value the domain layer owns.

**Recommendation: the middle path** — emit the DEFAULT only *inside* the
add-column diff so the backfill is automatic, then `DROP DEFAULT` in the same
migration. The column ends up exactly as it is today; the friction disappears;
no runtime surface changes.

### D-4 — re-price M-T3.16 (the inert `create` body)

Not a new finding, but this build is evidence about its cost. A state-based
aggregate's `create` body is entirely inert, so in a DSL whose pitch is DDD the
aggregate cannot guard its own construction or raise its creation event — the
canonical "book a cargo" factory had to become a workflow. And the workflow
escape hatch is itself leaky (#2850, missions 4, 6, 12). The two gaps compound.

**Recommendation:** land the one-line docs correction now, and re-price the
mission upward on the strength of four independent audits reaching for the same
workaround.

## Shape and pacing

Thirteen missions: one gate, five decision-free fixes, four followers, four in
the tail. **Five concurrent agents**, not nine — the runner pool is shared with
three other audit fleets and a merge queue, and every mission here triggers a
per-backend compile gate.

Two ordering rules carry the plan:

1. **The gate goes first, red, with a waiver per known site.** Each fix deletes
   its own waiver. The work list and the regression guard are the same artifact.
2. **Compiling one target is not evidence about the others.** Part 2's whole
   yield came from retargeting a model that already passed on node+react: three
   of Part 1's findings were under-scoped, and two defect classes were invisible.
   Every mission above names the targets its proof must cover.

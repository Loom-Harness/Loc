# Freight-audit fleet plan — the order for draining #2864

**Snapshot 2026-09-10, `main @ 93bc82d`.** The findings are in
[`2026-09-10-freight-dev-experience.md`](2026-09-10-freight-dev-experience.md);
this file is the ORDER, the FILE OWNERSHIP that keeps the fleet from colliding,
and the four design decisions that gate part of it.

Per the repo's rule, `docs/new-plan/` is the only authoritative status table.
This is a plan snapshot, not a status register — if the two disagree later, the
track file wins.

Every finding below was **re-verified on fresh `main` after the audit was
written** (the 19-commit drift). All five headline defects still reproduce.

## What the fleet must not touch

Three PRs are in flight over adjacent code. File ownership is the whole reason
this plan exists.

| In flight | Owns | Fleet rule |
|---|---|---|
| **#2850** (F58 / M-T6.60) | all five workflow emitters — `src/platform/hono/**` workflow files, `src/generator/{dotnet,java,python,elixir}/**` workflow files, `src/generator/_workflow/create-state.ts` | **Wave 2 only.** No wave-1 mission opens a workflow emitter. |
| **#2862** (e-shop audit) | the auth emitters, `src/generator/_walker/`, `src/generator/_frontend/gate-expr.ts`, the macro stdlib, a docs-fence ratchet | M-T6.64 must confirm the `Ids`-import split with them first (see its row). M-T1.32 stacks behind their walker work. |
| **#2861** (tracker audit) | projection emitters on all five backends, Vue emitter, first-run docs, two create-input gates | M-T6.67 shares the *directory* `src/platform/hono/v4/` but not a file. M-T5.30 must confirm the create-input gate boundary with them. |

## Wave 1 — six agents, fully disjoint, start now

No two of these open the same file, and none opens a file the three in-flight
PRs own.

| Mission | Fixes | Owns | Proof it must carry |
|---|---|---|---|
| **M-T2.15** — the migration diff models a value-collection field as a root column | D1 | `src/system/migrations-builder.ts` (`schemaFromModule`), `test/system/migrations-*` | Seed the pre-fix deriver, show the phantom `ADD COLUMN … JSONB[]` appears; after the fix, show gen-2 emits only `CREATE TABLE <agg>_<field>`. Then **apply both migrations to a real postgres and insert a row** — the audit's proof, as a test. |
| **M-T6.63** — a `managed` / `internal` field's declared default is discarded | D2 | node create-factory emitter; the `money` default arm in `src/generator/{python,dotnet,java}` | The 3×5 matrix in the audit as a table test. Elixir is the reference implementation — it is already right in every cell. |
| **M-T6.64** — a `valueobject` holding an `X id` emits a file with no imports | D3 | the TypeScript value-object emitter | `tsc --noEmit` on a generated project whose VO carries an `X id`. **Coordinate first:** #2862's D6 is the same class in the auth emitters. One slice or two is their call; do not land a duplicate fix. |
| **M-T6.67** — entity-part and payload-typed parameters have no wire materialization | D6, D7 | the operation/workflow request-schema + call-site emitters on node/dotnet/java/python | The value-object arm is the reference (`new LineVO(e.sku, e.qty)`). Decide materialize-vs-reject per D-2 below **before** writing code. |
| **M-T5.30** — two validator rulings | G2, G4 | `src/ir/validate/checks/`, `src/diagnostics/messages.ts` | A reactor-without-starter model must fail the new gate and pass after adding a starter. Confirm the create-input boundary with #2861's slice 4 first. |
| **M-T9.59** — parser and CLI papercuts | the `money("…")` ambiguity, the two contradictory summary lines | `src/language/ddd.langium` (the `MoneyLit` / `PrimitiveConversion` overlap), the CLI reporter | `ddd parse examples/showcase.ddd` must print no Chevrotain output, and one summary line. A regression test asserting stderr is clean on a money-carrying model. |

## Wave 2 — two agents, after #2850 merges

Both open workflow emitter files #2850 owns. Stack on its branch or wait for the
merge; do not run them concurrently with it.

| Mission | Fixes | Owns | Proof |
|---|---|---|---|
| **M-T6.65** — a workflow with an enum state field emits an undefined `<Enum>Schema` | D4 | `src/platform/hono/v4/workflow-builder.ts` | The aggregate route emitter is the reference: it emits `const HandlingKindSchema = z.enum([…])` locally before use. `tsc --noEmit` on an enum-stated saga. Note this breaks the **event-triggered** path too, so it invalidates T4's "runtime-proven at five-backend parity" claim for that shape — the mission must also correct that line. |
| **M-T6.66** — `handle` continuations emit nothing on any backend | D5 | all five workflow emitters | Gated on decision D-1 below. If "implement": a `handle` route on all five, plus an instance-state round-trip test. If "reject": one `loom.*` code and a corpus sweep. |

## Wave 3 — three agents, after wave 1

| Mission | Fixes | Owns | Depends on |
|---|---|---|---|
| **M-T2.16** — a scalar-literal field default becomes a SQL column DEFAULT | G1 | `src/system/migrations-builder.ts` + the per-backend DDL renderers | **Stacks on M-T2.15** — same file. Gated on decision D-3. |
| **M-T3.18** — a `mask unless` / `secret` field leaves the list-read sort allowlist | G3 | the sort-enum emitter + a validator gate | Independent; wave 3 only to keep wave 1 at six. |
| **M-T9.60** — a coverage ratchet over the ts-build fixture matrix | the systemic point | `test/e2e/fixtures/ts-build/**`, a new ratchet test | **After wave 1**, because each wave-1 mission adds its shape to the fixture; this pins the matrix so the next three cannot recur. |
| **M-T1.32** — value-object subforms lose the picker, the `datetime-local` input and the `error=` binding | the scaffold papercut | the subform renderer under `src/generator/_walker/` | Behind #2862's walker slices. |

## The four decisions that gate the plan

These are not defects with an obvious fix — someone has to choose. Wave 2 and
M-T2.16 should not start until D-1 to D-3 are answered.

### D-1 — `handle` continuations: implement, or reject?

`docs/workflow.md:318` sells `handle` as the multi-command saga surface. Today
it emits nothing anywhere, silently. Three options:

- **(a) Implement on all five backends.** Honours the documented surface. Cost:
  five emitters, plus the instance load / mutate / save seam — most of which
  #2850 is already building for `create`, so the marginal cost is lower now than
  it will ever be. This is the recommendation *if* sagas are a surface we intend
  to keep selling.
- **(b) Reject with a `loom.*` code and delete the surface from the docs.**
  Cheap, honest, and consistent with the frozen saga-compensation decision
  (T4: "sagas are already expressible today — authors write a form-4 workflow
  with explicit failure handlers"). Cost: a documented feature disappears.
- **(c) Reject now, implement later.** Mint the code in wave 1 (it is disjoint
  from #2850), schedule the emitter behind it. Gets the silence closed this week
  without committing five emitters.

**Recommendation: (c).** The silence is the actual bug; the emitter is a feature
decision that does not need to be made under time pressure.

### D-2 — entity-part and payload-typed parameters: materialize, or reject?

- **(a) Materialize.** Emit the construction the value-object arm already emits.
  For an entity part this means minting `id` and threading `parentId` — which
  raises a real semantic question the DSL has never answered: does a client-
  supplied part *replace* the collection (new ids each time, orphaning history)
  or *merge* by id? Answering it is a language decision, not an emitter fix.
- **(b) Reject entity-typed parameters, materialize payload-typed ones.** The
  payload case (`create(c: FileClaim)`) has no identity question at all — it is a
  flat record, exactly like a value object, and the current `z.unknown()` is
  plainly a hole. The entity case gets a `loom.*` code pointing at the
  value-object alternative, which is what a DDD-literate author should reach for
  anyway (a `Leg` in an itinerary is a value object in Evans' own model).

**Recommendation: (b).** It closes the wire-contract hole immediately and turns
the hard half into an explicit, documented "use a value object" — with the
identity question deferred to a proposal rather than guessed at in an emitter.

### D-3 — should a DSL field default become a SQL column DEFAULT?

Today `status: string = "pending"` never reaches the DDL, so the natural way to
add a required column non-destructively does not work and the author restates
the value in a `migration {}` block. Wiring it through would delete a whole class
of destructive-gate friction (this audit hit it twice in three iterations).

The argument against is real: a column default is a **second** source of truth
for a value the domain layer already owns, and rows written outside the app
would silently acquire domain semantics. The middle path is to emit the DEFAULT
**only in the add-column diff** (so the backfill is automatic and the gate
clears), then `DROP DEFAULT` in the same migration — the column ends up exactly
as it is today, and the friction disappears.

**Recommendation: the middle path.** It is a migration-emitter change with no
runtime surface and no second source of truth.

### D-4 — the create-body inertness (M-T3.16) is the deepest gap here

Not a new finding — it is tracked — but this build is evidence about its cost. A
state-based aggregate's `create` body is entirely inert: `precondition`, `emit`
and every assignment are dropped. In a DSL whose pitch is Domain-Driven Design,
the aggregate cannot guard its own construction or raise its creation event, so
the canonical "book a cargo" factory had to become a workflow. Every author who
reaches for the obvious DDD shape will hit this.

Two things this audit adds to the mission:

1. **`docs/language.md:435` still describes the body as "populates a fresh
   `this`"** — exactly backwards for the default persistence mode. That is a
   one-line docs fix that should not wait for the emitter.
2. The workaround (move it to a workflow) is only viable because workflows work.
   D4, D5 and #2850 mean the workflow escape hatch is itself partly broken — so
   the two gaps compound, and M-T3.16 is worth more than its own row suggests.

**Recommendation:** land the docs correction in wave 1 (free), and re-price
M-T3.16 upward now that the escape hatch is known to be leaky.

## Fleet shape

Six agents in wave 1, two in wave 2, four in wave 3 — twelve missions, of which
**wave 1 needs no decision** and can start immediately. Each mission is one
draft PR, opened before the work per the repo's claim rule, with the file list
above pasted into its body so the next agent can see the boundary.

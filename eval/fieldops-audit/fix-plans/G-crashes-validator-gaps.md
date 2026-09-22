I have everything I need. Here is the report.

---

# Agent G — fix plan: three crashes, three silent gaps

Re-verified on `/tmp/loom-main` @ `9a8f2fe0`. Nothing in `/tmp/loom-main` or `/home/user/Loc` was modified; scratch in `/tmp/agentG/`. No PRs, pushes or commits.

## 1. Verification table

| Finding | Status | Claim | Evidence (fresh `main`) |
|---|---|---|---|
| **F-012** e2e multi-word slug crashes codegen | **LIVE** | **UNCLAIMED** | `node bin/cli.js generate system /tmp/repro/e2e-multiword-slug.ddd` → `0 error(s), 0 warning(s).` then `Error: e2e: unknown aggregate 'api.workOrders' on this deployable. Available aggregates: bars.` at `out/system/e2e-render.js:612:15`. Control `e2e-two-deployables.ddd` → `Wrote 71 file(s)`. Diagnosis **confirmed and sharpened** — see below. |
| **F-040** cyclic containment → stack overflow | **LIVE, and WIDER than reported** | **UNCLAIMED** | `parse` → `0 error(s), 0 warning(s).`; `generate system` → `RangeError: Maximum call stack size exceeded … at nestedContainLoads (out/generator/typescript/repository-find-builder.js:154:26)`. **Four of five backends blow the stack** (node, dotnet `efcore.js:1000`, python `repository-builder.js:1051 syncContainment`, elixir `read-preload.js:82 nestedPreloadOf`); **java does not** — it writes 63 files containing `public record ChildResponse(UUID id, String label, List<ChildResponse> kids)`, an infinitely-recursive wire schema. A **mutual** cycle (`Child`→`Grand`→`Child`, `/tmp/agentG/mutual-cycle.ddd`) crashes identically, so self-reference is not the whole class. |
| **F-041** typo'd field in a page body unvalidated | **LIVE; root cause is one level deeper than stated** | **UNCLAIMED** (#2871 builds adjacent machinery, does not cover this) | `parse b09` → `0 error(s), 0 warning(s).` vs `parse b02` → `b02-missing-field.ddd:6:19 error: Unknown name 'totl' — did you mean 'total'?`. Flutter emits `Text('${orderById.totl}')` against a typed `class Order` — **`dart analyze` fails and no per-PR gate runs it**. |
| **F-005** no `create` → read-only API, silently | **LIVE** | **UNCLAIMED** | `parse` → `0 error(s), 0 warning(s).`; `grep -o 'method: "[a-z]*"' …/organization.routes.ts` → `method: "get"` / `method: "get"`. `docs/tenancy.md:135-137` still asserts *"`POST /organizations` works for any authenticated principal"*. **New**: the e2e that doc cites as its pin (`test/e2e/tenancy-isolation.test.ts` → `tenancy-owned.ddd:27`) declares `aggregate Organization with crudish` — a *different* declaration from the doc's own §Surface example at `docs/tenancy.md:27`. The claim is pinned by a model the doc does not show. |
| **F-004** `loom.transactional-no-effect` on a transactional workflow | **LIVE, and WIDER than reported** | **UNCLAIMED** | `parse wf-for-let-f.ddd` → `loom.transactional-no-effect C/finishE warning: workflow 'finishE': declared 'transactional' but does not mutate any aggregate or emit any event — the keyword has no effect.` while `api/http/workflows.ts` emits `await db.transaction(async (tx) => { … p.consume(l.qty); await parts.save(p); })`. **Second shape found**: `emit` inside a `for` body is equally uncounted (`/tmp/agentG/wf-for-emit2.ddd` → same warning), so the message's own "or emit any event" clause is wrong too. |
| **F-006** `create(...)` params silently ignored | **LIVE** | **CLAIMED BY #2861** (slice 4, `loom.create-params-not-wire`) | Reproduces: `CreateThingRequest = z.object({ name: … })`, `Thing.create({ name: body.name })`, param `n` absent. I read the gate on `origin/claude/loom-dev-experience-test-oew3t3` (`structural-checks.ts:1966-1998`): `missingRequired = ["name"]` on my exact repro → **it fires**. No competing plan below; one residual noted in §3. |

**#2896 read in full.** It claims D5/D6/G2 (`loom.workflow-handle-unsupported`, `loom.entity-part-param-unsupported`, `loom.reactor-without-starter`) and #2850 case B (`loom.correlation-unsupplied`) — none of mine. It explicitly puts the create position *out* of scope: *"the create position is **out of scope** — and it is #2861's finding, not this one."* Only conflict surface is adjacent text in `src/diagnostics/messages.ts`.

---

## 2. Fix plans (LIVE + UNCLAIMED)

### F-012 — one slug resolver, and a compatibility filter that fails closed

**Root cause — confirmed, and it is a *three-copy* problem, not a two.**

`src/system/e2e-render.ts:860` resolves a slug against **three** spellings:

```ts
function findAggregateBySlug(slug: string, contexts: BoundedContextIR[]): AggregateIR | undefined {
  for (const c of contexts) for (const a of c.aggregates) {
      if (lowerFirst(a.name) === slug) return a;
      if (snake(plural(a.name)) === slug) return a;
      if (lowerFirst(plural(a.name)) === slug) return a;
```

`src/system/e2e-render.ts:260` `findContextForSlug` resolves against **one**:

```ts
        if (snake(plural(a.name)) === slug) return c.name;
```

Measured: `WorkOrder → lowerFirst: workOrder | snake(plural): work_orders | lowerFirst(plural): workOrders`; `Foo → foo / foos / foos`. For a single-word name the two spellings **coincide**, which is exactly why the control passes and why the defect is invisible to every single-word fixture in the tree.

`compatibleBackends` (`:287`) then fails **open** on the miss — its own comment says so:

```ts
    if (ctx) requiredContexts.add(ctx);
    // No context owns the slug → the existing `findAggregateBySlug`
    // check at render time produces a precise error.  Skip here so
    // the declared deployable still runs and surfaces it.
```

That reasoning is sound only when the miss means "nothing owns it". Here the miss means "my resolver is narrower than the renderer's", so `requiredContexts` is empty, `[...empty].every(...)` is vacuously true, **every** backend is admitted, and `renderApiCall` throws against `other`. And there is a **third** copy at `src/ir/validate/checks/test-checks.ts:438` — byte-identical to the renderer's three-spelling version — which is why phase ⑦ (`loom.e2e-unknown-aggregate`) passes: it only ever looks at the *declared* deployable's contexts.

**Change.**
1. Extract the single predicate to `src/ir/util/api-slug.ts` (IR layer — importable by both `src/ir/validate/` and `src/system/`, no backward edge):
   `export function aggregateMatchesSlug(a: AggregateIR, slug: string): boolean` and `projectionMatchesSlug(p, slug)`. Rewrite all three call sites (`e2e-render.ts:260`, `:860`, `test-checks.ts:438`) onto it. A fourth divergence then cannot be minted by hand.
2. Fail closed in `compatibleBackends`: track the miss and, on any unresolved slug, return `[declared]` only — never the widened set. The declared deployable still surfaces the precise error (or, more usually, phase ⑦ already refused the model).

**Diagnostic.** **None, deliberately.** Once the resolvers agree, the reachable user-facing case is already covered by `loom.e2e-unknown-aggregate` at phase ⑦, and the CLI exits before codegen on a phase-⑦ error. Minting a new code here would mint one that cannot fire. Instead follow #2871's precedent: document the `throw` at `e2e-render.ts:709` as an **internal invariant** and pin its unreachability with a test that asserts every slug reaching `renderApiCall` was admitted by the shared predicate. (Any new code would also have to be named without an `-unsupported` suffix or it enters the gap register — `test/system/unsupported-register.test.ts` invariant 1.)

**Test.** `test/system/e2e-render-multi-backend.test.ts`: (a) `/tmp/repro/e2e-multiword-slug.ddd` generates and the emitted `e2e` file contains exactly **one** `it("create a work order against api")` and no `against other`; (b) the single-word control is **byte-identical** before/after (the regression guard for the widened resolver); (c) a slug owned by a context both backends host still replays on both.

**Mutation proof.** Copy `e2e-render.ts` aside; revert `findContextForSlug` to the one-spelling body; re-run. Expected failure: test (a) with `RangeError`-free but `Error: e2e: unknown aggregate 'api.workOrders'` thrown out of `generateSystemResult`. Then, separately, restore the resolver but revert only the fail-closed branch and re-run (c′) — a fixture whose slug is genuinely unknown must not widen: expected `expected [ 'api', 'other' ] to deeply equal [ 'api' ]`. Two mutations, because the finding has two independent halves and a single revert would not distinguish them. Restore by file copy, never `git checkout --`.

**Effort: S.**

---

### F-040 — refuse a cycle in the containment graph

**Root cause.** `src/generator/typescript/repository-find-builder.ts:216-232`:

```ts
function nestedContainLoads(part, rowsVar, dbExpr, indent, agg, ctx): string[] {
  return part.contains.flatMap((nc) => {
    const ncPart = agg.parts.find((p) => p.name === nc.partName);
    …
      ...nestedContainLoads(ncPart, rowsLocal, dbExpr, indent, agg, ctx),
```

Unbounded recursion over the part-containment graph, with no visited set. Same shape in `dotnet/emit/efcore.ts:1000 containmentConfigLines`, `python/repository-builder.ts:1051 syncContainment`, `elixir/vanilla/read-preload.ts:82 nestedPreloadOf`. Java does not recurse there and instead emits a self-referential DTO — a **silent** wire-shape divergence, which is a stronger argument for refusal than four crashes: there is no consistent output to converge on.

Lowering, enrichment (`wireShape`) and phase ⑦ all survive the cycle today (the crash is at phase ⑧), so a phase-⑦ check is reachable and is the right home — it holds for all five backends at once.

**Change.** New leaf check in `src/ir/validate/checks/structural-checks.ts` (it already owns aggregate-shape rulings): for each aggregate, build the directed graph `part → contains[].partName` over `agg.parts`, plus the root edge `agg.contains[]`, and run a DFS with a colour map. On a back-edge, report the **cycle path** (`Child → Grand → Child`), not just the offending part — the mutual case is the one a self-reference-only check would miss. A depth cap is explicitly **not** the fix: it would turn a refusal into an arbitrary truncation of the user's data model.

**Diagnostic code.** `loom.containment-cycle` — **error**. Named without an `-unsupported` suffix on purpose: this is a modelling rule (a containment graph must be a DAG because a containment is a child *table*, and a cyclic one has no finite eager-load), not a drainable emitter gap, so it must not enter `UNSUPPORTED_REGISTER` / raise `MAX_OPEN_GAPS`.

`src/diagnostics/messages.ts` entry:

```ts
  "loom.containment-cycle": (p: { agg: unknown; cycle: unknown; part: unknown }) =>
    `Aggregate '${p.agg}': \`contains\` forms a cycle (${p.cycle}).  A containment is a ` +
    `child table eagerly loaded with its parent, so a cyclic one has no finite load ` +
    `depth — four of the five backends recurse until the stack overflows and the fifth ` +
    `emits a self-referential DTO.  A tree (sub-tasks, a bill of materials) is modelled ` +
    `as its own aggregate with a self reference instead: move '${p.part}' out to ` +
    `\`aggregate ${p.part} { parent: ${p.part} id? … }\` and read the levels you need.`,
```

Plus a `src/diagnostics/code-docs.ts` anchor (`docs/language-reference/04-aggregates.md#contains--entity-parts`) — `diagnostic-docs-anchors.test.ts` fails without one — and a `FIRING_FIXTURES` entry in `test/system/diagnostic-firing-census.test.ts` (a new code may not be parked in `UNCOVERED`).

**Test.** `test/ir/containment-cycle.test.ts`: self-cycle (`b05`) raises it; mutual cycle (`Child → Grand → Child`) raises it and the message names **both** hops; the **acceptance** cases stay at zero diagnostics — `test/e2e/fixtures/dotnet-build/dapper-nested-parts.ddd` and `document-nested-parts.ddd`, which are legitimate *part-in-part* nesting (the repo already calls that "recursive containment" in their headers, so the gate must not read the name as the thing).

**Mutation proof.** Copy the file aside, make `validateContainmentGraph` early-return, re-run. Expected: `expected [] to include 'loom.containment-cycle'` ×2 and `expected '' to contain 'Grand'`. Separately assert non-vacuity: with the gate live, the two `*-nested-parts.ddd` fixtures still report **zero** — a cycle checker that also rejects legal deep nesting would pass the first proof and be useless.

**Effort: S–M** (the check is ~40 lines; the corpus sweep over 280 `.ddd` for false positives is the real work).

---

### F-041 — the page-body lambda binder is untyped; the member check already exists

**This is the finding whose root cause moved most.** My first hypothesis was "the page layer needs a new validator". It does not.

`src/language/validators/types.ts:171 checkUnknownMemberAccess` walks `AstUtils.streamAllContents(model)` — **the whole model, `ui` included** — and raises `loom.unknown-member` whenever `absentRecordMember(recvType, member)` resolves. Proof that it already reaches `ui` bodies (`/tmp/agentG/comp-param.ddd`, a `component Row(o: Order)` with the identical typo):

```
/tmp/agentG/comp-param.ddd:10:62 error: 'totl' is not a member of 'Order'.
```

So the layer is **not** unvalidated. The gate is blind for exactly one reason: a `QueryView { data: o => … }` lambda param has **no type**. The lowered IR records the erasure verbatim —

```json
{"kind":"ref","name":"o","refKind":"lambda","type":{"kind":"primitive","name":"string"}},
"member":"totl","receiverType":{"kind":"primitive","name":"string"},"memberType":{"kind":"primitive","name":"string"}
```

— and the generator layer already documents it as a known hole, at `src/generator/_walker/shared/row-field-type.ts:1-8`:

> *"A page body carries no `receiverType`: inside a `data: rows => …` lambda every member read (`o.amount`) types as `string`, money and decimal included. So a primitive that needs to know what a COLUMN really holds cannot ask the expression — it asks the ROW AGGREGATE the enclosing `QueryView` recorded (`ctx.listRowAggregates`)."*

`src/language/type-system.ts` already does contextual lambda typing for **collection ops** (`:1296-1302`, `:1315-1321`, `:1344-1350` — `makeEnv(…, new Map([[lambdaArg.param, { type: recv.element, … }]]))`), and `envForNode` (`:1745`) already types page and component params. What is missing is the walker-primitive arm.

**Change.** In `src/language/type-system.ts`:
1. A slot table — *which argument of which walker primitive is a row lambda, and where its row type comes from*: `QueryView.data` (from `of:`), `For.each`-item, `Table`/`DataGrid` column accessors, `Timeline`, `Chart`. Source the primitive/slot names from `src/util/walker-primitive-names.ts` (`WALKER_PRIMITIVE_SLOTS` already exists and is completeness-pinned against the emitters' positional reads) so the table cannot drift from the registry.
2. Teach `envForNode` to walk up through enclosing `Lambda`s: when a lambda sits in a typed slot, bind its param to the resolved row type (`entity <Agg>`, or its element for a collection slot).

Then `checkUnknownMemberAccess` fires on `o.totl` **with no new code and no new check**. Add the did-you-mean hint to `loom.unknown-member` (a `#hint` message variant, mirroring `loom.unknown-name`'s `p.hint` arm at `messages.ts:440`) so the page-layer diagnostic reads as well as the domain one does — the contrast the finding is built on. `levenshtein`/`suggest` currently live in `src/language/validators/names.ts:142/182`; they stay put (same layer), so no extraction is needed.

**Diagnostic code.** **None new.** Existing `loom.unknown-member`, plus one catalog variant `loom.unknown-member#hint`:

```ts
  "loom.unknown-member#hint": (p: { member: unknown; record: unknown; hint: unknown }) =>
    `'${p.member}' is not a member of '${p.record}' — did you mean '${p.hint}'?`,
```

**What it costs — honestly.**
- The reachable win is large: it closes the page layer against *every* field typo on all six frontends at once, and it types the binding for everything downstream (the `Money`/`Decimal` slot rulings in #2871 D4, the row-comparator special-casing in `row-field-type.ts`, `ctx.listRowAggregates`) so those three places could eventually stop re-deriving what the env now knows.
- The risk is **newly-typed receivers**. Today every `o.<anything>` in a page lambda is `string`, so `absentRecordMember` never resolves and the check is silent. Once typed, every member read in every shipped page body becomes checkable **in the same commit** — and a wire-shape read (`o.display`, `o.version`, a containment, a derived field, an `X id` link) that the env types differently from what the frontend actually receives becomes a **false error on shipped source**. That is the whole cost, and it is a one-way door: this must be measured across all 280 `.ddd` files (`playground-*-examples`, `ddd-source-census`, `clause-census`) *before* the check is allowed to be an error. Land it behind a warning first if the sweep is not clean.
- Two designed-in escape hatches: an **unresolvable** `of:` yields no type and therefore no diagnostic (never guess), and the row record must be `wireFieldsForAggregate(agg)` — the *wire* shape, not the domain shape — because the browser receives the wire shape, and typing against the domain shape would reject correct pages.

**Test.** `test/language/page-lambda-member.test.ts`: `b09` raises `loom.unknown-member` naming `totl` and hinting `total`; `o.total` is clean; a `For { each: … }` item lambda and a `Table` column accessor both raise; an unresolvable `of:` raises nothing; `component Row(o: Order)` keeps its existing diagnostic byte-identical. Plus the corpus suites as the non-vacuity half.

**Effort: M–L.** M for the two type-system arms; L is the corpus sweep and whatever shipped pages it turns red.

---

### F-005 — warn when an aggregate has no reachable constructor

**Root cause.** `emitsRestCreate` (`src/ir/enrich/wire-projection.ts:300`) is the single derivation every backend's create route is gated on:

```ts
export function emitsRestCreate(agg: AggregateIR): boolean {
  return agg.persistedAs === "eventLog" ? (agg.creates?.length ?? 0) > 0 : agg.canonicalCreate != null;
}
```

`routes-builder.ts:622-626` states the intent plainly — *"an aggregate that declares no create (explicit/`crudish` → `canonicalCreate`) is not constructible over HTTP and emits neither"* — and nothing anywhere tells the author that is what they wrote.

**Change.** A phase-⑦ check in `src/ir/validate/checks/structural-checks.ts` reusing `emitsRestCreate` (not re-deriving it — one rule, not two copies, the same discipline #2896 applied to `commandCreateCorrelationParam`). Report when **none** of these hold:

1. `emitsRestCreate(agg)`;
2. a workflow / commandHandler / queryHandler body constructs it — a `factory-let` whose `aggName === agg.name`, found with `walkWorkflowStmtsDeep` (**not** a hand-rolled walk; see F-004 — a shallow scan here would miss a `factory-let` inside a `for`, which is a common bulk-import shape);
3. a seed row targets it (`ctx.seeds[].rows[].aggregate === agg.name`);
4. `agg.isAbstract` (a TPC/TPH base is never instantiated by design — note the field is `isAbstract`, not `abstract`).

**Corpus measured, not guessed.** I ran that exact predicate over `examples/*.ddd` + `web/src/examples/*.ddd`:

```
NO-CREATE showcase.ddd DevPlatform People Squad
NO-CREATE timers.ddd Reaping Orders Sweep
NO-CREATE auth-capabilities.ddd Helpdesk Support Ticket
NO-CREATE dashboard-system.ddd DashboardShop Orders Customer
NO-CREATE dashboard-system.ddd DashboardShop Orders Order
NO-CREATE data-grid-showcase.ddd GridDemo Orders Customer
NO-CREATE expression-showcase.ddd ExpressionShowcase Products Product
NO-CREATE inheritance-system.ddd InheritanceSystem Wallet LoyaltyAccount
NO-CREATE svelte-data-grid.ddd SGrid Orders Customer
TOTAL aggregates 161; no reachable create 9
```

**9 of 161 shipped aggregates (5.6%)** are unconstructible. One is deliberate (`showcase.ddd:435 aggregate Squad with crudish(updateOnly: true)` — the macro's documented suppression). `LoyaltyAccount` is `persistedAs: eventLog` with two event-emitting operations and no creating command — the same defect wearing an event-sourced hat. The rest are demo apps whose data can only arrive by hand.

Cost containment: **warning, not error**. The three `playground-*-examples` suites assert only `severity === "error"` / `severity === 1`, so a warning does not turn the corpus red — verified at `test/system/playground-feature-examples.test.ts:58,81`. It *would* show up in `ddd new --template crud`'s first-parse cleanliness (#2861 slice 3's concern), so the starter template must be checked.

**Diagnostic code.** `loom.aggregate-not-constructible` — **warning**.

```ts
  "loom.aggregate-not-constructible": (p: { agg: unknown; ctxName: unknown }) =>
    `Aggregate '${p.agg}' in context '${p.ctxName}' has no reachable constructor: it ` +
    `declares no \`create\` (and no \`with crudish\`), no workflow or handler builds it, ` +
    `and no \`seed\` dataset carries it — so the generated API is read-only (\`GET\` only, ` +
    `no \`POST /<plural>\`) and no row can ever exist to read.  Add \`create(…)\`, \`with ` +
    `crudish\`, a \`seed\`, or a workflow that constructs it.  Deliberate — reference data ` +
    `loaded out of band, or \`with crudish(updateOnly: true)\` — is the case to state in ` +
    `a comment; this warning cannot tell the two apart.`,
```

Anchor: `docs/language-reference/06-behavior-and-statements.md#create--destroy--lifecycle-actions`. `FIRING_FIXTURES` entry required.

**Test.** `test/ir/aggregate-constructible.test.ts`: the `tenancy-bootstrap.ddd` shape warns; `with crudish` does not; a `create(...)` does not; an aggregate built only by a workflow `factory-let` **nested inside a `for`** does not (the shallow-walk trap); a seeded aggregate does not; an `abstract` base does not; an `eventLog` aggregate with a creating command does not, without one does.

**Mutation proof.** Copy aside, early-return the check: `expected [] to include 'loom.aggregate-not-constructible'` and `expected '' to contain 'Organization'`. Then the non-vacuity mutation that actually matters here — replace the `factory-let` clause with a **shallow** top-level scan and re-run: expected `expected [ 'loom.aggregate-not-constructible' ] to deeply equal []` on the nested-`for` acceptance case. Without that second mutation the check would ship with F-004's bug baked in.

**Doc fix — handed over, not done here.** `docs/tenancy.md:135-137` claims `POST /organizations` works for the §Surface example at `docs/tenancy.md:27`, which declares `aggregate Organization { name: string }`. It does not; the cited pin (`test/e2e/tenancy-isolation.test.ts` → `tenancy-owned.ddd:27`) uses `with crudish`. The doc's §Surface example needs `with crudish` (or an explicit `create`) added, and the paragraph should say the registry must be constructible for the bootstrap to exist. **The docs agent owns this** — it is a `status-refresh`-shaped change, and the code fix above is what makes the drift impossible to reintroduce silently.

**Effort: M.**

---

### F-004 — the effect detector must ride `walk.ts`

**Root cause — the CLAUDE.md rule, exactly as suspected.** `validateWorkflowBody` (`src/ir/validate/checks/workflow-checks.ts:559`) iterates **top-level statements only**:

```ts
  let mutated = false;
  for (const st of wf.statements) {
    switch (st.kind) {
```

The `for-each` arm (`:908-942`) then hand-rolls **one level** of descent and recognises **one** kind:

```ts
        bindingAgg.set(st.var, st.varAggName);
        for (const inner of st.body) {
          if (inner.kind === "op-call") {
            mutated = true;
```

No recursion, and no `emit` / `factory-let` arm — while the sibling `if-let` helper `checkBranchOpCalls` (`:1019-1055`) *does* handle `emit`/`factory-let` but is likewise one level deep and is only reached from a **top-level** `if-let`. So `for l in ls { if let p = … { p.consume(…) } }` sets `mutated` nowhere, and `wf.transactional && !mutated` (`:1181`) fires.

Two consequences, both verified:
- The reported case. The emitter disagrees, visibly: `api/http/workflows.ts` wraps the identical body in `await db.transaction(async (tx) => { … p.consume(l.qty); await parts.save(p); … })`.
- **A second shape the brief did not have**: `for l in ls { emit Consumed { sku: l.note } }` also warns (`/tmp/agentG/wf-for-emit2.ddd`), so the message's "or emit any event" half is false as well.

The census did not catch it because `test/system/ir-walk-census.test.ts` enforces **kind-exhaustiveness**, not **traversal depth**: the outer `switch` has a `never` default and is therefore sanctioned, and `checkBranchOpCalls` is waived as `CLOSED_PREDICATE` at `ir-walk-census.test.ts:449`. A shallow-but-exhaustive dispatch is the census's blind spot. Meanwhile `src/ir/validate/checks/api-checks.ts:23` hand-rolled its **own** deep walk, `forEachStmtDeep` — so two checks in the same directory, over the same union, disagree about depth.

**Change.**
1. Compute `mutated` in one pass with `walkWorkflowStmtsDeep` (`src/ir/util/walk.ts:325`) over `wf.statements`, setting it for `op-call` / `emit` / `factory-let` / `assign` / `repo-delete` — the same set `api-checks.ts:37 handlerMutates` already uses, which is the emitter-agreeing definition.
2. Keep the existing switch for its *other* duties (binding resolution, arity, unknown-event) but delete the `mutated = true` assignments scattered through the arms, so there is exactly one definition of "this workflow has an effect".
3. Delete `forEachStmtDeep` from `api-checks.ts` and point `handlerMutates` at `walkWorkflowStmtsDeep` too — one walk, not three.
4. Then either narrow the `checkBranchOpCalls` waiver at `ir-walk-census.test.ts:449` or drop it if the function dissolves.

**Diagnostic code.** **None new** — `loom.transactional-no-effect` already exists and its wording is correct; it was the analysis that lied. (If the message is touched at all, it should gain the offending workflow's effect-free body summary; not required.)

**Test.** `test/ir/transactional-effect-depth.test.ts`, one case per nesting shape: `for` → `if-let` → `op-call`; `for` → `emit`; `if-let` → `for` → `op-call`; `for` → `for` → `factory-let`. Each asserts **zero** `loom.transactional-no-effect`. Plus the true-positive: a `transactional` workflow whose body is only `let`/`precondition`/`repo-let` **still warns** — without it the fix could be "delete the check" and pass.

**Mutation proof.** Copy `workflow-checks.ts` aside; revert the effect detection to the top-level-only loop; re-run. Expected: `expected [ 'loom.transactional-no-effect' ] to deeply equal []` ×4 (one per nesting shape) with the true-positive case still green — that last one is what proves the mutation hit the depth and not the gate. Restore by file copy.

**Failure direction, restated because it decides the severity.** The warning tells an engineer to delete a keyword that is doing real work; acting on it silently removes atomicity from a multi-aggregate write. This is worse than a missing diagnostic.

**Effort: S–M.**

---

## 3. Residual on F-006 (for #2861, not a plan of mine)

#2861's gate computes `missing` over **create-input fields absent from the declared params**, and fires only when a *required* one is missing (`structural-checks.ts:1972-1981`). It never inspects the converse — a declared param that corresponds to **no** create-input field. On my repro it fires anyway, because `name` is missing. But `create(name: string, n: string)` on `aggregate Thing { name: string }` yields `missing = []` → **silent**, and `n` is still dropped. One extra clause in the same block would close it. Worth a comment on #2861 rather than a competing gate; and per its own PR body, M-T5.32 deletes the gate when the params become the contract, which is the coherent endpoint and is consistent with F-007's `loom.lifecycle-body-dropped` (both say "your declared create surface does not shape the wire").

---

## 4. Is "no generator throw without a diagnostic" enforceable as a gate?

**Yes — and it is already built, already green, and already gating every PR. It caught none of my three crashes, and the reason is not the oracle, the runner budget, or the tier ladder. It is that the model generator cannot express the shapes.**

### What exists

`test/system/pipeline-fuzz.test.ts` — 250 shallow seeds, **no env gate**, in the default `vitest run`, so it is inside `tests passed` on every PR. Its describe block is literally the invariant:

```
describe("pipeline fuzz — a crash on a valid model is always a bug", () => {
```

Measured now: **green, 12.96 s of test time** (28.8 s wall including transform/import).

`test/system/pipeline-fuzz-deep.test.ts` — 3500 seeds × 5 backends behind `LOOM_FUZZ_DEEP=1`, with a four-tier oracle that already draws the exact distinction the question asks for:

```ts
  crash:
    "the pipeline THREW on a valid model. A crash on valid input is always a bug: either " +
    "the model should have been rejected by a validator, or the emitter has a hole.",
```

…plus a shrinker that prints a corpus-ready `.ddd` and a `LOOM_FUZZ_SEEDS` replay hatch. The audit's §F3 is right that it is red and runs in no workflow.

### The binding constraint: input-space coverage, measured

`test/_helpers/ddd-model-generator.ts`:

- **Line 51** — `const NAMES = ["Order","Invoice","Ticket","Account","Shipment","Widget","Parcel","Claim"];` — eight names, **all single-word**. F-012 needs a name where `lowerFirst(plural(n)) !== snake(plural(n))`; for every name in that pool the two spellings are identical. **Unreachable by construction.**
- **Lines 138-144 / 302-303** — every containment is a fixed leaf: `contains lines: <Agg>Line[]  entity <Agg>Line { sku: string  qty: int }`. A part that contains a part is never generated, let alone one that contains itself. **F-040 unreachable.**
- **Lines 157 / 414** — exactly one backend deployable (`deployable d`), optionally one react `web` (line 392). F-012 needs **two** backend deployables. **Unreachable.**
- No `test e2e` block is ever generated at all.

So all three of F-011/F-012/F-040 sit outside the generated grammar. The oracle would have judged them correctly; it never saw them. **Any plan that wires the deep leg into CI without widening the generator buys coverage of the region already covered.**

### The redness is not what the audit recorded — and it may not be a harness bug

The audit (3 days old) records *"400 seeds → 3 failures (seeds 45, 70, 115), all F1"* — the `Amount`/.NET name collision, with the tier misattributed. Today, at 120 seeds:

```
+ seed 3 [node] — invalid
+   the GENERATOR emitted an invalid model. Fix `test/_helpers/ddd-model-generator.ts` — …
+     loom.workflow-create-correlation-unsupplied workflow 'placeClaim': the command 'create' writes
+     workflow state but supplies no value for the correlation field 'item', so it addresses no
+     instance. … supply the key as a parameter named 'item', or assign it from one ('item := <param>').
+     Parameters today: total.
```

Seeds 3, 4 and 9 all fail this way — **2.5% of seeds**, a *different* cause from the audit's, at a *different* tier. Reproduced outside the harness, via the CLI, on the shrunk model (`/tmp/agentG/seed3.ddd` → `1 error(s), 1 warning(s)`).

Look at what the model actually does:

```ddd
        create(total: decimal) {
          let built = Claim.create({ total: total })
          item := built.id
          emit ClaimPlaced { item: built.id, at: now() }
        }
```

It **does** supply the correlation key — `item := built.id`, the canonical "create the aggregate, then correlate the saga on its new id" starter. The gate accepts only `item := <param>` and refuses assignment from a `let` binding. So the most likely reading is that **the fuzzer's redness today is a validator over-refusal, not a generator defect** — and the harness's triage confidently blames the generator, which is precisely the misattribution the audit's §F3 item 3 names, now with a fresh cause. (This is adjacent to my F-004: a validator whose analysis is narrower than the emitter's behaviour. I did not chase it to the emitter; it is out of my cluster and deserves its own owner. `loom.workflow-create-correlation-unsupplied`, `src/ir/util/workflow-command-route.ts` after #2896 moves it.)

This is also the structural cost nobody has priced: **the generator is a fourth writer of `.ddd`** (after humans, `ddd patch`, and the visual builder — audit §F10 counts three), and it is unmaintained. Every new phase-④/⑦ gate can make it start emitting invalid models, which drives the `invalid` tier up and makes every other assertion on that seed vacuous. `#2896` alone mints four new refusals. Wiring the deep leg without owning that feedback loop buys a check that goes red for reasons unrelated to the code under test — the highest-cost failure mode a gate can have.

### So: buildable, at what cost

| Step | Cost | Verdict |
|---|---|---|
| **Keep the shallow leg per-PR** | 13 s, already paid | Already done. The invariant is not missing; it is under-fed. |
| **Fix the `invalid` tier** — decide whether `loom.workflow-create-correlation-unsupplied` is over-strict (fix the gate) or correct (fix the generator) | **S** if the gate is wrong; **S–M** if the generator must learn the rule | **Precondition for everything below.** A red gate that blames the wrong party trains people to ignore it. |
| **Widen the generator's name pool to multi-word names** | **S** — add `WorkOrder`, `LineItem`, `PurchaseOrder` to line 51 | Highest yield per line in this whole report. Multi-word names cross `lowerFirst(plural)` vs `snake(plural)`, `pascal` vs `snake` and `camelId` boundaries across **every** emitter — F-012 is one instance of a family. |
| **Generate part-in-part and cyclic containment** | **S** | Reaches F-040 immediately; combined with my `loom.containment-cycle` gate the fuzzer then proves the *refusal*, which is the stronger state. |
| **Generate a second backend deployable, and `test e2e` blocks** | **M** | Reaches F-012's actual precondition. The `test`/multi-deployable region is emitted by `src/system/`, which the fuzzer's single-deployable models never exercise. |
| **Wire the deep leg into a nightly** | **S** | Measured **0.37 s/seed** on this box (120 seeds × 5 backends = 44.9 s of test time), so the default 3500 seeds ≈ **22 min**, not the 12 min the header estimates. Fits a nightly; does **not** fit per-PR, and should not be forced there — the shallow leg is the per-PR rung. |
| **Make the crash tier a hard gate on `main`** | free once green | The tier already exists; only the redness and the workflow are missing. |

**Bottom line.** The invariant "every input that passes validation must generate without an uncaught exception" is not a new gate to design — it is `test/system/pipeline-fuzz.test.ts`, running on every PR today, and its deep sibling with a four-tier oracle and a shrinker. Treating this as "build a harness" would rebuild what exists. The three things that actually convert it from a check into a *net* are, in order: **(1)** resolve why it is red — and check the gate before blaming the generator; **(2)** widen the generator along the four axes above, starting with multi-word names, which is a one-line change that would have caught F-012 and an unknown number of its siblings; **(3)** nightly-wire the deep leg at its measured 22 min. Step (2) is the cheapest defect-per-hour item anywhere in this report — cheaper than any individual fix plan above, including the ones it would have made unnecessary.

One caveat the tier ladder still cannot express, and should: a model that **one** backend refuses and four accept is a backend finding, not an invalid model (the audit's §F3 item 3). `checkAllBackends` returns the **first** failure across the five platforms, so a per-backend divergence is reported as whatever tier the first failing backend produced. Widening the generator will make that class much more common, so the ladder needs its fifth rung — `divergence` — before the widening lands, or the reports will misroute at scale.
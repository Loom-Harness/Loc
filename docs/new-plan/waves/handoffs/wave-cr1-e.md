# Wave CR1 packet CR1-e — the 52 shape-classified waivers, re-read per kind

**Row:** P0-2a in [`docs/audits/code-review-2026-09-13.md`](../../../audits/code-review-2026-09-13.md).
**Branch:** `worktree-agent-a651813bcf1bad4c0` · base: the CR1 batch-1 tree (`be2e3349`).
**Waivers:** 98 → **47** (−51 register entries; 52 SITES resolved, one of them re-waived).
**Emission byte-identical** over 44,995 emitted files · **diagnostic set identical** over the same corpus.
**Six real defects found and fixed** (§4) — five validator gates that did not reach into an `if`
branch or an i18n hole, and one Elixir EMITTER whose false negative produced a module that does not
compile. Two regression tests, both mutation-proved (§5).

---

## 1. The finding, restated

`CLOSED_PREDICATE` waived 42 sites, and its own reason text was the finding:

> *"…every unhandled kind falls through to a safe, generic default … **Classified by default-arm
> shape, NOT re-verified per kind**; the drain re-reads each site"*

`HOTSPOT_SPLIT_RESIDUE` waived 10 more — the `src/ir/validate/checks/**` sites CR1-d could not touch
behind #2933's fence (now lifted). 52 subjects in total.

**The shape argument is not wrong, but it is not a proof.** It bounds the blast radius of ONE class
of site (a predicate whose default is a safe generic value) and says nothing about the other class
the same `default:` arm shape hides: a **traversal** whose default silently stops the walk. Six of
the 52 turned out to be the second kind, and every one of them was a gate or an emitter that had a
real hole.

---

## 2. Method — the case-set diff, scripted first

Per the brief, no site was read before the diff existed. A throwaway TypeScript-compiler script
(scratchpad, not the repo) re-ran the census detector and, for every site, additionally recorded:

- the set of kind literals its `switch` / if-chain actually names;
- the authoritative kind list for its union, read off `ExprIR` / `StmtIR` / `WorkflowStmtIR` **with
  the checker** (21 / 12 / 14 kinds) rather than from `walk.ts`'s source text;
- the `default:`-arm text and the enclosing function's declared return type.

The diff is the per-site **missing-kind** list in §3. It is also what stopped the "classified by
shape" error from repeating: the sites were sorted by missing-kind COUNT, and the two extremes are
where the interesting cases sit — `addCsExprUsing` names 2 of 21 kinds and is perfectly safe (it is
a per-node callback under `walkExprDeep`), while `ui-action-body-checks.ts#visitStmt` names 6 of 12
and was carrying a hole. **Neither the count nor the default-arm shape predicts the verdict**; only
the question "what does this function DO with a kind it does not name" does.

### The triage rule actually applied

| what a missing kind does here | verdict | resolution |
|---|---|---|
| stops a TRAVERSAL — a node the caller needed is never visited | **defect** | migrate onto `walk.ts` |
| narrows a CLASSIFICATION toward the safe answer (refuse / `undefined` / no-index) | safe | `never`-check, with the safe direction named |
| unreachable by construction (an earlier gate refuses it, or the node is only ever built in one shape) | safe | `never`-check, with the constraint stated |
| a per-node callback already DRIVEN by a sanctioned walker | safe | `never`-check (or `standing`, where the flagged chain is a membership test, not a dispatch) |

---

## 3. Per-site triage — all 52

`missing` counts kinds in the site's union that its switch/if-chain did not name.
`→` is the resolution. **Bold** marks a site that was carrying a real hole (§4).

### 3a. The 10 fenced `src/ir/validate/checks/**` sites (CR1-d §7)

| # | site | union | missing | what a missing kind meant | → |
|---|---|---|---|---|---|
| 1 | **`ui-action-body-checks.ts#checkBody`** | ExprIR | 8 | a page-body gate never entered `match.subject` / `match.variantArms` / a `call`'s `style:` entries / an `i18nFormat` hole / a `duration` amount | migrated (descent → `walkExprChildren`) + `never` on the residual per-kind pre-check |
| 2 | **`ui-action-body-checks.ts#visitStmt`** | StmtIR | 1 (`if`) | `firstMutatingCallInLambda` never entered an `if` branch | migrated → `walkStmtChildren` |
| 3 | **`ui-action-body-checks.ts#visitExpr`** | ExprIR | 9 | same walk, expression side — no `duration` / `i18nFormat` / `authz-filter` arm | migrated → `walkExprChildren` |
| 4 | `ui-action-body-checks.ts#toastMessageProblem` | ExprIR | 16 | default REJECTS (the safe direction — it is the gate that turns three renderers' `throw` into a `loom.*` code) | `never` |
| 5 | `ui-page-structure-checks.ts#directlyRenderedRefs` | ExprIR | 16 | stops the descent DELIBERATELY at any receiver-rooted shape (documented at the site) | `never` |
| 6 | `ui-page-structure-checks.ts#namesReadByBody` | ExprIR | 18 | already rides `walkExprDeep`; the flagged chain is per-node NAME EXTRACTION, and the set only SUPPRESSES a warning | **re-waived `standing`** (`DELEGATES_TO_SANCTIONED_WALKER`) |
| 7 | **`datasource-checks.ts#docFunctionUnsupported`** | StmtIR | 6 | pulled expression roots from 6 of 12 statement kinds, no `if` — a non-doc-safe expression in a branch made the whole function look doc-SAFE | migrated → `walkStmtChildren` |
| 8 | `datasource-checks.ts#docExprUnsupported` | ExprIR | 7 | default returns "unsupported" — a gate refusing, never emitting | `never` |
| 9 | `datasource-checks.ts#docStmtUnsupported` | StmtIR | 3 | idem | `never` |
| 10 | **`backend-syntax-checks.ts#eachStmtExpr`** | StmtIR | 3 (`call`/`if`/`variant-match`) | the elixir op-call-position gate never entered an `if` branch, nor a call statement's args | migrated → `walkStmtChildren`, caller switched to `walkStmtsDeep` so the tail-`return` carve-out stays per statement |

### 3b. The 42 `CLOSED_PREDICATE` sites

**Traversals — migrated onto `walk.ts` (7):**

| site | union | missing | why it was a traversal | → |
|---|---|---|---|---|
| **`elixir/vanilla/workflow-eventsourced-emit.ts#bodyUsesState`** | WorkflowStmtIR | 9 (+9 on the expression side) | decides the fold-snapshot BINDING; a miss emits `_state = …` then reads `state.…` | `walkWorkflowStmtExprsDeep` |
| `dotnet/criteria-emit.ts#anyRef` | ExprIR | 6 | "does any ref satisfy p" over a whole predicate; no `duration` / `i18nFormat` / `style:` / lambda-block arm | `walkExprDeep` |
| `dotnet/emit/efcore.ts#exprRefsCurrentUser` | ExprIR | 12 | its own comment said it "has to mirror `exprUsesCurrentUser`" and did not | delegates to `exprUsesCurrentUser` + a by-NAME sweep it uniquely also wants |
| `react/pages-emitter.ts#exprUsesCodeBlock` | ExprIR | 9 | gates the page module's `CodeBlock` import; no `list` / `style:` / `i18nFormat` arm | `walkExprDeep` |
| `react/pages-emitter.ts#stmtUsesCodeBlock` | StmtIR | 6 | statement twin, no `if` arm | folded into the same `walkExprDeep` |
| `ir/util/domain-service-tier.ts#classifyDomainServiceTier` | StmtIR | 9 | statement-level mutation scan was TOP-LEVEL only | `walkStmtsDeep` + an exhaustive `Record<StmtIR["kind"], boolean>` |
| `ir/validate/checks/api-checks.ts#handlerMutates` | WorkflowStmtIR | 8 | rode a hand-rolled `forEachStmtDeep` that named its two nesting kinds inline | `walkWorkflowStmtsDeep` + an exhaustive `Record` table |

> Sibling fixed on the way: `isMutatingOperation` (same file) had the identical top-level-only
> `.some(...)` — an aggregate operation whose only write sits in an `if` read as NON-mutating, which
> demotes every domain service calling it. Not a census site (an arrow, not an `if` statement), but
> the same defect one line up.

**Safe classifications — `never`-checked (34):**

| site | union | missing | the safe direction |
|---|---|---|---|
| `_expr/authz-filter-inapp.ts#desugarAuthzFilterInApp` | ExprIR | 17 | unreachable: a sentinel is ALWAYS a whole `contextFilters[i]` / `writeScopeFilter`, built at three sites in `tenant-stance.ts` |
| `_expr/authz-filter-inapp.ts#hasAuthzFilter` | ExprIR | 17 | idem (the two must stay arm-for-arm identical) |
| `_walker/primitives/forms.ts#defaultUsesThis` | ExprIR | 17 | mirrors `renderDefaultSeed`'s client-evaluable subset exactly; a wider answer threads a prop nothing reads |
| `dotnet/emit/efcore.ts#collectColumnRefs` | ExprIR | 16 | advisory only — an index hint + a filter's derived NAME |
| `typescript/emit/schema.ts#collectColumnRefs` | ExprIR | 16 | idem (index hints; the predicate itself is rendered by `lowerToDrizzle`) |
| `dotnet/render-expr.ts#addCsExprUsing` | ExprIR | 19 | per-node callback under `walkExprDeep` / `walkStmtExprsDeep` |
| `python/render-expr.ts#addPyExprImport` | ExprIR | 16 | idem |
| `java/render-expr.ts#addJavaExprImport` | ExprIR | 14 | idem |
| `elixir/realtime-liveview.ts#exprUsesBind` | ExprIR | 17 | mirrors `renderMessageExprElixir`'s v1 toast subset; everything else is refused at phase ⑦ |
| `feliz/realtime.ts#exprReadsBinding` | ExprIR | 17 | idem (`renderFsToastMessage`) |
| `feliz/realtime.ts#reads` | ExprIR | 18 | idem |
| `flutter/realtime.ts#exprReadsBinding` | ExprIR | 17 | idem (`renderDartToastMessage`) |
| `elixir/render-expr.ts#isDecimalOperand` | ExprIR | 14 | `false` ⇒ plain arithmetic, the right answer for a node with no static decimal type |
| `elixir/vanilla/changeset-invariant-emit.ts#structEvaluable` | ExprIR | 14 | `false` ⇒ the invariant is not lifted into the changeset |
| `elixir/vanilla/provenance-emit.ts#leavesResolveToColumns` | ExprIR | 16 | `false` ⇒ the site stays uncaptured rather than raising at runtime |
| `elixir/vanilla/provenance-emit.ts#paramLeafNames` | ExprIR | 17 | unreachable: its only caller gated on `leavesResolveToColumns` first |
| `elixir/vanilla/wire-serialize.ts#derivedRenderable` | ExprIR | 2 | `false` ⇒ the derived is left off the wire (`i18nFormat` is an honest gap, now named) |
| `python/find-predicate.ts#lower` | ExprIR | 13 | `null` = "not queryable" — the caller's fallback/refusal signal |
| `python/find-predicate.ts#isColumnRooted` | ExprIR | 17 | `false` routes to the host-value path (`literal(...)` binding) |
| `typescript/render-stmt.ts#markableExprsOf` | StmtIR | 2 | sourcemap marks only — **`if` newly added** (see §4f) |
| `ir/util/sql-renderable-expr.ts#sqlRenderableExpr` | ExprIR | 15 | the backfill gate; default REFUSES with `loom.migration-expr-unsupported` |
| `ir/util/temporal.ts#isDatetimeTypedIR` | ExprIR | 15 | `false` REFUSES temporal interval arithmetic in a `where` |
| `ir/enrich/enrichments.ts#tailBindType` | WorkflowStmtIR | 11 | `undefined` = "binds no tail value" |
| `ir/validate/checks/api-checks.ts#aggregatesTouched` | WorkflowStmtIR | 7 | the listed kinds name no aggregate |
| `ir/validate/checks/domain-service-checks.ts#checkOperationBody` | StmtIR | 8 | see §4c — the statement scan also went DEEP |
| `ir/validate/checks/migration-checks.ts#sqlExprFamily` | ExprIR | 15 | dead by construction (`sqlRenderableExpr` refuses them first) |
| `ir/validate/checks/query-checks.ts#describeSeedValue` | ExprIR | 14 | message formatting for an already-decided diagnostic |
| `ir/validate/checks/shared.ts#firstUnknownColumnRef` | ExprIR | 12 | unreachable (`firstNonQueryableNode` refuses them) — **except `duration`, which IS admitted; arm added** |
| `ir/validate/checks/structural-checks.ts#check` | StmtIR | 7 | already deep (`walkStmtsDeep`); the listed kinds are the PURE half |
| `ir/validate/checks/structural-checks.ts#lifecycleGuardIllegalReads` | ExprIR | 18 | per-node classifier under `walkExprDeep` |
| **`structural-checks.ts#validateEventSourcedDiscipline`** | StmtIR | 9 | see §4a — top-level-only; now `walkStmtsDeep`, chain → exhaustive `switch` |
| **`structural-checks.ts#validateEventSourcedDiscipline$2`** | StmtIR | 8 | applier-purity half of the same, same fix |
| `ir/validate/checks/workflow-checks.ts#checkBranchOpCalls` | WorkflowStmtIR | 11 | one level DELIBERATELY (it resolves branch-LOCAL `let` bindings; a nested `for-each`/`if-let` opens its own scope, owned by the arms above) |
| `util/expr-body-type.ts#bodyTypeOf` | ExprIR | 12 | `undefined` = "ask your own fallback" |
| `util/expr-body-type.ts#provableStringType` | ExprIR | 17 | `undefined` narrows a claim, never widens one |

---

## 4. The six defects

Every one is the M-T6.50 shape: a hand-rolled child enumeration that stopped one level short.
**Five are VALIDATOR gates** — their failure mode is a diagnostic that does not fire, which is worse
than a crash because the backend then emits the shape the gate exists to refuse. **One is an
EMITTER**, and it produces Elixir that does not compile.

Each was measured the same way: build the repro, run it on the fixed tree, then restore the ONE file
to its pre-fix content **by file copy** (`git show HEAD:… > scratch`, then `cp`; never
`git checkout --`, per `experience_gathered.md` §84), rebuild, re-run, and restore by copy with a
`diff … && echo RESTORED IDENTICAL`.

### 4a. `loom.emitted-event-unhandled` / `loom.event-sourced-direct-mutation` — blind to `if`

`validateEventSourcedDiscipline` walked `cmd.statements` and `ap.statements` at the TOP LEVEL only.

```ddd
operation deposit(amount: int) {
  if amount > 1000 { emit Flagged { account: id } }   // no apply(Flagged) exists
  emit Deposited { account: id, amount: amount }
}
```

| | `ddd parse` |
|---|---|
| before | `0 error(s), 0 warning(s).` |
| after | `loom.emitted-event-unhandled Accounts/Account: aggregate 'Account' operation 'deposit' emits 'Flagged' but no applier folds it.` |

The event is recorded in the stream and never reflected in state — silently, forever, on every
backend. The `assign`/`add`/`remove` arm had the same blindness. This is the **identical** hole
`loom.function-block-impure` closed one screen up in the same file (its "DEEP, not one level" note);
it was simply never applied here.

### 4b. `loom.vanilla-op-call-position` — blind to `if`

```ddd
operation tick(flag: bool) {
  if flag { let n = bump() total := n } else { total := 0 }   // bump() is a private operation
}
```

Before: clean. The emitted Elixir (measured):

```elixir
record = if flag do
  n = bump_counter(record, %{})          # {:ok, term()} | {:error, …}  — a TUPLE
  record = %{record | total: n}          # writes a tuple into an :integer column
```

`bump_counter/2` returns the tagged tuple, so `total: n` writes `{:ok, 1}` — an `Ecto.ChangeError`
at runtime, not even a compile error. After: `loom.vanilla-op-call-position`, naming `tick` and
`bump`. The caller now enumerates statements with `walkStmtsDeep` and computes the tail-`return`
carve-out **per statement**, so a branch's own `return bump()` keeps the exemption.

### 4c. `loom.domain-service-no-mutation` — blind to `if`

```ddd
domainService Pricing {
  operation quote(base: int): int {
    let out = base
    if base > 10 { out := base * 2 }
    return out
  }
}
```

Before: clean. After: `loom.domain-service-no-mutation`. **The top-level twin (`out := base * 2` with
no `if`) was already refused** — this is a consistency fix, not a new refusal, and the test asserts
both depths so that stays visible.

### 4d. `loom.vanilla-document-unsupported` — blind to `if`

`docFunctionUnsupported` pulled expression roots from six of the twelve `StmtIR` kinds and had no
`if` arm, yet a `function` block body IS allowed to branch (`FunctionDecl`'s block form takes
`Statement*`, and wave C2 stopped refusing the shape).

```ddd
aggregate Article shape: document {
  operation retitle(t: int) { title := tier(t) }
  function tier(t: int): string {
    if viewCount > t { return match { title == "x" => "hot", else => "warm" } } else { return "cold" }
  }
}
```

Before: clean, and elixir then emits a document-path body for a `match` the scalar path cannot
render. After: `loom.vanilla-document-unsupported`, naming `retitle`.

### 4e. `loom.method-call-unresolved-receiver` — blind to an i18n hole

`checkBody`'s descent had no `i18nFormat` arm, and the wrapper is documented as TRANSPARENT — every
backend renders straight through it. So **every gate this module raises** (unresolved action refs,
`Action(...)` arity, action-payload conformance, the method-call receiver rule, the effect-marker
floor, projection reads) was blind to whatever sat inside a `` `…{x, format}` `` hole.

```ddd
Heading { `total {ghostBinding.total(), number}`, level: 1 }
```

Before: clean. After: `loom.method-call-unresolved-receiver`. The descent also gained `match.subject`,
`match.variantArms`, a `call`'s `style:` entries and a `duration` amount, and `checkStmt` gained `if`
(page action bodies refuse `if` at a different gate today, so that arm is defensive).

### 4f. `bodyUsesState` — the Elixir ES-workflow handler that does not compile

**The one EMITTER find.** `renderEsWorkflowHandler` binds the folded snapshot as `state` or `_state`
from `bodyUsesState`, which hand-rolled BOTH walks: four of fourteen `WorkflowStmtIR` kinds with no
`for-each`/`if-let` nesting, and an expression walk with no `convert` / `match` / `list` / `duration`
/ `i18nFormat` / `style:` / lambda-block arm.

Repro — the corpus fixture `eventsourced-workflow.ddd` with one operator added:

```ddd
on(pr: PaymentRegistered) by pr.order {
  precondition long(paid) >= 0          // `paid` is workflow state, behind a convert
  emit FulfillmentCancelled { order: pr.order }
}
```

Parses, validates and generates **clean**, 0 errors. `d/lib/d/fulfillment/workflows/order_fulfillment/on_payment_registered.ex`:

```diff
- _state = D.Fulfillment.Workflows.OrderFulfillmentFold.from_events(key, loaded)
+ state  = D.Fulfillment.Workflows.OrderFulfillmentFold.from_events(key, loaded)
  with :ok <- ensure(state.paid >= 0, {:precondition_failed, …}),
```

Before, the next line names `state.paid` against a binding called `_state`:
`** (CompileError) undefined variable "state"`. Elixir-only (no other backend has this two-name
binding), and it is the CR1-d shape exactly.

Why the corpus never caught it: the one existing ES-workflow fixture reads `paid` as a BARE ref
directly under the precondition — the single expression kind the old walk did handle.

---

## 5. The regression tests, and their mutation proofs

Nothing in the corpus reaches any of these shapes (§6 — emission AND diagnostics came back
byte-identical), so the byte-identical result is itself the evidence that no fixture covers them.
Two new files:

### `test/ir/branch-nested-gate-reach.test.ts` — the five validator gates

Six cases, one per gate arm. Each asserts the diagnostic fires for **both** spellings of the same
violation: at the top of a body, and one level down. The top-level leg is the control — it already
passed before the fix, so a vacuous all-red run is distinguishable from the real signature (branch
leg red, top-level leg green). The `loom.vanilla-op-call-position` case additionally asserts the
gate stays platform-scoped (silent on `node`).

**Mutation proof.** All five pre-fix files restored by copy, rebuilt, suite re-run:

```
Tests  6 failed (6)
```

and every failure is the BRANCH leg, verbatim:

> `loom.emitted-event-unhandled fires at the top of a body but NOT inside an `if` branch — the gate
> does not reach the branch bodies, so the same violation one level down is accepted in silence:
> expected [] to include 'loom.emitted-event-unhandled'`

> `an event-sourced command mutates state inside an `if` branch and the discipline gate does not see
> it: expected [] to include 'loom.event-sourced-direct-mutation'`

(plus the same shape for `loom.vanilla-op-call-position`, `loom.domain-service-no-mutation`,
`loom.vanilla-document-unsupported` and `loom.method-call-unresolved-receiver`). Restored by copy,
verified `RESTORED IDENTICAL` on all five, rebuilt, re-run: **6 passed**.

### `test/generator/elixir/vanilla-es-workflow-state-binding.test.ts` — the emitter

Five cases: the direct-read control plus three slots the old walk missed (`convert`, `list` literal,
a ternary inside a convert), and a name-independent invariant.

**The assertions distinguish a binding from a use**, which is the crux, because the broken output
still contains `state` — as `_state`, and in `state.paid`:

1. the binding is matched by a **regex anchored on a non-identifier char**
   (`/(?<![\w_])state = …from_events\(/`), not `toContain` — `_state = <Fold>.from_events(`
   CONTAINS `state = <Fold>.from_events(` as a plain substring, so a substring assertion passes on
   the very output the file exists to reject. *(The first draft used `toContain` and was vacuous
   under mutation; caught by running the proof.)*
2. an independent second witness: the `_state` form must be ABSENT.
3. a name-independent case: for every handler that reads `state.<field>`, a `state = …` binding must
   exist. A refactor that renames the handle keeps passing; one that drops the binding fails.

**Mutation proof.** `workflow-eventsourced-emit.ts` restored by copy, rebuilt:

```
Tests  4 failed | 1 passed (5)
```

The control passes; the three defect slots and the name-independent case fail:

> `the fold snapshot is bound as `_state` while the body reads `state.…` — `mix compile` fails with:
> undefined variable "state": expected false to be true`

> `an ES workflow handler names `state` without binding it — the emitted Elixir does not compile:`
> `long(paid) >= 0: reads state.paid but binds `_state``
> `[paid, 0].length > 0: reads state.paid but binds `_state``
> `long(cancelled ? paid : 0) >= 0: reads state.cancelled, state.paid but binds `_state``
> `: expected [ …(3) ] to deeply equal []`

Restored by copy, `RESTORED IDENTICAL`, rebuilt, re-run: **5 passed**.

> Note on the `match` probe: a `match` expression does not parse in a workflow `precondition` on this
> grammar (`Expecting token of type '=>' but found ','`), so the two probes are `convert` and `list`
> — both were missing arms and both are reachable there.

---

## 6. Gates

| gate | result |
|---|---|
| `npx tsc -b` | clean (exit 0) |
| `npm run lint` (`biome ci . --error-on-warnings`) | clean (exit 0) |
| `npx vitest run test/system test/ir test/generator test/platform test/language` | green |
| `npx vitest run test/system/ir-walk-census.test.ts` | 8/8 |
| **emission byte-identical** | **44,995 emitted files, 0 differences** |
| **diagnostic set identical** | **270 IR diagnostics, 0 differences** |

The differential hashes every file of every generated project across the **77-fixture shared corpus ×
its declared backends** (node, dotnet, java, python, vanilla) **× the non-default persistence
adapters** (node: drizzle, mikroorm; dotnet: dapper), **plus** every `.ddd` under `examples/`,
`web/src/examples/` and `journey/`, through `generateSystems` — and, because five of the six defects
are VALIDATOR gates where the byte-identical gate is the wrong instrument (CR1-d §7), it hashes the
**`validateLoomModel` diagnostic set** over the same corpus in the same pass. Captured before the
first edit and after the last; `diff` returned empty on both.

**Zero difference on both sides is the expected and correct result**, and it is also the finding: the
corpus reaches none of the six shapes. That is why §5 exists.

---

## 7. Waiver counts

**98 → 47** (−51 entries). 52 SITES were resolved; one of them (`#namesReadByBody`) stays in the
register under a different, `standing` reason, so the entry count falls by 51.

| reason | before | after | note |
|---|---|---|---|
| `CLOSED_PREDICATE` | 42 | **0** | constant deleted |
| `HOTSPOT_SPLIT_RESIDUE` | 10 | **0** | constant deleted |
| `THROWING_DISPATCHER` | 32 | 32 | **standing** — CR1-f's subject |
| `TRAVERSAL_TIME_BOXED` | 7 | 7 | deferred, `2026-12-31` — untouched |
| `SHALLOW_CHILD_BUILDER` | 4 | 4 | deferred, `2026-12-31` — untouched |
| `DELEGATES_TO_SANCTIONED_WALKER` | 3 | **4** | +1 (`#namesReadByBody`) |
| **total** | **98** | **47** | |

By resolution: **11 migrated** onto `walk.ts` (the site leaves the census entirely), **40
`never`-checked**, **1 re-waived**.

### The one re-waive, and why it is `standing`

`src/ir/validate/checks/ui-page-structure-checks.ts#namesReadByBody` →
`DELEGATES_TO_SANCTIONED_WALKER`.

It already rides `walkExprDeep`; what the census flags is the three-arm chain layered on top, which
is a per-node NAME EXTRACTION ("which callable or member does this node name?"), not a dispatch that
has to cover every kind. A node kind it does not name contributes nothing to a set used **only to
SUPPRESS** a warning (`loom.scaffold-filter-param-dropped`), so the worst case is the warning firing
where the author had in fact bound the find — advisory, and in the noisy direction. It survives
"why is this not just `walkExprDeep`?" because **it already is**; a `never`-check does not fit a
membership test with no terminal `else`. `standing`, not `deferred`: nothing scheduled will change
this.

### What CR1-e did NOT touch

`TRAVERSAL_TIME_BOXED` (7) and `SHALLOW_CHILD_BUILDER` (4) keep their `2026-12-31` deferrals. They
are a different class — genuine hand-rolled traversals and one-level child builders, CR1-d's own
"treat as suspects" list — and draining them is a separate packet. **CR1-d's warning applies with
more force now:** the hono twin of `SHALLOW_CHILD_BUILDER` was carrying a live defect, and this
packet found six more of the same shape. `TRAVERSAL_TIME_BOXED` is still the highest-risk bucket.

`THROWING_DISPATCHER` (32) is P0-2b / packet CR1-f. One observation for it from here:
`src/generator/_frontend/default-seed.ts#renderDefaultSeed` is waived as `THROWING_DISPATCHER` but
its default **returns `null`**, it does not throw — so at least one row of that bucket is
mis-classified, and the classification should be re-derived from the arm rather than trusted.

---

## 8. Files touched

```
src/ir/validate/checks/ui-action-body-checks.ts     (§3a 1-4; the §4e fix)
src/ir/validate/checks/ui-page-structure-checks.ts  (§3a 5-6)
src/ir/validate/checks/datasource-checks.ts         (§3a 7-9; the §4d fix)
src/ir/validate/checks/backend-syntax-checks.ts     (§3a 10; the §4b fix)
src/ir/validate/checks/structural-checks.ts         (§3b; the §4a fix)
src/ir/validate/checks/domain-service-checks.ts     (§3b; the §4c fix)
src/ir/validate/checks/api-checks.ts                (§3b — handlerMutates migrated, aggregatesTouched never-checked)
src/ir/validate/checks/migration-checks.ts          (§3b)
src/ir/validate/checks/query-checks.ts              (§3b)
src/ir/validate/checks/shared.ts                    (§3b — plus the `duration` arm)
src/ir/validate/checks/workflow-checks.ts           (§3b)
src/ir/util/domain-service-tier.ts                  (§3b — plus isMutatingOperation)
src/ir/util/sql-renderable-expr.ts                  (§3b)
src/ir/util/temporal.ts                             (§3b)
src/ir/enrich/enrichments.ts                        (§3b)
src/util/expr-body-type.ts                          (§3b ×2)
src/generator/_expr/authz-filter-inapp.ts           (§3b ×2)
src/generator/_walker/primitives/forms.ts           (§3b)
src/generator/dotnet/criteria-emit.ts               (§3b)
src/generator/dotnet/emit/efcore.ts                 (§3b ×2)
src/generator/dotnet/render-expr.ts                 (§3b)
src/generator/elixir/realtime-liveview.ts           (§3b)
src/generator/elixir/render-expr.ts                 (§3b)
src/generator/elixir/vanilla/changeset-invariant-emit.ts (§3b)
src/generator/elixir/vanilla/provenance-emit.ts     (§3b ×2)
src/generator/elixir/vanilla/wire-serialize.ts      (§3b)
src/generator/elixir/vanilla/workflow-eventsourced-emit.ts (the §4f fix)
src/generator/feliz/realtime.ts                     (§3b ×2)
src/generator/flutter/realtime.ts                   (§3b)
src/generator/java/render-expr.ts                   (§3b)
src/generator/python/find-predicate.ts              (§3b ×2)
src/generator/python/render-expr.ts                 (§3b)
src/generator/react/pages-emitter.ts                (§3b ×2)
src/generator/typescript/emit/schema.ts             (§3b)
src/generator/typescript/render-stmt.ts             (§3b + the `if` mark arm)
test/system/ir-walk-census.test.ts                  (the register: −51, two constants deleted)
test/ir/branch-nested-gate-reach.test.ts            (NEW — the five validator gates)
test/generator/elixir/vanilla-es-workflow-state-binding.test.ts (NEW — the §4f emitter defect)
docs/new-plan/waves/handoffs/wave-cr1-e.md          (this note)
```

## 9. For whoever picks up the rest

1. **`TRAVERSAL_TIME_BOXED` (7) is next, not `THROWING_DISPATCHER`.** Six of this packet's 52 were
   traversals misfiled as predicates; that bucket is traversals by its own admission.
2. **The `default:`-arm shape is not evidence.** Sort by what the function DOES with an unnamed kind,
   never by what its default LOOKS like. A `default: return false` in a predicate and a
   `default: break` in a collector are the same three tokens and opposite verdicts.
3. **`i18nFormat` is the quiet one.** It is documented as transparent, so every hand-rolled walk that
   pre-dates it has a hole there, and the hole is invisible to a corpus that does not use `, format`
   holes. Worth a grep of its own.
4. **A validator's byte-identical gate is the DIAGNOSTIC set**, and it is cheap: `validateLoomModel`
   over the same corpus in the same pass as the emission hash, ~2 minutes for both. There is no
   reason for a future packet to run only one of them.

---

## 10. Three things the full rollup surfaced that are NOT this packet's

Running `test/system test/ir test/generator test/platform test/language` on the merged
(batch-1 ∪ `main`) tree produced 26 failures. Two were mine and are fixed (§8's second commit);
the rest split three ways, and the middle one is a finding in its own right.

### (a) `workflow-path-coverage` ×17 — a semantic merge conflict, FIXED here

`src/generator/_test/` is a genuine shared emission seam — all five backends' `emit/tests.ts`
import `arg-coercion.ts` — added on `main` by **#2957**. CR1-a's new gate, which *derives* the
requirement that a workflow claiming `src/generator/<plat>/**` watches every `src/generator/_*` dir
in that tree's import closure, landed in **batch 1**. Neither side was wrong; neither could see the
other. They met for the first time when this branch merged them, and the gate fired.

Fixed by adding `src/generator/_test/**` next to `_stmt/**` in the 18 workflows carrying the seam
block → 90/90 green. **This is CR1-a's gate doing exactly the job the audit row opened it for**, on
its first combined run, and it is the clearest evidence in the wave that the gate was worth building.

### (b) `auth-verifier-doc-honesty` ×2 — INHERITED, left for CR1-b

**Not fixed, deliberately — it is not mine to decide.** `test/generator/auth-verifier-doc-honesty.test.ts`
comes from `main` (`08c52c1b`) and asserts the verifier emits the options inline:

```
jwtVerify(token, await getJwks(), { issuer: ISSUER, audience: A… })
```

while CR1-b's own fix (`5636c7ce`, batch 1) hoisted them into a `VERIFY_OPTIONS` const, which is
what the emitter now produces. Same shape as (a) — a semantic merge conflict inside batch 1's own
fold — but here the resolution is a real question (is the hoisted const the intended emission? then
re-point the assertion), so it belongs to whoever owns the OIDC row.

Proved to predate CR1-e mechanically, not by inspection:

```
git diff be2e3349 HEAD -- test/generator/auth-verifier-doc-honesty.test.ts \
                          src/platform/hono/v4/auth-emit.ts src/platform/hono/v5/auth-emit.ts
```

returns **empty** — every input to that test is byte-identical to the batch-1 tip. (And
independently: the emission differential in §6 covers `auth-oidc.ddd` on node and came back with
zero differences, so nothing this packet did could have changed that output.)

### (c) `packaging-split-*` ×3 — environmental

`fs-discovery` finds 0 backends because this worktree has no `node_modules/@loom` workspace
symlinks (`npm install` was never run inside it; the parent checkout has them). This packet touches
no file under `src/platform/**` or `packages/**`. Passes wherever the branch is folded.

### (d) `walker-declines-with-a-code` ×1 — a CONTENTION artifact, not a failure

Timed out at 180,000 ms inside the parallel rollup (load average ~19 on 4 cores, two sibling packets
running their own suites). **Run alone: 140.6 s, 9/9 green.** Recorded as a flake.

> Worth carrying forward, because it is easy to misread: under load this box turns a slow-but-fine
> test into an ordinary-looking red. The tell is the duration — a test whose reported time is the
> timeout itself. **Re-run any failure in isolation before recording it.** The coordinator
> independently hit the same artifact three times the same day, once on a test that passes in 1.6 s.

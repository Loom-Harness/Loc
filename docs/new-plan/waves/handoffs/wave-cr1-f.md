# Wave CR1 packet **CR1-f** — the 32 `THROWING_DISPATCHER` census waivers

*Audit row **P0-2b** (`docs/audits/code-review-2026-09-13.md`). Branch:
`worktree-agent-ad4e1346d147d61fa`. Base: `main` @ `4b4b76ec`, then merged with the batch-1
branch `claude/loom-code-review-audit-790gec` mid-packet (see **Base correction**).*

---

## Base correction — the merge the coordinator asked for

The brief said this worktree was branched from the batch-1 tree with CR1-d's typed-waiver
mechanism present. It was not: isolation gave plain `origin/main` @ `4b4b76ec`
(`git grep -c reviewUntil -- test/system/ir-walk-census.test.ts` → 1, versus 13–15 on the
sibling packets' trees). The coordinator corrected this mid-packet; the drain had by then been
done and committed against the bare-string register.

Resolution, in commit order:

| commit | what |
|---|---|
| `0813df5d` | the drain, against main's bare-string `WAIVERS: Record<string, string>` |
| **merge** | `Merge the Wave CR1 batch-1 branch into CR1-f (typed-waiver mechanism)` |
| (in the merge) | every CR1-f entry re-expressed as `{ standing }` / `{ deferred, reviewUntil }` |

**One conflict, in `test/system/ir-walk-census.test.ts`, at the reason-constants block** —
exactly where the coordinator predicted. Resolved by keeping CR1-f's per-site reason constants
and **deleting batch-1's `THROWING_DISPATCHER` constant entirely**: no waiver in the register
references it any more, which is the point of the packet. Everything else merged clean.

Post-merge checks, all re-run: the 32 site ids are unchanged by CR1-d (it drained sites in the
`INFLIGHT_*` / hotspot buckets, not this one), `LIVE_FENCES` is `{}` so no CR1-f waiver names a
`blockedBy`, and every `reviewUntil` is `2026-12-31` — 101 days out, inside `MAX_DEFERRAL_DAYS`
(180).

**One merge-interaction failure, fixed here.** CR1-a's new `workflow-path-coverage` gate
(batch-1) requires every shared `src/generator/_*/` dir in a workflow's import closure to appear
in its `paths:` block. `src/generator/_test/` landed on `main` at `8787897d` (2026-09-14)
*after* CR1-a wrote those blocks, and batch-1 does not contain it — so the two are only red
together. 17 tests failed on the merged tree with

```
AssertionError: dotnet-build.yml claims a whole platform generator tree but does not watch
src/generator/_test/**. … expected [ '_test' ] to deeply equal []
```

Fixed the way the gate's own message says to: `- 'src/generator/_test/**'` added in
alphabetical position (`_stmt` < `_test` < `_trace`) to **20** workflows' `paths:` blocks (both
the `push:` and `pull_request:` triggers where both exist — 34 insertions). Not CR1-f's work,
but it is red in CR1-f's tree, and the coordinator will hit it again at the fold of any packet
that merges batch-1. Nothing else about the two trees conflicts.

**One merge-interaction failure I did NOT fix, because it is not mine to resolve.**
`test/generator/auth-verifier-doc-honesty.test.ts` fails 2/2 on the merged tree:

```
× says `aud` is NOT verified when the model declares no audience
× claims audience validation only when the model actually asks for it
AssertionError: expected …"jwtVerify(token, await getJwks(), { issuer: ISSUER, audience: AUDIENCE })"
```

The emitted verifier uses CR1-b's `VERIFY_OPTIONS` + always-emitted `AUDIENCE` shape; the test
is `main`'s honesty-fix version, which expects the inline options object and the
conditional-audience arms. **Both sides answered the audit's P0-4 and the compose kept one of
each.** Proved not to be CR1-f's: every one of my `src/` edits was reverted to its `4b4b76ec`
content by file copy and the test **still failed 2/2**; restored by file copy afterwards, and my
own three suites re-run green (24/24). CR1-b owns the composition — the two arms of
`renderOidcVerifier` and the two `it(...)` bodies have to agree on one shape, and picking it is
an auth decision, not a census one.

---

## Headline: the bucket's stated reason was false for 12 of its 32 entries

The blanket waiver read:

> *closed emission dispatcher whose default arm THROWS for an unhandled kind (loud failure, not
> the silent-drop class this census targets); case-completeness is emission-mode/parity scope
> (packet 2.4), not 2.3's*

Two things were wrong with it.

1. **The audit's objection is right.** For a generator, "loud" means `ddd generate system` dies
   on a valid `.ddd` — this repo's own definition of a **silent gap**. Three of the sites were
   measured doing exactly that, from models `ddd parse` reported `0 error(s), 0 warning(s)` for.
2. **Twelve of the 32 do not throw at all.** Five were total by case count with *no* `default`
   (TypeScript caught a new kind only as "function lacks ending return"); seven fall through to
   a **silent** default — `return null` / `return e` / `return "nil"` /
   `return { value: "state" }` / `break`. That is the M-T6.50 silent-drop class the waiver
   claimed to exclude, sitting inside the waiver that excluded it. One of them is *proven* so
   (row 26 below).

Method, per the brief: the declared vocabulary of every site was extracted with the TypeScript
checker (the census's own detector plus a case-label collector) and diffed against the current
`ExprIR` (21) / `StmtIR` (12) / `WorkflowStmtIR` (14) kind lists read out of `walk.ts` — scripted,
not eyeballed. Sites whose vocabulary was short were then **probed with a real `.ddd` through
`node bin/cli.js`**, because "a validator probably catches it" is the reasoning this wave exists
to correct.

---

## Per-site table

`R?` = reachable from valid `.ddd`. Sites are grouped by outcome.

### A. Waiver DELETED — made exhaustive, emission byte-identical (5)

Each already listed every kind of its union and had no `default`. They now carry
`default: { const _exhaustive: never = s; … }`, the census sees them as exhaustive, and the
ratchet took their entries.

| site | union | missing kinds | R? | outcome |
|---|---|---|---|---|
| `elixir/domain-service-emit.ts#renderStatement` | StmtIR | none (12/12) | n/a | `never`-check added; **waiver deleted** |
| `elixir/vanilla/operation-returns-emit.ts#renderReturningStmt` | StmtIR | none (12/12) | n/a | `never`-check added; **waiver deleted** |
| `elixir/vanilla/workflow-execution-emit.ts#lowerStatement` | WorkflowStmtIR | none (14/14) | n/a | `never`-check added; **waiver deleted** |
| `system/mermaid.ts#stepNode` | WorkflowStmtIR | none (14/14) | n/a | `never`-check added; **waiver deleted** |
| `system/mermaid.ts#sequenceMessages` | WorkflowStmtIR | none (14/14) | n/a | `never`-check added; **waiver deleted** |

### B. Unreachable — `{ standing }`, each citing the `loom.*` code (12)

| site | missing kinds | the gate that makes it unreachable |
|---|---|---|
| `_frontend/realtime.ts#renderMessageExpr` | this, id, unary, method-call, duration, i18nFormat, authz-filter | `loom.toast-message-unsupported` — `ui-action-body-checks.ts#toastMessageProblem` mirrors these four switches **arm for arm** (literal / the event binding / a member chain off it / paren / binary) |
| `elixir/realtime-liveview.ts#go` | (same) | (same) |
| `feliz/realtime.ts#renderFsToastMessage` | (same) | (same) |
| `flutter/realtime.ts#renderDartToastMessage` | (same) | (same) |
| `_frontend/gate-expr.ts#renderGateExpr` | this, id, duration, i18nFormat, authz-filter, **convert, call, list, match, new, object, lambda, action-ref** | **`loom.ui-gate-expr-unsupported` — NEW, this packet.** Was reachable; see §Converted |
| `feliz/auth-gate.ts#renderFelizGate` | (same) | (same) |
| `flutter/auth-gate.ts#renderFlutterGate` | (same) | (same) |
| `dotnet/emit/dapper.ts#whereToSql` | this, id, duration, i18nFormat | `firstNonQueryableNode` (`ir/validate/checks/shared.ts`) — exhaustive and `never`-checked; its admitted set is exactly this switch's vocabulary **after** this packet closed `this` / `id` / bare `duration`. Residue routes through `loom.query-emission-invalid`, not a bare `Error` |
| `java/render-jpql.ts#render` | duration, i18nFormat | (same); `unsupported()` here already routes to `refuseOutOfVocabulary` |
| `java/render-criteria.ts#bool` | id, duration, i18nFormat | (same), **plus** its caller `java/emit/criteria.ts:37` runs the oracle itself and returns `null` rather than rendering — behind the gate twice |
| `java/render-sql-restriction.ts#renderSqlRestriction` | this, id, duration, i18nFormat | (same), plus `loom.context-filter-no-principal` for the one `authz-filter` shape it cannot render statically |
| `sql-pg-expr.ts#renderSqlScalarExpr` | this, id, member, method-call, call, new, object, list, lambda, authz-filter, duration, i18nFormat, match, action-ref | `loom.migration-expr-unsupported` (`migration-checks.ts`) bounds a backfill expression at phase ⑦; the default routes through `refuseOutOfVocabulary` → `loom.query-emission-invalid` |
| `feliz/update-emit.ts#renderUpdateStmt` | precondition, requires, return, emit, if | `loom.ui-body-statement-kind` (return/precondition/requires, every non-LiveView frontend), `loom.if-stmt-page-body-unsupported` (`if` anywhere in a ui body, **every** frontend), phase-③ scope resolution (`emit` has no aggregate in ui scope) |
| `flutter/riverpod-emit.ts#renderNotifierStmt` | precondition, requires, return, emit, variant-match, if | (same) + `loom.flutter-async-effect-unsupported` for `variant-match` on the component path — the site's own comment already cited each one and was re-checked against them |
| `elixir/vanilla/fold-stmt-emit.ts#renderFoldStatement` | precondition, requires, return, emit, call, variant-match, if | `loom.applier-emits` / `loom.applier-impure-call` / `loom.applier-guard` (`structural-checks.ts`, "Rule 4 — applier bodies are pure folds") + `loom.elixir-if-stmt-unsupported` |
| `elixir/vanilla/tests-emit.ts#vtExpr` | this, id, action-ref, lambda, list, authz-filter, ternary, convert, duration, i18nFormat, match | **not a codegen abort at all** — the typed `UnsupportedTestShapeError` is *caught* by `renderTest` (same file, ~219) and degrades the case to `@tag :skip`; only a non-`UnsupportedTestShapeError` propagates |

(That table is 15 rows because three of them — `gate-expr` and its two siblings — are listed
here as *now* unreachable and again under §Converted as *what made them so*.)

### C. Converted — a reachable crash became an honest refusal (2 fixes, 4 sites)

See §Diagnostics below for the before/after and the mutation proof.

### D. MISFILED — the default does not throw; the waiver described the wrong failure (7)

All kept waived (draining them is the `CLOSED_PREDICATE` class, packet **CR1-e**'s scope), but
with the false claim removed — a waiver that names the wrong failure mode is worse than none,
because the next reader trusts it. Six are `{ deferred, reviewUntil: "2026-12-31" }`; the one
whose silent default is *correct by design* is `{ standing }`.

| site | default arm | what it actually does |
|---|---|---|
| `_frontend/default-seed.ts#renderDefaultSeed` | `return null` | **Correct**: a documented best-effort fallback (the caller keeps its type-zero seed). Wrong bucket, right behaviour → `standing` |
| `elixir/domain-service-emit.ts#substituteRefs` | `return e` | An **IR→IR map**, not an emitter. Unhandled kinds (`list` / `match` / `convert` / `i18nFormat` / `duration` / `lambda`) leave a `param` ref **unsubstituted**, so the emitted Elixir names an undefined variable — the #2720/M-T6.50 shape exactly |
| `elixir/store-emit.ts#renderStoreStmt` | `return { value: "state" }` | The statement is dropped, the struct passes through. And the gate it would lean on does **not** cover it: `loom.ui-body-statement-kind` exempts `phoenixLiveView`, the only framework this emitter serves |
| `elixir/store-emit.ts#renderStoreExpr` | `return "nil"` | A store-action RHS outside the subset (a method call, a `match`, a conversion) silently becomes `nil` in the emitted Elixir |
| `elixir/vanilla/eventsourced-emit.ts#renderCommandRunner` | `break` | Statement dropped. The ES command discipline does refuse assign/add/remove/call; `expression` / `return` / `variant-match` were **not** re-verified against a gate |
| `elixir/vanilla/workflow-execution-emit.ts#renderBranch` | terminal `else`, no throw | Routes every unlisted kind into the emit/resource-call branch renderer, so an `if-let` / `for-each` / `repo-delete` nested in an `if let` branch is **mis-rendered** rather than refused |
| `elixir/vanilla/function-emit.ts#renderPureBlock` | *no `default` and not total* | Six kinds push no line. `loom.function-block-impure` covers five of the six; **`variant-match` was not separately verified**, so `deferred`, not `standing` |

### E. Not re-verified — the one honest deferral (1)

| site | missing kinds | why still deferred |
|---|---|---|
| `feliz/fs-expr.ts#renderFsExpr` | this, action-ref, authz-filter | A real throw, and the site's own comment argues all three are shapes the frontend pipeline never produces. CR1-f **read** that argument; it did not probe it. Re-verify with a `.ddd` that puts an `action-ref` in an update-arm *value* position before promoting to `standing` |

### F. New waiver added by this packet (1)

| site | why waived |
|---|---|
| `ir/validate/checks/ui-framework-checks.ts#pageGateProblem` | `{ standing }`. Deliberately **not** `never`-checked: its `default` **refuses**, so a new `ExprIR` kind fails *closed* into `loom.ui-gate-expr-unsupported` (a readable refusal) instead of falling through to the three renderers' bare `throw` — the direction the whole packet enforces. An exhaustive arm would spell the identical refusal 21 times. Same shape and same reason as its twin `ui-action-body-checks.ts#toastMessageProblem` |

---

## The two diagnostics, with crash-before / refusal-after

### 1. `loom.ui-gate-expr-unsupported` — the page `requires` gate

`RequiresProp: 'requires' expr=Expression` admits any expression; the gate type-check only
demands `bool`; the three page-gate renderers implement one narrow currentUser-only subset and
`throw` on everything else. They are arm-for-arm identical, so one target-agnostic phase-⑦ rule
covers all six closed-table frontends. `phoenixLiveView` is deliberately **excluded** — it
renders a page gate through the general HEEx expression renderer
(`heex-walker-core.ts#renderRequiresGuardAt`), so refusing it there would invent a limitation it
does not have.

**Before** (`page Welcome { requires string(currentUser.role) == "admin" }`, `auth: ui`, svelte):

```
$ node bin/cli.js parse  .scratch/probe/gate.ddd
0 error(s), 2 warning(s).
OK: .scratch/probe/gate.ddd

$ node bin/cli.js generate system .scratch/probe/gate.ddd -o .scratch/out
0 error(s), 2 warning(s).
Error: UI gate: expression kind 'convert' is not supported in a UI gate.
    at renderGateExpr (out/generator/_frontend/gate-expr.js:63:19)
    at renderGateExpr (out/generator/_frontend/gate-expr.js:55:23)
    at renderSveltePageGate (out/generator/svelte/walker/page-shell.js:422:25)
    at renderSveltePage (out/generator/svelte/walker/page-shell.js:392:18)
    …
```

**After**:

```
loom.ui-gate-expr-unsupported WebApp/Welcome: ui 'WebApp': page 'Welcome' `requires` gate uses a
`convert` expression. Every closed-table gate renderer implements the SAME client-evaluable
subset — `currentUser` and its claim chain, enum members, string/bool/int/long/decimal literals,
`.contains(…)` membership, comparisons, boolean operators, `!`, parentheses and a ternary — and
THROWS on anything else (`expression kind 'convert' is not supported in a UI gate`): …
1 error(s), 2 warning(s).
```

Files: message in `src/diagnostics/messages.ts`; check `validatePageGateExprs` in
`src/ir/validate/checks/ui-framework-checks.ts`, wired in `validate.ts`; anchor in
`code-docs.ts` → `15-ui-pages-structure.md#page--route-title-body`; register row in
`unsupported-register.ts` (`kind: "gap"`, mission **M-T1.10** — it drains with the same work
that drains its twin `loom.toast-message-unsupported`); `MAX_OPEN_GAPS` **20 → 21** with the
reviewed note; firing fixture in `diagnostic-firing-census.test.ts`; behaviour test
`test/ir/ui-page-gate-expr.test.ts`.

**Mutation proof.** `src/ir/validate/validate.ts` copied aside, the
`validatePageGateExprs(sys, diags);` line deleted, `tsc -b`, suite re-run — **5 of 8 failed**:

```
× a conversion in a page gate raises loom.ui-gate-expr-unsupported
× a non-membership method call in a page gate raises loom.ui-gate-expr-unsupported
× a null literal in a page gate raises loom.ui-gate-expr-unsupported
× the refusal fires on every closed-table frontend, not just one
× the message names the offending kind and the renderers, not just 'unsupported'

AssertionError: expected [] to include 'loom.ui-gate-expr-unsupported'
AssertionError: expected loom.ui-gate-expr-unsupported on react: expected [] to include 'loom.ui-gate-expr-unsupported'
AssertionError: expected '' to contain 'convert'
```

Restored **by file copy** (`cp .scratch/validate.ts.keep src/ir/validate/validate.ts`), never
`git checkout --` (`experience_gathered.md` §84). 8/8 green after restore.

The three control cases are half the point: an in-subset gate stays accepted on all six
frontends, a ternary/`!`/parens gate stays accepted, and `phoenixLiveView` stays **ungated**.

### 2. Three leaves the queryable oracle admitted that no query renderer emits

`firstNonQueryableNode` (`src/ir/validate/checks/shared.ts`) is the oracle every find /
criterion / projection predicate passes before a backend renders it. It listed `this` and `id`
beside `literal` as unconditionally queryable, and let a `duration` node through on its own
amount. **None of the five query renderers has an arm for any of them.** This is a validator gap
by the repo's own definition — `loom.query-emission-invalid`'s doc comment says reaching it "is
a validator gap or a compiler bug, never a user mistake".

Three fixtures, each measured on the pre-fix HEAD:

| `.ddd` | before | after |
|---|---|---|
| `find byThis(q: Customer): Customer[] where this == q` | `0 error(s), 4 warning(s)` → `QueryEmissionRefusal: drizzle-predicate: …` | `loom.find-where-not-queryable … (bare 'this' (the whole row) — a query predicate compares COLUMNS, so name one ('this.<field>'), not the aggregate itself)` |
| `find byId2(q: Customer id): Customer[] where id == q` | `0 error(s), 3 warning(s)` → same crash | `… (bare 'id' — no backend's query renderer emits the primary-key column in a find / criterion predicate; filter on a declared field, or load by key through '<Repo>.getById(...)')` |
| `find byDur(): Customer[] where days(7) == days(3)` | `0 error(s), 3 warning(s)` → same crash | `… (duration constructor 'days(…)' outside a 'datetime ± days(n)' comparison — a bare duration is not a column or a bindable value)` |

No new code was minted: the existing `loom.find-where-not-queryable` composes the returned
label, so there is no register row and no anchor to add. The `duration` arm is reachable only by
a **standalone** duration — the `binary` arm destructures the `datetime ± duration` form and
recurses into the duration's *amount*, never the node — which is why narrowing it leaves the A5
temporal feature untouched (asserted by two controls, one through the emitter).

`i18nFormat` was checked and left admitted: the only producer is a backtick template
(`lowerTemplateString`, the single construction site in `src/ir/lower/`), and every backtick
template in a find `where` is already refused as `arithmetic '+'` — measured on three shapes.

**Mutation proof.** `src/ir/validate/checks/shared.ts` copied aside, all three arms restored to
their pre-fix form, `tsc -b`, suite re-run — **6 of 8 failed**:

```
× bare `this` in a find where is refused by loom.find-where-not-queryable
× bare `this`: the message names WHY, not just "not queryable"
× bare `id` in a find where is refused by loom.find-where-not-queryable
× bare `id`: the message names WHY, not just "not queryable"
× a standalone `duration` constructor in a find where is refused by loom.find-where-not-queryable
× a standalone `duration` constructor: the message names WHY, not just "not queryable"

AssertionError: expected [] to include 'loom.find-where-not-queryable'
AssertionError: expected '' to match /compares COLUMNS/
AssertionError: expected '' to match /primary-key column/
AssertionError: expected '' to match /outside a 'datetime ± days\(n\)' comp…/
```

Restored by file copy; 8/8 green after restore. Test: `test/ir/queryable-non-column-leaves.test.ts`.

---

## Parity hand-off — for `parity-auditor`, then `language-feature-developer`

Both rows are **measured**, not inferred: for each, a backend that emits the shape is named,
with the emitted line. Neither is a language limit, so neither belongs behind a diagnostic.

### P1 — elixir reactor bodies refuse four `WorkflowStmtIR` kinds node emits

**Site:** `src/generator/elixir/dispatch-emit.ts#renderStmt` (line ~975).
**Vocabulary:** handles `factory-let`, `repo-let`, `op-call`, `emit`, `expr-let`, `assign`,
`precondition`, `requires`, `repo-run`, `for-each`.
**Missing:** `repo-delete`, `resource-call`, `domain-service-call`, `if-let`.
**Its own comment** said these "don't appear in validated reactor / starter bodies today" — that
is the unverified reasoning. All four appear, and all four crash:

| shape in a workflow reactor (`on(e: Event) { … }`) | elixir | node |
|---|---|---|
| `Orders.delete(o)` | `Error: dispatch-emit: unsupported reactor statement kind 'repo-delete'` | `await orders.delete(o.id);` |
| `mail.send(o.sku, "Shipped", "…")` | `… 'resource-call'` | `(await mail$send(o.sku, "Shipped", "…"));` |
| `Restocker.run(o)` | `… 'domain-service-call'` | `Restocker.run(o);` + `import { Restocker } from "../domain/services";` |
| `if let found = Orders.find(BySku("SKU-1")) { … }` | `… 'if-let'` | emitted |

Every one of those four models printed `0 error(s), 0 warning(s)` (one printed one unrelated
warning) from `ddd parse` before `ddd generate system` aborted with a bare stack trace.

**What emitting it would take:** each of the four already has a `lowerStatement` arm in the
*vanilla workflow-execution* emitter (`elixir/vanilla/workflow-execution-emit.ts`, which is
total over all 14 kinds after this packet). `dispatch-emit.ts#renderStmt` is the **reactor**
path and returns `BodyLine[]` in the same `with`-clause shape, so the work is porting four arms
between two emitters in the same backend, not new IR or new language surface. Start by diffing
the two switches: the reactor one is a strict subset.

**Reproducers:** the four probe `.ddd` files were built from `test/fixtures/corpus/workflow-create-state.ddd`
by adding one statement to the `on(e: OrderShipped)` reactor; see the four shapes above. They
belong in `test/fixtures/corpus/` as one fixture once the arms land, so
`corpus-elixir-build` covers them.

### P2 — an ES-workflow applier `let` crashes node and python; elixir, java and .NET emit it

**Sites:** `src/generator/python/workflow-eventsourced-emit.ts#renderApplierStmt` (this packet's
waiver) and `src/platform/hono/v4/workflow-eventsourced-builder.ts#renderApplierStmt` (the node
twin — its waiver is the in-flight bucket's, not this one's, so it is named here rather than
rewritten).
**Vocabulary:** both handle `assign`, `add`, `remove` only.

```
apply(pr: PaymentRegistered) { let bump = pr.amount  paid := paid + bump }
```

| backend | result |
|---|---|
| elixir | `Wrote 75 file(s)` |
| java | `Wrote 67 file(s)` |
| dotnet | `Wrote 70 file(s)` |
| **node** | `Error: es-workflow applier: unexpected statement kind 'let' (appliers are pure folds)` |
| **python** | `Error: python es-workflow applier: unexpected statement kind 'let' (appliers are pure folds)` |

`0 error(s), 0 warning(s)` in every case. A `let` in a pure fold is not impure — nothing in the
A1 applier discipline refuses it, and three backends already render it.

**What emitting it would take:** one arm each. Python: `f"{indent}{snake(s.name)} = {renderPyExpr(s.expr, rctx)}"`.
Node: the same against its expression renderer. Both switches are ~6 lines. Fixture:
`test/fixtures/corpus/eventsourced-workflow.ddd` with a `let` added to one `apply`, which puts
it in front of `corpus-{tsc,python}-build`.

### P3 — elixir drops a `repo-let` out of an ES-workflow handler, silently

**Site:** `src/generator/elixir/vanilla/workflow-eventsourced-emit.ts#renderEsWorkflowHandler`
(line ~429). Handles `precondition`, `requires`, `expr-let`, `emit`; `default: break`.

This is the one that makes the case for the whole packet. Source:

```
on(pr: PaymentRegistered) by pr.order {
  precondition paid >= 0
  let o = Orders.getById(pr.order)
  emit FulfillmentCancelled { order: pr.order }
}
```

`0 error(s), 0 warning(s)`. Node emits `const o = await orders.getById(pr.order);`. The emitted
Elixir (`lib/d/fulfillment/workflows/order_fulfillment/on_payment_registered.ex`) contains the
`ensure(state.paid >= 0, …)` guard and the `events = [%…FulfillmentCancelled{…}]` append — and
**nothing at all for the `repo-let`**. Valid Elixir, `mix compile --warnings-as-errors` clean,
a statement gone. This is the M-T6.50 class, inside the bucket that was waived for not being it.

**What emitting it would take:** `renderEsWorkflowHandler`'s sibling
`workflow-execution-emit.ts#lowerStatement` already has a `repo-let` arm producing exactly the
`{:ok, x} <- Context.get_<agg>(id)` with-clause this handler's `with` chain wants. Same file
tree, same shape. The other nine missing kinds (`assign`, `factory-let`, `op-call`,
`repo-delete`, `repo-run`, `resource-call`, `domain-service-call`, `for-each`, `if-let`) were
not probed individually and should be treated as suspects, not as safe — the `break` gives no
signal either way.

---

## Two observations outside this packet's scope

* **`elixir/vanilla/tests-emit.ts#vtExpr` degrades a test to `@tag :skip`.** Not a crash, so not
  CR1-f's problem — but a test that silently skips is invisible in a green `mix test`, which is
  the class **CR1-h** owns. Worth a row there.
* **`elixir/store-emit.ts` has no gate at all.** `loom.ui-body-statement-kind` exempts
  `phoenixLiveView`, and phoenixLiveView is the only framework `store-emit.ts` serves — so the
  one frontend whose store emitter drops statements silently is the one frontend the gate does
  not cover. Flagged for CR1-e, whose class it is.

---

## Counts

| | before | after |
|---|---|---|
| `THROWING_DISPATCHER` entries | 32 | **0** (the constant is deleted) |
| ↳ waiver deleted (site made exhaustive) | — | 5 |
| ↳ `{ standing }`, citing a `loom.*` code | — | 12 |
| ↳ `{ standing }`, misfiled but correct by design | — | 1 |
| ↳ `{ deferred }`, misfiled (silent default, CR1-e's class) | — | 6 |
| ↳ `{ deferred }`, parity hand-off | — | 2 |
| ↳ `{ deferred }`, not re-verified | — | 1 |
| new waiver added (the CR1-f gate's own refusing default) | — | 1 |
| **register total, this bucket** | 32 | **28** |

The audit called it 31; the register held 32.

Two new tests, one new diagnostic, one existing diagnostic reaching three more shapes, one
`MAX_OPEN_GAPS` raise (20 → 21, documented), three parity rows handed off.

## Gates

`npx tsc -b` clean · `npm run lint` clean **with `--error-on-warnings`** (CR1-c's ratchet, live
after the merge) · `npx vitest run test/system` 2245 passed / 0 failed · `test/ir` 3282 passed /
0 failed · `test/generator test/platform test/language` 12388 passed, **2 failed — both in
`auth-verifier-doc-honesty.test.ts`, proved above to be CR1-b's merge composition, not CR1-f's**
· `diagnostic-catalog` / `diagnostic-docs-anchors` / `diagnostic-firing-census` /
`unsupported-register` / `ir-walk-census` / `workflow-path-coverage` all green · both new guards
mutation-proved above, each restored by file copy.

Pre-merge, on `main` @ `4b4b76ec`, the same four suites were **fully** green: `test/system` +
`test/ir` 5471 passed / 0 failed, `test/generator test/platform test/language` 12380 passed / 0
failed. So CR1-f's own diff is green on both trees; the only two reds on the merged tree are the
two batch-1↔main compositions recorded at the top, one fixed here and one handed back.

Emission is byte-identical everywhere except the two refusals, and each of those replaces a
measured crash on input that `ddd parse` had just called clean.

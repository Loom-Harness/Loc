# M-T9.77 – M-T9.83 — the fail-closed register

*Minted 2026-10-04 by the fail-closed sweep (#3133). Mission headings live in [`T9-toolchain-health.md`](../T9-toolchain-health.md); this file is the per-site evidence.*

**What it is.** Every `throw new Error(…)` under `src/generator/**` and `src/platform/**` is a place `ddd generate` can crash after `ddd parse` accepted the model. `test/system/generator-throw-census.test.ts` makes each one carry a typed claim (`guardedBy` a named `loom.*` code, a structural `invariant`, or a dated `deferred` live defect). The sites below are the `deferred` ones. For each, a minimal `.ddd` was reproduced on `main` @ `bce7f409`: `node bin/cli.js parse` printed `0 error(s)` and `node bin/cli.js generate system` then crashed with that site's message.

**How an entry closes.** Add the refusal upstream (and re-classify the census entry `guardedBy: ["loom.<code>"]`), or make the emitter render the shape (the throw goes away, and so must its entry). A closed entry must be deleted in the same PR. The census fails on a stale entry, and on any deferral past its `reviewUntil`.

**Already closed by #3133**, so not listed: the four test tiers' statement vocabulary (nine sites, `loom.test-statement-invalid`) and thirteen predicate-lowering sites, the SvelteKit `/foo` vs `/foo/` route collision (`loom.ui-page-route-collision` now compares routes segment-wise), across Drizzle / MikroORM / Dapper / JPA (column vs column, `== null`, `now()`, date arithmetic, method-call and parenthesised values). The second set is pinned by `test/system/predicate-position-census.test.ts`.

**Closed since the sweep:** M-T9.80 (resource operations in unmapped positions, [#3187](https://github.com/Loom-Harness/Loc/pull/3187)) — its three sites are `guardedBy` in the census; see the archived mission in [`archive/T9-done.md`](../archive/T9-done.md).

## M-T9.77 — Paged `queryHandler` body shape — **closed** (refused, `loom.paged-query-handler-shape`, #3084)

All five sites are `guardedBy: ["loom.paged-query-handler-shape"]`; every emitter now reads the shared `pagedRunStmt` predicate the phase-⑦ check enforces. The five repros (`return Orders.run(InRegion(rgn))`, a let-bound custom find, …) each fail `ddd parse` with that code.

## M-T9.78 — Event-sourced workflow with no id-typed correlation field — **closed** (refused, `loom.workflow-correlation-required`)

Both sites (`src/generator/dotnet/workflow-eventsourced-emit.ts#esCorrIdClass`, `src/generator/java/emit/workflow-eventsourced.ts#esWorkflowCorrIdClass`) and the Elixir `TypeError` are closed by refusing the shape in phase ⑦: an `eventSourced` workflow must declare exactly one id-shaped state field, with or without event consumers, because that field is its event stream's key. Zero id-shaped fields is `loom.workflow-correlation-required`, two or more `loom.correlation-field-ambiguous`. Both census entries are now `guardedBy`. Not rendered, because node and python had no sound shape to port: they emitted a plain command route that dropped the declared state and `apply` blocks, with no stream, no generated instance id and nothing to read back. The repro is the `loom.workflow-correlation-required` fixture in `test/system/diagnostic-firing-census.test.ts`.

## M-T9.79 — Statement vocabulary of event-sourced / workflow bodies (`create`, `apply`, `function`, `on`)

*All seven sites closed — see the archived mission in [`../archive/T9-done.md`](../archive/T9-done.md).*

### `src/generator/elixir/dispatch-emit.ts#renderStmt`

**Fixed — rendered.** The Phoenix reactor/starter renderer now has an arm for every `WorkflowStmtIR` kind: `repo-delete` (the context's delete entry, or `Repo.delete/1` when the aggregate has no delete surface), `resource-call`, a mutating `domain-service-call` (the command path's inlined service clauses) and `if let` (the command path's one-row retrieval + `case`); the default arm is now a `never` check (census entry `invariant`). Compiled with `mix compile --warnings-as-errors`.

A workflow on(e) reactor body containing `Orders.delete(o)` lowers to a repo-delete WorkflowStmtIR, which the elixir reactor renderer has no arm for; no validator refuses it (likely also if-let/resource-call/domain-service-call in reactor bodies).

Crash: `Error: dispatch-emit: unsupported reactor statement kind 'repo-delete'`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system R {
  subdomain S {
    context C {
      aggregate Order {
        status: string
        operation place() {
          status := "Placed"
          emit OrderPlaced { order: id }
        }
      }
      repository Orders for Order { }
      aggregate Shipment {
        orderRef: Order id
        status: string
      }
      repository Shipments for Shipment { }
      event OrderPlaced { order: Order id }
      workflow Fulfil {
        orderId: Order id
        create(p: OrderPlaced) by p.order {
          let ship = Shipment.create({ orderRef: p.order, status: "Pending" })
        }
        on(s: OrderPlaced) by s.order {
          let o = Orders.getById(s.order)
          Orders.delete(o)
        }
      }
    }
  }
  api RApi from S
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: elixir contexts: [C] dataSources: [st] serves: RApi port: 4000 }
}
```

</details>

### `src/generator/elixir/vanilla/eventsourced-emit.ts#renderCommandRunner`

**Fixed — refused.** `validateElixirIfSupport` now walks an aggregate's `creates` and `destroys` as well as its operations, so an `if` in an event-sourced `create` is `loom.elixir-if-stmt-unsupported#event-sourced`.

An `if` inside an event-sourced aggregate's `create` body is never checked by the elixir if-gate, yet the create is rendered through the ES command runner.

Crash: `Error: platform: elixir — an 'if' statement reached the event-sourced command emitter; it is refused at validation (loom.elixir-if-stmt-unsupported#event-sourced).`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system Ledger {
  subdomain Core {
    context Accounts {
      event Opened { account: Account id, owner: string }
      aggregate Account persistedAs: eventLog {
        owner: string
        create open(owner: string) {
          if owner != "" {
            emit Opened { account: id, owner: owner }
          }
        }
        apply(e: Opened) {
          owner := e.owner
        }
      }
      repository Accounts for Account { }
    }
  }
  api LedgerApi from Core
  storage pg { type: postgres }
  resource accountsLog { for: Accounts, kind: eventLog, use: pg }
  deployable api {
    platform: elixir
    contexts: [Accounts]
    dataSources: [accountsLog]
    serves: LedgerApi
    port: 4000
  }
}
```

</details>

### `src/generator/elixir/vanilla/fold-stmt-emit.ts#renderFoldStatement`

**Fixed — refused, target-neutrally.** An applier yields nothing: `return` (and a bare call statement) in any applier, aggregate or workflow, is `loom.applier-stmt-invalid` (`validateApplierBodies`, `body-stmt-vocabulary.ts`, which also takes over the `loom.applier-emits` / `-impure-call` / `-guard` rule and now applies it to workflow appliers). An `if` in a workflow applier on Phoenix is `loom.elixir-if-stmt-unsupported`.

A `return` in an event-sourced aggregate `apply` body passes both applier-discipline validators but the elixir fold renderer has no `return` arm (an `if` in an eventSourced WORKFLOW apply is likely also unguarded).

Crash: `Error: elixir vanilla fold: unsupported applier statement 'return' — an applier folds pure assignments / collection mutations / let bindings only; the event-sourcing discipline validator should have rejected this.`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system Ledger {
  subdomain Core {
    context Accounts {
      event Opened { account: Account id, owner: string }
      aggregate Account persistedAs: eventLog {
        owner: string
        create open(owner: string) {
          emit Opened { account: id, owner: owner }
        }
        apply(e: Opened) {
          owner := e.owner
          return owner
        }
      }
      repository Accounts for Account { }
    }
  }
  api LedgerApi from Core
  storage pg { type: postgres }
  resource accountsLog { for: Accounts, kind: eventLog, use: pg }
  deployable api {
    platform: elixir
    contexts: [Accounts]
    dataSources: [accountsLog]
    serves: LedgerApi
    port: 4000
  }
}
```

</details>

### `src/generator/elixir/vanilla/fold-stmt-emit.ts#renderFoldNewMap`

**Fixed — refused, target-neutrally.** Constructing an entity part outside the aggregate that owns it (any workflow body, or another aggregate's body) is `loom.cross-aggregate-entity-part` (`#construct`); the same shape crashed Java's renderer in every workflow position.

An eventSourced workflow `apply` that constructs a contained entity part of an aggregate in the same context (`let l = Line { sku: a.sku }`) validates clean, but the workflow fold has no part resolver.

Crash: `Error: elixir vanilla fold: cannot construct 'Line' — no contained entity part resolves in this fold's scope (workflow folds have no entity parts).`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system WFN {
  subdomain F {
    context F {
      aggregate Order {
        create(status: string) { }
        status: string
        entity Line { sku: string }
        lines: Line[]
      }
      repository Orders for Order { }
      event Started { order: Order id }
      event Added { order: Order id, sku: string }
      workflow Track eventSourced {
        orderId: Order id
        last: string
        create(p: Started) by p.order {
          emit Added { order: p.order, sku: "x" }
        }
        apply(a: Added) {
          let l = Line { sku: a.sku }
          last := a.sku
        }
      }
    }
  }
  api FApi from F
  storage pg { type: postgres }
  resource st { for: F, kind: state, use: pg }
  deployable d { platform: elixir contexts: [F] serves: FApi dataSources: [st] port: 4000 }
}
```

</details>

### `src/generator/elixir/vanilla/function-emit.ts#renderFunctionBodyLines`

**Fixed — refused.** `validateElixirIfSupport` now classifies workflow `function` block bodies with the same `"value"` predicate as aggregate functions (`loom.elixir-if-stmt-unsupported#return-in-branch`).

A workflow `function` with a non-tail `return` inside an `if` is never checked by the elixir if-gate but is rendered through renderFunctionBodyLines.

Crash: `Error: platform: elixir — an 'if' statement with a return-in-branch reached the vanilla aggregate-function emitter; it is refused at validation (loom.elixir-if-stmt-unsupported#return-in-branch).`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system WF {
  subdomain S {
    context C {
      aggregate Thing with crudish {
        name: string
      }
      repository Things for Thing {}
      workflow make {
        function label(n: int): string {
          if n > 0 { return "pos" }
          return "neg"
        }
        create(n: int) {
          let t = Thing.create({ name: label(n) })
        }
      }
    }
  }
  api XApi from S
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: elixir contexts: [C] dataSources: [st] serves: XApi port: 4000 }
}
```

</details>

### `src/generator/python/workflow-eventsourced-emit.ts#renderApplierStmt`

**Fixed — rendered.** The Python ES-workflow applier renders `let`, a bare expression and `if` / `else`; every other kind is refused for all backends by `validateApplierBodies`.

A workflow applier containing a `let` binding (`apply(pr: PaymentRegistered) { let x = pr.amount  paid := paid + x }`) validates clean, but the Python ES-workflow applier renderer only handles assign/add/remove.

Crash: `Error: python es-workflow applier: unexpected statement kind 'let' (appliers are pure folds)`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system FulfillmentSys {
  subdomain Fulfillment {
    context Fulfillment {
      aggregate Order {
        status: string
        create(status: string) { }
        operation place() {
          precondition status == "Draft"
          status := "Placed"
          emit OrderPlaced { order: id, at: now() }
        }
      }
      repository Orders for Order { }
      event OrderPlaced { order: Order id, at: datetime }
      event PaymentRegistered { order: Order id, amount: int }
      event FulfillmentCancelled { order: Order id }
      channel Lifecycle {
        carries: OrderPlaced, PaymentRegistered, FulfillmentCancelled
        delivery: broadcast
        retention: ephemeral
      }
      workflow OrderFulfillment eventSourced {
        orderId: Order id
        paid: int
        cancelled: bool
        create(p: OrderPlaced) by p.order {
          emit PaymentRegistered { order: p.order, amount: 0 }
        }
        on(pr: PaymentRegistered) by pr.order {
          precondition paid >= 0
          emit FulfillmentCancelled { order: pr.order }
        }
        apply(pr: PaymentRegistered) { let x = pr.amount  paid := paid + x }
        apply(fc: FulfillmentCancelled) { cancelled := true }
      }
    }
  }
  api FulfillmentApi from Fulfillment
  storage pg { type: postgres }
  resource fulfillmentState { for: Fulfillment, kind: state, use: pg }
  deployable d {
    platform: python
    contexts: [Fulfillment]
    serves: FulfillmentApi
    dataSources: [fulfillmentState]
    port: 4000
  }

  test e2e "placing an order drives the self-folding fulfillment saga without error" against d {
    let o = api.orders.create({ status: "Draft" })
    api.orders.place(o)
    let read = api.orders.getById(o)
    expect(read.status).toBe("Placed")

    let listed = api.orders.all()
    expect(listed.items.length).toBe(1)
    expect(listed.total).toBe(1)
  }
}
```

</details>

### `src/platform/hono/v4/workflow-eventsourced-builder.ts#renderApplierStmt`

**Fixed — rendered.** The Hono ES-workflow applier renders `let`, a bare expression and `if` / `else`; every other kind is refused for all backends by `validateApplierBodies`.

The applier purity rules (loom.applier-emits/-impure-call/-guard) cover aggregate appliers and explicitly allow let/if/expression/return; an eventSourced workflow `apply(r) { let a = r.at  firedAt := a }` (or an `if`) validates clean and the hono ES-workflow applier refuses it.

Crash: `Error: es-workflow applier: unexpected statement kind 'let' (appliers are pure folds)`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system Reaping {
  subdomain Ops {
    context Orders {
      aggregate Sweep with crudish {
        runId: string
      }
      event SweepTick { sweep: Sweep id, at: datetime }
      event SweepRan  { sweep: Sweep id, at: datetime }
      workflow SweepRun eventSourced {
        sweep: Sweep id
        firedAt: datetime
        create(t: SweepTick) by t.sweep { emit SweepRan { sweep: t.sweep, at: t.at } }
        apply(r: SweepRan) {
          let a = r.at
          firedAt := a
        }
      }
      repository Sweeps for Sweep {}
    }
  }
  storage pg { type: postgres }
  resource opsState { for: Orders, kind: state, use: pg }
  api OrdersApi from Ops
  deployable d { platform: node contexts: [Orders] dataSources: [opsState] serves: OrdersApi port: 4000 }
}
```

</details>

## M-T9.81 — Frontend page- and store-action vocabulary (Feliz / Flutter, plus the shared JS walker) — CLOSED

All thirteen sites closed; the census entries are re-classified `guardedBy`. One vocabulary module (`src/ir/validate/checks/ui-body-vocabulary-checks.ts`) refuses the modelling errors on every frontend and holds the per-target table `UI_BODY_FEATURE_RENDERERS`; `test/system/ui-body-vocabulary-census.test.ts` generates every frontend × shape cell (React, Vue, Svelte, Angular, Feliz, Flutter, Phoenix LiveView) against it, and `test/ir/ui-body-vocabulary-repros.test.ts` runs each repro below.

| Site | Outcome |
|---|---|
| `_walker/walker-core.ts#emitExpr$4` | refused — `loom.ui-this-unbound` (every page / component / store surface) |
| `_walker/walker-core.ts#unsupportedPageStmt` | refused — `loom.ui-assign-not-state` (a write whose root is not the host's `state` field) |
| `feliz/fs-expr.ts#renderFsMethodCall` | refused — `loom.intrinsic-unknown` / `loom.unknown-member` on a typed receiver (since M-T5.47 by the AST gate itself; the IR re-raises only on an action-body lambda param and a value-object `function`); `.matches` via the per-target table |
| `feliz/fs-expr.ts#renderFsExpr$3` | refused on Feliz — `loom.ui-body-feature-unsupported` (`block-lambda-in-action`) |
| `feliz/fs-expr.ts#renderFsExpr$4` | refused — `this`: `loom.ui-this-unbound`; an action value: `loom.ui-body-feature-unsupported` (`action-ref-value`) |
| `feliz/update-emit.ts#renderUpdateStmt` | `toast(…)` **rendered** (`Cmd.ofEffect (fun _ -> updateToast …)`, Fable + vite build green); an unresolved store call is `loom.unresolved-action-ref`, which now walks store bodies |
| `feliz/update-emit.ts#renderUpdateStmt$2` | refused on Feliz — `nested-async-effect` / `store-async-effect` (and `async-effect-with-siblings`, which Feliz silently dropped) |
| `feliz/wire.ts#findParamQueryValue` | refused on Feliz — `find-read-composite-param` (shared predicate `ir/util/feliz-find-read.ts`) |
| `feliz/wire.ts#felizFindRead` | refused on Feliz — `find-read-non-aggregate-return` (shared predicate) |
| `feliz/wire.ts#felizFindRead$2` | refused on every frontend — `loom.ui-find-call-arity` (the JS clients failed their own typecheck) |
| `feliz/wire.ts#walk` | refused on Feliz — `find-read-unbound-arg` (shared predicate) |
| `flutter/riverpod-emit.ts#renderNotifierStmt` | refused — `loom.unresolved-action-ref` now walks store action bodies |
| `flutter/riverpod-emit.ts#renderNotifierStmt$2` | refused on Flutter — `nested-async-effect` / `store-async-effect` |

**The union-typed payload field** the mission text also named does not reproduce as stated: an unused `payload Info { status: A or B }` generates on Feliz and Flutter. Used as a field of an operation's `error` variant it crashes `wireTypeInfo` — but in the Hono backend (`zodForResponseInner`), before any frontend runs, with or without a ui. It is a backend wire-shape gap, not one of these sites — noted for triage in the archived M-T9.81 entry (`archive/T9-done.md`).

## M-T9.83 — A misconfigured custom design pack crashes generate with no diagnostic — closed

**Fixed by [#3184](https://github.com/Loom-Harness/Loc/pull/3184); all 11 sites closed and their census entries removed or re-classified.** Every repro this section held (`loader-fs.ts#loadPack`, `$2`, `$4`, `$5`; `loader.ts#compilePack$3`; `pack-chrome.ts#assertDeclaredChromeIsSane`, `$2`, `$3`, `#bind`, `#declared`; `shell-emits.ts#emitShellFiles`) now fails `ddd parse` with one `loom.design-pack-invalid` error naming the defect, e.g. `Custom design pack './no-such-pack' on deployable 'web' cannot be rendered: no pack.json at <ddd dir>/no-such-pack/pack.json …`. The relative-path side bug is fixed too: `./no-such-pack` now resolves against the `.ddd` file's directory. How: see the archived mission in [`../archive/T9-done.md`](../archive/T9-done.md); per-defect tests in `test/generator/_packs/pack-defects.test.ts`.

## M-T9.82 — Generate-crash residue (JPA, MikroORM entities, Hono zod rows, HEEx, projections) — closed

All eleven sites closed in one PR; each census entry is now `guardedBy` (or an `invariant` where the shape renders). The per-site repros are pinned as cases in `test/system/generate-crash-residue.test.ts`.

| Site | Outcome |
|---|---|
| `java/emit/jpa-annotations.ts#jpaFieldAnnotations` | **Rendered** for a projection / workflow state row (`refs: Order id[]` → the shared migration's jsonb column, through the per-target `IdJsonListConverter`; drizzle and MikroORM declare the same column). **Refused** elsewhere: `X id[]?`, an entity part's `X id[]` (except in a mikroorm-only context, which stores it as jsonb), a collection inside a persisted value object → `loom.collection-field-unpersisted` (the shared schema had no column for them). |
| `java/emit/jpa-annotations.ts#jpaFieldAnnotations$2` | **Refused**: `<VO>[]` on a projection / workflow state row → `loom.collection-field-unpersisted#state-value-collection` (no backend created a column or child table for it). |
| `java/emit/projection-reads.ts#corrWire`, `java/emit/projection-state.ts#correlationField` (and the shared `migrations-builder.ts` TypeError in front of them) | **Refused**: a folded projection with no `keyed by` is `loom.projection-event-unkeyed#singleton` whether its handlers route `by …` or not. |
| `java/emit/query-projection-reads.ts#groupKeyCoerce` | **Rendered**: `json` → `(JsonNode)`, `File` → `(FileRef)` group keys (node / python / dotnet / elixir already rendered them). |
| `java/render-expr.ts#renderNew` | **Refused**: a part builder in an aggregate unit test → `loom.aggregate-test-context` (node / python / dotnet rendered an ambient `this` id the test body does not have). |
| `typescript/emit/mikroorm-entities.ts#columnsForType` | **Refused**: a collection inside a persisted value object → `loom.collection-field-unpersisted#nested-in-value-object` (drizzle dropped the column too). |
| `typescript/emit/mikroorm-filter.ts#predicateEntry` | **Rendered**: context filters and the write-scope guard now pass `agg.associations`, so `this.refs.contains(x)` renders the join-table membership fragment, as finds already did. |
| `hono/v4/projection-query-routes-builder.ts#zodForRow` | **Refused**: a `duration` select → `loom.projection-select-duration` (.NET crashed on it too; `duration` has no wire form). |
| `elixir/heex-walker-core.ts#renderVariantMatchStmt$2` | **Refused**: `loom.ui-aggregate-unserved` now also covers a deployable that mounts its own ui (`#self-hosted`). |
| `elixir/liveview-emit.ts#gatherComponentHandlers` | **Rendered**: a bare store-action handler (`onClick: Cart.clear`) names its own `store-cart-clear` event, so it never shares a clause with a page or component `action clear()`. |

Beside the sites: a query-time projection named `Count` (or any Spring Data / `Object` member name) now emits its JPA source read as `countSource()` instead of redeclaring `CrudRepository.count()`; and an inline `or` union as a payload field is refused (`loom.union-position#payload-field`) — every backend crashed on it in an error payload, three of five in a workflow `create` payload.

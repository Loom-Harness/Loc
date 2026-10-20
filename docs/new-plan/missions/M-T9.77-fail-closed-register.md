# M-T9.77 – M-T9.83 — the fail-closed register

*Minted 2026-10-04 by the fail-closed sweep (#3133). Mission headings live in [`T9-toolchain-health.md`](../T9-toolchain-health.md); this file is the per-site evidence.*

**What it is.** Every `throw new Error(…)` under `src/generator/**` and `src/platform/**` is a place `ddd generate` can crash after `ddd parse` accepted the model. `test/system/generator-throw-census.test.ts` makes each one carry a typed claim (`guardedBy` a named `loom.*` code, a structural `invariant`, or a dated `deferred` live defect). The sites below are the `deferred` ones. For each, a minimal `.ddd` was reproduced on `main` @ `bce7f409`: `node bin/cli.js parse` printed `0 error(s)` and `node bin/cli.js generate system` then crashed with that site's message.

**How an entry closes.** Add the refusal upstream (and re-classify the census entry `guardedBy: ["loom.<code>"]`), or make the emitter render the shape (the throw goes away, and so must its entry). A closed entry must be deleted in the same PR. The census fails on a stale entry, and on any deferral past its `reviewUntil`.

**Already closed by #3133**, so not listed: the four test tiers' statement vocabulary (nine sites, `loom.test-statement-invalid`) and thirteen predicate-lowering sites, the SvelteKit `/foo` vs `/foo/` route collision (`loom.ui-page-route-collision` now compares routes segment-wise), across Drizzle / MikroORM / Dapper / JPA (column vs column, `== null`, `now()`, date arithmetic, method-call and parenthesised values). The second set is pinned by `test/system/predicate-position-census.test.ts`.

**Closed since the sweep:** M-T9.80 (resource operations in unmapped positions, [#3187](https://github.com/Loom-Harness/Loc/pull/3187)) — its three sites are `guardedBy` in the census; see the archived mission in [`archive/T9-done.md`](../archive/T9-done.md).

## M-T9.77 — Paged `queryHandler` body shape (lands with #3084's `loom.paged-query-handler-shape`)

### `src/generator/dotnet/explicit-handlers-emit.ts#pagedRunStmt`

Any `queryHandler H(...): Agg paged` whose body is not exactly `let r = Repo.run(Crit(args)); return r` (e.g. `return Orders.run(InRegion(rgn))`, a let-bound paged find, or an aliased let) validates clean but crashes (repros also g2-pagedqh-find.ddd, g2-pagedqh-alias.ddd).

Crash: `Error: internal: paged queryHandler 'ListInRegion' in 'Orders' does not match the supported 'let r = Repo.run(<Criterion>(args)); return r' shape. Please file a bug.`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system PQH {
  subdomain Sales {
    context Orders {
      aggregate Order { code: string  region: string }
      repository Orders for Order { find inRegion(rgn: string): Order paged where this.region == rgn }
      criterion InRegion(rgn: string) of Order = region == rgn
      queryHandler ListInRegion(rgn: string): Order paged {
        return Orders.run(InRegion(rgn))
      }
    }
  }
  api A from Sales { route GET "/orders/projections/in_region" -> Orders.ListInRegion }
  storage pg { type: postgres }
  resource s { for: Orders, kind: state, use: pg }
  deployable d { platform: dotnet, contexts: [Orders], dataSources: [s], serves: A, port: 4000 }
}
```

</details>

### `src/generator/elixir/vanilla/explicit-handlers-emit.ts#pagedRunStmt`

A `queryHandler X(n): Thing paged { let xs = Things.byName(n) return xs }` (custom find, not a synthesized-criterion Repo.run) passes validation but has no synthCriterion repo-run.

Crash: `Error: internal: paged queryHandler 'Named' in 'C' does not match the supported 'let r = Repo.run(<Criterion>(args)); return r' shape. Please file a bug.`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system PQ {
  subdomain S {
    context C {
      aggregate Thing with crudish {
        name: string
      }
      repository Things for Thing {
        find byName(n: string): Thing[] where this.name == n
      }
      queryHandler Named(n: string): Thing paged {
        let xs = Things.byName(n)
        return xs
      }
    }
  }
  api XApi from S {
    route GET "/named/{n}" -> C.Named
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: elixir contexts: [C] dataSources: [st] serves: XApi port: 4000 }
}
```

</details>

### `src/generator/java/explicit-handlers-emit.ts#pagedRunStmt`

A queryHandler returning `Order paged` whose body is anything other than `let r = Repo.run(Crit(args)); return r` (e.g. `return Orders.run(InRegion(rgn))`) validates clean and throws here.

Crash: `Error: internal: paged queryHandler 'ListInRegion' in 'Orders' does not match the supported 'let r = Repo.run(<Criterion>(args)); return r' shape. Please file a bug.`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system PQH {
  subdomain Sales {
    context Orders {
      aggregate Order with crudish { code: string  region: string }
      repository Orders for Order { }
      criterion InRegion(rgn: string) of Order = region == rgn
      queryHandler ListInRegion(rgn: string): Order paged {
        return Orders.run(InRegion(rgn))
      }
    }
  }
  api A from Sales { route GET "/orders/projections/in_region" -> Orders.ListInRegion }
  storage pg { type: postgres }
  resource s { for: Orders, kind: state, use: pg }
  deployable d { platform: java, contexts: [Orders], dataSources: [s], serves: A, port: 4000 }
}
```

</details>

### `src/generator/python/explicit-handlers-emit.ts#pagedRunStmt`

Same as Java: any paged queryHandler body other than the exact let/return repo-run shape validates clean.

Crash: `Error: internal: paged queryHandler 'ListInRegion' in 'Orders' does not match the supported 'let r = Repo.run(<Criterion>(args)); return r' shape. Please file a bug.`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system PQH {
  subdomain Sales {
    context Orders {
      aggregate Order with crudish { code: string  region: string }
      repository Orders for Order { }
      criterion InRegion(rgn: string) of Order = region == rgn
      queryHandler ListInRegion(rgn: string): Order paged {
        return Orders.run(InRegion(rgn))
      }
    }
  }
  api A from Sales { route GET "/orders/projections/in_region" -> Orders.ListInRegion }
  storage pg { type: postgres }
  resource s { for: Orders, kind: state, use: pg }
  deployable d { platform: python, contexts: [Orders], dataSources: [s], serves: A, port: 4000 }
}
```

</details>

### `src/platform/hono/v4/explicit-handlers-builder.ts#emitPagedRunHandler`

No validator pins the body of a `queryHandler H(...): <Agg> paged`; `return Orders.run(InRegion(rgn))` (or a let-rebinding, or `let r = Orders.findAll()`, or a compound criterion) validates clean on node and crashes the paged branch.

Crash: `Error: internal: paged queryHandler 'ListInRegion' in 'Orders' does not match the supported 'let r = Repo.run(<Criterion>(args)); return r' shape. Please file a bug.`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system PQH {
  subdomain Sales {
    context Orders {
      aggregate Order with crudish { code: string  region: string }
      repository Orders for Order { }
      criterion InRegion(rgn: string) of Order = region == rgn
      queryHandler ListInRegion(rgn: string): Order paged {
        return Orders.run(InRegion(rgn))
      }
    }
  }
  api A from Sales { route GET "/orders/projections/in_region" -> Orders.ListInRegion }
  storage pg { type: postgres }
  resource s { for: Orders, kind: state, use: pg }
  deployable d { platform: node, contexts: [Orders], dataSources: [s], serves: A, port: 4000 }
}
```

</details>

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

## M-T9.82 — Generate-crash residue (JPA, MikroORM entities, Hono zod rows, HEEx, projections)

### `src/generator/elixir/heex-walker-core.ts#renderVariantMatchStmt$2`

A bare `match await Invoice.confirm()` on a LiveView page naming an aggregate from a context the elixir deployable does not host passes the system-wide async-effect check, but the HEEx emitter only knows served aggregates.

Crash: `Error: platform: elixir — 'match await' on page 'InvoiceDetail' resolves to 'Invoice.confirm', but 'Invoice' is not an aggregate served by this deployable, so there is no context function to run.`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system MatchAwait {
  subdomain Sales {
    context Orders {
      aggregate Order with crudish {
        code: string
      }
      repository OrderRepo for Order { }
    }
  }
  subdomain Billing {
    context Invoices {
      error Rejected { reason: string }
      aggregate Invoice with crudish {
        code: string
        operation confirm(): Invoice or Rejected { return Rejected { reason: code } }
      }
      repository InvoiceRepo for Invoice { }
    }
  }
  api OrdersApi from Sales
  api BillingApi from Billing
  ui Console {
    api Orders: OrdersApi
    page InvoiceDetail {
      route: "/invoices/:id"
      state { message: string = "" }
      action confirmNow() {
        match await Invoice.confirm() {
          Invoice o  => { message := o.code }
        }
      }
      body: Stack {
        Heading { "Invoice" },
        Button { "Confirm", onClick: confirmNow }
      }
    }
  }
  storage pg { type: postgres }
  resource orderState { for: Orders, kind: state, use: pg }
  resource invState { for: Invoices, kind: state, use: pg }
  deployable billing {
    platform: node
    contexts: [Invoices]
    dataSources: [invState]
    serves: BillingApi
    port: 4001
  }
  deployable phoenixApp {
    platform: elixir
    contexts: [Orders]
    dataSources: [orderState]
    serves: OrdersApi
    ui: Console { Orders: phoenixApp }
    port: 4000
  }
}
```

</details>

### `src/generator/elixir/liveview-emit.ts#gatherComponentHandlers`

A page using `onClick: Cart.clear` synthesizes a `clear` handle_event clause that collides with a stateful component's own `action clear()`; the validator never sees store-action-ref handlers.

Crash: `Error: internal: page 'CartPage' hoists two different 'clear' handlers into one LiveView (component 'CartSummary' collides with another handler of that name). The IR validator's handler-name collision gate should have rejected this model before codegen reached it.`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system StoreCollide {
  subdomain Sales {
    context Sales {
      aggregate Order with crudish {
        customerId: string
      }
      repository Orders for Order { }
    }
  }
  api SalesApi from Sales
  ui WebApp {
    api Sales: SalesApi
    store Cart {
      state {
        count: int = 0
      }
      action clear() {
        count := 0
      }
    }
    component CartSummary() {
      state { n: int = 0 }
      action clear() { n := 1 }
      body: Stack {
        Button { "Reset", onClick: clear }
      }
    }
    page CartPage {
      route: "/cart"
      body: Stack {
        Heading { Cart.count, level: 2 },
        CartSummary(),
        Button { "Discard", onClick: Cart.clear }
      }
    }
  }
  storage primary { type: postgres }
  resource salesState { for: Sales, kind: state, use: primary }
  deployable phoenixApp {
    platform: elixir
    contexts: [Sales]
    dataSources: [salesState]
    serves: SalesApi
    ui: WebApp { Sales: phoenixApp }
    port: 4000
  }
}
```

</details>

### `src/generator/java/emit/jpa-annotations.ts#jpaFieldAnnotations`

An optional reference collection `tags: Tag id[]?` on an aggregate (or any `X id[]` on an entity part, or on a projection/workflow state) gets no AssociationIR, but jpaFieldAnnotations unwraps optional and demands one.

Crash: `Error: java jpa: no AssociationIR for reference collection 'Order.tags' — enrichment derives one per aggregate-level Id[] field.`

*(no standalone repro: see the reason)*

### `src/generator/java/emit/jpa-annotations.ts#jpaFieldAnnotations$2`

For aggregates/parts/bases valueCollectionsFor derives one entry per VO-array field (unwrapping optional), so the throw is unreachable there; but a projection (or saga) state field `tags: Tag[]` reaches this lookup with the stub owner {name, associations: []} and crashes one line earlier with 'TypeError: owner.fields is not iterable' (valid model, 0 errors) — repro g5-java-proj-voarray.ddd; fixing that TypeError would make this throw fire.

*(no standalone repro: a different crash fires first, see the reason)*

### `src/generator/java/emit/projection-reads.ts#corrWire`

A folded projection with no `keyed by` whose handlers all use `on(e: E) by e.x` passes validation (0 errors) and has no id-source wire field; today generation crashes earlier in src/system/migrations-builder.ts projectionTableShape (TypeError: Cannot read properties of undefined (reading 'replace')) so this throw is masked — repro g5-java-singleton-fold-by.ddd.

*(no standalone repro: a different crash fires first, see the reason)*

### `src/generator/java/emit/projection-state.ts#correlationField`

Same singleton-with-`by` gap as corrWire: a folded projection without `keyed by` but with `on(...) by ...` validates clean, has correlationField undefined, and would throw here; currently masked by the earlier migrations-builder TypeError (repro g5-java-singleton-fold-by.ddd). Keyed projections are guarded by loom.projection-key-unknown (:607).

*(no standalone repro: a different crash fires first, see the reason)*

### `src/generator/java/emit/query-projection-reads.ts#groupKeyCoerce`

Grouping by a bare `json` column (`group by o.meta; select k = o.meta`) is shape-valid, but groupKeyCoerce has no arm for primitive 'json' (or 'File') and throws.

Crash: `Error: internal: grouping key of type kind 'primitive' is not a bare source column type — the IR validator should have rejected this projection`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system G {
  subdomain Sales {
    context Orders {
      valueobject Addr { city: string }
      aggregate Order with crudish {
        code: string
        meta: json
        addr: Addr
        total: money
      }
      repository Orders for Order { }
      projection ByKey {
        k: json
        orders: int
        from Order as o
        group by o.meta
        select k = o.meta, orders = count()
      }
    }
  }
  api A from Sales
  storage pg { type: postgres }
  resource st { for: Orders, kind: state, use: pg }
  deployable d { platform: java contexts: [Orders] dataSources: [st] serves: A port: 4000 }
}
```

</details>

### `src/generator/java/render-expr.ts#renderNew`

A part builder-call `Line { qty: 1 }` inside an aggregate-nested unit test lowers to a `new` expr, but the Java test renderer's JavaRenderContext has no agg.

Crash: `Error: new Line: part not found on the rendering aggregate (<none>) — JavaRenderContext.agg must be set where 'new <Part>' can occur.`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system N {
  subdomain S {
    context C {
      aggregate Order with crudish {
        code: string
        contains lines: Line[]
        entity Line { qty: int }
        test "builds a line" {
          let l = Line { qty: 1 }
          expect(l.qty).toBe(1)
        }
      }
      repository Orders for Order { }
    }
  }
  api A from S
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: java contexts: [C] dataSources: [st] serves: A port: 4000 }
}
```

</details>

### `src/generator/typescript/emit/mikroorm-entities.ts#columnsForType`

A root value-object field whose VO contains a VO collection (`tags: Tag[]`) is flattened into sub-columns and recurses into columnsForType with a non-scalar array element; no validator rejects nested VO collections under persistence: mikroorm.

Crash: `Error: mikroorm: unsupported field kind 'array' on 'bag_tags' (validator gap)`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system S {
  subdomain Sd {
    context C {
      valueobject Tag {
        label: string
      }
      valueobject Bag {
        tags: Tag[]
      }
      aggregate A with crudish {
        name: string
        bag: Bag
      }
      repository As for A {}
    }
  }
  api SApi from Sd
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node { persistence: mikroorm }, contexts: [C], dataSources: [st], serves: SApi, port: 4000 }
}
```

</details>

### `src/generator/typescript/emit/mikroorm-filter.ts#predicateEntry`

A capability `filter this.owners.contains(<id>)` over an `X id[]` reference collection is admitted by firstNonQueryablePredicate, but mikroContextFilters calls whereToMikroFilter(pred) with no associations, so containsMembershipFragment returns null and predicateEntry falls through.

Crash: `Error: mikroorm: unsupported find predicate 'method-call'`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system S {
  subdomain Sd {
    context C {
      aggregate U with crudish {
        label: string
      }
      aggregate A with crudish {
        name: string
        owners: U id[]
        filter this.owners.contains("00000000-0000-0000-0000-000000000001")
      }
      repository As for A {}
      repository Us for U {}
    }
  }
  api SApi from Sd
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node { persistence: mikroorm }, contexts: [C], dataSources: [st], serves: SApi, port: 4000 }
}
```

</details>

### `src/platform/hono/v4/projection-query-routes-builder.ts#zodForRow`

A select-only query-time projection derives its row fields from the select expressions' resolved types (selectDerivedFields), so `select span = o.closedAt - o.openedAt` (datetime - datetime = duration) puts a duration into wireShape and zodForRow throws.

Crash: `Error: internal: 'duration' is expression-only and never reaches a view row`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system S {
  subdomain Sd {
    context C {
      aggregate Order with crudish {
        code: string
        openedAt: datetime
        closedAt: datetime
      }
      repository Orders for Order { }
      projection Spans {
        from Order as o
        select code = o.code, span = o.closedAt - o.openedAt
      }
    }
  }
  api A from Sd
  storage pg { type: postgres }
  resource s { for: C, kind: state, use: pg }
  deployable d { platform: node, contexts: [C], dataSources: [s], serves: A, port: 4000 }
}
```

</details>

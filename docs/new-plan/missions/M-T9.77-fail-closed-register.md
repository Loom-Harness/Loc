# M-T9.77 – M-T9.83 — the fail-closed register

*Minted 2026-10-04 by the fail-closed sweep (#3133). Mission headings live in [`T9-toolchain-health.md`](../T9-toolchain-health.md); this file is the per-site evidence.*

**What it is.** Every `throw new Error(…)` under `src/generator/**` and `src/platform/**` is a place `ddd generate` can crash after `ddd parse` accepted the model. `test/system/generator-throw-census.test.ts` makes each one carry a typed claim (`guardedBy` a named `loom.*` code, a structural `invariant`, or a dated `deferred` live defect). The sites below are the `deferred` ones. For each, a minimal `.ddd` was reproduced on `main` @ `bce7f409`: `node bin/cli.js parse` printed `0 error(s)` and `node bin/cli.js generate system` then crashed with that site's message.

**How an entry closes.** Add the refusal upstream (and re-classify the census entry `guardedBy: ["loom.<code>"]`), or make the emitter render the shape (the throw goes away, and so must its entry). A closed entry must be deleted in the same PR. The census fails on a stale entry, and on any deferral past its `reviewUntil`.

**Already closed by #3133**, so not listed: the four test tiers' statement vocabulary (nine sites, `loom.test-statement-invalid`) and thirteen predicate-lowering sites, the SvelteKit `/foo` vs `/foo/` route collision (`loom.ui-page-route-collision` now compares routes segment-wise), across Drizzle / MikroORM / Dapper / JPA (column vs column, `== null`, `now()`, date arithmetic, method-call and parenthesised values). The second set is pinned by `test/system/predicate-position-census.test.ts`.

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

## M-T9.78 — Event-sourced workflow with no id-typed correlation field crashes .NET / Java / Elixir

### `src/generator/dotnet/workflow-eventsourced-emit.ts#esCorrIdClass`

An `eventSourced` workflow with only a command-triggered create (no `on`/event-create) and no id-typed state field has no correlation field and no diagnostic, yet the ES emitter unconditionally requires an id-typed correlation field.

Crash: `Error: dotnet es-workflow: correlation field of 'Tracker' must be id-typed`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system ES {
  subdomain D {
    context Sales {
      aggregate Order with crudish { code: string }
      repository Orders for Order { }
      event Recorded { code: string, count: int }
      workflow Tracker eventSourced {
        code: string
        archivedCount: int
        create(c: string) {
          emit Recorded { code: c, count: 1 }
        }
        apply(rec: Recorded) { archivedCount := archivedCount + rec.count }
      }
    }
  }
  api A from D
  storage pg { type: postgres }
  resource salesState { for: Sales, kind: state, use: pg }
  deployable d {
    platform: dotnet
    contexts: [Sales]
    dataSources: [salesState]
    serves: A
    port: 4000
  }
}
```

</details>

### `src/generator/java/emit/workflow-eventsourced.ts#esWorkflowCorrIdClass`

An eventSourced workflow with only a command-triggered create and no id-typed state field validates clean, has no correlationField, and renderEsWorkflowFoldClass is still emitted for it.

Crash: `Error: java es-workflow: correlation field of 'Tally' must be id-typed`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system W {
  subdomain F {
    context F {
      aggregate Order with crudish { status: string }
      repository Orders for Order { }
      event Bumped { amount: int }
      workflow Tally eventSourced {
        total: int
        create(n: int) {
          emit Bumped { amount: n }
        }
        apply(b: Bumped) { total := total + b.amount }
      }
    }
  }
  api FApi from F
  storage pg { type: postgres }
  resource st { for: F, kind: state, use: pg }
  deployable d { platform: java contexts: [F] serves: FApi dataSources: [st] port: 4000 }
}
```

</details>

## M-T9.79 — Statement vocabulary of event-sourced / workflow bodies (`create`, `apply`, `function`, `on`)

### `src/generator/elixir/dispatch-emit.ts#renderStmt`

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

## M-T9.80 — Resource operations in positions whose emitter has no resource mapping

### `src/generator/dotnet/render-expr.ts#renderCall`

A resource-op inside a workflow `function` body (`function peek(k: string): string = salesFiles.get(k)`) is admitted (it is inside a workflow) but the <Wf>Functions class is rendered without resourceClasses, so renderCall throws.

Crash: `Error: Resource operation 'salesFiles.get' reached the .NET renderer without a resource class mapping.`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system RC {
  subdomain D {
    context Sales {
      aggregate Order with crudish { name: string }
      repository Orders for Order { }
      workflow archive {
        function peek(k: string): string = salesFiles.get(k)
        create(name: string) {
          let x = peek(name)
        }
      }
    }
  }
  api A from D
  storage pg { type: postgres }
  storage files { type: localDisk }
  resource salesState { for: Sales, kind: state, use: pg }
  resource salesFiles { for: Sales, kind: objectStore, use: files }
  deployable d {
    platform: dotnet
    contexts: [Sales]
    dataSources: [salesState, salesFiles]
    serves: A
    port: 4000
  }
}
```

</details>

### `src/generator/elixir/render-expr.ts#renderCall`

A raw verb (`orders.get("/orders")`) on a `kind: api` resource bound to an in-system api (no storage) lowers to a resource-op, but buildPhoenixResourceModules only maps storage-backed resources, and nothing rejects it.

Crash: `Error: Resource operation 'orders.get' reached the Phoenix renderer without a module mapping.`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
// Typed in-system api call (M-T4.8): a `resource { kind: api }` bound to an
// `api` a SIBLING deployable serves, called from a workflow as
// `orders.getOrderById(id)`.
//
// Two deployables on purpose — the whole feature is that the caller's client is
// DERIVED from the callee's served operation set, so a single-deployable
// fixture could not exercise it.  Both spell `elixir`, so each backend's
// corpus leg compiles both halves of the call with its own emitter.
//
// The workflow reads a field off the response (`o.code`) rather than just
// issuing the call: that is what pins the response type through lowering, and
// what makes a client whose response shape drifted from the callee's wire shape
// fail to compile instead of failing at runtime.
system AC {
  subdomain D {
    context Orders {
      aggregate Order with crudish {
        code: string
        status: string
      }
      repository Orders for Order {
        // An ABSENCE union: the caller gets a 404 as a VALUE to match on
        // rather than a raise (payloads.md §Union finds).
        find byCode(code: string): Order option
      }
    }
    context Shipping {
      aggregate Shipment with crudish {
        orderCode: string
        status: string
      }
      repository Shipments for Shipment { }
      workflow fulfil {
        // `Order id`, not `string`: a foreign aggregate id the caller does NOT
        // host, so the deployable has to declare the brand itself — the shape
        // that broke every backend before `src/ir/util/foreign-ids.ts`.
        create(orderId: Order id) {
          let fetched = orders.get("/orders")
          let s = Shipment.create({ orderCode: fetched, status: "Pending" })
        }
      }
      // The COLLECTION half.  Two things are pinned here that nothing else
      // covers: that a caller can reach the callee's auto-`findAll` at all (the
      // resolver's operation set has to include the ENRICHMENT-derived ops, not
      // just the declared ones), and that the response is the callee's paged
      // envelope rather than nothing — reading `.total` off it is what makes a
      // client returning void a compile error instead of a silent no-op.
      // (Deliberately a `match` on the count rather than a string conversion:
      //  there is no `toString` intrinsic in the stdlib, and writing one anyway
      //  compiles on node/.NET/Java — which have a native method of that name —
      //  while failing at RUNTIME on Python and Elixir.)
      workflow census {
        create(label: string) {
          let listing = orders.allOrder()
          let note = match { listing.total > 0 => "SEEN", else => "EMPTY" }
          let s = Shipment.create({ orderCode: label, status: note })
        }
      }
      // The WRITE half: the caller creates a row in the CALLEE's database
      // through the typed client.  Every other workflow here only reads, so
      // without this the write methods (`createOrder`/`updateOrder`/
      // `destroyOrder`) were emitted on all five backends and never exercised.
      workflow placeOrder {
        create(code: string) {
          let created = orders.createOrder({ code: code, status: "Draft" })
          let s = Shipment.create({ orderCode: code, status: "Placed" })
        }
      }
      // The absence-union half: `byCode` may legitimately find nothing, so the
      // caller MUST handle it — the union does not type-check as bare `Order`.
      workflow lookup {
        create(code: string) {
          let maybe = orders.byCodeOrder(code)
          let note = match maybe { Order x => x.code, else => "missing" }
          let s = Shipment.create({ orderCode: note, status: "Pending" })
        }
      }
    }
  }
  api OrdersApi from D
  storage pg { type: postgres }
  resource ordersState   { for: Orders,   kind: state, use: pg }
  resource shippingState { for: Shipping, kind: state, use: pg }
  // No address anywhere in this source — the binding is what makes it derivable.
  resource orders        { for: Shipping, kind: api,   use: OrdersApi }
  deployable ordersSvc {
    platform: elixir
    contexts: [Orders]
    dataSources: [ordersState]
    serves: OrdersApi
    port: 4000
  }
  deployable shippingSvc {
    platform: elixir
    contexts: [Shipping]
    dataSources: [shippingState, orders]
    port: 4001
  }
}
```

</details>

### `src/generator/java/render-expr.ts#renderCall`

A resource op in a projection fold assign value (`blob := salesFiles.get("x")`) passes loom.projection-fold-impure (assign is allowed) and the resource-op gate, then hits the Java renderer with no resourceClasses.

Crash: `Error: Resource operation 'salesFiles.get' reached the Java renderer without a resource class mapping.`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system RC {
  subdomain D {
    context Sales {
      aggregate Order with crudish {
        name: string
        operation place() { emit OrderPlaced { orderRef: id } }
      }
      repository Orders for Order { }
      event OrderPlaced { orderRef: Order id }
      projection Board keyed by orderRef {
        orderRef: Order id
        blob: string
        on(e: OrderPlaced) { orderRef := e.orderRef  blob := salesFiles.get("x") }
      }
    }
  }
  api A from D
  storage pg { type: postgres }
  storage files { type: s3, config: { bucket: "app-files" } }
  resource salesState { for: Sales, kind: state, use: pg }
  resource salesFiles { for: Sales, kind: objectStore, use: files }
  deployable d { platform: java contexts: [Sales] dataSources: [salesState, salesFiles] serves: A port: 4000 }
}
```

</details>

## M-T9.81 — Frontend page- and store-action vocabulary (Feliz / Flutter, plus the shared JS walker)

### `src/generator/_walker/walker-core.ts#emitExpr$4`

No validator rejects `this` in a page/component body: `Text { this.name }` in a ui page parses with 0 errors and crashes react/vue/svelte/angular generation.

Crash: `Error: walker: 'this' has no meaning in a page/component body — there is no aggregate instance in scope on a frontend.`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system Shop {
  subdomain Sales {
    context Orders {
      aggregate Customer with crudish {
        name: string
      }
      repository Customers for Customer {}
    }
  }
  api SalesApi from Sales
  storage primary { type: postgres }
  resource st { for: Orders, kind: state, use: primary }
  ui WebApp {
    api Sales: SalesApi
    page Home {
      route: "/home"
      title: "Home"
      body: Stack { Text { this.name } }
    }
  }
  deployable api {
    platform: node
    contexts: [Orders]
    dataSources: [st]
    serves: SalesApi
    port: 4000
  }
  deployable web {
    platform: react
    targets: api
    ui: WebApp { Sales: api }
    port: 3000
  }
}
```

</details>

### `src/generator/_walker/walker-core.ts#unsupportedPageStmt`

A page action that assigns (`:=` or `+=`) to a name that is not a declared state field parses with 0 errors. Example: `action bump() { other := 1 }`. Only if/precondition/requires are gated (loom.if-stmt-page-body-unsupported / loom.ui-body-statement-kind).

Crash: `Error: react: unsupported assignment to 'other' in a page event handler — the React backend only mutates page-state fields (declare the root in 'state { … }').`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system Shop {
  subdomain Sales {
    context Orders {
      aggregate Customer with crudish {
        name: string
      }
      repository Customers for Customer {}
    }
  }
  api SalesApi from Sales
  storage primary { type: postgres }
  resource st { for: Orders, kind: state, use: primary }
  ui WebApp {
    api Sales: SalesApi
    page Home {
      route: "/home"
      title: "Home"
      state { count: int = 0 }
      action bump() { other := 1 }
      body: Stack { Button { "Bump", onClick: bump } }
    }
  }
  deployable api {
    platform: node
    contexts: [Orders]
    dataSources: [st]
    serves: SalesApi
    port: 4000
  }
  deployable web {
    platform: react
    targets: api
    ui: WebApp { Sales: api }
    port: 3000
  }
}
```

</details>

### `src/generator/feliz/fs-expr.ts#renderFsMethodCall`

A page action using a collection/string method outside the small F# set (reverse, indexOf, concat, none, find, append, toString, format...) parses clean and crashes; no frontend method-vocabulary gate covers the feliz update path.

Crash: `Error: feliz: method 'reverse' is not implemented on the F# action/update path — ...`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system S {
  subdomain M { context Sales {
    enum Color { Red, Green }
    aggregate Thing with crudish { name: string }
    repository Things for Thing { find byName(name: string): Thing[] }
  } }
  ui WebApp {
    function twice(x: int): int extern from "x"
    page Home {
      route: "/"
      state { n: int = 0  s: string = ""  xs: int[] = []  ss: string[] = []  d: datetime = now()  c: Color = Red  b: bool = false  m: decimal = 0.0 }
      action say() { xs := xs.reverse() }
      body: Stack { Text { string(n) }, Button { "go", onClick: say } }
    }
  }
  storage primary { type: postgres }
  resource salesState { for: Sales, kind: state, use: primary }
  deployable api { platform: node contexts: [Sales] dataSources: [salesState] port: 3000 }
  deployable web { platform: feliz targets: api ui: WebApp port: 3005 }
}
```

</details>

### `src/generator/feliz/fs-expr.ts#renderFsExpr$3`

An effect-free block-body lambda (only let statements) in a page action passes loom.effect-in-lambda and every other gate, then crashes.

Crash: `Error: feliz: block-body lambda ('x => { … }') is not rendered in an F# action body.`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system S {
  subdomain M { context Sales {
    enum Color { Red, Green }
    aggregate Thing with crudish { name: string }
    repository Things for Thing { find byName(name: string): Thing[] }
  } }
  ui WebApp {
    function twice(x: int): int extern from "x"
    page Home {
      route: "/"
      state { n: int = 0  s: string = ""  xs: int[] = []  ss: string[] = []  d: datetime = now()  c: Color = Red  b: bool = false  m: decimal = 0.0 }
      action say() { let f = x => { let y = x } }
      body: Stack { Text { string(n) }, Button { "go", onClick: say } }
    }
  }
  storage primary { type: postgres }
  resource salesState { for: Sales, kind: state, use: primary }
  deployable api { platform: node contexts: [Sales] dataSources: [salesState] port: 3000 }
  deployable web { platform: feliz targets: api ui: WebApp port: 3005 }
}
```

</details>

### `src/generator/feliz/fs-expr.ts#renderFsExpr$4`

'b := this.b' (kind 'this') or 'let f = say' (kind 'action-ref') in a page action parse with 0 errors and hit the default arm.

Crash: `Error: feliz: unsupported expression 'this' in an F# action/update body — ...`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system S {
  subdomain M { context Sales {
    enum Color { Red, Green }
    aggregate Thing with crudish { name: string }
    repository Things for Thing { find byName(name: string): Thing[] }
  } }
  ui WebApp {
    function twice(x: int): int extern from "x"
    page Home {
      route: "/"
      state { n: int = 0  s: string = ""  xs: int[] = []  ss: string[] = []  d: datetime = now()  c: Color = Red  b: bool = false  m: decimal = 0.0 }
      action say() { b := this.b }
      body: Stack { Text { string(n) }, Button { "go", onClick: say } }
    }
  }
  storage primary { type: postgres }
  resource salesState { for: Sales, kind: state, use: primary }
  deployable api { platform: node contexts: [Sales] dataSources: [salesState] port: 3000 }
  deployable web { platform: feliz targets: api ui: WebApp port: 3005 }
}
```

</details>

### `src/generator/feliz/update-emit.ts#renderUpdateStmt`

toast(...) in a page action lowers as a private-operation call; loom.unresolved-action-ref exempts it as a view-effect builtin but feliz has only a navigate arm. Also: an unresolved call foo() inside a STORE action is not checked by unresolved-action-ref.

Crash: `Error: feliz: unsupported 'private-operation' call 'toast' in the MVU update arm — ...`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system S {
  subdomain M { context Sales {
    aggregate Thing { name: string }
    repository Things for Thing { }
  } }
  ui WebApp {
    page Home {
      route: "/"
      state { n: int = 0 }
      action say() { toast("hi") }
      body: Stack { Text { string(n) }, Button { "go", onClick: say } }
    }
  }
  storage primary { type: postgres }
  resource salesState { for: Sales, kind: state, use: primary }
  deployable api { platform: node contexts: [Sales] dataSources: [salesState] port: 3000 }
  deployable web { platform: feliz targets: api ui: WebApp port: 3005 }
}
```

</details>

### `src/generator/feliz/update-emit.ts#renderUpdateStmt$2`

A match await nested inside another match-await arm on a :id page (or any match await in a store action) is never projected and no gate refuses it (feliz-async-effect-unsupported only flags component hosts; stores are not scanned).

Crash: `Error: feliz: a 'match await' (async effect) statement reached the per-statement update renderer — ...`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system Demo {
  subdomain S {
    context C {
      error OrderMissing { missingRef: string }
      aggregate Order with crudish {
        customerId: string
        operation reserve(): Order or OrderMissing {
          return OrderMissing { missingRef: customerId }
        }
        private operation hidden(): Order or OrderMissing {
          return OrderMissing { missingRef: customerId }
        }
      }
    }
  }
  api A from S
  ui Web {
    api C: A

    page Orders {
      route: "/orders"
      body: Text { "x" }
    }
    page Detail(id: Order id) {
      route: "/orders/:id"
      state { draftName: string = "" }
      action reserveNow() {
        match await C.Order.reserve() {
          Order o => { match await C.Order.reserve() { Order p => { draftName := p.customerId } else => { draftName := "b" } } }
          else    => { draftName := "unavailable" }
        }
      }
      body: Stack { Heading { "Order", level: 1 }, Button { "Reserve", onClick: reserveNow } }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node contexts: [C] dataSources: [st] serves: A port: 3000 }
  deployable web { platform: feliz targets: api ui: Web { C: api } port: 3001 }
}
```

</details>

### `src/generator/feliz/wire.ts#findParamQueryValue`

A repository find with a list (or other non-scalar) parameter read in a feliz QueryView parses clean and crashes; no feliz find-shape gate.

Crash: `Error: feliz: repository find 'Thing.byNames' has a parameter 'names' of an unsupported type (array) — ...`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system S {
  subdomain M { context Sales {
    enum Color { Red, Green }
    valueobject Range { lo: int  hi: int }

    aggregate Thing with crudish { name: string  qty: int  color: Color }
    repository Things for Thing { find byNames(names: string[]): Thing[] }
  } }
  api SApi from M
  ui WebApp {
    api C: SApi
    page Home {
      route: "/"
      state { n: int = 0  s: string = ""  }
      body: QueryView { of: C.Thing.byNames(["a"]), loading: Text { "l" }, error: Text { "e" }, empty: Text { "n" }, data: rows => Text { "x" } }
    }
  }
  storage primary { type: postgres }
  resource salesState { for: Sales, kind: state, use: primary }
  deployable api { platform: node contexts: [Sales] dataSources: [salesState] serves: SApi port: 3000 }
  deployable web { platform: feliz targets: api ui: WebApp { C: api } port: 3005 }
}
```

</details>

### `src/generator/feliz/wire.ts#felizFindRead`

A find returning a non-aggregate shape (string[], int) read in a feliz QueryView parses clean and crashes.

Crash: `Error: feliz: repository find 'Thing.names' returns a shape the Feliz frontend cannot decode (array) — ...`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system S {
  subdomain M { context Sales {
    enum Color { Red, Green }
    valueobject Range { lo: int  hi: int }

    aggregate Thing with crudish { name: string  qty: int  color: Color }
    repository Things for Thing { find names(): string[] }
  } }
  api SApi from M
  ui WebApp {
    api C: SApi
    page Home {
      route: "/"
      state { n: int = 0  s: string = ""  }
      body: QueryView { of: C.Thing.names(), loading: Text { "l" }, error: Text { "e" }, empty: Text { "n" }, data: rows => Text { "x" } }
    }
  }
  storage primary { type: postgres }
  resource salesState { for: Sales, kind: state, use: primary }
  deployable api { platform: node contexts: [Sales] dataSources: [salesState] serves: SApi port: 3000 }
  deployable web { platform: feliz targets: api ui: WebApp { C: api } port: 3005 }
}
```

</details>

### `src/generator/feliz/wire.ts#felizFindRead$2`

Find call arity is not checked: QueryView { of: C.Thing.byName() } (or bare C.Thing.byName, or 2 args) against a 1-param find parses with 0 errors.

Crash: `Error: feliz: repository find 'Thing.byName' was called with 0 argument(s) but declares 1 parameter(s) — ...`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system S {
  subdomain M { context Sales {
    enum Color { Red, Green }
    valueobject Range { lo: int  hi: int }

    aggregate Thing with crudish { name: string  qty: int  color: Color }
    repository Things for Thing { find byName(name: string): Thing[] }
  } }
  api SApi from M
  ui WebApp {
    api C: SApi
    page Home {
      route: "/"
      state { n: int = 0  s: string = ""  }
      body: QueryView { of: C.Thing.byName(), loading: Text { "l" }, error: Text { "e" }, empty: Text { "n" }, data: rows => Text { "x" } }
    }
  }
  storage primary { type: postgres }
  resource salesState { for: Sales, kind: state, use: primary }
  deployable api { platform: node contexts: [Sales] dataSources: [salesState] serves: SApi port: 3000 }
  deployable web { platform: feliz targets: api ui: WebApp { C: api } port: 3005 }
}
```

</details>

### `src/generator/feliz/wire.ts#walk`

A find read nested in a For/data lambda passing the row binding (C.Thing.byName(r.name)) is valid but the argument isn't a state cell/store field.

Crash: `Error: feliz: the argument 'r' passed to repository find 'Thing.byName' is not resolvable where the Feliz frontend issues the query. ...`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system S {
  subdomain M { context Sales {
    enum Color { Red, Green }
    valueobject Range { lo: int  hi: int }

    aggregate Thing with crudish { name: string  qty: int  color: Color }
    repository Things for Thing { find byName(name: string): Thing[] }
  } }
  api SApi from M
  ui WebApp {
    api C: SApi
    page Home {
      route: "/"
      state { n: int = 0  s: string = ""  }
      body: QueryView { of: C.Thing.all, loading: Text { "l" }, error: Text { "e" }, empty: Text { "n" }, data: rows => For { each: rows, r => QueryView { of: C.Thing.byName(r.name), loading: Text { "l" }, error: Text { "e" }, empty: Text { "n" }, data: xs => Text { "y" } } } }
    }
  }
  storage primary { type: postgres }
  resource salesState { for: Sales, kind: state, use: primary }
  deployable api { platform: node contexts: [Sales] dataSources: [salesState] serves: SApi port: 3000 }
  deployable web { platform: feliz targets: api ui: WebApp { C: api } port: 3005 }
}
```

</details>

### `src/generator/flutter/riverpod-emit.ts#renderNotifierStmt`

loom.unresolved-action-ref does not scan STORE action bodies, so a typo'd/unknown call foo() in a store action parses clean and crashes the flutter store notifier.

Crash: `Error: internal: the Flutter Riverpod Notifier emitter cannot render a 'private-operation' call 'foo'. ...`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system Demo {
  subdomain S {
    context C {
      error OrderMissing { missingRef: string }
      aggregate Order with crudish {
        customerId: string
        operation reserve(): Order or OrderMissing {
          return OrderMissing { missingRef: customerId }
        }
        private operation hidden(): Order or OrderMissing {
          return OrderMissing { missingRef: customerId }
        }
      }
    }
  }
  api A from S
  ui Web {
    api C: A
    store Cart { state { n: int = 0 } action a() { n := 1 } action b() { foo() } }

    page Orders {
      route: "/orders"
      body: Text { "x" }
    }
    page Detail(id: Order id) {
      route: "/orders/:id"
      state { draftName: string = ""  pick: bool = false }
      action reserveNow() { Cart.b() }
      body: Stack { Heading { "Order", level: 1 }, Button { "Reserve", onClick: reserveNow } }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node contexts: [C] dataSources: [st] serves: A port: 3000 }
  deployable web { platform: flutter targets: api ui: Web { C: api } port: 3001 }
}
```

</details>

### `src/generator/flutter/riverpod-emit.ts#renderNotifierStmt$2`

A match await nested inside a page match-await arm (or any match await in a store action) reaches the default arm; the page interceptor only handles top-level ones and no gate covers nested/store cases.

Crash: `Error: internal: the Flutter Riverpod Notifier emitter cannot render an action statement of kind 'variant-match'. ...`

<details><summary>repro (<code>ddd parse</code>: 0 errors)</summary>

```ddd
system Demo {
  subdomain S {
    context C {
      error OrderMissing { missingRef: string }
      aggregate Order with crudish {
        customerId: string
        operation reserve(): Order or OrderMissing {
          return OrderMissing { missingRef: customerId }
        }
        private operation hidden(): Order or OrderMissing {
          return OrderMissing { missingRef: customerId }
        }
      }
    }
  }
  api A from S
  ui Web {
    api C: A


    page Orders {
      route: "/orders"
      body: Text { "x" }
    }
    page Detail(id: Order id) {
      route: "/orders/:id"
      state { draftName: string = ""  pick: bool = false }
      action reserveNow() { match await C.Order.reserve() { Order o => { match await C.Order.reserve() { Order p => { draftName := p.customerId } else => { draftName := "b" } } } else => { draftName := "u" } } }
      body: Stack { Heading { "Order", level: 1 }, Button { "Reserve", onClick: reserveNow } }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node contexts: [C] dataSources: [st] serves: A port: 3000 }
  deployable web { platform: flutter targets: api ui: Web { C: api } port: 3001 }
}
```

</details>

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

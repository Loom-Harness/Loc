# The target language

This page describes the language Loom is heading to, section by section: what a model can say once the decided changes have landed. It is a description of the destination, not of today's compiler. The reference for what works today is [`language.md`](language.md) and [`language-reference/`](language-reference/README.md).

How to read it:

- **The "When" column.** `today` means it works on today's compiler. `today, changing` means it works today and its spelling or behaviour will change. `coming` means the direction is decided and it is not built, or only partly. `not planned` means it is deliberately left out.
- **Code fences.** A fence marked `ddd` parses on today's compiler. A plain-text fence shows syntax that is coming and does not parse yet; its spelling can still move.
- **Decisions live elsewhere.** What is decided, what is still open and in what order things are built is kept on the project's tracking issue. Where this page and that record disagree, the record wins.

Related pages: [`how-do-i.md`](how-do-i.md) for what to use today, [`boundaries.md`](boundaries.md) for what Loom leaves to other systems.

## 1. System shape

A model is one `system`: contexts hold the domain, an `api` says what is served, a `deployable` says where it runs. The context, never the deployable, is the boundary.

```text
system Shop {
  subdomain Sales {
    context Ordering with scaffoldHandlers { aggregate Order with crudish { code: string } }
  }
  api SalesApi with scaffoldApi(of: Sales) { }
  storage st { type: postgres }
  deployable api { platform: node  contexts: [Ordering]  dataSources: [st]  serves: SalesApi }
  ui Web with scaffold(api: SalesApi) { }
  deployable web { platform: web  targets: api }
}
```

| Construct | What it is | When |
| --- | --- | --- |
| `system`, `subdomain`, `context` (`module`) | Grouping. A subdomain only groups contexts and holds the permissions catalogue; no visibility rule depends on it. | today |
| Internal by default, `published` | A context's declarations are invisible outside it unless marked `published`. Publishable: value objects, enums, records, events. Never operations, handlers, workflows, repositories, projections, criteria. | coming |
| `Context.Name` qualification | A foreign declaration is written qualified outside its context; bare inside. | coming |
| Root-level declarations | The ambient shared kernel: bare names everywhere. | today |
| `api X { route … }` | An api is exactly its route lines. `with scaffoldApi(of: …)` writes them; unfold and delete a line to stop serving it. | coming |
| `deployable` | `platform:`, `contexts:`, `dataSources:`, `serves:` (required; `serves: none` allowed), `channels:`, `adapters:`, `auth:`. | today, changing |
| `storage`, `resource` | Infrastructure a context uses: state, objectStore, queue, api, email. | today |
| `platform: gateway`, `gathers: [a at "/", b at "/ops"]` | One front door over several web deployables; one login; full page load between parts. A hand-written `apps { app <part> label "…" }` block lists them; `/_gateway/…` is reserved. A ui may sit over several backends behind a gateway that owns the session and forwards the same token. | coming |
| `import` | Plain file loading into one global scope. | today |
| Generated layout | One project per deployable, folders by context (`host/ platform/ kernel/ <ctx>/{published,domain,db,http,handlers}`) with an import census. One migration chain per context. | coming |

**Targets.** Five backends (node/Hono, .NET, Elixir/Phoenix, Python/FastAPI, Java/Spring) and seven UI targets (React, Vue, Svelte, Angular, Feliz, Flutter, LiveView). Every target is a full target; none is dropped or tiered.

**What is not here.** No package manager for models (a monorepo is the expected shape). No multi-project build per deployable.

## 2. Domain model

The aggregate is the unit of consistency: its invariants hold after every operation, and one row version separates its writers. Everything else in this section hangs off that.

```ddd
aggregate Stock with auditable, versioned {
  sku: string
  available: int
  status: StockStatus = Open
  unique (sku)
  invariant available >= 0
  operation reserve(qty: int) when status == Open {
    precondition enough: available >= qty
    available -= qty
    emit StockReserved { stock: id, qty: qty }
  }
}
```

### Declarations

| Construct | Notes | When |
| --- | --- | --- |
| `aggregate`, entity parts, `valueobject`, `enum`, `event` | Parts are contained and saved with their aggregate. Cross-aggregate links are `X id` (and `X id[]` for a join table). | today |
| `invariant [name:] expr [when …]` | Checked after every operation. On a value object it is input validation (422); on an aggregate a violation is a bug (500). | today |
| `operation`, `when` gate, `precondition [name:] expr`, `emit` | `requires` 403, then `when` 409, then `precondition` 422. | today |
| `unique (a, b)` | A database unique index; 409 on conflict. The one cross-row guarantee in the language. | today |
| `derived` fields, defaults, `managed`, `immutable`, `internal`, `private`, `token` | Field modifiers. `token` round-trips as an optimistic-concurrency value. | today |
| `function`, `domainService` | Pure calculators; a domain service may read. Never hand-written. | today |
| `criterion Name(params) of T = predicate` | A reusable, queryable predicate. | today |
| Abstract aggregates, `extends`, TPC / TPH | Polymorphic `find all <Base>`. | today |

### Capabilities and macros

| Construct | Notes | When |
| --- | --- | --- |
| `auditable`, `softDeletable`, `versioned`, `tenantOwned`, `tenantRegistry` | Prelude mixins: fields plus a stamp and a filter. | today |
| `crudish`, `scaffoldHandlers`, `scaffoldApi`, `scaffold`, `scaffoldDashboard` | Macros that expand to plain `.ddd`; `unfold` prints the source. | today |
| `shareable` | Emits a sibling `<Agg>Share` aggregate and a `SharedWithMe` policy function. | today |
| `implements tenantMembership`, `implements accessRecord` | Per-tenant person record; access log for org switches. | coming |

### Persistence kinds

| Construct | Notes | When |
| --- | --- | --- |
| State-stored (default) | One row per aggregate, parts in child tables. | today |
| Event-sourced (`persistedAs: eventLog`, `apply`) | The append-only kind. Stored events are compatibility-checked: a field removal is refused; the fix is a new event name. | today |
| Document persistence, `persistence:` adapters per backend | The one realization axis left besides layout. | today |
| Effective-dated (bitemporal) aggregates | `Repo.asOf(id, date)`. | not planned |

### Types and values

| Construct | Notes | When |
| --- | --- | --- |
| Scalars (`string`, `int`, `long`, `decimal`, `bool`, `date`, `datetime`, `guid`, `json`, `money`), `File`, `T?`, `T[]` | One absence model: `T?`. Presence is not a type; an update is a JSON Merge Patch. | today, changing |
| `A or E`, `payload Foo = A \| B` | Unions with a tagged `type` on the wire. A returned `E` must be matched and rolls the unit of work back. | today |
| `Money { amount, currency }`, `Currency` enum | Mixed currencies are a runtime 422. `money` stays the bare amount. | coming |
| `s.toInt()` etc. returning `T or ParseError` | Parsing must be matched. | coming |
| Date arithmetic (`addDays`, `addMonths`, `startOfMonth`, `toDays()`), `.format(pattern)`, `padStart` | UTC until time zones are designed. | coming |
| One sort order: text by code point, enums alphabetical by name, empty last | Database and in-memory agree. Enum order is not declaration order. | coming |
| Structural assignability for payload-family records | Same field names fit; anything else goes through `mapsFrom`. | coming |
| `bytes(max: N)` | `bytea`, base64 on the wire. The size limit is a required part of the type. | coming |
| Built-in type names (`File`, `AuditEntry`, `Money`, `bytes`, `ParseError`, `EventMeta`) | Reserved by the language itself. | coming |
| `==` on value objects and lists | Value objects compare by value and are absence-safe; lists compare element by element, in order. | coming |
| User generics, function-typed parameters, refinement types, a `?` operator |  | not planned |

## 3. Commands, queries, routes and the wire

Every entry into a context is one declared record handled by exactly one handler, and a route only says which record an HTTP call sends. This is the command model.

```text
command ShipOrder { id: Order id  carrier: string }
query   GetOrderById { id: Order id }
commandHandler ShipOrderHandler(cmd: ShipOrder) { let o = Orders.get(cmd.id)  o.ship(cmd.carrier) }
queryHandler   GetOrderByIdHandler(q: GetOrderById): OrderResponse { return Orders.get(q.id) }
api SalesApi {
  route POST "/orders/{id}/ship" send Ordering.ShipOrder
  route GET  "/orders/{id}"      send Ordering.GetOrderById
  route POST "/hooks/stripe" send Billing.StripeEvent { payload: raw body, signature: header "Stripe-Signature" }
}
```

| Construct | Rule | When |
| --- | --- | --- |
| `command X { }` + `commandHandler XHandler(cmd: X)` | One record per handler; zero or two handlers is refused. A handler changes one aggregate type and does not send commands. | coming |
| `query Q { }` + `queryHandler` | Reads only; runs now. | coming |
| `route METHOD "path" send Ctx.Record` | Path placeholders, body and query string bind to record fields by name. `raw body` and `header "…"` bindings exist for webhooks. | coming |
| `response <Agg>Response`, `payload`, `error E`, `paged T` | The wire shape is the declared response record; nothing is derived implicitly. | today, changing |
| Statically typed in-process command bus on every backend | Real dispatch, not inlining. | coming |
| No built-in domain endpoints | History, permission queries (`can o.ship()`), workflow instances and projection reads are scaffolded records an api must route. | coming |
| `requires true` on a handler | Admits an anonymous caller on an authenticated deployable: the per-route allowlist, and how a public webhook is served. | coming |
| Failure model | Absence `T?`; validation 422; `precondition` 422; expected failure `A or E` with `httpStatus`; aggregate invariant 500; version or gate conflict 409. No exceptions in the language. | today |
| `rateLimited(n, per: …, by: …)` | A gate marker on a handler or workflow; 429. | coming |
| Request dedupe (`Idempotency-Key`) | Every command goes through one table that stores the key, the caller, the status and where the result lives, not the response body. A repeat gets the same status and re-reads the result through the normal authorised read; 409 only while the first is still running. | coming |
| A handler that returns a value | Must declare its result type (`loom.handler-return-untyped`). | coming |
| A route whose send is queued | Answers 202 with no `Location`: there is no run to read. | coming |
| OpenAPI document, `contracts/wire-spec.json`, `ddd diff` | Wire changes are classified compatible or breaking.  | today |

## 4. Workflows

A workflow is the only thing that changes more than one aggregate: it sends commands, and its shape decides whether they commit together or one by one with undo. Today's workflows load and mutate aggregates directly; that form goes away.

```text
command StartFulfilment { id: Order id }
workflow Fulfilment {
  create(cmd: StartFulfilment) {                       // the workflow handles its own start command
    let h = send OrderHistory { id: cmd.id }           // a query: runs now
    step pay {
      send ReserveStock  { id: h.stock, qty: h.qty }
      send ChargeAccount { id: h.account, amount: h.total }
    } undo {
      send ReleaseStock  { id: h.stock, qty: h.qty }
      send RefundAccount { id: h.account, amount: h.total }
    }
    step ship { send ShipOrder { id: cmd.id, carrier: "dhl" } } final
  }
}
workflow Transfer transactional(serializable) { create(cmd: MoveFunds) { send Debit {…}  send Credit {…} } }
```

### What commits when

| Unit | Transaction | A failure leaves |
| --- | --- | --- |
| Command handler | One; joins an open one | Nothing |
| Workflow body, plain | Its own state and outbox rows, written once at the end | Nothing of its own; committed steps stay |
| `send Cmd`, target in the same database | Joins the open transaction, else its own commit; returns the handler's result now | Nothing of its own |
| `send Cmd`, other database or deployable | An outbox row; runs exactly once later; in a workflow that has a run, the run waits for `Done / Rejected e / Exhausted x`. Inside `create` such a send is queued with a warning and its result cannot be bound | The outcome must be matched |
| `step name { … }` | One transaction; every send joins | Nothing of the block |
| `transactional[(level)]` workflow | One, held from the first read. This is the multi-aggregate atomic unit. A send that cannot join is a compile error. | Nothing |
| `on` reaction, event-started `create` | One, with its inbox claim | Nothing; the trigger stays and is retried |
| Outside call (port, resource) | Never rolled back; it is a step and needs `undo` or `final` | The effect |

### Rules

| Rule | When |
| --- | --- |
| A workflow changes aggregates only through commands: no load-and-mutate, no `Agg.create(…)` in a body. | coming |
| A workflow is started by its start command over HTTP, by an event (`create(e: X) by e.key`), or by another workflow sending its start command (`let w = send StartX { … }`, which binds `create`'s result or a `<Workflow> id`). Command handlers and reactions start one only by event. | coming |
| Where a send runs depends only on where its target lives (same database: now; otherwise: outbox). | coming |
| A step followed by anything that can fail carries `undo { }` or is marked `final`. Undos run newest first; a failing undo parks the run. | coming |
| Every run has a `_workflow_run` row: position (a step name), direction, saved values, lease, status `done / failed / failed-to-undo / waiting`. A crashed `create` is undone in the background; a later `on(e)` run continues forward. There is no replay and no determinism rule. | coming |
| A workflow's `create` runs fully inside the request. Until durable runs exist a start answers 200 or 201 with `create`'s result; after that, `202 Accepted` with the `Location` of the instance read. The read is `W.instance(id)`, a scaffolded query an api must route; the page primitive is `InstanceView`, and it polls while a run is pending. | coming |
| No automatic retry of a lost version race or a refused serializable commit inside a request: 409 or 503, the client decides. No lock construct; row-version checks only. | coming |
| Removing or renaming a step that has runs is refused by the breaking-for-data gate; the fix is a new workflow name. | coming |
| Stateless reaction: a workflow with no fields and only keyless `on` entries. No state table, no run, sends are fire-and-forget to the dead letters. `eventSourced`, `apply` and a header `requires` are each refused in one. | coming |
| Stateful workflow: fields, an instance row per key, `by` on every event entry. | today, changing |
| Test statements: `settle`, `expect(settle).toPark(W.step)`, `crash after step s`, `fail step s with E {…}`, `fail send X`. | coming |

## 5. Events, channels and time

Every server-side listener is durable, with no knob: an event's commit writes one outbox row per listener, and each listener runs afterwards in its own transaction until it succeeds or parks. Today's channels (`channel`, `channelSource`, `delivery:`, `retention:`) are replaced by this design.

```text
context Sales {
  event OrderPlaced { … }                  // only Sales may listen
  published event OrderAccepted { … }      // other contexts may listen
}
workflow ReserveOnAccept { on(e: Sales.OrderAccepted) { send ReserveStock { … } } }   // stateless reaction
workflow Invoicing { … create(e: Sales.OrderAccepted) by e.order { … } }             // stateful, keyed
channel OrderFeed { carries: Sales.OrderAccepted  over: bus }
deployable api { … channels: [OrderFeed]  deadLetters requires Ops.ManageDeadLetters }
event NightTick crossTenant { at: datetime }
ui Web { on Sales.OrderAccepted(e) { toast(…) }   on OrderBoard.updated(k) { refetch(OrderBoard) } }
```

| Construct | Rule | When |
| --- | --- | --- |
| `event`, `published event` | Internal by default; a cross-context listener on an internal event is a compile error. No `emits` clause, no context map. | coming |
| Durable listeners | Projection fold, workflow `on`, event-started `create`, reaction. Retried with backoff (5 attempts, to 30 s), then that listener's row parks. The HTTP reply does not wait. | coming |
| Ordering | Per listener and per key (`by`); a parked row holds back later rows of that key. Keyless listeners are unordered. Order among listeners is undefined. | coming |
| One `_outbox` for events and sent commands; `_inbox` for claims | Columns include `order_key`, `tenant`, `correlation_id`, `causation_id`, `origin`, `reply_to_run`. | coming |
| `channel X { carries: … over: <broker> }` + deployable `channels:` | A named broker route. Four compile errors keep listings honest. A channel no deployable reads publishes to the outside. Redis Streams, RabbitMQ, Kafka. | coming |
| `on(e: X, meta: EventMeta)` | `id, occurredAt, tenant, producer, causationId, correlationId`. | coming |
| Dead-letter routes | List, retry, discard, per listener and per event, gated by a model permission; none generated without the clause. Tenant-scoped by default. | coming |
| Browser listeners | The ui listens to published events directly; no ui channel. A listener may only `toast` and `refetch`. A payload-free notice per read model drives `on <ReadModel>.updated`. On reconnect, one refetch; no replay. No ui may listen to a `crossTenant` event. | coming |
| Event tenancy | A tenant event by default; `event X crossTenant` is raised only in platform places; a timer's event must be `crossTenant`. | coming |
| Stored-event compatibility | Only event-sourced events are checked. Published events: a documented rule, no check, no versions, no upcasters. | coming |
| `timerSource` / `cron:` | A tick is an ordinary event carrying `at`. One tick per scheduled time across replicas, UTC, one catch-up tick after downtime. | today, changing |
| Test clock | Tests move time. | coming |

## 6. Reads

Reads are typed predicates the compiler turns into SQL; whatever cannot be pushed to the database is refused with a diagnostic, never run in memory silently.

```text
repository Orders for Order { }
retrieval ByCustomer(c: Customer id) of Order { where: customer == c  sort: [placedAt desc] }
criterion Overdue(asOf: date) of Invoice = dueOn < asOf && status == Open
projection OrderBoard { order: Order id  customer: string
  from Order as o  join Customer as c on o.customer
  select order = o.id, customer = c.name }
```

| Construct | Rule | When |
| --- | --- | --- |
| `repository`, `retrieval`, auto `findAll`, `paged`, `sort` | Filters are typed expressions. | today |
| Read verbs `get` (404) / `find` (`T?`) / `getBy` / `findBy` / `all` | Replaces declared finds. Zero-argument `Repo.all()` only in a handler returning `paged`. | coming |
| `criterion` | Named, reusable, pushable. | today |
| Following `X id` in a read | The compiler plans a bulk load or a join; a hand-written by-ids read is two queries, not N+1. | today |
| Query-time `projection` (`from / join / select`), incl. the dashboard aggregates | Aggregated in SQL. | today |
| Folded `projection` | A read model updated by events, after commit. | today |
| Projection reads `P.all()`, `P.get(key)`; workflow reads `W.instances()`, `W.instance(key)`; `Orders.history(id)` | Each is a read verb its owner contributes; the route is scaffolded. All list reads are paged: history returns `paged AuditEntry`, and `W.instances()` and `P.all()` are legal only in a handler returning `paged`. | coming |

### Reading another context's data

| Route | Rule | When |
| --- | --- | --- |
| `send Catalog.GetProduct { … }` | From any body, to any context in the same deployable, under the caller's principal. To another deployable: refused. Query cycles between contexts: refused. | coming |
| A local copy folded from published events | The cross-deployable answer. | coming |
| An `api` resource or a port | For another deployable or an outside system. | today, changing |
| A projection that joins another context's aggregate | Refused: `loom.projection-foreign-source`. | coming |
| Reads spanning contexts on one database | Expressions contributed by several contexts are gathered, compiled and run as one query when the contexts are declared on one database. What a context contributes and what the reader writes is not designed yet. | coming |
| Holding another context's id (`Catalog.Product id`) | Allowed with no marker. It is an unchecked foreign id: no foreign key, no existence check, and it opens no data. | coming |

## 7. Concurrency, transactions and idempotency

Writers are separated by row versions and nothing else: there is no lock construct and no automatic retry inside a request. Data stays correct; the cost of contention lands on the client as a 409.

| Mechanism | Rule | When |
| --- | --- | --- |
| Row version on every aggregate | A write checks the version it read. A client `If-Match` is honoured (409 on mismatch). | today |
| Lost race with no `If-Match` | Answers 409; the client decides. | today |
| Unit of work | A command handler is one transaction and reads inside it. A non-`transactional` workflow writes its own state row and outbox rows once, at its end. | coming |
| `transactional[(level)]` on a body | Holds the transaction from the first read. `transactional(serializable)` is the documented answer for check-then-act across rows. A refused serializable commit is not retried (503). | coming |
| Multi-aggregate atomic change | A `transactional` workflow whose sends all target the same database commits them together. | coming |
| `unique (…)` | The only declarative cross-row guarantee. | today |
| `loom.effect-in-transaction` | A hint when an outside call precedes the commit. | today |
| Idempotency of requests | See request dedupe in section 3: the outcome is stored, not the body. | coming |
| Idempotency of effects | Every port `effect` receives a generated key `(run, step, position)`, sent as `Idempotency-Key` on api resources. | coming |
| Idempotency of listeners | An inbox mark per listener and message. | coming |
| Semantic lock | A `Pending` status plus a `precondition`: the documented countermeasure in place of isolation between saga steps. | coming |

### The stock answers to contention

Each of these is written by hand today.

| Need | Answer | When |
| --- | --- | --- |
| An invariant across rows that share a key (bookings of one practitioner on one day) | A registration aggregate per key that holds the entries as parts, so the invariant is inside one aggregate and its version serialises writers. | today |
| A hot counter (stock, seats) | A reservation aggregate that spreads the counter. | today |
| A gapless number series | A counter aggregate per series; correct and contended. | today |

**Not planned.** A posting engine for truly hot accounts, such as a bank's ledger core. Such engines are hand-built for one use; a Loom app reaches one through a port.

## 8. Authorization, identity and tenancy

A read is admitted by one formula, compiled into the query on every backend:

```
read(p, X) = Base(X) ∧ Reach(p, X) ∧ (Floor(p, X) ∨ Across(p, X)) ∧ ¬Deny(p, X)
```

Base is the aggregate's own filters, Reach the caller's permissions, Floor the tenant, Across an explicit cross-tenant grant, Deny always wins.

```text
tenancy by user.tenantId of Organization
permissions { ordersRead  ordersCancel implies ordersRead }
aggregate Quote with tenantOwned { customer: Customer id  margin: money mask unless currentUser.role == "sales" }
policy {
  allow local on Quote as q when currentUser.role == "customer" where q.customer == currentUser.customerId
  allow crossTenant read on Organization as o where organizationContext.org in o.ancestors
}
```

### Authorization

| Construct | Rule | When |
| --- | --- | --- |
| `permissions { }` with `implies`, `requires` gates, `policy { }` read ladders, named policy functions | Policy functions are inlined into SQL; must be queryable and non-recursive. | today |
| Row rules `allow own`, `allow … when` | `when` reads the caller only and runs before the query. | today |
| `allow local on X as x when … where …` | Narrows a role to some rows inside the tenant. A bare `allow … where` is refused: the level is always named. | coming |
| `allow crossTenant [read\|write] on X as x where …` | Must be anchored on something the application stores; an identity-provider claim alone can never grant cross-tenant reach. | coming |
| Absent claim | Unknown in every authorization predicate; a grant admits only on true. | coming |
| `shareable` | Row sharing to an org, a subtree or a user, in any tenant; no re-sharing; masks still apply. | today |
| `mask unless <caller predicate>` | Redacts a field to `null`. | today |
| `enforcement: denyByDefault \| opt` |  | today |

### Identity

**Loom is not an identity provider.** It uses one as infrastructure (Keycloak in the generated stack) through the OIDC code flow with PKCE and refresh rotation. That works today.

| Item | Rule | When |
| --- | --- | --- |
| Users, credentials, MFA, password reset, social login | The identity provider's job. | not planned |
| Identity is global; everything about a person is tenant-owned | `implements tenantMembership` gives `user`, `role`, `name`, `email`, `status`. No system-wide profile. `currentUser.role` is the membership role in the operating org. | coming |
| A caller with no tenant | The membership check applies to signed-in callers: no membership answers 403. An anonymous caller passes `requires true` routes and has no tenant. Self-service sign-up therefore goes through the identity provider and a platform place that creates the membership. | coming |
| Erasing a person | A gated `erase` on the membership row; audit rows are never rewritten and carry ids only. | coming |

### Tenancy

| Construct | Rule | When |
| --- | --- | --- |
| `tenancy by user.<claim> of <Registry>`, `tenantOwned`, `crossTenant`, the explicit-stance rule | Data visibility is flat: my org's rows. Rules only add to it. | today |
| Registry tree (`parent: Self id?`), `organizationContext` | The tree manages sub-tenants; it plays no part in reads except subtree shares. | today |
| Org switch (`x-org-context`, `OrgSwitch {}`) | Support acts under its own identity in an org it can read; a switch outside your own top org needs `x-access-reason` and writes an `AccessRecord`. Writes are stamped with the operating org. | coming |
| System principal, `as tenant o { … }` | Event-started work runs as the system principal of a tenant. A tenant-less body does tenant work only inside `as tenant`. | coming |
| `ignoring tenantOwned`, `ignoring *` | Drops the floor only; never reach, deny or author filters. | coming |

Deliberately not part of the design: a materialised path or closure table for the org tree, `deep` / `global` / `inherited` visibility, a Zanzibar-style relation graph, a platform principal or root-org flag, a system-wide user profile, application-level shard routing.

## 9. UI language

Pages are written in a closed library of primitives and rendered by one shared walker on seven targets; a design pack decides how each primitive looks. The UI never runs domain logic: it consumes the wire.

```text
ui Web with scaffold(api: SalesApi) {
  store Draft persist: local { state { lines: Line[] = [] } }
  page Orders { route: "/orders"
    state { status: OrderStatus? }
    action cancel(o: Order) { match await o.cancel() { Ok => toast("Cancelled")  Conflict c => … } }
    body: Stack { SelectField { "Status", value: status },
                  Table { rows: api.Sales.Order.byStatus(status), Column { … } } } }
}
```

| Construct | Notes | When |
| --- | --- | --- |
| `ui`, `area`, `page`, `component` (with `slot` and `action` params), `state`, `derived`, lambdas, `match`, `match await` | 57 primitives: layout, forms, display. | today |
| `store` with `persist: local` | Shared client state that survives a reload. | today |
| `action`, calls to the API, `navigate` | Named handlers. | today |
| Scaffolded pages (`scaffold`): list, details, new, workflow forms, home with dashboard tiles | Full bodies as plain source; `unfold` ejects them. | today |
| Design packs (`designs/<family>/<vNN>`) | React, Vue, Svelte, Angular packs are template trees; HEEx packs own the shell; Feliz and Flutter self-host. | today |
| Data cache | TanStack Query v5 on the four web targets (stale after 5 s, one retry); a single HTTP seam on Flutter. | today |
| `component X(…) extern`, `function f(…) extern` | Hand-written UI units on every target. | today, changing |
| i18n: `t()`, catalog, `ddd i18n sync` |  | today |
| Frontend Contract (`ddd emit-frontend-contract`) | The resolved UI plus the wire surface a frontend emits from; the "OpenAPI for the UI". | today |
| `use order = SalesApi.getOrderById(id)`, `enabled: can o.ship()` | Typed data and gate bindings against the api. | coming |
| `frame: Frame { banner, nav, footer, … }`, `subframe:`, `Nav`, `NavLink`, typed page references `Area.Page(args)` | Replaces `layout`, `menu {}` and the hidden per-target shells. | coming |
| Three-layer rule: primitive only for a new capability; else a Loom `component`; else a macro | New primitives land on React first; every other target refuses with a dated diagnostic. | coming |
| Create forms and server-filled defaults | A default the server fills (`now()`, `currentUser.*`) is not pre-filled: the field shows "set when saved" and is sent absent. Literal and enum defaults stay pre-filled. | coming |

**Limits to know.** One `ui` renders in one framework. A ui over several backends must sit behind a gateway. Whole pages are never hand-written; components and functions are.

## 10. Integration: hand-written code, ports, resources

Anything Loom does not model is reached through a typed seam, and the generated wrapper keeps the guarantees around it. Today's `extern` works with older spellings.

```text
context Billing {
  error CardDeclined { reason: string }
  port PaymentGateway {
    effect charge(token: string, amount: money): ChargeRef or CardDeclined | GatewayUnavailable
    read   quote(amount: money): money
  }
  commandHandler ChargeInvoiceHandler(cmd: ChargeInvoice): string or CardDeclined extern { requires currentUser.role == "billing" }
}
adapter StripeGateway for Billing.PaymentGateway extern { use: stripeApi  config { apiKey: secret } }
adapter FakeGateway   for Billing.PaymentGateway { charge(token, amount) = ChargeRef { id: "ch_" + token } }
deployable api { … adapters: [StripeGateway] }
```

| Construct | Rule | When |
| --- | --- | --- |
| Hand-writable units | Command handler body, query handler body, aggregate operation body, port adapter, UI function, UI component. Never: domain services, workflow steps, reactions, projection folds, raw SQL reads, whole pages. | coming |
| `… extern { gates }` after the signature | The wrapper enforces `requires`, preconditions, invariants, parsing, the unit of work, tenant-scoped repositories, audit, and answers 501 for an unfilled stub. | coming |
| One context object passed in | Own repositories, typed `emit`, `queries` to any context in the deployable, `user`, `tenant`, `log`, `idempotencyKey`, declared ports. Not reachable: a raw connection, other contexts' repositories, sending commands. | coming |
| `port` + `adapter` + deployable `adapters:` | Each operation is `read` or `effect`; results are `T or E` and must be matched; one adapter per port per deployable; a Loom-written fake makes the deployable test-only. | coming |
| `resource` kinds: objectStore, queue, api, email | The untyped `restApi` verbs stay; an `api` call answers opaque `json` today. | today |
| Inbound webhooks | An ordinary route with `raw body` and `header` bindings on a handler that `requires true`. Under tenancy the handler has no tenant: it looks the tenant up from the payload and writes inside `as tenant o { … }`. For providers that need a fast answer, the documented pattern is to store the payload and raise an event, and a reaction does the tenant work. | coming |
| Outbound webhooks, foreign message formats | A hand-written adapter behind a port. | coming |
| `File` + objectStore, `FileUpload` | A file is readable only through the row that holds it. | today, changing |
| Regeneration over edits: `generate --merge`, `--check`, `.loomignore`, `eject`, `scaffold --print` | Git is the record of what was generated; no ledger. Loom never edits a user's file. | coming |

What the wrapper cannot enforce is documented only: a hand-written body that filters wrongly inside its own tenant, or returns wrong data.

## 11. Evolution: schema, contracts, compatibility

Schema change is tooling, not language: the model says what the data is now, and `ddd migrate add` records the difference as the next entry of a committed chain. There are no versions on events, records or workflows; a changed shape gets a new name.

| Topic | Rule | When |
| --- | --- | --- |
| Migration chain | `migrate add / status / remove / rebase`; `generate` renders the chain and refuses unrecorded changes. One derived `MigrationsIR`, rendered per backend. | today |
| Destructive changes | Refused without `--allow-destructive` (the breaking-for-data gate). A rename is classed compatible. | today |
| Adding a required column | Added with a default, and the default is dropped in the same migration. | today |
| `ddd diff` | Classifies compatible / breaking-for-clients / breaking-for-data against the chain, a baseline file or a git ref. | today, changing |
| Changed event or workflow shape | A new name; the old one stays declared. No `v2`, no upcasters. | coming |
| Published records and events across deployables | No check: a separately deployed consumer breaking is reported by no tool. An accepted, stated downside. | coming |

## 12. Testing, tooling and artifacts

Tests are part of the model, and where a test runs is derived from its target: against a backend it becomes HTTP calls, against a web deployable it becomes Playwright through page objects.

| Item | Notes | When |
| --- | --- | --- |
| `test "…" for Agg { … expect(…) }`, `test e2e "…" against <deployable>`, `verifies TC-…` | Unit tests run in each backend's language; `expect(call).toThrow(precondition \| invariant)` pins which rule refused. | today |
| `settle`, fault injection (`crash after step`, `fail step … with`, `fail send`), `toPark` | For durable listeners and runs. | coming |
| Test clock |  | coming |
| `ddd verify` | Joins test results onto requirements for Definition-of-Done verdicts. | today |
| CLI: `new`, `parse`, `generate system`, `scaffold`, `migrate`, `diff`, `snapshot`, `verify`, `trace`, `breakpoints`, `patch`, `i18n`, `emit-frontend-contract` |  | today |
| Source maps, `ddd trace`, the DAP remap layer | Map a runtime stack or a breakpoint back to `.ddd`. | today |
| Derived artifacts: mermaid, LikeC4, traceability, wire spec, provenance snapshots | No `.loom/` folder and no read-back. | today, changing |
| MCP server and the `loom_*` tool catalog, LSP with unfold, the browser playground | One transport-neutral toolkit under all of them. | today |
| Observability: a neutral log-event catalog, traces, metrics, correlation ids | Per-deployable; joining across services is done in the log stack. | today |
| Runtime image: a signed release tarball, blue/green gated by `ddd diff` | Node backends only. | coming |

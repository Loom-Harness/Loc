# Target Loom: language map

Snapshot of 2026-11-22. Each construct carries a status; a ruling is done when this text changes.

## How to read this map

This is one description of the language Loom is heading to, with a status on every construct. "Target Loom" means today's compiler, plus every open design issue, plus the owner rulings log (#5438, rows 1 to 448), plus what the design review of 2026-11-22 proposed (index issue #6476).

It is a map, not the reference. It names each construct, shows its shape in a line, and says where the design lives. The full reference is tracked in #6493; this file is its first draft.

| Status | Meaning |
| --- | --- |
| **Shipped** | In today's grammar and emitted on the targets. Described in `docs/`. |
| **Ruled** | The owner decided it; a ruling row or closed design note says so. Not built, or only partly. |
| **Designed** | Written up in an issue with syntax. No ruling yet. |
| **Open** | A known question with no decision. |
| **Proposed** | Raised by the review; filed as an issue under #6476. Nothing decided. |
| **Non-goal** | Deliberately not Loom's job. Someone else's job is named. |

Three cautions when reading:

- **Code fences tell you what parses.** A fence marked `ddd` parses on today's compiler (a test checks it). A plain-text fence shows ruled or designed syntax.
- **Syntax marked Ruled or Designed does not parse today.** Spellings can still move; several are listed as open in their own design notes.
- **Row numbers** ("row 402") are rows of the rulings log #5438. **Letter-number ids** (E3, K3, N6) are rulings inside a design note: E = eventing (#4068), K = compensation (#6185), N = authorization narrowing (#6283), A to G = boundaries (#4051).
- **Shipped is stated from the docs and from spot checks on main**, not from a full audit. Where I verified a thing on the compiler, the text says so.

Sources: `docs/` on main at 6909c93f, the open `vision` issues, the rulings log, the six simulated case studies and four verification passes of the review, and the owner's corrections during it.

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

| Construct | What it is | Status |
| --- | --- | --- |
| `system`, `subdomain`, `context` (`module`) | Grouping. A subdomain only groups contexts and holds the permissions catalogue; no visibility rule depends on it (boundaries E1). | Shipped |
| Internal by default, `published` | A context's declarations are invisible outside it unless marked `published`. Publishable: value objects, enums, records, events. Never operations, handlers, workflows, repositories, projections, criteria. | Ruled (rows 187 to 210, #6250). Not built. |
| `Context.Name` qualification | A foreign declaration is written qualified outside its context; bare inside. | Ruled (row 189) |
| Root-level declarations | The ambient shared kernel: bare names everywhere. | Shipped. A real `kernel` block with `uses` is Open (#6255, S1). |
| `api X { route … }` | An api is exactly its route lines. `with scaffoldApi(of: …)` writes them; unfold and delete a line to stop serving it. | Ruled (#4053). Today: `api X from <Subdomain>`, which is removed. |
| `deployable` | `platform:`, `contexts:`, `dataSources:`, `serves:` (required; `serves: none` allowed), `channels:`, `adapters:`, `auth:`. | Shipped, except `serves:` required, `adapters:` (Ruled) |
| `storage`, `resource` | Infrastructure a context uses: state, objectStore, queue, api, email. | Shipped (`docs/resources.md`) |
| `platform: gateway`, `gathers: [a at "/", b at "/ops"]` | One front door over several web deployables on the same backend; one login; full page load between parts. | Slice 1 landed and is refused at generate (`loom.reserved-not-emitted`); slices 2 to 5 wait (#6136) |
| `setting name: T = default` | A typed deploy-time value a context declares and domain code reads; env > deployable `settings:` > default. | Designed (#6236) |
| `version N` | The model names the language version it targets; mismatch stops the compile. | Designed (#6235) |
| `library` | A pure package: value objects, enums, payloads, functions, tests. No aggregates or I/O. | Designed (#5903) |
| `import` | Plain file loading into one global scope. | Shipped. Packages and versions: Open. |
| Generated layout | One project per deployable, folders by context (`host/ platform/ kernel/ <ctx>/{published,domain,db,http,handlers}`) with an import census. One migration chain per context. | Ruled (row 208, #5377, #5380). `directoryLayout:` goes. |

**Targets.** Five backends (node/Hono, .NET, Elixir/Phoenix, Python/FastAPI, Java/Spring) and seven UI targets (React, Vue, Svelte, Angular, Feliz, Flutter, LiveView). All Shipped. Row 29 rules that targets are not dropped or tiered. A Go backend (#6051) and Blazor (#6052) are Designed, out of tree.

**What is not here.** No package manager for models (a monorepo is the expected shape). No multi-project build per deployable (row 208). One frontend over several backends is not covered by the gateway (#3333).

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

| Construct | Notes | Status |
| --- | --- | --- |
| `aggregate`, entity parts, `valueobject`, `enum`, `event` | Parts are contained and saved with their aggregate. Cross-aggregate links are `X id` (and `X id[]` for a join table). | Shipped |
| `invariant [name:] expr [when …]` | Checked after every operation. On a value object it is input validation (422); on an aggregate a violation is a bug (500). | Shipped |
| `operation`, `when` gate, `precondition [name:] expr`, `emit` | `requires` 403, then `when` 409, then `precondition` 422. | Shipped |
| `unique (a, b)` | A database unique index; 409 on conflict. The one cross-row guarantee in the language. | Shipped |
| `derived` fields, defaults, `managed`, `immutable`, `internal`, `private`, `token` | Field modifiers. `token` round-trips as an optimistic-concurrency value. | Shipped |
| `function`, `domainService` | Pure calculators; a domain service may read. Never hand-written (row 261). | Shipped |
| `criterion Name(params) of T = predicate` | A reusable, queryable predicate. | Shipped. Criteria as runtime values (`allOf`, `anyOf`, `Repo.run(c)`): Designed (#4165) |
| Abstract aggregates, `extends`, TPC / TPH | Polymorphic `find all <Base>`. | Shipped (`docs/inheritance.md`) |
| Abstract `domainService` with `implementations` | A closed, ordered set of strategies inside one context. | Designed (#4786) |

### Capabilities and macros

| Construct | Notes | Status |
| --- | --- | --- |
| `auditable`, `softDeletable`, `versioned`, `tenantOwned`, `tenantRegistry` | Prelude mixins: fields plus a stamp and a filter. | Shipped |
| `crudish`, `scaffoldHandlers`, `scaffoldApi`, `scaffold`, `scaffoldDashboard` | Macros that expand to plain `.ddd`; `unfold` prints the source. | Shipped |
| `shareable` | Emits a sibling `<Agg>Share` aggregate and a `SharedWithMe` policy function. | Shipped |
| `implements tenantMembership`, `implements accessRecord` | Per-tenant person record; access log for org switches. | Ruled (#4969, row 248) |
| Macro model v2: sibling emission, new hosts (`payload`, `valueobject`, `event`, `function`, `test`, `library`) | Prerequisite for most new macros. | Designed (#6000) |
| Loom-written macros (`macro` in a `library`, `quote { }`) | Two competing shapes; neither chosen. | Open (#6053) |
| `reservedBy`, reservation counter, `tree(parent)`, `customFields` | The stock answers the review found missing. See section 13. | Proposed (#6477, #6478, #6483, #6484) |

### Persistence kinds

| Construct | Notes | Status |
| --- | --- | --- |
| State-stored (default) | One row per aggregate, parts in child tables. | Shipped |
| Event-sourced (`persistedAs: eventLog`, `apply`) | The append-only kind. Stored events are compatibility-checked (E21): a field removal is refused; the fix is a new event name. | Shipped. `every` / `retain` snapshot knobs parse and are not realised. |
| Document persistence, `persistence:` adapters per backend | The one realization axis left besides layout. | Shipped |
| `seq: long sequence from 1001` | A human-readable number from a database sequence (unique, not gapless). | Designed (#3841) |
| Effective-dated (bitemporal) aggregates | `Repo.asOf(id, date)`. | Far future (#5218); extern until then |

### Types and values

| Construct | Notes | Status |
| --- | --- | --- |
| Scalars (`string`, `int`, `long`, `decimal`, `bool`, `date`, `datetime`, `guid`, `json`, `money`), `File`, `T?`, `T[]` | One absence model: `T?`. Presence is not a type; an update is a JSON Merge Patch. | Shipped (absence model Ruled, #4120) |
| `A or E`, `payload Foo = A \| B` | Unions with a tagged `type` on the wire. A returned `E` must be matched and rolls the unit of work back. | Shipped |
| `Money { amount, currency }`, `Currency` enum | Mixed currencies are a runtime 422. `money` stays the bare amount. | Ruled (#4135). No allocate/split, no FX. |
| `s.toInt()` etc. returning `T or ParseError` | Parsing must be matched. | Ruled (row 175, #6006), in progress |
| Date arithmetic (`addDays`, `addMonths`, `startOfMonth`, `toDays()`), `.format(pattern)`, `padStart` | UTC until time zones are designed. | Ruled (rows 169 to 178) |
| One sort order: text by code point, enums alphabetical by name, empty last | Database and in-memory agree. Enum order is not declaration order, which the review flagged for status columns. | Ruled (row 173, #6010) |
| Structural assignability for payload-family records | Same field names fit; anything else goes through `mapsFrom`. | Ruled (#5996) |
| `bytes` | `bytea`, base64 on the wire, a declared maximum size. | Ruled (rows 291, 377) |
| `x.copy(field: v)`, named field checks (`isIban()`, `isEmail()`), `markdown` scalar, maps (`V by K`), `text`, nested `match` patterns, hashing | The library sub-language and stdlib growth. | Designed (#6001, #6005, #6063, #5905 to #5907, #6009) |
| Time zones (`zoned` values, tenant zone, cron in a zone) | Today everything is UTC. | Open (#5810): one of the seven real remaining design items |
| `geo`, `localized string`, `Recurrence` | Value types the case studies needed. | Proposed (#6487) |
| User generics, function-typed parameters, refinement types, a `?` operator |  | Non-goal (#5901, #4120) |

## 3. Commands, queries, routes and the wire

Every entry into a context is one declared record handled by exactly one handler, and a route only says which record an HTTP call sends. This is the command model; it is ruled and its first waves are being built.

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

| Construct | Rule | Status |
| --- | --- | --- |
| `command X { }` + `commandHandler XHandler(cmd: X)` | One record per handler; zero or two handlers is refused. A handler changes one aggregate type and does not send commands. | Ruled (rows 129, 16/22/28/32 of the #6185 note). Wave 0 and 1 released (row 409). |
| `query Q { }` + `queryHandler` | Reads only; runs now. | Ruled |
| `route METHOD "path" send Ctx.Record` | Path placeholders, body and query string bind to record fields by name. `raw body` and `header "…"` bindings exist for webhooks. | Ruled (rows 146, 352, 376). Replaces `-> Ctx.Handler`. |
| `response <Agg>Response`, `payload`, `error E`, `paged T` | The wire shape is the declared response record; nothing is derived implicitly. | Shipped (records). Explicit-only rule: Ruled (row 95). |
| Statically typed in-process command bus on every backend | Real dispatch, not inlining. | Ruled (row 153, #6230, #6224) |
| No built-in domain endpoints | History, gate probes (`can o.ship()`), workflow instances and projection reads are scaffolded records an api must route. | Ruled (row 101) |
| `requires true` on a handler | Admits an anonymous caller on an authenticated deployable: the per-route allowlist, and how a public webhook is served. | Ruled (row 353) |
| Failure model | Absence `T?`; validation 422; `precondition` 422; expected failure `A or E` with `httpStatus`; aggregate invariant 500; version or gate conflict 409. No exceptions in the language. | Ruled (#4120) |
| `error E { } message \`…{field}…\`\` | A translatable message template on an error record. | Designed (#5999) |
| `rateLimited(n, per: …, by: …)` | A gate marker on a handler or workflow; 429. | Ruled direction, not started (#5758) |
| `when` on a command handler + a probe | A pure gate over the command's fields. | Designed (#4512); its `/can` route conflicts with row 101 |
| `error X recorded` | A returned error that keeps the unit of work (a declined payment that must be stored). Workaround: a first step marked `final`. | Proposed (#6507) |
| List envelope `total` | Whether a paged answer carries a count, and its cost. | Open (#3733): one of the seven real remaining items |
| Request dedupe (`Idempotency-Key`) | A repeated request returns the stored answer. | Ruled (rows 440, 444) |
| Import and export: typed rows from a file, non-JSON responses, `Content-Disposition` | Today: a `File` field plus an extern handler. | Open, design not started (#5754) |
| OpenAPI document, `contracts/wire-spec.json`, `ddd diff` | Wire changes are classified compatible or breaking. `ddd diff` misses a field dropped from a hand-written response record and removed routes (#5797). | Shipped, with that gap |

## 4. Workflows

A workflow is the only thing that changes more than one aggregate: it sends commands, and its shape decides whether they commit together or one by one with undo. All of this section is Ruled (#6185, rows 119 to 157, K1 to K10, 402) unless marked; today's workflows load and mutate aggregates directly, and 126 of 154 shipped bodies will be rewritten.

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
    send ShipOrder { id: cmd.id, carrier: "dhl" }  final
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
| `send Cmd`, other database or deployable | An outbox row; runs exactly once later; the run waits for `Done / Rejected e / Exhausted x` | The outcome must be matched |
| `step name { … }` | One transaction; every send joins | Nothing of the block |
| `transactional[(level)]` workflow | One, held from the first read. This is the multi-aggregate atomic unit. A send that cannot join is a compile error. | Nothing |
| `on` reaction, event-started `create` | One, with its inbox claim | Nothing; the trigger stays and is retried |
| Outside call (port, resource) | Never rolled back; it is a step and needs `undo` or `final` | The effect |

### Rules

| Rule | Status |
| --- | --- |
| A workflow changes aggregates only through commands: no load-and-mutate, no `Agg.create(…)` in a body. | Ruled (23) |
| A workflow is started by its start command over HTTP, or by an event (`create(e: X) by e.key`). Never called directly. | Ruled (4, 142) |
| Where a send runs depends only on where its target lives (same database: now; otherwise: outbox). | Ruled (35, 36) |
| A step followed by anything that can fail carries `undo { }` or is marked `final`. Undos run newest first; a failing undo parks the run. | Ruled (14, K5) |
| Every run has a `_workflow_run` row: position (a step name), direction, saved values, lease, status `done / failed / failed-to-undo / waiting`. After a crash the relay continues it; there is no replay and no determinism rule. | Ruled (K1) |
| A workflow's `create` runs fully inside the request; the answer is `202 Accepted` with `Location: /runs/<id>`, and a generated run-read route serves the status and result. | Ruled (K3, rows 225, 402). What 202 means for scaffolded pages and the generated client is Open. |
| No automatic retry of a lost version race or a refused serializable commit inside a request: 409 or 503, the client decides. No lock construct; row-version checks only. | Ruled (rows 119, 120, 375; #3749) |
| Removing or renaming a step that has runs is refused by the breaking-for-data gate; the fix is a new workflow name. | Ruled (K10) |
| Stateless reaction: a workflow with no fields and only keyless `on` entries. No state table, no run, sends are fire-and-forget to the dead letters. | Ruled (E18, row 351) |
| Stateful workflow: fields, an instance row per key, `by` on every event entry. | Shipped (shape); `by` required Ruled (E19) |
| Test statements: `settle`, `expect(settle).toPark(W.step)`, `crash after step s`, `fail step s with E {…}`, `fail send X`. | Ruled (K6) |

### Not settled

| Item | Status |
| --- | --- |
| Steps inside a loop (`for p in e.legs { step book {…} undo {…} }`). Recommended: one loop level, sequential. Needs a value array as a `for` source (#6275). | Open |
| Spellings: the statement that fails a run with a declared error (`fail E`), outcome arm names, `undo` / `final` on a one-line send, the run-read expression. | Open (S3 to S6) |
| Per-instance time: a wait, a wait for an event with a timeout, a scheduled send. Today a deadline is a date column plus a cron tick and a sweep. | Proposed (#6504). The owner said sagas and timers are planned; the record (D-TIME-AS-EVENT) does not say so yet. |
| Extensions: `command X extensible`, `extension … of Ctx.Cmd`, `after Cmd(…) transactional`. Parked, and written against removed spellings. | Designed, parked (#4509 to #4516) |
| A retry policy in the model for ports and durable sends (E25 fixes one per deployment). | Proposed (#6512) |

## 5. Events, channels and time

Every server-side listener is durable, with no knob: an event's commit writes one outbox row per listener, and each listener runs afterwards in its own transaction until it succeeds or parks. The design is closed (#4068, E1 to E36; rows 158 to 217) and not built; it is wave 5, after stateless reactions. Today's channels (`channel`, `channelSource`, `delivery:`, `retention:`) ship and will be replaced.

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

| Construct | Rule | Status |
| --- | --- | --- |
| `event`, `published event` | Internal by default; a cross-context listener on an internal event is a compile error. No `emits` clause, no context map. | Ruled (E1, E9, E10) |
| Durable listeners | Projection fold, workflow `on`, event-started `create`, reaction. Retried with backoff (5 attempts, to 30 s), then that listener's row parks. The HTTP reply does not wait. | Ruled (E3 to E5, E25) |
| Ordering | Per listener and per key (`by`); a parked row holds back later rows of that key. Keyless listeners are unordered. Order among listeners is undefined. | Ruled (E6) |
| One `_outbox` for events and sent commands; `_inbox` for claims | Columns include `order_key`, `tenant`, `correlation_id`, `causation_id`, `origin`, `reply_to_run`. | Ruled (E23, row 366) |
| `channel X { carries: … over: <broker> }` + deployable `channels:` | A named broker route. Four compile errors keep listings honest. A channel no deployable reads publishes to the outside. Redis Streams, RabbitMQ, Kafka. | Ruled (E11, E13, E32). Today's knobs go. |
| `on(e: X, meta: EventMeta)` | `id, occurredAt, tenant, producer, causationId, correlationId`. | Ruled (E22) |
| Dead-letter routes | List, retry, discard, per listener and per event, gated by a model permission; none generated without the clause. Tenant-scoped by default. | Ruled (#6248, row 255) |
| Browser listeners | The ui listens to published events directly; no ui channel. A listener may only `toast` and `refetch`. A payload-free notice per read model drives `on <ReadModel>.updated`. On reconnect, one refetch; no replay. | Ruled (E12 to E16, E20). #6310 rev 5 still writes a ui `channel`: unreconciled. |
| Event tenancy | A tenant event by default; `event X crossTenant` is raised only in platform places; a timer's event must be `crossTenant`. | Ruled (rows 357 to 360, #6372) |
| Stored-event compatibility | Only event-sourced events are checked. Published events: a documented rule, no check, no versions, no upcasters. | Ruled (E21, E35) |
| `timerSource` / `cron:` | A tick is an ordinary event carrying `at`. One tick per scheduled time across replicas, UTC, one catch-up tick after downtime. | Shipped (shape); semantics Ruled (E28, E29, #5966) |
| Test clock | Tests move time. | Ruled (row 426), wave 5 |
| Per-tenant tick fan-out, a gated manual tick, a definition of `as tenant o { }` in one place | One bad row today fails the tick for every tenant. | Proposed (#6513) |
| Settled-through read on a folded projection | Ask whether a fold has caught up before billing from it. | Proposed (#6510) |
| Ordering key on a stateless reaction; browser payloads only to a declared audience | Additions while the design is unbuilt. | Proposed (#6512) |
| Retention for `_outbox`, `_inbox`, `_workflow_run`, dedupe, audit | Today "deployment config" (row 242). | Proposed (#6511) |
| Replay or rebuild of a projection from the log | "A late listener starts from now"; replay is a deliberate act with no designed mechanism. | Open (#3500) |
| Load numbers: outbox rows per event, per-key pick throughput | Listed unmeasured in the design itself. | Proposed study (#6520) |

Known delivery defects in today's output are deliberately left until the rebuild (E27): Node and Elixir lose a failed durable fold; Java and .NET notify the page before the commit.

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

| Construct | Rule | Status |
| --- | --- | --- |
| `repository`, `retrieval`, auto `findAll`, `paged`, `sort` | Filters are typed expressions. | Shipped |
| Read verbs `get` (404) / `find` (`T?`) / `getBy` / `findBy` / `all` | Replaces declared finds. Zero-argument `Repo.all()` only in a handler returning `paged`. | Ruled (#3949, row 299) |
| `criterion` | Named, reusable, pushable. | Shipped |
| Following `X id` in a read | The compiler plans a bulk load or a join; a hand-written by-ids read is two queries, not N+1. | Shipped |
| Query-time `projection` (`from / join / select`), incl. the dashboard aggregates | Aggregated in SQL. | Shipped |
| Folded `projection` | A read model updated by events, after commit. | Shipped; delivery rebuilt in section 5 |
| Projection reads `P.all()`, `P.get(key)`; workflow reads `W.instances()`, `W.instance(key)`; `Orders.history(id)` | Each is a read verb its owner contributes; the route is scaffolded. | Ruled (rows 102, 109 to 111) |
| A projection may `join` a local projection | Needed to join against a local copy of another context's data. | Gap (#6253) |
| Word search: `matches(q, title, author)`, `sort: [relevance desc]`, a `search(…)` index | Prefix match per word, no stemming. Name collides with the regex `matches("…")`. | Designed (#6237) |
| Refused query shapes: grouping beyond the dashboard, sub-selects, some collection predicates | Workaround: a projection where the shape allows, else a reporting database outside the model. | Open (#4160, #4166, #5814): one of the seven real remaining items |
| A table of what is queryable where | One page instead of discovering it by diagnostics. | Proposed (#6498) |

### Reading another context's data

| Route | Rule | Status |
| --- | --- | --- |
| `send Catalog.GetProduct { … }` | From any body, to any context in the same deployable, under the caller's principal. To another deployable: refused. Query cycles between contexts: refused. | Ruled (rows 204, 205, #6252) |
| A local copy folded from published events | The cross-deployable answer. | Ruled; needs #6253 to be joinable |
| An `api` resource or a port | For another deployable or an outside system. | Shipped (untyped), typed ports Ruled |
| A projection that joins another context's aggregate | Refused: `loom.projection-foreign-source`. | Ruled (rows 203, 207, 218) |
| Same-database optimisation of cross-context reads | **The owner confirmed on 2026-11-22 that this is intended**: when two contexts share a database, a cross-context read is compiled to one query. The record lost it; rows 203, 207 and 218 need amending. | Intended; to be re-added to the record |
| Holding another context's id (`Catalog.Product id`) | Allowed with no marker. It is an unchecked foreign id: no foreign key, no existence check, and it opens no data. | Ruled (rows 192, 315) |

### Read audit

Recording who read which row is the review's one remaining **blocker**, and only for regulated domains (health, finance). `audited read` is one line with no design, ruled "not built now" (#6285, row 251). A command per read does not work, because every other route that returns the row bypasses it. It needs to hang off the row scope, so every path is covered.

## 7. Concurrency, transactions and idempotency

Writers are separated by row versions and nothing else: there is no lock construct and no automatic retry inside a request. Data stays correct; the cost of contention lands on the client as a 409.

| Mechanism | Rule | Status |
| --- | --- | --- |
| Row version on every aggregate | A write checks the version it read. A client `If-Match` is honoured (412 on mismatch). | Shipped |
| Lost race with no `If-Match` | Answers 409; the client decides. Measured on #3749: 5% to 31% of requests on a mix with 20 hot rows. | Ruled (#3749) |
| Unit of work | Every body (handler, workflow, reaction) reads outside a transaction and writes once at the end. A lookup by id returns the in-memory row; a query by criteria does not see rows created earlier in the body. | Ruled (rule 1 of the #6185 note) |
| `transactional[(level)]` on a body | Holds the transaction from the first read. `transactional(serializable)` is the documented answer for check-then-act across rows. A refused serializable commit is not retried (503). | Ruled (rows 119, 375) |
| Multi-aggregate atomic change | A `transactional` workflow whose sends all target the same database commits them together. | Ruled (row 402) |
| `unique (…)` | The only declarative cross-row guarantee. | Shipped |
| Cross-row invariants ("no overlapping bookings") | Document now, design later; a hint on find-then-create in a non-serializable body. | Open (#5815) |
| `loom.effect-in-transaction` | A hint when an outside call precedes the commit. | Shipped (hint); widened by ruling 8 |
| Idempotency of requests | A dedupe table keyed by the request key returns the stored answer. | Ruled (rows 392, 403, 440, 444) |
| Idempotency of effects | Every port `effect` receives a generated key `(run, step, position)`, sent as `Idempotency-Key` on api resources. | Ruled (K4, plan fact `effectKey`) |
| Idempotency of listeners | An inbox mark per listener and message. | Ruled (E3) |
| Semantic lock | A `Pending` status plus a `precondition`: the documented countermeasure in place of isolation between saga steps. | Ruled (K7) |

### The stock answers to contention

These are the workarounds the review found; each bends the model a little, and each is being proposed as a library pattern so nobody has to invent it.

| Need | Answer | Status |
| --- | --- | --- |
| An invariant across rows that share a key (bookings of one practitioner on one day) | A registration aggregate per key that holds the entries as parts, so the invariant is inside one aggregate and its version serialises writers. | Works today by hand. `reservedBy` capability Proposed (#6477) |
| A hot counter (stock, seats) | A reservation aggregate that spreads the counter. | Works today by hand. Macro Proposed (#6478) |
| A decrement that should not 409 at all | The compiler derives a guarded single-statement update when an operation only does relative writes and its checks read only those fields. No new syntax. | Proposed (#6506) |
| Retry of a lost race inside the request | Safe exactly where no outside effect precedes the commit, which the compiler knows. Contradicts #3749, so it is the owner's call. | Open (in #6506) |
| A gapless number series | A counter aggregate per series; correct and contended. | By hand; sequence (not gapless) Designed (#3841) |

```ddd
operation reserve(qty: int) {
  precondition enough: available >= qty
  available -= qty
}
```

```sql
-- derived under #6506: check and change in one statement, no version predicate
UPDATE stock SET available = available - $1, version = version + 1
WHERE id = $2 AND available >= $1 RETURNING available;
```

**Non-goal.** A posting engine for truly hot accounts (a bank's ledger core). Such engines are hand-built for one use; Loom reaches one through a port or a `kind: ledger` resource (#6488).

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

| Construct | Rule | Status |
| --- | --- | --- |
| `permissions { }` with `implies`, `requires` gates, `policy { }` read ladders, named policy functions | Policy functions are inlined into SQL; must be queryable and non-recursive. | Shipped |
| Row rules `allow own`, `allow … when` | `when` reads the caller only and runs before the query. | Shipped |
| `allow local on X as x when … where …` | Narrows a role to some rows inside the tenant. A bare `allow … where` is refused: the level is always named. | Ruled (N-series, rows 310, 311; #6283, #6374) |
| `allow crossTenant [read\|write] on X as x where …` | Must be anchored on something the application stores; an identity-provider claim alone can never grant cross-tenant reach. | Ruled (rows 313, 314) |
| Absent claim | Unknown in every authorization predicate; a grant admits only on true. | Ruled (row 312) |
| `shareable` | Row sharing to an org, a subtree or a user, in any tenant; no re-sharing; masks still apply. | Shipped |
| `mask unless <caller predicate>` | Redacts a field to `null`. | Shipped |
| A marker for masked fields (`masked: […]`), and a mask predicate that reads the row | Today hidden and empty look the same. | Proposed (#6508) |
| `enforcement: denyByDefault \| opt` |  | Shipped |
| Promise register (P-1 to P-10): generated probes that tenant isolation, authorization and validation hold | Loom-side CI over fixtures. Whether an adopter's app ships the suite is not stated. | Ruled (rows 303 to 337; #6307) |
| Solver checks on policies (unreachable rule, cross-tenant leak, always-true mask) | Opt-in analysis with counterexamples. | Designed (#5922) |
| Read audit | See section 6. | Open, the one blocker (#6285) |
| History of fields tagged `sensitive` | Tagged fields stay out of audit snapshots, so regulated fields have no history. | Open (#6371): one of the seven real remaining items |

A security bug found by the review is filed: a named `policy` whose body contains `||` is inlined without parentheses under `&&` (#6471).

### Identity

**Loom is not an identity provider.** It uses one as infrastructure (Keycloak in the generated stack) through the OIDC code flow with PKCE and refresh rotation. That is Shipped.

| Item | Rule | Status |
| --- | --- | --- |
| Users, credentials, MFA, password reset, social login | The identity provider's job. | Non-goal |
| Identity is global; everything about a person is tenant-owned | `implements tenantMembership` gives `user`, `role`, `name`, `email`, `status`. No system-wide profile. `currentUser.role` is the membership role in the operating org. | Ruled (#4969 principle 6) |
| Inviting a user, creating a customer login, service accounts and scoped tokens | Calls to the provider's management API. Needs a typed port and a Keycloak adapter. | Proposed (#6485). The owner said service and scope ideas exist; today everything is user-based. |
| A signed-in caller with no tenant yet (self-service sign-up, a shop customer) | Rows 244 ("no membership: 403") and 353 (`requires true`) are unreconciled. | Open; asked in #6485 |
| Erasing a person | A gated `erase` on the membership row; audit rows are never rewritten and carry ids only. | Ruled (#4969 principles 7, 8; #5167) |

### Tenancy

| Construct | Rule | Status |
| --- | --- | --- |
| `tenancy by user.<claim> of <Registry>`, `tenantOwned`, `crossTenant`, the explicit-stance rule | Data visibility is flat: my org's rows. Rules only add to it. | Shipped |
| Registry tree (`parent: Self id?`), `organizationContext` | The tree manages sub-tenants; it plays no part in reads except subtree shares. | Shipped |
| Org switch (`x-org-context`, `OrgSwitch {}`) | Support acts under its own identity in an org it can read; a switch outside your own top org needs `x-access-reason` and writes an `AccessRecord`. Writes are stamped with the operating org. | Ruled (#4969 principles 5, 9; rows 247, 248) |
| System principal, `as tenant o { … }` | Event-started work runs as the system principal of a tenant. A tenant-less body does tenant work only inside `as tenant`. No issue defines the construct in one place. | Ruled (rows 396 to 404) |
| `ignoring tenantOwned`, `ignoring *` | Drops the floor only; never reach, deny or author filters. | Ruled (row 320) |
| Tenant-scoped folds over cross-tenant input | Three options, none chosen; the refusal stays. | Open (#4745) |
| `currentTenant` ambient, session policies, feature flags as policy functions | A flag is a `policy` over the registry row. | Designed, parked (#4510, #4511) |
| `distribution: byTenant` (Citus-style schema) | Loom shapes keys and DDL; no runtime routing. | Designed (#4968) |
| Tenant off-boarding and export | A completeness census, so a new aggregate is not silently left behind, and a set-based delete. | Proposed (#6509): one of the seven real remaining items |
| Tenant-defined fields | `customFields` with filtering and form binding; today a `json` field and a hand-written form. | Proposed (#6484): one of the seven |
| Row-level security in Postgres as a second layer | Defence in depth; low priority. | Proposed (#6518) |

Rejected and recorded so they are not proposed again: a materialised path or closure table for the org tree, `deep` / `global` / `inherited` visibility, a Zanzibar-style relation graph, a platform principal or root-org flag, a system-wide user profile, application-level shard routing.

## 9. UI language

Pages are written in a closed library of primitives and rendered by one shared walker on seven targets; a design pack decides how each primitive looks. The UI never runs domain logic: it consumes the wire.

```text
ui Web with scaffold(api: SalesApi) {
  store Draft persist: local { state { lines: Line[] = [] } }
  page Orders { route: "/orders"
    state { status: OrderStatus? }
    action cancel(o: Order) { match await o.cancel() { Ok => Toasts.show("Cancelled")  Conflict c => … } }
    body: Stack { SelectField { "Status", value: status },
                  Table { rows: api.Sales.Order.byStatus(status), Column { … } } } }
}
```

| Construct | Notes | Status |
| --- | --- | --- |
| `ui`, `area`, `page`, `component` (with `slot` and `action` params), `state`, `derived`, lambdas, `match`, `match await` | 57 primitives: layout, forms, display. | Shipped. Slot and action params on Feliz and Angular: in progress (#6034, #6035) |
| `store` with `persist: local` | Shared client state that survives a reload. | Shipped |
| `action`, calls to the API, `navigate` | Named handlers. | Shipped |
| Scaffolded pages (`scaffold`): list, details, new, workflow forms, home with dashboard tiles | Full bodies as plain source; `unfold` ejects them. | Shipped |
| Design packs (`designs/<family>/<vNN>`) | React, Vue, Svelte, Angular packs are template trees; HEEx packs own the shell; Feliz and Flutter self-host. | Shipped |
| Data cache | TanStack Query v5 on the four web targets (stale after 5 s, one retry); a single HTTP seam on Flutter. | Shipped |
| `component X(…) extern`, `function f(…) extern` | Hand-written UI units on every target. | Shipped (old spelling); new spelling Ruled (#4066) |
| i18n: `t()`, catalog, `ddd i18n sync` |  | Shipped |
| Frontend Contract (`ddd emit-frontend-contract`) | The resolved UI plus the wire surface a frontend emits from; the "OpenAPI for the UI". | Shipped |
| `use order = SalesApi.getOrderById(id)`, `enabled: can o.ship()` | Typed data and gate bindings against the api. | Ruled (merged plan) |
| Providers: `provider`, `provide`, `uses`; built-ins `Session`, `Locale`, `Router`, `Toasts`, `Theme`, `DataCache` | The application root as an ordered list of providers, replaceable through an interface. | Designed with owner decisions per revision (#6310 rev 5) |
| `frame: Frame { banner, nav, footer, … }`, `subframe:`, `Nav`, `NavLink`, typed page references `Area.Page(args)` | Replaces `layout`, `menu {}` and the hidden per-target shells. | Designed (#6310) |
| Three-layer rule: primitive only for a new capability; else a Loom `component`; else a macro | New primitives land on React first; every other target refuses with a dated diagnostic. | Ruled direction (#6033) |
| New primitives: `DropZone` / `Draggable`, `DateField`, `Tooltip`, `Popover`, `DropdownMenu`, `Progress`, `Markdown`, `TreeView`, `Calendar`, `CodeEditor`, `SplitPane`, `Frame` (iframe) | `Frame` names two different primitives (#6065 and #6310). | Designed (#6039 to #6065) |
| Stdlib components: `Board`, `Lane`, `FilterBar`, `ConfirmAction`, `RelatedSection`, `DetailView`, `MasterDetail`; `kanban X by status card C` | Plain Loom source shipped with the toolchain. | Designed (#6036, #6044 to #6046) |
| `DataGrid` on Flutter and LiveView | Refused honestly today. | Gap (#4556, #4557) |
| Create forms pre-filling server-sourced defaults |  | Open, "not now" (#6208, row 108) |
| An operations ui (runs, dead letters, parked rows) | A scaffold over the generated operations routes. | Proposed (#6486) |
| Public pages on LiveView: SEO props emitted, expressions in them, a public cache policy | LiveView is the one server-rendered target, so it is the answer for a storefront. | Proposed (#6517) |

### Offline, in three sizes

| Size | What it takes | Status |
| --- | --- | --- |
| Capture offline, send later, read what was last seen | An explicit outbox: unsent command records in a `store persist: local`, a page that lists them. Missing enablers: a `Connectivity` provider, a non-click trigger, a drain loop in an action, an instance command addressed by id from a store, a persisted read cache. | Pattern works in part today. Enablers Proposed (#6514) |
| Create a thing offline and keep working on it | Client-supplied ids on create; local apply of queued commands. | Proposed (#6515) |
| A local replica that stays current, with conflict handling | Evaluate an existing sync engine driven by the row rules before designing a feed on five backends. Possibly not a target at all. | Proposed study (#6516) |

**Limits to know.** One `ui` renders in one framework (rows 78 to 81). One frontend talks to one backend. Whole pages are never hand-written; components and functions are. Reviewer concerns on #6310 about keeping a frame mounted on Flutter and LiveView are recorded and not resolved.

## 10. Integration: hand-written code, ports, resources

Anything Loom does not model is reached through a typed seam, and the generated wrapper keeps the guarantees around it. The escape-hatch design is closed (#4066, X1 to X40; rows 259 to 298); today's `extern` ships with older spellings.

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

| Construct | Rule | Status |
| --- | --- | --- |
| Hand-writable units | Command handler body, query handler body, aggregate operation body, port adapter, UI function, UI component. Never: domain services, workflow steps, reactions, projection folds, raw SQL reads, whole pages. | Ruled (X-series) |
| `… extern { gates }` after the signature | The wrapper enforces `requires`, preconditions, invariants, parsing, the unit of work, tenant-scoped repositories, audit, and answers 501 for an unfilled stub. | Ruled. Shipped with `extern` before the signature and `from "path"`. |
| One context object passed in | Own repositories, typed `emit`, `queries` to any context in the deployable, `user`, `tenant`, `log`, `idempotencyKey`, declared ports. Not reachable: a raw connection, other contexts' repositories, sending commands. | Ruled (plan fact `hatchContract`) |
| `port` + `adapter` + deployable `adapters:` | Each operation is `read` or `effect`; results are `T or E` and must be matched; one adapter per port per deployable; a Loom-written fake makes the deployable test-only. | Ruled (#3501, #6368). Wave 4. |
| `resource` kinds: objectStore, queue, api, email | The untyped `restApi` verbs stay; an `api` call answers opaque `json` today. | Shipped. Typed responses: Open (#3358) |
| Inbound webhooks | An ordinary route with `raw body` and `header` bindings on a handler that `requires true`. Under tenancy the handler has no tenant: it stores the payload cross-tenant and a reaction does the tenant work inside `as tenant`. | Ruled pieces (rows 352, 353, 430). Inbox macro Proposed (#6481) |
| Outbound webhooks, foreign message formats | A hand-written adapter behind a port. | By hand |
| `File` + objectStore, `FileUpload` | A file is readable only through the row that holds it. | Shipped; the row rule Ruled (row 327, N11) |
| `document X for Agg { template, format: pdf }` | Generated documents from a typed template. | Designed (#5217) |
| Regeneration over edits: `generate --merge`, `--check`, `.loomignore`, `ddd eject`, `ddd scaffold --print` | Git is the record of what was generated; no ledger. Loom never edits a user's file. | Ruled (#5395); minimal version claimed |
| Identity-provider management, a ledger engine, search, rate limiting at the edge | Each behind a port or a resource kind. | Proposed (#6485, #6488); search Designed (#6237); `rateLimited` Ruled direction |

What the wrapper cannot enforce is documented only: a hand-written body that filters wrongly inside its own tenant, or returns wrong data (#5216).

## 11. Evolution: schema, contracts, compatibility

Schema change is tooling, not language: the model says what the data is now, and `ddd migrate add` records the difference as the next entry of a committed chain. There are no versions on events, records or workflows; a changed shape gets a new name.

| Topic | Rule | Status |
| --- | --- | --- |
| Migration chain | `migrate add / status / remove / rebase`; `generate` renders the chain and refuses unrecorded changes. One derived `MigrationsIR`, rendered per backend. | Shipped |
| Destructive changes | Refused without `--allow-destructive` (the breaking-for-data gate). A rename is classed compatible. | Shipped |
| Adding a required column | Added with a default, and the default is dropped in the same migration. | Shipped |
| Refuse a new column that has no default | The owner's rule from the review: add with a default, maybe remove it later; the tool should insist. | Proposed (#6489) |
| `ddd migrate verify`, migrations run outside app boot | Check a chain against a real database; run migrations as a job, not at start-up. | Proposed (#6492, #6491) |
| `ddd diff` | Classifies compatible / breaking-for-clients / breaking-for-data against the chain, a baseline file or a git ref. | Shipped; misses a dropped response field and removed routes (#5797) |
| Contract check against the deployed release | Compare against what is running, not only the last commit. | Proposed (#6490) |
| Changed event or workflow shape | A new name; the old one stays declared. No `v2`, no upcasters. | Ruled (E21, E35, K10) |
| Published records and events across deployables | No check: a separately deployed consumer breaking is reported by no tool. An accepted, stated downside. | Ruled (rows 202, E35) |
| Language changes | Clean breaks: every model in the repository is rewritten in the same change; no codemod, no warning period. Two rewrite windows are planned. | Ruled (rows 59, 63, 386) |
| A compatibility policy for the language itself | Owed once the surface settles and before the first model lives outside this repository. | Filed (#6454) |
| `version N` in the model | Names the language version; a change list per version, not a codemod. | Designed (#6235) |
| Tenant off-boarding and export | See section 8. | Proposed (#6509) |
| Retention of tool tables | See section 5. | Proposed (#6511) |
| Squash merges dropping generated ancestry; a changed hook signature compiling silently on Node and Python | Known limits of `--merge`. | Deferred (#5395) |

## 12. Testing, tooling and artifacts

Tests are part of the model, and where a test runs is derived from its target: against a backend it becomes HTTP calls, against a web deployable it becomes Playwright through page objects.

| Item | Notes | Status |
| --- | --- | --- |
| `test "…" for Agg { … expect(…) }`, `test e2e "…" against <deployable>`, `verifies TC-…` | Unit tests run in each backend's language; `expect(call).toThrow(precondition \| invariant)` pins which rule refused. | Shipped |
| `settle`, fault injection (`crash after step`, `fail step … with`, `fail send`), `toPark` | For durable listeners and runs. | Ruled (E17, K6) |
| Test clock |  | Ruled (row 426), wave 5 |
| `given(o: Order, total: …)` test macro, `forAll`, `cases` | Derived fixtures and property tests. A derived value is only shape-valid; invariants fail at runtime. | Designed (#6003, #5914) |
| `provide Session = signedIn(user: …)` in a test | UI tests bind providers. | Designed (#6310) |
| `ddd verify` | Joins test results onto requirements for Definition-of-Done verdicts. Checked `verifies` is Proposed (#6501). | Shipped |
| CLI: `new`, `parse`, `generate system`, `scaffold`, `migrate`, `diff`, `snapshot`, `verify`, `trace`, `breakpoints`, `patch`, `i18n`, `emit-frontend-contract` |  | Shipped |
| Source maps, `ddd trace`, the DAP remap layer | Map a runtime stack or a breakpoint back to `.ddd`. Source maps on by default is Proposed (#6501). | Shipped (opt-in) |
| Derived artifacts: mermaid, LikeC4, traceability, wire spec, provenance snapshots | No `.loom/` folder and no read-back (rows 17, 75). | Shipped; folder move Ruled |
| MCP server and the `loom_*` tool catalog, LSP with unfold, the browser playground | One transport-neutral toolkit under all of them. | Shipped |
| Observability: a neutral log-event catalog, traces, metrics, correlation ids | Per-deployable; joining across services is done in the log stack. | Shipped |
| Topology and cost facts (`topology.json`, per-use-case hop counts) | Compare architecture variants. | Designed (#4907 to #4912) |
| Runtime image: a signed release tarball, blue/green gated by `ddd diff` | Node backends only. | Ruled (#5574) |
| Hosted compile service; macros expand server-side; no offline deep validate in that product shape | A product decision, not a language one. | Ruled (#5264) |

### Documentation the review found missing

Most of the review's 24 overturned claims came from reading the target at two removes. These pages would have prevented them; all are Proposed.

| Page | Issue |
| --- | --- |
| A target language reference (this map, grown up) | #6493 |
| "How do I…" index that starts from a need | #6494 |
| "What Loom does not do", with whose job each thing is | #6495 |
| The runtime model: what commits when, what is retried, what a request waits for | #6496 |
| Status markers generated from the code, and a support table per target | #6497 |
| What is queryable where | #6498 |
| Four contradictions between docs pages | #6499 |
| Worked examples of the hard cases | #6500 |
| One case study built end to end on the real compiler | #6519 |

## 13. Patterns: the stock answer to a common need

Most of what the six case studies first reported as missing has an answer in the language already; what is missing is the answer written down, or packaged as a macro. This table is the need-first index.

| Need | Answer in Target Loom | Packaged as |
| --- | --- | --- |
| No double booking; an invariant over rows sharing a key | A registration aggregate per key holding the entries as parts | `reservedBy` (#6477) |
| A hot stock or seat counter | A reservation aggregate; or the derived guarded update | #6478, #6506 |
| Something must happen at a date (trial end, reminder, hold expiry) | A due-date column, a cron tick, a sweep that sends one command per due row | `dueBy` sweep macro (#6479); per-instance timers (#6504) |
| Work over many rows (nightly billing, an import) | A sweep that commits in chunks, one page per tick | Chunked sweep (#6480) |
| Change two aggregates together | A `transactional` workflow sending both commands to the same database | In the language (row 402) |
| A multi-step process with outside calls | A workflow with `step … undo` and `final`; the run row survives a crash | In the language (K1 to K10) |
| Retry a payment for days | An attempt aggregate plus a sweep: retry modelled as state | Attempt-and-retry macro (#6482) |
| A declined payment must still be stored | Save the attempt in a first step marked `final`, decide in a second | `error X recorded` (#6507) |
| Receive a webhook for a tenant | A route with `raw body` on a `requires true` handler, stored cross-tenant, then a reaction inside `as tenant` | Webhook inbox macro (#6481) |
| Show data owned by another context | Send its published query; or fold a local copy from its published events | In the language (#6252, #6253) |
| Check a foreign id exists before saving | Send the owning context's published query in the handler | By hand; by design (row 315) |
| A category tree, an org chart | A parent id and hand-written criteria | `tree(parent)` (#6483) |
| Fields a tenant defines | A `json` field and a hand-written form | `customFields` + `DynamicFields` (#6484) |
| A feature flag per tenant | A `policy` function over the registry row | In the language |
| Staff acting for a customer | Org switch with an access reason; writes stamped with the operating org | In the language (#4969) |
| Invite a user, create a customer login, a service account | The identity provider's management API | IdP management port (#6485) |
| Hide a field from some roles | `mask unless`; a hand-written flag where hidden must differ from empty | Masked marker (#6508) |
| Work offline | An explicit outbox in a `store persist: local` | Enablers (#6514) |
| A public, indexable page | The LiveView target | #6517 |
| Search | An external index behind a port; word search in Postgres | `matches` (#6237) |
| A changed event or workflow shape | A new name; the old one stays declared | In the language (E21, K10) |
| A report the query language refuses | A projection where the shape allows; otherwise a reporting database | Open (#4160, #4166, #5814) |
| Money split and rounding | By hand with `decimal` and `round` | Not planned in Money v2 |
| A high-volume posting ledger | Not in Loom: a port to a ledger engine | `kind: ledger` (#6488) |
| Operate the system: see runs, retry dead letters | The generated operations routes | Operations ui scaffold (#6486) |

## 14. Boundaries: what Loom does not do

Loom generates a transactional business application and the wiring around it; these things are someone else's job on purpose. The boundary page for the docs is tracked in #6495.

| Not Loom's job | Whose job | How Loom reaches it |
| --- | --- | --- |
| Identity: users, credentials, MFA, sign-up flows | The identity provider (Keycloak or another) | OIDC; a management port (#6485) |
| A high-throughput posting ledger | A purpose-built ledger engine | A port or `kind: ledger` resource (#6488) |
| Full-text and faceted search at scale | A search engine | A port; simple word search in Postgres (#6237) |
| Reporting and analytics beyond projections | A reporting database or warehouse | Outside the model; published events feed it |
| Rate limiting, WAF, TLS at the edge | The gateway or ingress | `rateLimited` covers per-handler business limits only |
| Data retention schedules | Deployment configuration today (row 242) | A model setting is Proposed (#6511) |
| Sharding and connection routing | The database (a distributed Postgres) | Loom only shapes keys and DDL (#4968) |
| A package manager for models | The monorepo | `import`; `library` is Designed (#5903) |
| Arbitrary SQL, a raw connection | Nobody: deliberately unreachable from hand-written code | Typed reads; a port for the rest |
| Whole hand-written pages or services inside a deployable | A separate service next to the generated one | The generated API and published events |
| Bitemporal data, a rules engine, BPMN, a CMS | A library behind `extern`, or another system | `extern`, ports |
| Full offline replication | Possibly a sync engine, possibly nobody | Study (#6516) |

**Also deliberate, and worth knowing before proposing otherwise:** no user generics or function types; no exceptions; no locks; no automatic retry in a request; no event or record versions; no referential integrity across contexts; no dropping or tiering of targets (row 29); no built-in domain endpoints (row 101).

## 15. Open decisions and order of work

Seven design items remain where no obvious workaround exists and nothing is designed; everything else on this map is either decided or has a stock answer.

| Item | Why it has no workaround | Where |
| --- | --- | --- |
| Read audit | Every route that returns the row must be covered; a command per read is bypassed. The one blocker, for regulated domains. | #6285 |
| Time zones | Cron, `today()`, formatting and report buckets are UTC; zone arithmetic by hand covers only operation bodies. | #5810 |
| List envelope `total` | Clients depend on the envelope once it ships. | #3733 |
| Refused query shapes | The alternative is a reporting database outside the model. | #4160, #4166, #5814 |
| Tenant off-boarding and export | Only the compiler knows where a tenant's data lives. | #6509 |
| Tenant-defined fields with filtering and form binding | A `json` field has no validation, filter or report. | #6484 |
| History of fields tagged sensitive | Regulated fields are exactly the ones that need history. | #6371 |

An eighth is strategic, not a design gap: the target matrix. Every design is built five times on the server and seven on the client, and new UI primitives land on React first with dated refusals elsewhere. Row 29 keeps the matrix; the cost is build time.

### Decisions waiting for the owner

| Question | Where |
| --- | --- |
| Re-add the same-database optimisation for cross-context reads to the record (rows 203, 207, 218) | Section 6 |
| Are per-instance timers part of the target; amend D-TIME-AS-EVENT | #6504 |
| A bounded in-request retry where no effect precedes the commit (against #3749) | #6506 |
| A signed-in caller with no tenant (rows 244 vs 353) | #6485 |
| Retry policy in the model, an ordering key on stateless reactions, browser payload audience (E25, E18, E12) | #6512 |
| Refuse a new column without a default | #6489 |
| Is full offline a target at all | #6516 |
| A real shared-kernel construct | #6255 (S1) |
| Steps inside a loop | #6185 |
| Spellings: `fail E`, outcome arm names, one-line `undo` / `final`, the run read, `port` as a keyword next to `port: 3000` | S3 to S6, S14 |
| Loom-written macro shape: `quote` with typed splices, or plain functions returning text | #6053 |
| `bytes` type or string-returning hash intrinsics | #6009 |

### Inconsistencies in the record

- `Frame` names two primitives: an iframe (#6065) and the application frame (#6310). `Dropdown` and `DropdownMenu` overlap the same way.
- `matches` is both the regex field limit and the proposed word search (#6237).
- The ui `channel` binding is removed by the eventing design (E12) and used by #6310 rev 5.
- Enums sort alphabetically (row 173) while kanban lanes use declaration order (#6046).
- String length and index units are undecided (#6057) and already assumed to be code points (#6007).
- \#5261's body still reads as the agreed vision for cross-context data; #4051's closing note supersedes most of it.
- The extension sketches (#4509 to #4516) use removed spellings and put another context's body inside the host's transaction, which the command model forbids.
- Null handling has two truth tables: null-safe in queries (row 172), three-valued inside authorization (row 312).

### Order of work

The ruled build order is waves 0 to 6 (row 385): 0 command records and dispatch; 1 workflows on the dispatcher; 2 remaining grammar and safety; 3 the two source-rewrite windows; 4 layout by context, ports, identity runtime; 5 eventing; 6 durable compensation. Waves 0 and 1 are released.

What the review would slot in, cheapest first:

1. **Write things down** (no code): the runtime model, the boundary page, the need-first index, the queryable-where table (#6494 to #6498). These would have removed most of the review's wrong findings.
2. **Package the stock answers** as macros: registration, reservation counter, due-date sweep, chunked sweep, webhook inbox (#6477 to #6481). Each turns a "costly" finding into "later".
3. **Add lines to designs that are not built yet**, while it is free: per-instance waits on the run row (#6504), settled-through reads and the additions in #6512 on the eventing design, retention defaults (#6511).
4. **Derive, with no syntax**: the guarded update (#6506), the off-boarding census (#6509).
5. **Prove it on the compiler**: one case study built end to end (#6519), and the load measurement of the eventing design before five backends implement it (#6520).

With items 1 and 2 done, the costly findings per case study fall from 14 to 4 (SaaS billing), 9 to 1 (marketplace), 14 to 5 (clinic), 13 to 3 (banking), 14 to 5 (field service) and 5 to 3 (three-year evolution).

### Not verified

Eight small defects reported by the verification passes were not reproduced and are not filed: `Paper` drops `style`; a file-root component is not emitted on Flutter; an effect lambda is accepted in a file-root component and refused in a ui-scoped one; LiveView `navigate` with a query emits a wrong path for a page at `/`; a missing UI extern module does not stop `generate`; the docs say 56 primitives where the registry has 57; `scaffold` fails on a value-object collection with a `bool?` field; LiveView drops SEO page props (now part of #6517).

## Sources

- The review and its findings: [Target Loom design review](https://claude.ai/artifact/9gNFDDJakwDtQVPqPjr5ur); index issue [#6476](https://github.com/Loom-Harness/Loc/issues/6476).
- Rulings log: [#5438](https://github.com/Loom-Harness/Loc/issues/5438). Design notes: eventing [#4068](https://github.com/Loom-Harness/Loc/issues/4068), boundaries [#4051](https://github.com/Loom-Harness/Loc/issues/4051), command model and compensation [#6185](https://github.com/Loom-Harness/Loc/issues/6185), authorization [#6283](https://github.com/Loom-Harness/Loc/issues/6283), tenancy [#4969](https://github.com/Loom-Harness/Loc/issues/4969), escape hatches [#4066](https://github.com/Loom-Harness/Loc/issues/4066), api as contract [#4053](https://github.com/Loom-Harness/Loc/issues/4053), ui root and frame [#6310](https://github.com/Loom-Harness/Loc/issues/6310).
- Reference docs on main (`docs/`), read at commit 6909c93f.

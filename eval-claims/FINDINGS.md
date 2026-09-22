# Loom dev-experience evaluation — "Assure", a claims platform

Three iterations of an insurance/banking claims system, built the way a new
user would: `ddd new`, then grow the model, regenerate, compile, boot, and
evolve it under simulated user feedback.

Baseline: `main` @ `86628b3f` (2026-09-22). Every repro below was re-run on
that tree. Where a stack was booted, it was booted **for real** (postgres 18 +
RabbitMQ 4 + Keycloak 26 + the generated node backend), not simulated.

Severity **S1** doesn't compile/boot, silently wrong, or data-unsafe ·
**S2** blocked or expensively worked around · **S3** repeated friction ·
**S4** polish.
Class **SILENT** (`0 error(s)`, broken output) · **HONEST** (a `loom.*`
diagnostic) · **DOCUMENTED**.

| | S1 | S2 | S3 | S4 |
|---|---|---|---|---|
| count | **6** | **5** | **5** | **1** |

SILENT: 9 · HONEST-but-wrong-target: 3 · gap/friction: 5

---

# S1 — the generated tree does not compile, or is silently wrong

## F-101 · SILENT — a context with a workflow but no reactor drops the outbox dispatcher

```ddd
context Ord {
  aggregate Order with crudish { code: string  derived display: string = code }
  repository Orders for Order { }
  event OrderPlaced { order: Order id, at: datetime }
  channel Lifecycle { carries: OrderPlaced  delivery: queue  retention: work }
  workflow place {
    create(code: string) {
      let o = Order.create({ code: code })
      emit OrderPlaced { order: o.id, at: now() }
    }
  }
}
// + storage bus { type: rabbitmq }, channelSource, deployable channels: [lifeBus]
```

```
$ ddd parse            → 0 error(s), 0 warning(s).
$ ddd generate system  → 0 error(s). Wrote 48 file(s)
$ cd out/api && npm i && npx tsc --noEmit
http/index.ts(40,35): error TS2304: Cannot find name 'createOutboxDispatcher'.
index.ts(7,10): error TS2305: Module '"./http/workflows"' has no exported member 'createInProcessDispatcher'.
index.ts(7,37): error TS2305: … 'createOutboxDispatcher'.
index.ts(7,61): error TS2305: … 'startOutboxRelay'.
```

**Root cause.** `src/platform/hono/v4/workflow-builder.ts:126`

```ts
if (ctx.workflows.length === 0) return buildProducerOutboxFile(ctx, usingMikro);
```

The workflow-**less** producer shape emits the outbox machinery whenever the
context has durable events. The with-workflows path emits it only inside the
*subscription* block (`:1318-1323`), which runs per reactor. A context with a
workflow and **no** reactor emits neither — while `index.ts` / `http/index.ts`
import and call all three factories unconditionally (`emit.ts:1794-1800`,
`routes.ts:255`), keyed off "durable events exist", not "a reactor exists".
Emitter condition ≠ reference condition.

**Mutation-proved**: deleting the workflow from the same fixture restores all
three exports.

**Impact.** Any producer-only service on a broker-bound `queue`/`work` channel
— the ordinary "this service publishes, that one consumes" saga — is
uncompilable the moment it also owns one workflow. Hit on the first
`tsc --noEmit` of iteration 2. Workaround: give the context a reactor it does
not need.

---

## F-102 · SILENT — a query-time projection imports value objects from contexts the deployable does not host

20-line repro: two contexts on two deployables, one projection, one value
object in the *other* context.

```
$ ddd generate system → 0 error(s), 0 warning(s). Wrote 72 file(s)
$ cd out/api_a && npx tsc --noEmit
http/query-projections.ts(11,22): error TS2306: File 'domain/value-objects.ts' is not a module.
```

`query-projections.ts` emits `import { Addr } from "../domain/value-objects"`
where `Addr` belongs to context `B`; `api_a` hosts only `A`, so its
`value-objects.ts` is empty. The enum pool is scoped to hosted contexts
correctly — only the **value-object** pool spans the whole system.

Reproduced in the real model too (`import { Money, Coverage, BankAccount, … }`
on a deployable hosting neither `BankAccount`'s context nor its aggregate).

Any multi-deployable system with a projection is affected.

---

## F-103 · SILENT — an operation `requires` gate inlined into an event reactor: four backends, four different wrong answers

25-line repro: an aggregate operation carrying
`requires currentUser.permissions.contains(permissions.close)`, invoked from an
event-triggered workflow (`create(e: Shipped) by e.order { o.finish() }`).
`0 error(s), 0 warning(s)` on all five.

| backend | what it emits in the reactor | result |
|---|---|---|
| **node/Hono** | `if (!((currentUser.permissions).includes("d.close"))) throw …` | **TS2304 — does not compile** |
| **.NET** | `if (!((currentUser.Permissions).Contains("d.close")))` | **does not compile** |
| **java** | `if (!(currentUser.permissions().contains("d.close")))` | **does not compile** |
| **python** | `o.finish()` — the gate is **not emitted at all** (it lives only in the HTTP route) | **compiles; gate silently absent on this path** |
| **elixir** | `finish_order(o, %{})` against `def finish_order(record, params, current_user \\ nil)` → `Enum.member?(nil.permissions, …)` | **compiles; crashes at runtime on every reactor call** |

**Overlap**: PR **#2966** item 1 claims exactly this shape **for Java only**,
and locates it in `src/generator/java/emit/workflow.ts`. The same defect is
live on **node and .NET**, and python/elixir have their own two variants. This
is a cross-backend defect, not a Java one.

**And the model has no correct way to express the intent.** The three options:

| spelling | outcome |
|---|---|
| `operation markPaid() { requires <gate> … }` | the codegen defect above |
| `operation markPaid() { requires true … }` | a public, ungated `POST /claims/{id}/mark_paid` that any authenticated caller can hit |
| `private operation markPaid()` | `loom.workflow-private-operation`: "Workflows can only call public operations" |

There is no "reachable from the saga, not from the wire" operation. I shipped
`requires true` — i.e. the evaluation's own model has an unguarded state
transition because the language offers nothing better.

---

## F-104 · SILENT — `X id` is not type-checked in a `create({…})` argument, so the wrong aggregate's id can be written to a reference column

```ddd
aggregate A with crudish { code: string  derived display: string = code }
aggregate B2 with crudish { code: string  derived display: string = code }
aggregate R with crudish { a: A id  n: int }

workflow wonky2 {
  create(bid: B2 id) { let r = R.create({ a: bid, n: 1 }) }   // 0 error(s)
}
```

A **production workflow** writes a `B2 id` into a field declared `A id`.
`ddd parse` → `0 error(s), 0 warning(s)`.

The type system knows the difference everywhere else — the same confusion in an
**assignment** or a **comparison** is caught precisely:

```
error: Cannot assign 'B2 id' to 'A id'.
error: Operator '==' cannot compare 'A id' with 'B2 id'.
```

The `create` check only asks "is this a text value":

```
error: 'R.create' field 'a' expects a text value ('A id') but got 'int'.
```

so a bare `"not-a-guid"` string passes too. `create` is the one place where the
wrong id becomes a persisted row.

---

## F-105 · SILENT — operation-call arguments in a `test` body are not type-checked at all

```ddd
test "arg type confusion" for R {
  let r = R.create({ a: "s", n: 1 })
  r.retarget(42)               // retarget(x: A id)
  r.bump("not-a-number")       // bump(by: int)
  expect(r.n).toBe(1)
}
```
→ `0 error(s), 0 warning(s)`, then:
```
domain/r.test.ts(9,16): error TS2345: Argument of type 'number' is not assignable to parameter of type 'AId'.
domain/r.test.ts(10,12): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
```

The **same two calls inside a `workflow` body are caught perfectly**:

```
error: Argument 1 of 'bump' expects 'int' but got 'string'.
error: Argument 1 of 'retarget' expects 'A id' but got 'int'.
```

So the check exists and is correct — it just never runs over `test` bodies.
On python/elixir this lands as a silent runtime bug instead of a compile error.
(Sibling of the merged #2958, which did this for `test e2e` payloads; the unit
`test` body's *operation calls* are still open.)

---

## F-106 · SILENT — `money.round(n)` is mis-lowered on the React frontend

| | emitted | verdict |
|---|---|---|
| backend (hono) | `this._price.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)` | correct |
| React page walker | `claimStats.data.exposure.round(0)` | `TS2554: Expected 0 arguments, but got 1` |

Same `decimal.js` runtime on both sides; `Decimal.prototype.round()` takes no
argument. `docs/stdlib.md` documents `round` as `(places?: int): money`.

---

# S2 — blocked, or expensively worked around

## F-107 · money cannot be displayed on a hand-written page — while the scaffold displays it correctly

```ddd
QueryView { of: Ap.Totals, data: s => Group { Stat { "Gross", s.gross } } }   // gross: money
```
→ `0 error(s)`, then `src/pages/home.tsx: error TS2322: Type 'Decimal' is not assignable to type 'ReactNode'`.

The recommended interpolated form fails too:

```ddd
Text { `Gross: {s.gross}` }
→ TS2322: Type 'Decimal' is not assignable to type 'string | number | boolean | Date'
```

**The machinery exists.** The *scaffolded* page for the same field emits
`<MoneyValue value={ row.claimedTotal } />`. Only the hand-written walker path
emits the raw value — which is the customization-gradient promise breaking at
exactly the step it advertises.

Cross-frontend, same model:

| frontend | emitted | verdict |
|---|---|---|
| React | `{totals.data.gross}` | **TS2322 — build fails** |
| Vue | `{{ totals.data.gross }}` | compiles; raw `Decimal`, no `MoneyValue`, no currency |
| Svelte | `{totals.data.gross}` | compiles; unformatted |
| Angular | `{{ … }}` | compiles; unformatted |
| Flutter | `final String gross` | correct (money is a string on the wire) |
| React **scaffold** | `<MoneyValue value={…} />` | correct |

**Overlap**: PR **#2871** D4 adds `loom.money-in-text-slot`, covering thirteen
slots including `Stat` ("wrap in place"). Two things that PR should check
against this repro: its row-type resolution is described as reading
`wireFieldsForAggregate` off a `QueryView`'s `of:` — **my `of:` is a
projection**, not an aggregate, so a projection-typed money field may still slip
through; and it turns the break into a refusal, which leaves the four
non-React frontends still rendering money unformatted rather than through
`MoneyValue`.

---

## F-108 · HONEST-but-misdirecting — splitting a context onto its own deployable produces 18 generated-page errors that never name the cause

Iteration 2's evolution step: move `context Claims` onto its own `claimsApi`.

```
$ ddd parse             → 0 error(s), 0 warning(s).
$ ddd generate system   → exit 2
loom.method-call-unresolved-receiver portal/src/pages/claims/detail.tsx:18: method-call Claim.byId(id): receiver did not resolve
  …16 more…
loom.page-ref-unreachable portal/src/pages/claims/detail.tsx:64 warning: Form(data.startReview): 'data' is not an in-scope aggregate instance
18 error(s), 3 warning(s) in generated pages.
```

The cause is one line of wiring — `ui Portal` is mounted on
`deployable portal { targets: api }` and `api` no longer hosts `Claims`.
Nothing in the 18 messages mentions `targets:`, the ui, the deployable or the
context; they point at line numbers in files the user never wrote and which
were never written to disk (the generate aborted).

**And there is no fix to apply.** `targets:` is a *single* deployable reference
(`ddd.langium:304` — `targets=[Deployable:LooseName]`), so `targets: [api,
claimsApi]` is a parse error. A UI over a subdomain whose contexts live on two
backends **cannot be expressed**. `docs/architecture.md:287` comments the
clause "the backend(s) this frontend talks to" — plural in prose, singular in
grammar.

Expected: one phase-⑦ diagnostic naming the ui, the deployable and the
unhosted context — the same shape as the good `loom.ui-id-ref-no-display` and
`loom.deployable-channel-unrelated` messages already in the language.

---

## F-109 · the `migration` rename/backfill surface rejects 81 legal field names, including `description`

```ddd
aggregate Claim { description: string … }      // parses fine

migration "rename-claim-description" { Claim.description -> summary }
→ error: 'description' is a Loom keyword, so it cannot be used as a name here.
  Rename it — 'descriptionRef' or a domain-specific synonym.
```

`Property` (`ddd.langium:1814`) accepts `ID | CommonSoftKeywords | 'await' |
'ignoring' | 'page'`; the migration `ColumnStep` (`:104`) accepts
`UserFieldName = ID | 'id' | 'permissions' | 'migration'`. Measured: **78 of the
79 `CommonSoftKeywords`** are legal property names and illegal in a migration
step — `description, key, kind, message, parent, query, body, action, schema,
config, error, option, response, title, state, sort, group, …` — plus `await`,
`ignoring`, `page`.

So a field with one of those names can be declared but can **never** be renamed
or backfilled through the supported surface. The only escapes are
`--allow-destructive` (data loss) or a raw `sql "…"` step. The error's advice
("Rename it") is the operation being blocked.

`message` additionally gets a *different*, worse error:
`Unexpected 'message'. Expected one of: 'id', 'p…`.

The grammar comment shows the author considered exactly one keyword:
> `migration` is hard only at the top-level `Migration` block head; soft in
> field-name position so a domain field named `migration` parses.

---

## F-110 · there is no `date` (or `time`) scalar

`policy.startsOn`, `policy.endsOn`, `claim.incidentOn`, a due date, a date of
birth. The type list is `bool, datetime, decimal, File, guid, int, json, long,
money, string`.

The diagnostic is excellent (it prints the whole list), so this is HONEST — but
the only workaround is `datetime`, which re-introduces the timezone class of
bug the type exists to prevent (a policy that ends `2026-01-01T00:00:00Z` ends
on Dec 31 for half the world). `docs/language.md` never mentions `date`, not
even as unsupported. The i18n layer already has the concept: `{at, date}` is a
shipped interpolation format spec.

---

## F-111 · `string(x)` documents "any primitive" and rejects four of nine; the interpolation advice is circular

```
$ derived d: string = string(ref)          // ref: guid
error: Cannot convert 'guid' to 'string': not supported.  Today's conversion
vocabulary admits: string ← any primitive | enum | X id; …
```

The message states the rule and violates it in the same breath. One probe per
primitive:

| | guid | datetime | json | File | bool | int | long | decimal | money |
|---|---|---|---|---|---|---|---|---|---|
| `string(v)` | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |

Same hole via interpolation — `` `G-{ref}` `` is rejected by
`loom.interp-hole-type`, whose advice is *"Convert it first (e.g. wrap in a
'derived' that formats it)"*: **circular**, because that conversion is the one
that does not exist. An `X id` interpolates fine and an `X id` *is* a guid, so
the rule is internally inconsistent too.

Concrete block: `aggregate Payout { claimRef: guid … }` cannot produce the
`derived display: string` the UI layer *requires* of a referenced aggregate
(`loom.ui-id-ref-no-display`).

---

# S3 — friction

## F-112 · SILENT — a `retention: work` event published before its consumer's first boot is dropped

Live, against the booted stack. `broker-init/bus-definitions.json` declares
**vhost, users and permissions only** — no queues, exchanges or bindings. Each
consuming deployable declares its own queue at boot.

With `payoutsApi` not yet started, `api` published `ClaimApproved` (outbox row
`dispatched = t`) and:

```
$ rabbitmqctl list_bindings -p loom
loom.Claims.ClaimEvents   loom.Claims.ClaimEvents.api      ← only the producer's own group
loom.dlx                  loom.dlq.loom.Claims.ClaimEvents
$ rabbitmqctl list_queues -p loom
loom.Claims.ClaimEvents.api            0
loom.dlq.loom.Claims.ClaimEvents       0
```

No `.payoutsApi` queue exists, the event is in no queue and no DLQ. The whole
point of `retention: work` is at-least-once delivery; here the saga's trigger
event is lost to deploy ordering. The generator already emits a definitions
file and already knows every (channel × consuming deployable) pair, so
pre-declaring the queues and bindings there is nearly free.

## F-113 · SILENT — unused `workflow create` parameters become required request fields and are discarded

```ddd
workflow make { create(code: string, ignoredNote: string, ignoredQty: int) { let t = T.create({ code: code }) } }
```
→ `0 error(s)`, and the generated contract:
```ts
ignoredNote: z.string(),                                   // REQUIRED on the wire
ignoredQty: z.number().int().min(-2147483648)…,            // REQUIRED on the wire
const ignoredNote = body.ignoredNote;                      // never read
```

I hit this for real: `submitClaim(… firstLine: string, firstAmount: Money)`
returned `204` and the claim came back with `lines: []`. The API contract
obliges a client to send data the system throws away, with no warning.

## F-114 · SILENT — an aggregate no code path can create validates clean

`aggregate Policy` has no `create`, no `with crudish`, and no workflow factory.
`0 error(s)`; `POST /api/policies` → `405 Method Not Allowed`; the table can
never hold a row. The scaffold correctly omits the "new" page, so the
information is present in the compiler — it is just never surfaced as a
warning.

## F-115 · SILENT — "Did you mean …?" for an unknown type suggests operation names and page-state variables

```
aggregate A with crudish { occurredOn: date }
→ Unknown type 'date'. Did you mean 'update'?     // the crudish operation

… + a `ui … with scaffold(…)`
→ Unknown type 'date'. Did you mean 'data'?       // a synthesised page state var
```

`src/language/ddd-linker.ts:70-84` builds the candidate set from
`streamAllContents(root)` — every named node in the **macro-expanded** document
— instead of the declared types. The suggestion is confidently wrong and tells
the user to write `occurredOn: update`.

## F-116 · stale — `ddd new`'s own scaffold says `crudish(requires:)` "hasn't landed"; it has

`src/cli/new-templates.ts:271-273`, emitted verbatim into every new project's
`main.ddd`:

> `with crudish` generates its create/update/destroy, which likewise cannot
> carry a gate today: hand-write those three on any aggregate you want gated
> **until `crudish(requires: <Policy>)` lands**.

It shipped (`src/macros/stdlib/crudish.macro.ts:85`), and the
`loom.default-deny-ungated` diagnostic itself recommends it. A reader who
trusts the file they were handed hand-writes three members per gated aggregate
for nothing.

---

# S4

## F-117 · `examples/sales-ui.ddd` does not parse, and its `Table { …, columns: […] }` is the shape the compiler now rejects

```
$ ddd parse examples/sales-ui.ddd
examples/sales-ui.ddd:133:26 error: Expecting token of type ')' but found ':'.
```
It is the only non-parsing file in `examples/` and it says so in its own header
— but it is also the only file in `examples/` that shows hand-written pages, so
it is what a reader browsing for page syntax finds. I copied
`Table { rows, columns: [...] }` straight out of it. (The diagnostic that
caught me, `loom.page-primitive-unknown-arg`, is one of the best in the
language — it lists every accepted argument and explains why an unknown one is
dangerous.)

---

# Notes on the environment (not Loom defects)

- Containers in this sandbox have **no outbound network**, so `docker compose
  up --build` cannot finish: every generated Dockerfile runs `npm install` /
  `mix deps.get` / `gradle` at image-build time. I booted the stack natively
  instead (postgres + rabbitmq + keycloak in containers, the node backend on
  the host) and got full runtime coverage that way.
- Generated node projects ship **no lockfile** (the Dockerfile comments on it:
  "the generator emits no package-lock.json so npm ci exits with EUSAGE"), so
  image builds are neither reproducible nor offline-capable.
- The generated Java project requires **JDK 25**; only 21 is installed here, so
  `payouts_api` was verified by reading the emitted source, not by compiling.

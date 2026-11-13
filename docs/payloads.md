# Payloads, generic carriers, and discriminated unions

Loom's **transport layer** — the structured data that crosses a boundary
(HTTP, queue, internal call) rather than living as durable aggregate state.
This is the reference for what *ships today*; the design rationale and the
phased roadmap live in
[`proposals/payload-transport-layer.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/payload-transport-layer.md).

Aggregates are nominal state machines; **payloads are structurally-typed
records**. The two ladders coexist: reach for an `aggregate` when you have
durable, identified state with behaviour; reach for a payload when you have a
shape that flows across a wire.

---

## 1. Payloads

A payload is a flat record of properties. Five keywords declare one; they share
the same structural wire contract and differ only in documented intent:

```
payload  Address  { line1: string  city: string  postcode: string }
command  PlaceOrder { customer: Customer id  total: money }
query    OrderSearch { region: string  since: datetime }
response OrderSummary { id: Order id  total: money }
error    OutOfStock { sku: string }
```

`event` is the sixth member of the family — it keeps its own legacy
declaration surface but is unified into the same payload view at the IR layer.

Payload names share one namespace per context with value objects and events;
duplicates and empty/repeated field names are rejected (`loom.*` payload
checks). Payloads are offered as a **type** only where a transport record makes
sense — today that is a workflow `create` parameter, a generic
carrier argument, a union variant, and the per-aggregate `<Agg>Response` read
record. They are **not** admissible as a stored aggregate field type.

### `<Agg>Response` — the read record

Every exposed aggregate and entity part has a declared `response
<Agg>Response` record (spliced by `scaffoldHandlers` and `api X from
<Subdomain>`, or written by hand): its read contract. Every backend's response
DTO and serializer render its rows — `id`, then the record's fields in order —
so the JSON an aggregate takes on the network is identical across Hono, .NET,
Phoenix, Python, Java (and the React/Vue/Svelte/Angular/Feliz frontends) by
construction, not by coincidence. This is the shape a union variant or a
carrier argument projects through when it names an aggregate.

### Numeric wire forms — `money` is a string, `decimal` is a number

`wireShape` fixes the field *order*; the numeric **primitive you pick fixes the
JSON form**, and the two decimal-ish primitives deliberately differ. Choosing
between them is therefore a wire decision, not only a storage one:

- **`money`** crosses as a fixed-scale decimal **string**, always 4 decimals —
  normative in [`conformance-semantics.md` § RS-12](conformance-semantics.md#rs-12--money-wire-scale-is-consistent-across-backends).
- **`decimal`** crosses as a JSON **number**, float64-wide — normative in
  [`conformance-semantics.md` § RS-24](conformance-semantics.md#rs-24--a-plain-decimal-is-a-json-number-only-money-is-a-string),
  which also records the per-backend narrowings this took.

Those two rules are the source of truth; this section only says where the choice
shows up in a payload. One aggregate with one of each:

```ddd
aggregate Invoice {
  amount: money
  taxRate: decimal

  create(amount: money, taxRate: decimal) {
    amount := amount
    taxRate := taxRate
  }
}
```

`GET /api/invoices/{id}` — the identical body on all five backends, for
`amount = 12.5` and `taxRate = 0.0825`:

```json
{
  "id": "1d9f0a7e-5c33-4b19-9e08-2c7d4f6a1b02",
  "amount": "12.5000",
  "taxRate": 0.0825,
  "version": 1
}
```

Note what `money` does and `decimal` does not: `12.5` is re-emitted as
`"12.5000"`. The scale is pinned, so `"12.5"`, `"12.50"` and `"12"` all read
back the same way, and no client can round-trip an amount through a float.

The generated encoder that produces each, one line per backend — the response
boundary only, since the **request** direction deliberately stays on each
backend's wide type (see RS-24). Quoted verbatim from generated output, except
that the .NET and Java rows drop the `System.Globalization.` / `java.math.`
qualifiers the emitters write in full:

| Backend | `money` → string | `decimal` → number |
|---|---|---|
| node / Hono | `root.amount.toFixed(4)` | `root.taxRate` (already a JS `number`) |
| .NET | `found.Amount.ToString("F4", CultureInfo.InvariantCulture)` | `double.Parse(found.TaxRate.ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture)` |
| Phoenix | `__money_round(record.amount)` → `Decimal.round(dec, 4)` | `__decimal_num(record.tax_rate)` → `Decimal.to_float(dec)` |
| Python | `money_str(root.amount)` → `format(amount.quantize(Decimal("1e-4"), rounding="ROUND_HALF_UP"), "f")` | `root.tax_rate` (already a `float`) |
| Java | `value.amount().setScale(4, RoundingMode.HALF_UP).toPlainString()` | `value.taxRate().doubleValue()` |

The response DTO declares the same split, so it is visible in the served
OpenAPI too — node's Zod schema, for instance:

```ts
export const InvoiceResponse = z.object({
  id: z.string(),
  amount: z.string(),   // money   → string
  taxRate: z.number(),  // decimal → number
  version: z.number().int().openapi({ format: "int32" }),
}).openapi("InvoiceResponse");
```

and `.loom/wire-spec.json` carries it as the contract artifact:

```json
"amount":  { "type": "string", "format": "decimal" },
"taxRate": { "type": "number" }
```

**For a client author:** parse `amount` with a decimal type, never a float — the
string is the whole point of `money`. `decimal` is safe to read as a double,
because the backend already narrowed it to one.

The per-backend column mapping and the full five-language expansion (domain
type, DDL, and both directions) live in
[`language-reference/04-type-system.md` § `money`](language-reference/04-type-system.md#money--precise-column-string-on-the-wire).
The arithmetic rules that keep the two types apart — `money ± money`,
`money × {int|long|decimal}`, and the rejection of `money + decimal` — are in
[§ Numeric representation rules](language-reference/04-type-system.md#numeric-representation-rules).

---

## 2. Generic carriers — `paged`

One **carrier-bounded generic payload** is built in. It is instantiated
with **ML-postfix** syntax — the carrier keyword follows its type argument:

```
queryHandler ListOrders(region: string): Order paged   # paged(Order) — the { items, page, … } wrapper
```

The argument must be a **carrier**: a primitive, an `X id`, an enum, a value
object, or an aggregate/entity (which projects through its `<Agg>Response` record). A
carrier may appear only in a **transport position** — a `queryHandler`'s
return type or a payload field — never as a stored property.  (The implicit
list read `all` is paged too.) v1 ships only this
closed, blessed set (`loom.generic-*` codes guard the rules).

### Pinned wire shapes

```
paged(T)    → { items: T[]; page: int; pageSize: int; total: int; totalPages: int }
```

**`envelope` is removed** (`loom.envelope-removed`): `T envelope` meant exactly
`T`, so write `T` — see
[`language-reference/04-type-system.md` § `envelope` (removed)](language-reference/04-type-system.md#envelope-removed).

`paged` is **1-based** (`page` starts at 1) and offset-based; `totalPages` is
included so clients don't recompute it. A paged read auto-gains `page` /
`pageSize` query controls (defaults `1` / `20`). The shape is the *uniform
backend-exchange guarantee*: no backend serializes its framework-native paging
type (EF, Ecto `limit`/`offset`, …) — each maps to this one DTO.

| Backend | `paged` emission |
|---|---|
| Hono / React | `z.object({ items: …, page, pageSize, total, totalPages })` |
| .NET | `Paged<T>` record (`Domain.Common`); repo `CountAsync` + `Skip`/`Take` |
| Phoenix / Ecto | `limit`/`offset` query + a `count` query; controller maps the page to the envelope |
| Python / FastAPI | `PagedResult[T]` |
| Java / Spring | `Paged<T>` over Spring Data paging |

The **frontend** side of that guarantee is `QueryView`'s `data:` binding: a page
body reads the rows and the page metadata (`rows.total`, `rows.totalPages`) off
one binding, whichever paging mode the query is in. See
[page-metamodel.md §9.2](page-metamodel.md#92-queryview-over-a-paged-read--the-envelopes-page-metadata)
for the two modes and the per-frontend support table.

---

## 3. Discriminated unions

A union is a value that is **one of several distinct variants**, tagged on the
wire so a consumer can branch. Two surfaces, one IR shape:

**Anonymous `or`** — inline in an exception-less operation return, no
declaration (a payload field is refused — see [Position](#position)):

```
aggregate Order {
  operation locate(): Order or NotFound { … }   # tagged Order | NotFound wire
}
```

(A repository read never returns a union — see [Union finds are removed](#union-finds-are-removed) below.)

**Named `payload Foo = A | B`** — declared up front, reusable, identity by name:

```
payload OrderEvent = OrderPlaced | OrderCancelled | OrderShipped
```

`A or B or C` and `payload F = A | B | C` produce the same tagged wire. Identity
differs: an anonymous union is **structural on its variant set** (associative-
commutative — `A or B` ≡ `B or A`); a named union is **nominal** (by its name).

### `option` — a deprecated spelling of `T?`

```
queryHandler ByCode(code: string): Order option   # Order? — warns, the fix writes `Order?`
```

`T option` lowers to `T?` (D-ABSENCE-MODEL), so it is the nullable shape in
every position: a read answers `200 OrderResponse` or `404`, and a payload
field is `null` when absent. `loom.option-deprecated` warns on the keyword and
its quick fix rewrites it.

### The tagged wire

Every variant serializes as an object with a **`type` discriminator** plus its
data:

- a **record variant** (an aggregate → its `<Agg>Response` record, or a payload/event →
  its fields) flattens its fields alongside `type`:
  `{ "type": "Order", "id": …, "code": …, "region": … }`;
- a **scalar variant** (primitive / `id`) carries a single `value` field;
- the **`none`** unit is bare: `{ "type": "none" }` — only in a union of two or
  more present variants, since `T or none` is `T?`.

The variant **tag** is the variant type's name (`Order`, `NotFound`, `none`, …).
All five backends derive this shape from one resolver, so the wire is identical
by construction. This tagged form is emitted for **exception-less operation
returns** — *not* repository finds (next):

| Backend | union emission |
|---|---|
| Hono / React | `z.discriminatedUnion("type", [ z.object({ type: z.literal("Order"), … }), … ])` |
| .NET | `[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]` base + one `[JsonDerivedType(typeof(V), "Tag")]` record per variant |
| Phoenix / Ecto | controller `tag_<union>/1` — one struct-pattern clause per variant → `%{type: "Tag", …}` |
| Java / Spring | `@JsonTypeInfo` / `@JsonSubTypes` sealed interface, one record per variant |
| Python / FastAPI | `buildPyBaseUnionFile` — a tagged base + one model per variant |

#### Operation returns in OpenAPI

An operation's union return is not served whole at `200`. An `error`-kind arm is
answered as an RFC 7807 problem at that arm's status (its `httpStatus` override,
else the stdlib default), with the arm's fields as extension members. Only the
success arms reach the `200`, still tagged. The published contract says the same
thing on all five backends:

```
operation reject(): string or NotFound     # error NotFound { resource: string, attemptedCode: string }
```

| response | schema |
|---|---|
| `200` | `stringOrNotFoundSuccess`, a tagged `oneOf` of the success arms only (`{ "type": "string", "value": … }`) |
| `404` (NotFound's status) | `anyOf: [ProblemDetails, NotFoundProblem]`, where `NotFoundProblem` = ProblemDetails + `resource`, `attemptedCode` (required) |

Plain `ProblemDetails` stays in the `anyOf` because the status also has a
generic producer: an absent aggregate is a `404` on every operation route, and
that body carries no arm fields. A union with no `error` arm keeps its whole
`<Union>` component at `200`. The split is decided once, by `opUnionResponses`
in `src/generator/_payload/union-wire.ts`, and is gated by
`test/conformance/op-union-openapi-parity.test.ts`. (Elixir names its modules
upper-first: `StringOrNotFoundSuccess`.)

### Union finds are removed

A repository `find` once returned the absence shape `Order or NotFound` /
`Order option`, answered untagged at a status code.  `find` declarations are
removed ([D-FINDDECL-REMOVED](decisions.md)) and the 2026-10-25 ruling dropped
the shape: a miss is `T?` (`findById` / `findBy` / `find(<Criterion>)`), and a
must-exist read (`getById` / `getBy`) answers the standard ProblemDetails
`404`.  The tagged `oneOf` is the union wire, for operation returns.

### Precedence

Postfix carriers and the array / optional markers bind **tighter** than `or`:

```
string or int option   ≡  string or (int option)
A or B[]               ≡  A or (B[])
```

### Position

An **inline `or`** union (like a carrier) is a transport shape — it may appear
only as an operation / domain-service-operation return, or — with at least
one `error` variant — as the result of a routed command entry point: a
workflow `create`, a `commandHandler`, a `queryHandler`
(`loom.union-position`).  That last form is an expected failure the route
answers like an operation's `or E` (200 tagged success, the error at its
mapped status), and an error answer rolls the whole command back:

```ddd
payload Receipt { left: int }
error PaymentDeclined { available: int }
commandHandler Charge(account: Account id, amt: int): Account or PaymentDeclined {
  let a = Accounts.get(account)
  let r = a.withdraw(amt)
  match r {
    int left => { return a }
    Insufficient e => { return PaymentDeclined { available: amt - e.needed } }
  }
}
```

```ts
// node — http/bankApi-routes.ts: the aggregate arm answers its AccountResponse fields, tagged
handlerResult = { type: "Account", ...(accounts.toWire(await accounts.getById(a.id)) as Record<string, unknown>) };
…
if (handlerResult.type === "PaymentDeclined") throw __rollback;
```

See [13-workflows.md, "Expected failures"](language-reference/13-workflows.md#expected-failures)
for the five backends.  A payload field is
refused as well: the tagged wire is emitted at the top of a return, and no
backend renders a union nested inside a record.

A **named** union (`payload U = A | B`) is a variant set: a value of it is
always one of its variants.  It may be named as a workflow `create` or handler
parameter and as a union variant; anywhere else — a field, an operation
parameter, any return — it is refused with `loom.union-position`, naming the
position.  Write the inline `A or B` in a return instead.  The full form ×
position table is in
[04-type-system.md, "Where a type form may appear"](language-reference/04-type-system.md#where-a-type-form-may-appear).

---

## 4. Validation rules

| Code | Rejects |
|---|---|
| `loom.union-duplicate-variant` | A repeated variant (`string or string`, `payload F = A \| A`) — the discriminator must be unambiguous. |
| `loom.union-variant-not-carrier` | A `slot` variant — every variant must be a carrier type. |
| `loom.union-position` | An inline `or` union outside an operation return, or outside a routed entry point's result (workflow `create` / `commandHandler` / `queryHandler`) with an `error` variant (a payload field included); a named union outside a `create` / handler parameter or a union variant. |
| `loom.transport-type-position` | An event or payload record named as a type outside a transport boundary (a workflow `create`, a handler's contract, a union variant) — a stored field or a domain signature. |
| `loom.union-find-shape-unsupported` | A union find that isn't the absence shape `Agg or <error>` / `Agg option` (exactly the aggregate + one `none`/`error{resource}` variant). |
| `loom.union-read-undiscriminated` | A member read (`r.code`) or an operation call (`r.touch()`) straight through an `or`-union value — a union find's result or an `or`-returning operation's — outside a variant `match` arm. Discriminate it first (`match r { Order o => o.code, else => … }`); a find declared `: Order` answers 404 on a miss instead. |
| `loom.generic-arg-not-carrier` | A non-carrier or nested carrier argument to `paged`. |
| `loom.envelope-removed` | `T envelope` — removed; it meant `T`. |
| `loom.generic-position` | A generic carrier outside a transport position. |

---

## 5. Producer-side boundary

A union's *wire contract* — its DTO/schema and the serialization — is fully
generated on every backend. The two surfaces differ in who selects the variant:

- **Exception-less operation returns** (`placeOrder(): OrderId or NotFound`) are
  producer-selected: the domain body returns the variant it chose, which the
  backend maps to the tagged wire (success) or an RFC-7807 ProblemDetails
  (error). Shipped across all five backends (rationale:
  [`proposals/exception-less.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/exception-less.md)).

### Returning a `match` — one tag per arm

A value `match` whose arms build different variants of the declared union is
tagged per arm: each arm answers its own variant, and an `error` arm is the
error path only when that arm runs.  A mutating operation decides its arm
before it writes, so an error arm leaves no trace.

```ddd
operation decide(kind: string, notes: string): Repaired or Rejected {
  return match {
    kind == "reject" => Rejected { reason: title },
    else => Repaired { notes: notes }
  }
}
```

```ts
// node — domain/ticket.ts
if (kind === "reject") {
  return { type: "Rejected", ...(({ reason: this._title })) };
} else {
  return { type: "Repaired", ...(({ notes: notes })) };
}
```

```elixir
# elixir — lib/d/desk.ex
cond do
  kind == "reject" ->
    {:error, "Rejected", %{reason: record.title}}
  true ->
    {:ok, Map.put(%{notes: notes}, :type, "Repaired")}
end
```

.NET and Java construct each arm's own `<Union>_<Tag>` record, Python returns
each arm's tagged dict, and the variant form (`match r { A a => …, B b => … }`)
dispatches on the subject the same way.  Lowering records the arm variants on
the `return` (`armVariants`) only when the match is exhaustive — an `else`, or
a variant form naming every variant; `distributeUnionReturn`
(`src/ir/util/union-return.ts`) expands it into one tagged `return` per arm.

### Matching a union in a backend body

The statement `match` runs statements per variant in an operation / `create` /
`destroy`, a domain-service operation, a workflow `create` / `on`, or a
handler; the value form (`let t = match r { Order o => o.code, … }`) fits
anywhere, a pure fold or `function` included.  Reading a union without either
is refused (`loom.union-read-undiscriminated`).

```ddd
domainService Pricing {
  operation quote(code: string): Receipt or Rejected { … }
}
workflow Settle {
  create(orderId: Order id, code: string) {
    let o = Orders.get(orderId)
    let q = Pricing.quote(code)
    match q {
      Receipt rc => { o.touch() }
      Rejected e => { o.touch() }
    }
  }
}
```

```ts
// http/workflows.ts (node) — the union's `type` discriminates; the exit save
// follows the match
const o = await orders.getById(orderId);
const q = Pricing.quote(code);
switch (q.type) {
  case "Receipt": {
    const rc = q;
    o.touch();
    break;
  }
  case "Rejected": {
    const e = q;
    o.touch();
    break;
  }
}
await orders.save(o);
```

.NET switches over the `<Union>_<Tag>` carrier records, Java arrow-switches
over the sealed union, Python probes the tagged dict's `type`.  Phoenix runs a
`case` over the tagged tuple the call answers (`{:ok, value}` /
`{:error, "Tag", fields}`) as one with-clause; it refuses a union of two success
variants, whose untagged `{:ok, value}` tuples it cannot tell apart, and the
`if` statement's sub-shapes (`loom.elixir-match-stmt-unsupported`).  Binding the result of a MUTATING aggregate
operation in a workflow (`let r = o.withdraw(x)`, then `match r`) is still
refused by `loom.workflow-mutation-unsaved`.

## What's deferred

- **Merge-patch update** semantics (presence is the generated update's rule,
  not an `option` type — D-ABSENCE-MODEL, #4109).
  (Exception-less **operation returns** of unions have shipped — see §5.)
- **User-declared generic payloads** beyond the blessed `paged`.
- **Multi-arg generics** and row polymorphism over payloads.

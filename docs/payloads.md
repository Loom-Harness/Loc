# Payloads, generic carriers, and discriminated unions

Loom's **transport layer** — the structured data that crosses a boundary
(HTTP, queue, internal call) rather than living as durable aggregate state.
This is the reference for what *ships today*; the design rationale and the
phased roadmap live in
[`proposals/payload-transport-layer.md`](old/proposals/payload-transport-layer.md).

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
sense — today that is a workflow `create` / `handle` parameter, a generic
carrier argument, a union variant, and (auto-synthesized) the per-aggregate
`<Agg>Wire`. They are **not** admissible as a stored aggregate field type.

### `<Agg>Wire` — the auto-synthesized wire shape

Every aggregate, part, and value object carries a canonical, ordered
`wireShape` (id → declared properties → containments → derived), synthesized
once in enrichment. Every backend's DTO emitter walks the *same* list, so the
JSON an aggregate takes on the network is identical across Hono, .NET, Phoenix,
Python, Java (and the React/Vue/Svelte/Angular/Feliz frontends) by construction — not
by coincidence. This is the shape a union
variant or a carrier argument projects through when it names an aggregate.

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

## 2. Generic carriers — `paged` and `envelope`

Two **carrier-bounded generic payloads** are built in. They are instantiated
with **ML-postfix** syntax — the carrier keyword follows its type argument:

```
repository Orders for Order {
  find recent(): Order paged                 # paged(Order)   — the { items, page, … } wrapper
  find latest(): OrderPlaced envelope        # envelope(…)    — a single-row read; the BARE body
}
```

The argument must be a **carrier**: a primitive, an `X id`, an enum, a value
object, or an aggregate/entity (which projects through its `<Agg>Wire`). A
carrier may appear only in a **transport position** — a repository find's
return type or a payload field — never as a stored property. v1 ships only this
closed, blessed set (`loom.generic-*` codes guard the rules).

### Pinned wire shapes

```
paged(T)    → { items: T[]; page: int; pageSize: int; total: int; totalPages: int }
envelope(T) → T          # NOT a wrapper — a SINGLE-ROW find (see below)
```

**`envelope` is a read cardinality, not a wire shape** (M-T6.57, ratified
2026-09-10). `find latest(): OrderPlaced envelope` means "read at most one
`OrderPlaced`": the repository answers the bare `OrderPlaced`, the route
serialises it directly at `200`, and an empty result set is a `404`. The
`{ id, ts, body }` wrapper this document used to pin was the P3 design and never
shipped on any backend — nothing in the IR can source `ts` — and two backends
emitted code that did not compile while carrying its type in their signatures.
`T envelope` and `T` now emit identically everywhere; see
[`language-reference/04-type-system.md` § `envelope`](language-reference/04-type-system.md#envelope).

`paged` is **1-based** (`page` starts at 1) and offset-based; `totalPages` is
included so clients don't recompute it. A paged find auto-gains `page` /
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

**Anonymous `or`** — inline in a payload field or an exception-less operation
return, no declaration:

```
aggregate Order {
  operation locate(): Order or NotFound { … }   # tagged Order | NotFound wire
}
```

(A **repository find** is the one union position that does *not* produce this
tagged wire — see [Union finds](#union-finds--the-untagged-exception) below.)

**Named `payload Foo = A | B`** — declared up front, reusable, identity by name:

```
payload OrderEvent = OrderPlaced | OrderCancelled | OrderShipped
```

`A or B or C` and `payload F = A | B | C` produce the same tagged wire. Identity
differs: an anonymous union is **structural on its variant set** (associative-
commutative — `A or B` ≡ `B or A`); a named union is **nominal** (by its name).

### `option` — the third blessed postfix carrier

```
find findByCode(code: string): Order option       # Order or none
```

`T option` is sugar for the 2-variant union `union[T, none]` — it flows through
the same union machinery. (`option` is distinct from `T?`/`optional`, which is
a nullable field rather than a tagged variant.) As a **find** return, `option`
takes the untagged find path below — `findByCode` responds `200 OrderResponse`
or `404`, not a tagged `{ type: "none" }` body.

### The tagged wire

Every variant serializes as an object with a **`type` discriminator** plus its
data:

- a **record variant** (an aggregate → its `<Agg>Wire`, or a payload/event →
  its fields) flattens its fields alongside `type`:
  `{ "type": "Order", "id": …, "code": …, "region": … }`;
- a **scalar variant** (primitive / `id`) carries a single `value` field;
- the **`none`** unit is bare: `{ "type": "none" }`.

The variant **tag** is the variant type's name (`Order`, `NotFound`, `none`, …).
All five backends derive this shape from one resolver, so the wire is identical
by construction. This tagged form is emitted for **payload fields** and
**exception-less operation returns** — *not* repository finds (next):

| Backend | union emission |
|---|---|
| Hono / React | `z.discriminatedUnion("type", [ z.object({ type: z.literal("Order"), … }), … ])` |
| .NET | `[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]` base + one `[JsonDerivedType(typeof(V), "Tag")]` record per variant |
| Phoenix / Ecto | controller `tag_<union>/1` — one struct-pattern clause per variant → `%{type: "Tag", …}` |
| Java / Spring | `@JsonTypeInfo` / `@JsonSubTypes` sealed interface, one record per variant |
| Python / FastAPI | `buildPyBaseUnionFile` — a tagged base + one model per variant |

### Union finds — the untagged exception

A **repository find** may return a union, but only in the constrained
*absence* shape — exactly two variants, the repository's own aggregate plus one
absent variant (`none` or an `error` payload carrying at most `resource:
string`). Anything else is rejected (`loom.union-find-shape-unsupported`):

```
find recent(): Order or NotFound      # NotFound is an `error { resource: string }`
find findByCode(code: string): Order option   # sugar for `Order or none`
```

This is **not** the tagged wire above. A single-success union find is
wire-identical to `Order?` / `Order option`: the success variant is returned
**directly** as `OrderResponse` at `200`, and the absent variant rides its own
status — an `error` payload → its mapped RFC-7807 ProblemDetails status
(`resource` filled with the aggregate name), `none` → `404`. There is no `type`
discriminator and no union component in the OpenAPI schema. All five backends
agree by construction (the wire matches a plain optional find); the tagged
`oneOf` survives only for operation returns and payload fields.

> **Why the split.** A find's absent case is an *edge* (the row wasn't there),
> not a domain-modelled alternative the producer chose — so it belongs at a
> status code, exactly like an optional find's miss. An operation return is
> producer-selected variant data, so it carries the tag. (Rationale:
> [`proposals/exception-less.md`](old/proposals/exception-less.md) §4.)

### Precedence

Postfix carriers and the array / optional markers bind **tighter** than `or`:

```
string or int option   ≡  string or (int option)
A or B[]               ≡  A or (B[])
```

### Position

An **inline `or`** union (like a carrier) is a transport shape — it may appear
only as a repository find return type, a payload field, or an operation /
domain-service-operation return (`loom.union-position`). A **named** union is
referenced by its name and so is unaffected.

---

## 4. Validation rules

| Code | Rejects |
|---|---|
| `loom.union-duplicate-variant` | A repeated variant (`string or string`, `payload F = A \| A`) — the discriminator must be unambiguous. |
| `loom.union-variant-not-carrier` | A `slot` variant — every variant must be a carrier type. |
| `loom.union-position` | An inline `or` union outside a find return / payload field / operation return. |
| `loom.union-find-shape-unsupported` | A union find that isn't the absence shape `Agg or <error>` / `Agg option` (exactly the aggregate + one `none`/`error{resource}` variant). |
| `loom.union-read-undiscriminated` | A member read (`r.code`) or an operation call (`r.touch()`) straight through an `or`-union value — a union find's result or an `or`-returning operation's — outside a variant `match` arm. Discriminate it first (`match r { Order o => o.code, else => … }`); a find declared `: Order` answers 404 on a miss instead. |
| `loom.generic-arg-not-carrier` | A non-carrier or nested carrier argument to `paged` / `envelope`. |
| `loom.generic-position` | A generic carrier outside a transport position. |
| `loom.generic-carrier-unsupported` / `loom.union-unsupported` | A carrier / union served by a backend that doesn't emit it yet — a platform-aware gate. All five backends now emit both, so these are dormant safety nets for a future backend. |

---

## 5. Producer-side boundary

A union's *wire contract* — its DTO/schema and the serialization — is fully
generated on every backend. The two surfaces differ in who selects the variant:

- **Union finds** are fully implemented, no stub: the framework derives the
  selection from the row's presence (found → the success variant at `200`;
  absent → the `none`/`error` variant at its status). That's why they're
  constrained to the absence shape and render untagged (see [Union finds](#union-finds--the-untagged-exception)).
- **Exception-less operation returns** (`placeOrder(): OrderId or NotFound`) are
  producer-selected: the domain body returns the variant it chose, which the
  backend maps to the tagged wire (success) or an RFC-7807 ProblemDetails
  (error). Shipped across all five backends (rationale:
  [`proposals/exception-less.md`](old/proposals/exception-less.md)).

## What's deferred

- **The effect-form `match` over a union in a domain / workflow body** (arms that
  run statements, e.g. `match r { Order o => o.touch(), NotFound => … }`). The
  VALUE form ships on all five backends (`let t = match r { Order o => o.code,
  … }`, exhaustiveness-checked, narrowed per backend) and reading a union
  without it is refused (`loom.union-read-undiscriminated`); the statement form
  is frontend-only today (`loom.variant-match-placement`).
- **`option` PATCH** semantics ([`partial-update`](old/proposals/partial-update.md)).
  (Exception-less **operation returns** of unions have shipped — see §5.)
- **User-declared generic payloads** beyond the blessed `paged` / `envelope` /
  `option` set.
- **Multi-arg generics** and row polymorphism over payloads.

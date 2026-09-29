# 7. Invariants, derived fields & functions

Three pure, read-only member kinds shared by aggregates, entity parts, and value objects: `invariant` predicates (with optional `when` guard, `message`, and the `private` modifier), `derived` computed fields (including the reserved `display` and `inspect`), and reusable `function` helpers in expression or block form. None of them mutate state — invariants *check* it after every mutation, derived fields *project* it onto the wire shape, functions *compute* over it. Reach for this chapter when you want a rule enforced at construction time, a value computed once and shown everywhere, or a predicate shared between several operations. The per-field read mask (`mask unless`) is summarised at the end and specified in [`../auth.md`](../auth.md).

> **Grammar:** `Invariant`, `Unique`, `DerivedProp`, `FunctionDecl`, the `mask unless` tail of `Property` · **Validators:** `loom.construction-missing-field`, `loom.construction-field-type`, `loom.unknown-construction-field`, `loom.unique-*`, `loom.reserved-derived-on-vo`, `loom.ui-id-ref-no-display`, `loom.function-block-no-return`, `loom.function-toplevel-block`, `loom.function-recursive`, `loom.workflow-function-uses-state`, `loom.field-mask-*`; uncoded type errors `Invariant must be of type 'bool'` / `Invariant guard ('when …') must be of type 'bool'` / `Cannot assign to derived property` (`src/language/validators/types.ts`, `statements.ts`); the IR purity gate `loom.function-block-impure` (`src/ir/validate/checks/structural-checks.ts`; five `#`-slug variants in the message catalog, one per way a body reaches past the pure subset) · **Docs:** [`../language.md`](../language.md) · [`../criterion.md`](../criterion.md) · [`../stdlib.md`](../stdlib.md) · [`../auth.md`](../auth.md)

All three are emitted **in the same shape** across the five backends that run domain logic — same check site, same guard lowering, same predicate text in the violation message. The divergence is host-language syntax plus one structural exception: Phoenix keeps invariants in the Ecto changeset (there is no separate domain floor) and renders derived fields inline in the controller serializer. The frontends consume only the wire shape (so they see `derived` fields but never run an `invariant` or a `function`) and get no tab. Every tab below was generated from one scratch system with a deployable per backend (`node bin/cli.js generate system … -o out`; context `Demo`, aggregate `Order with crudish`).

## `invariant` — a checked predicate

`[private] invariant Expr [when Guard] [message "…"]` declares a `bool` predicate that must hold after every mutation (a non-`bool` expression is `Invariant must be of type 'bool', got '…'`; a non-`bool` guard is `Invariant guard ('when ...') must be of type 'bool', got '…'`). It is asserted in the aggregate's domain floor (`_assertInvariants` and friends), called from the factory (`Order.create(...)`) and from every operation. The violation message defaults to `Invariant violated: <source text>`; a `message "…"` clause replaces it with author text that also becomes the i18n key (`msg.<hash>`, carried as a wire error code — `loomCode` / `WithErrorCode` / `PydanticCustomError` / `loom_code:`; `src/generator/_i18n/validation-catalog.ts`).

```ddd
aggregate Order {
  taxRate: decimal
  qty: int
  invariant taxRate >= 0
  invariant qty <= 1000 message "At most 1000 items per order"
}
```

The check is rendered as a guarded throw — `if (!(<pred>)) throw …` — carrying the message.

::: tabs backend
== node
```ts
// domain/order.ts
private _assertInvariants(): void {
  if (!(this._qty <= 1000)) throw new DomainError("At most 1000 items per order");
  if (!(this._taxRate >= 0)) throw new DomainError("Invariant violated: taxRate >= 0");
}
```
The constructor calls `this._assertInvariants()` after assigning state, so an out-of-range value never escapes `Order.create(...)`.
== dotnet
```csharp
// Domain/Orders/Order.cs
private void AssertInvariants()
{
    if (!(this.Qty <= 1000)) throw new DomainException("At most 1000 items per order");
    if (!(this.TaxRate >= 0m)) throw new DomainException("Invariant violated: taxRate >= 0");
}
```
== java
```java
// features/orders/Order.java — decimal is BigDecimal, so >= is compareTo
public void _assertInvariants() {
    if (!(this.qty <= 1000)) throw new DomainException("At most 1000 items per order");
    if (!(this.taxRate.compareTo(new BigDecimal("0")) >= 0)) throw new DomainException("Invariant violated: taxRate >= 0");
}
```
== python
```python
# app/domain/order.py
def _assert_invariants(self) -> None:
    if not (self._qty <= 1000):
        raise DomainError("At most 1000 items per order")
    if not (self._tax_rate >= 0):
        raise DomainError("Invariant violated: taxRate >= 0")
```
== elixir
```elixir
# lib/ex_api/demo/order_changeset.ex — a single-field bound becomes a native
# validator on the changeset; a messaged rule routes to validate_invariants/1 so
# it can carry its wire code
|> validate_number(:tax_rate, greater_than_or_equal_to: 0)
|> validate_invariants()

def validate_invariants(changeset) do
  data = apply_changes(changeset)
  changeset =
    if data.qty <= 1000, do: changeset, else: add_error(changeset, :qty, "At most 1000 items per order", loom_code: "msg.mnvq93")
  changeset
end
```
The Elixir backend keeps invariants in the schema's changeset (`base_changeset` / `update_changeset`, and the operation-persist pipe calls `validate_invariants/1` too), not in a hand-written assert method. A violated one surfaces as an invalid changeset → 422.
::: end

### Construction is checked before the floor runs

A construction expression (`V { a: 1, b: 2 }` for a value object or entity part) is validated statically, so the domain floor only ever sees complete, well-typed input: every required field must be supplied (`loom.construction-missing-field`), each value must match its declared type (`loom.construction-field-type`), and an unknown name is `loom.unknown-construction-field` (with the declared-field list as a hint).

```ddd
valueobject V { a: int  b: int }
aggregate A {
  v: V
  function f(): V = V { a: "x", zz: 2 }
  //   'V' construction is missing required field: b.      loom.construction-missing-field
  //   Field 'a' of 'V' expects 'int' but got 'string'.    loom.construction-field-type
  //   'V' has no field 'zz'. Declared fields: a, b.         loom.unknown-construction-field
}
```

### A value object refused inside a body — 422 with `errors[]`

A value object runs its invariants when it is built.  In a request body that is the wire layer (below) and answers the §3.2 422 with a pointer to the offending field.  A value object a **body** builds — an operation, a workflow step, a handler — refuses at its constructor instead, and answers the domain-floor status with **one** `errors[]` entry: the rule's message, its content-hash `code` when the rule is messaged, and the pointer `""` (the whole request — the body computed the value, so it names no member of the request).

```ddd
valueobject Qty { value: int  invariant value > 0 message "Quantity must be positive" }
aggregate Order with crudish {
  qty: Qty
  operation resize(n: int) { qty := Qty { value: n } }
}
```

`POST /api/orders/{id}/resize {"n": 0}` answers, on all five backends (pinned by the `vo-invariant-in-body` wire golden):

```json
{ "type": "about:blank", "title": "Unprocessable Entity", "status": 422,
  "detail": "Quantity must be positive", "instance": "/api/orders/{id}/resize",
  "errors": [{ "pointer": "", "message": "Quantity must be positive", "code": "msg.bqyhlx" }] }
```

::: tabs backend
== node
```ts
// domain/value-objects.ts
if (!(this.value > 0)) throw new ValueObjectInvariantError("Qty", "Quantity must be positive", "msg.bqyhlx");
// http/order.routes.ts — the DomainError arm
return domainFloorProblem(c, err, 422, "Unprocessable Entity") ?? problem(422, "Unprocessable Entity", err.message);
```
== dotnet
```csharp
// Domain/ValueObjects/Qty.cs
if (!(this.Value > 0)) throw new ValueObjectInvariantException("Qty", "Quantity must be positive", "msg.bqyhlx");
// Api/DomainExceptionFilter.cs — ahead of the DomainException arm
if (context.Exception is ValueObjectInvariantException voe) { … Extensions["errors"] = … }
```
== java
```java
// domain/valueobjects/Qty.java — a DomainException subclass
if (!(value > 0)) throw new ValueObjectInvariantException("Qty", "Quantity must be positive", "msg.bqyhlx");
// api/ApiExceptionAdvice.java
@ExceptionHandler(ValueObjectInvariantException.class)
public ResponseEntity<ProblemDetail> onValueObjectInvariant(ValueObjectInvariantException e, WebRequest request) { … }
```
== python
```python
# app/domain/value_objects.py — a DomainError subclass
raise ValueObjectInvariantError("Qty", "Quantity must be positive", "msg.bqyhlx")
# app/http/problem.py
@app.exception_handler(ValueObjectInvariantError)
```
== elixir
```elixir
# lib/d/orders.ex — the op persists the body's rebinding through force_change,
# which runs no validator, so the constructor is re-run on the way to the write
|> Ecto.Changeset.force_change(:qty, record.qty)
|> D.Orders.OrderChangeset.validate_body_value_objects()
```
::: end

A message-less rule carries no `code`, and its text is each backend's derived default — on elixir the value object's Ecto validator chain (`should be at least 1 character(s)`), elsewhere `Invariant violated: <source>` — the same native-chain split the wire layer has for a message-less rule.  Before M-T5.1 elixir did not check a body-built value object at all (`resize(0)` persisted `{"value": 0}` and answered 204), and the other four answered the domain floor with no `errors[]`.

### A messaged rule at the domain floor — the same `errors[]` entry, with its code

A rule the **wire** layer can evaluate answers the wire rung (below): 422 "Validation failed", one `errors[]` entry per field, each messaged rule carrying its content-hash `code`.  A rule that reads the aggregate's own **state** — a `precondition` relating a field to a parameter, an `invariant` an operation body breaks — is invisible to any request validator and trips at the **domain floor**.  Since M-T1.11 (c) a MESSAGED rule there answers the domain-floor status with **one** `errors[]` entry of the value-object shape above: the rule's message, the **same** `msg.<hash>` code the wire rung carries (so one catalog entry localises both rungs), and the pointer `/<field>` when the rule is single-field-shaped, `""` otherwise.  A message-less rule keeps the plain domain floor — it has no code, and its text is each backend's own default.

```ddd
aggregate Account with crudish {
  owner: string
  balance: int
  ceiling: int
  invariant balance >= 0 message "Balance cannot be negative"
  invariant balance <= ceiling message "Balance cannot exceed the ceiling"
  operation withdraw(amount: int) {
    precondition balance >= amount message "Insufficient funds"
    balance := balance - amount
  }
  operation overdraw(amount: int) { balance := balance - amount }
}
```

`POST /api/accounts/{id}/withdraw {"amount": 50}` on a balance of 12, and `overdraw` by the same amount, answer on all five backends (pinned by the `domain-floor-messages` wire golden):

```json
{ "type": "about:blank", "title": "Unprocessable Entity", "status": 422,
  "detail": "Insufficient funds", "instance": "/api/accounts/{id}/withdraw",
  "errors": [{ "pointer": "", "message": "Insufficient funds", "code": "msg.p55wf6" }] }

{ "type": "about:blank", "title": "Unprocessable Entity", "status": 422,
  "detail": "Balance cannot be negative", "instance": "/api/accounts/{id}/overdraw",
  "errors": [{ "pointer": "/balance", "message": "Balance cannot be negative", "code": "msg.11ks9e" }] }
```

::: tabs backend
== node
```ts
// domain/account.ts — the throw carries the rule's code and pointer
if (!(this._balance >= amount)) throw new DomainError("Insufficient funds", "msg.p55wf6", "");
if (!(this._balance >= 0)) throw new DomainError("Balance cannot be negative", "msg.11ks9e", "/balance");
// http/account.routes.ts — the DomainError arm (one serializer for both refusals)
return domainFloorProblem(c, err, 422, "Unprocessable Entity") ?? problem(422, "Unprocessable Entity", err.message);
```
== dotnet
```csharp
// Domain/Accounts/Account.cs
if (!(this.Balance >= amount)) throw new DomainException("Insufficient funds", "msg.p55wf6", "");
// Api/DomainExceptionFilter.cs — the value-object arm's template, ahead of the plain DomainException arm
if (context.Exception is DomainException dfe && dfe.RuleCode != null) { … Extensions["errors"] = … }
```
== java
```java
// features/accounts/Account.java
if (!(this.balance >= amount)) throw new DomainException("Insufficient funds", "msg.p55wf6", "");
// api/ApiExceptionAdvice.java — onDomain shares domainFloorWithEntry with onValueObjectInvariant
if (e.getRuleCode() != null) return domainFloorWithEntry(e, e.getRuleCode(), e.getPointer() == null ? "" : e.getPointer(), request);
```
== python
```python
# app/domain/account.py
raise DomainError("Insufficient funds", "msg.p55wf6", "")
# app/http/problem.py — _domain shares _domain_floor_with_entry with the value-object handler
if err.code is not None:
    return _domain_floor_with_entry(request, err, err.pointer if err.pointer is not None else "")
```
== elixir
```elixir
# lib/d/accounts.ex — a messaged precondition's denial carries a coded detail map…
:ok <- ensure(record.balance >= amount, {:precondition_failed, %{detail: "Insufficient funds", code: "msg.p55wf6", pointer: ""}})
# …and the op persist re-asserts the invariants at the DOMAIN FLOOR, tagging a
# messaged violation so ProblemDetails answers this rung, not "Validation failed"
|> D.Accounts.AccountChangeset.validate_domain_floor()
```
::: end

Before M-T1.11 (c) the four non-elixir backends answered the domain floor with `detail` only — no `errors[]`, so no code a client could localise by and no pointer a form could bind — and elixir answered a messaged invariant tripped by an operation with the WIRE rung's shape ("Validation failed") and a messaged precondition with the bare floor.

### `.length` counts code points

A string `.length` — in a domain rule, an invariant, a precondition, anywhere — is a count of **Unicode code points**, not of the host language's native string length. This is the unit the emitted JSON Schema publishes as `minLength`/`maxLength`, so the rule the server enforces and the bound it advertises are the same number:

| target | emitted for `s.length` |
|---|---|
| node/Hono | `[...s].length` |
| .NET | `s.EnumerateRunes().Count()` |
| java | `((int) s.codePoints().count())` |
| python | `len(s)` |
| elixir | `length(String.to_charlist(s))` — in domain expressions and in the hand-rolled `validate_change/3` changeset closure alike (a charlist is one element per code point; `String.length/1` would count graphemes) |

`"😀X"` is therefore **2**, not 3: the astral character is one code point (two UTF-16 code units). Before this was pinned, node/.NET/java counted code units and accepted a value their own published `maxLength` forbade (`docs/audits/schemathesis-findings-2026-08.md`, F5).

### Elixir: enforced or reported

Four backends assert every invariant at a domain floor of their own (`_assertInvariants()` / `AssertInvariants()` / `_assert_invariants`), so any predicate the language admits is enforced. Elixir has no such floor — its carrier is the Ecto changeset, which has two paths: a native `validate_number` / `validate_length` / `validate_format` line for a message-less, unguarded single-field rule, and a custom `validate_invariants/1` for everything else, piped onto `base_changeset`, `update_changeset` and the operation-persist path.

`validate_invariants/1` renders through the **same** expression renderer the operation and `derived` bodies use, so it covers cross-field comparisons, guarded rules (`… when …`), messaged rules, member reads, scalar intrinsics, collection ops and `derived` reads:

```ddd
invariant sku.trim().length > 0        // String.length(String.trim(data.sku))
invariant lines.count > 0             // Enum.count(data.lines)
invariant lines.any(l => l.qty > 0)   // Enum.any?(data.lines, …)
invariant isBig == false              // the derived expression, INLINED
```

Two mechanics are worth knowing. A `derived` read is **inlined**, because an Ecto struct carries no computed field (`data.is_big` would be a missing key). A contained collection is normalised (`%Ecto.Association.NotLoaded{}` → `[]`) before it is read, since an unloaded containment means "no children" on both write paths.

One shape is deliberately **not** enforced here: a **reference collection** (`X id[]`). Its join rows are written by the repository *after* the changeset runs, so the changeset would read an empty list and the rule would hold for every input — enforcement in name only, which is worse than none because it also looks enforced.

That case, and anything else this carrier cannot evaluate (a `domainService` or resource call), raises **`loom.elixir-invariant-unenforced`** — a warning naming the aggregate, the invariant's source text and the specific reason. So on Elixir an invariant is either enforced or reported; it is never silently dropped. If you need a reported rule enforced, move it into an operation `precondition`, where the full aggregate is in scope, or host the context on another backend.

### The wire layer

A non-private invariant is **also** projected to the request-validation layer the HTTP boundary runs *before* a command reaches the domain — so a malformed body is rejected as a 422, not a domain throw. It lands on the create **and** update request shapes of a constructible aggregate (one with a canonical `create`, e.g. via `crudish`). Simple single-field predicates lower to native validator constraints (`src/ir/validate/invariant-classify.ts` → `zod-refine.ts` / `dotnet/validator-emit.ts` / the Java `*Validator` / Pydantic `Field(...)`); anything the classifier can't reduce becomes a custom rule.

`invariant taxRate >= 0`, `invariant note.length > 0`, and `invariant qty <= 1000 message "…"` emit:

::: tabs backend
== node
```ts
// http/order.routes.ts — Zod request schema; the code-point length is an explicit
// refine plus the minLength the OpenAPI schema publishes
const CreateOrderRequest = z.object({
  note: z.string().refine((s) => [...s].length >= 1).openapi({ minLength: 1 }),
  qty: z.number().int(),
  taxRate: z.number().min(0),
  // …
}).openapi("CreateOrderRequest").refine((data: any) => data.qty <= 1000, { path: ["qty"], message: "At most 1000 items per order", params: { loomCode: "msg.mnvq93" } })
```
== dotnet
```csharp
// Application/Orders/Commands/CreateOrderCommandValidator.cs — FluentValidation
public CreateOrderCommandValidator()
{
    RuleFor(x => x.Note).Must(v => v == null || v.EnumerateRunes().Count() >= 1)
        .WithMessage("'{PropertyName}' must be at least 1 characters.");
    RuleFor(x => x.TaxRate).GreaterThanOrEqualTo(0);
    RuleFor(x => x).Must(x => x.Qty <= 1000)
        .WithName("Qty")
        .WithMessage("At most 1000 items per order")
        .WithErrorCode("msg.mnvq93");
}
```
== java
```java
// features/orders/CreateOrderValidator.java — a Spring Validator over the request record;
// a message-less rule carries the sentinel code "loom.invariant" (not a diagnostic)
if (!(((int) note.codePoints().count()) >= 1)) errors.rejectValue("note", "loom.invariant", "Invariant violated: note.length > 0");
if (!(qty <= 1000)) errors.rejectValue("qty", "msg.mnvq93", "At most 1000 items per order");
if (!(taxRate.compareTo(new java.math.BigDecimal("0")) >= 0)) errors.rejectValue("taxRate", "loom.invariant", "Invariant violated: taxRate >= 0");
```
== python
```python
# app/http/order_routes.py — Pydantic Field constraints + a model_validator
class CreateOrderRequest(BaseModel):
    note: str = Field(min_length=1)
    qty: int
    taxRate: float = Field(ge=0)

    @model_validator(mode="after")
    def _check_invariants(self) -> "CreateOrderRequest":
        if not (self.qty <= 1000):
            raise ValidationError.from_exception_data("CreateOrderRequest", [InitErrorDetails(
                type=PydanticCustomError("msg.mnvq93", "At most 1000 items per order"), loc=("qty",), input=self.qty)])
        return self
```
== elixir
```elixir
# lib/ex_api/demo/order_changeset.ex — the changeset IS the wire layer; the
# code-point length rule is a validate_change closure with Ecto's own message shape
|> validate_change(:note, fn _, value ->
  if length(String.to_charlist(value)) >= 1,
    do: [],
    else: [{:note, {"should be at least %{count} character(s)", count: 1, validation: :length, kind: :min, type: :string}}]
end)
|> validate_number(:tax_rate, greater_than_or_equal_to: 0)
|> validate_invariants()        # the messaged qty rule, shown above
```
::: end

## `private invariant` — domain floor only

Prefix with `private` to enforce the rule **only** in the domain `_assertInvariants` floor — it is *not* projected onto the wire/validation layer, and therefore not disclosed via OpenAPI. Use it for rules you don't want advertised on the public contract (internal consistency, sensitive uniqueness).

```ddd
aggregate Order {
  taxRate: decimal
  qty: int
  invariant taxRate >= 0           // wire + domain
  private invariant qty >= 0       // domain only
}
```

Both rules appear in the domain floor; only the non-private one reaches the request validator:

::: tabs backend
== node
```ts
// domain/order.ts — BOTH invariants present in the floor
private _assertInvariants(): void {
  if (!(this._qty >= 0)) throw new DomainError("Invariant violated: qty >= 0");
  if (!(this._taxRate >= 0)) throw new DomainError("Invariant violated: taxRate >= 0");
}
```
```ts
// http/order.routes.ts — the request schema carries ONLY the non-private rule
const CreateOrderRequest = z.object({
  qty: z.number().int(),      // no .min(0): the private rule is absent
  taxRate: z.number().min(0),
  // …
})
```
== dotnet
```csharp
// Domain/Orders/Order.cs — both in the domain floor
if (!(this.Qty >= 0)) throw new DomainException("Invariant violated: qty >= 0");
if (!(this.TaxRate >= 0m)) throw new DomainException("Invariant violated: taxRate >= 0");
```
```csharp
// CreateOrderCommandValidator.cs — only the non-private rule reaches FluentValidation
RuleFor(x => x.TaxRate).GreaterThanOrEqualTo(0);
```
== elixir
```elixir
# Phoenix has ONE layer — the changeset — so a private invariant is enforced
# there like any other, and is therefore visible in the 422 errors[]
|> validate_number(:qty, greater_than_or_equal_to: 0)
|> validate_number(:tax_rate, greater_than_or_equal_to: 0)
```
::: end

Java and Python behave like node/.NET (the `qty >= 0` rule is in `_assertInvariants` / `_assert_invariants` and absent from `CreateOrderValidator` / `CreateOrderRequest`).

## `when` — a conditional invariant

`invariant Expr when Guard` only enforces `Expr` while `Guard` holds — logical implication, `guard => pred`. It lowers to a single combined `if`, never a separate branch.

```ddd
aggregate Order {
  taxRate: decimal
  note: string
  invariant note.length > 0 when taxRate > 0
}
```

The guard is evaluated first; the predicate is only asserted when the guard is true:

::: tabs backend
== node
```ts
// domain/order.ts
if ((this._taxRate > 0) && !([...this._note].length > 0)) throw new DomainError("Invariant violated: note.length > 0");
```
```ts
// http/order.routes.ts — the wire layer renders it as a Zod refine (implication form)
.refine((data: any) => !(data.taxRate > 0) || ([...data.note].length > 0), { path: ["note"], message: "Invariant violated: note.length > 0" })
```
== dotnet
```csharp
// Domain/Orders/Order.cs
if ((this.TaxRate > 0m) && !(this.Note.EnumerateRunes().Count() > 0)) throw new DomainException("Invariant violated: note.length > 0");
```
```csharp
// CreateOrderCommandValidator.cs — wire layer as a .Must implication
RuleFor(x => x).Must(x => !(x.TaxRate > 0m) || (x.Note.EnumerateRunes().Count() > 0))
    .WithName("Note")
    .WithMessage("Invariant violated: note.length > 0");
```
== java
```java
// features/orders/Order.java — the domain floor is correct
if ((this.taxRate.compareTo(new BigDecimal("0")) > 0) && !(((int) this.note.codePoints().count()) > 0)) throw new DomainException("Invariant violated: note.length > 0");
```
```java
// features/orders/CreateOrderValidator.java — KNOWN BUG: the wire rule drops the guard,
// so an empty note is rejected even when taxRate == 0 (src/generator/java/emit/validator.ts
// renders inv.expr without the `!(guard) ||` implication the other backends emit)
if (!(((int) note.codePoints().count()) > 0)) errors.rejectValue("note", "loom.invariant", "Invariant violated: note.length > 0");
```
== python
```python
# app/domain/order.py
if (self._tax_rate > 0) and not (len(self._note) > 0):
    raise DomainError("Invariant violated: note.length > 0")
```
```python
# app/http/order_routes.py — model_validator, implication form
if not (not (self.taxRate > 0) or (len(self.note) > 0)):
    raise ValueError("Invariant violated: note.length > 0")
```
== elixir
```elixir
# Honest gap: a guarded invariant whose predicate is a single-field shape
# (.length / .matches / a numeric bound) is emitted NEITHER as a native
# validator NOR in validate_invariants/1 — the changeset carries nothing for it
# (src/generator/elixir/vanilla/changeset-invariant-emit.ts, residualInvariants).
# A guarded CROSS-FIELD comparison (both sides plain fields) does render, as
#   changeset = if <guard> do (if <pred>, do: changeset, else: add_error(…)) else changeset end
```
::: end

## `unique (a, b)` — a set-level invariant

`unique (col, …)` declares a natural-key rule over the aggregate's rows. It cannot run in the per-instance floor, so the compiler *derives* its enforcement — a DB unique index (partial under `softDeletable`) plus a per-backend `23505 → 409` mapping. Columns are bare field names (`loom.unique-unknown-field` with a known-fields hint, `loom.unique-collection-field`, `loom.unique-valueobject-field`, `loom.unique-duplicate-column`; a tenant-owned aggregate must include its tenant key, `loom.unique-missing-tenant-scope`; not on an event-sourced aggregate, `loom.unique-on-event-sourced`). The schema side is in [Migrations](../migrations.md).

```ddd
aggregate Order {
  note: string
  unique (note)
}
```

```elixir
# lib/ex_api/demo/order_changeset.ex — the index name the migration created, mapped to a changeset error
|> unique_constraint(:note, name: "orders_note_uq")
```

## `derived` — a computed read-only field

`derived name: Type = Expr` is a property computed from other facts on the node — no storage column, no setter. Assigning to it is a compile error (`Cannot assign to derived property 'x'`). It is part of the [enriched `wireShape`](../technical.md), so it appears on the response DTO of every backend and on the wire that frontends consume. A derived may read another derived (`total` reads `tax` below).

```ddd
aggregate Order {
  subtotal: money
  taxRate: decimal
  derived tax: money = subtotal * taxRate
  derived total: money = subtotal + tax
}
```

Emitted as a read-only getter on the domain object **and** a member of the response record.

::: tabs backend
== node
```ts
// domain/order.ts — getters, no backing field
get tax(): Decimal { return this._subtotal.times(this._taxRate); }
get total(): Decimal { return this._subtotal.plus(this.tax); }
```
```ts
// http/order.routes.ts — present on the wire response (money → string)
export const OrderResponse = z.object({
  id: z.string(),
  taxRate: z.number(),
  subtotal: z.string(),
  // …
  tax: z.string(),        // derived, on the wire
  total: z.string(),
});
```
== dotnet
```csharp
// Domain/Orders/Order.cs — expression-bodied get-only properties
public decimal Tax => this.Subtotal * this.TaxRate;
public decimal Total => this.Subtotal + this.Tax;
```
```csharp
// Application/Orders/Queries/GetOrderByIdHandler.cs — projected onto the response record
new OrderResponse(found.Id.Value, /* … */, found.Tax.ToString("F4", CultureInfo.InvariantCulture), found.Total.ToString("F4", CultureInfo.InvariantCulture), /* … */)
```
== java
```java
// features/orders/Order.java — public accessor methods
public BigDecimal total() {
    return this.subtotal.add(this.tax());
}
// OrderResponse.from(value) maps it: value.total().setScale(4, java.math.RoundingMode.HALF_UP).toPlainString()
```
== python
```python
# app/domain/order.py — @property, surfaced into the response model via wireShape
@property
def total(self) -> Decimal:
    return self._subtotal + self.tax
```
== elixir
```elixir
# lib/ex_api_web/controllers/order_controller.ex — no schema function; a derived is
# computed inline in the serializer map
"tax" => __money_round(Decimal.mult(record.subtotal, record.tax_rate)),
```
Honest gap: `total` is **absent** from the Phoenix response. A derived whose expression reads another derived (or a helper function, `currentUser`, a resource) is silently skipped by the serializer instead of projected (`src/generator/elixir/vanilla/wire-serialize.ts`, `derivedRenderable`) — the other four backends put it on the wire, so this is a cross-backend wire divergence with no validator.
::: end

### Reserved `display` and `inspect`

Two derived names are special-cased (aggregates only — on a value object they are `loom.reserved-derived-on-vo`).

`derived display: string = …` declares the aggregate's **user-facing label**. When present, `string(aggregate)`, implicit `"x " + aggregate` and a `{aggregate}` template hole lower to a member access on it (`src/ir/lower/lower-expr.ts`), and frontend `Select` pickers over an `X id` field use it for option text; without it those expressions are compile errors and a UI that references the id is `loom.ui-id-ref-no-display`. It rides the wire like any derived.

`derived inspect: string = …` declares the **developer-facing debug form**, emitted as the host language's stringification hook (`toString()` + `[util.inspect.custom]` / `ToString()` / `toString()` / `__repr__`). When you omit it, phase ⑥ **synthesises** a structural form on every aggregate (`src/ir/enrich/enrichments.ts`, `synthesizeInspect`), and any field carrying a `sensitive(...)` tag is printed as `<redacted>`; Elixir emits a `defimpl Inspect` for that redacted form only when the aggregate has a sensitive field (`src/generator/elixir/vanilla/inspect-emit.ts`). A user-supplied `inspect` is rendered verbatim (you opt out of redaction by writing your own); it is **not** on the wire.

```ddd
aggregate Order {
  note: string
  qty: int
  ssn: string sensitive(pii)
  derived display: string = "Order " + note
  // inspect omitted → synthesised structural form
}
```

::: tabs backend
== node
```ts
// domain/order.ts — `display` getter + the SYNTHESISED `inspect`/toString
get display(): string { return "Order " + this._note; }
get inspect(): string { return "Order(" + "id: " + String(this._id) + ", " + "note: " + "'" + this._note + "'" + ", " + "qty: " + String(this._qty) + ", " + "ssn: " + "<redacted>" + ", " + "version: " + String(this._version) + ")"; }
toString(): string { return this.inspect; }
[Symbol.for("nodejs.util.inspect.custom")](): string { return this.inspect; }
```
== dotnet
```csharp
// Domain/Orders/Order.cs — `Display` + synthesised `Inspect` delegated from ToString()
public string Display => "Order " + this.Note;
public string Inspect => "Order(" + "id: " + this.Id.ToString() + ", " + "note: " + "'" + this.Note + "'" + ", " + "qty: " + this.Qty.ToString(System.Globalization.CultureInfo.InvariantCulture) + ", " + "ssn: " + "<redacted>" + ", " + "version: " + this.Version.ToString(System.Globalization.CultureInfo.InvariantCulture) + ")";
public override string ToString() => Inspect;
```
== java
```java
// features/orders/Order.java
public String display() { return "Order " + this.note; }
public String inspect() { return "Order(" + "id: " + String.valueOf(this.id) + ", " + "note: " + "'" + this.note + "'" + ", " + "qty: " + String.valueOf(this.qty) + ", " + "ssn: " + "<redacted>" + ", " + "version: " + String.valueOf(this.version) + ")"; }
@Override
public String toString() { return inspect(); }
```
== python
```python
# app/domain/order.py
@property
def display(self) -> str:
    return "Order " + self._note
@property
def inspect(self) -> str:
    return "Order(" + "id: " + str(self._id) + ", " + "note: " + "'" + self._note + "'" + ", " + "qty: " + str(self._qty) + ", " + "ssn: " + "<redacted>" + ", " + "version: " + str(self._version) + ")"
def __repr__(self) -> str:
    return self.inspect
```
== elixir
```elixir
# lib/ex_api/demo/order.ex — emitted only because `ssn` is sensitive
defimpl Inspect, for: ExApi.Demo.Order do
  import Inspect.Algebra
  def inspect(record, _opts) do
    string("Order(" <> "id: " <> to_string(record.id) <> ", " <> "note: " <> "'" <> record.note <> "'" <> ", " <> "qty: " <> to_string(record.qty) <> ", " <> "ssn: " <> "<redacted>" <> ", " <> "version: " <> to_string(record.version) <> ")")
  end
end
# `display` is serialized inline by the controller: "display" => "Order " <> record.note
```
::: end

## `function` — a pure helper

`function name(params): Type = Expr` (expression form) or `function name(params): Type { let … return … }` (block form — `let` bindings, `precondition` / `requires` bug-regime statements, and a mandatory `return` of the declared type on every path, `loom.function-block-no-return`) is a pure, side-effect-free helper callable from any expression in the same aggregate / entity part / value object / workflow — invariant predicates, derived expressions, operation bodies. The expression form is SQL-inlinable like a `criterion`; the block form is not queryable (a call is already rejected in `where` / `criterion` positions). It compiles to a private method on the aggregate on node/.NET/java (`_`-prefixed on python; a public context-facade function on Phoenix) — never part of the public command surface.

The same purity contract binds the four RULE positions — `invariant Expr`, its `when Guard`, a field's `check Expr`, and `derived name: T = Expr`. All four are spliced into the per-instance floor, which runs with nothing in scope but `this`, so a rule expression may not reach a repository, an aggregate, a workflow or any other declaration it cannot address, and may not call one of the aggregate's own actions (`operation` / `create` / `destroy`). Both are refused by `loom.rule-expr-impure` (`src/language/validators/types.ts`, slugs `#unaddressable` and `#operation`) at the offending head / call. A cross-aggregate rule such as `invariant Technicians.getById(technicianId).skills.contains(…)` used to validate clean and then emit an unresolvable identifier into every backend (`TS2304: Cannot find name 'Technicians'`) — or, on Phoenix, silently emit nothing at all. Denormalize the value onto the aggregate and assert over that, or move the rule into the operation / workflow that already loads it. A pure `domainService` call stays legal in a rule: it is a calculator, and every backend threads its import.

The block form is held to the same purity contract by the IR check `loom.function-block-impure` (`src/ir/validate/checks/structural-checks.ts`; its wording lives in `src/diagnostics/messages.ts` under five `#`-slug variants — `#mutation`, `#emit`, `#call-stmt`, `#call-expr`, `#method-call`): no `:=` / `+=` / `-=` on aggregate state, no `emit`, and no call other than another pure `function` or a value-object constructor (operations, repository reads, domain services, externs, workflows, page actions and method calls on a receiver are all rejected).

```ddd
aggregate Order {
  taxRate: decimal
  status: Status
  function isMutable(): bool = status == Status.Draft
  function fee(q: int): decimal {
    let base = decimal(q) * 2.5
    return base + taxRate
  }
}

valueobject Price {
  amount: decimal
  currency: string
  function withTax(rate: decimal): decimal = amount * (1 + rate)
}
```

::: tabs backend
== node
```ts
// domain/order.ts — decimal is a plain number on node
private isMutable(): boolean { return this._status === Status.Draft; }
private fee(q: number): number {
  const base = q * 2.5;
  return base + this._taxRate;
}
// domain/value-objects.ts
withTax(rate: number): number { return this.amount * (1 + rate); }
```
== dotnet
```csharp
// Domain/Orders/Order.cs
private bool IsMutable() => this.Status == Status.Draft;
private decimal Fee(int q)
{
    var @base = (decimal)q * 2.5m;
    return @base + this.TaxRate;
}
// Domain/ValueObjects/Price.cs
private decimal WithTax(decimal rate) => this.Amount * (1m + rate);
```
== java
```java
// features/orders/Order.java — decimal is BigDecimal
private boolean isMutable() {
    return this.status == Status.Draft;
}
private BigDecimal fee(int q) {
    var base = BigDecimal.valueOf(q).multiply(new BigDecimal("2.5"));
    return base.add(this.taxRate);
}
// domain/valueobjects/Price.java
private BigDecimal withTax(BigDecimal rate) {
    return this.amount.multiply((new BigDecimal("1").add(rate)));
}
```
== python
```python
# app/domain/order.py — underscore-prefixed; decimal is a float
def _is_mutable(self) -> bool:
    return self._status == Status.Draft

def _fee(self, q: int) -> float:
    base = float(q) * 2.5
    return base + self._tax_rate

# app/domain/value_objects.py
def with_tax(self, rate: float) -> float:
    return self.amount * (1 + rate)
```
== elixir
```elixir
# lib/ex_api/demo.ex (the context facade) — public functions taking the struct first
@doc "Pure domain function `isMutable` on `Order`."
@spec is_mutable(ExApi.Demo.Order.t()) :: boolean()
def is_mutable(%ExApi.Demo.Order{} = record) do
  record.status == :Draft
end

@spec fee(ExApi.Demo.Order.t(), integer()) :: Decimal.t()
def fee(%ExApi.Demo.Order{} = record, _q) do
  base = Decimal.mult(Decimal.new(q), Decimal.new("2.5"))
  Decimal.add(base, record.tax_rate)
end
```
Honest gap: the block form underscore-prefixes a parameter the body reads (`_q` above, `src/generator/elixir/vanilla/function-emit.ts` — `bodyUsesParam` misses a `let`-bound use), so a block-form function with a parameter does not compile on Phoenix today; the expression form is fine.
::: end

A pure block that breaks the contract:

```ddd
aggregate A {
  n: int
  function f(q: int): int { n := q  return q }   // loom.function-block-impure: 'n' is mutated
  function g(q: int): int { let x = q * 2 }      // loom.function-block-no-return
  function h(q: int): int { if q > 0 { return 1 } }  // loom.function-block-no-return: the false path has no value
}
```

A `return` may sit inside a statement `if` — `function tier(t: decimal): string { if n > t { return "gold" } else { return "bronze" } }` is legal and renders on all five backends — provided the conditional covers **both** paths (an `else`, or an `else if` chain ending in one). `match`, `if let` and `for` cannot appear in a function block at all; `checkStatementPlacement` confines those to the frontend / workflow zones (`loom.variant-match-placement`, `loom.if-let-placement`, `loom.for-placement`).

### Top-level functions and the prelude

A `function` declared at file root or inside `system { }` is visible workspace-wide and **inlines** its expression body at every call site during lowering — so it must be expression-form (`loom.function-toplevel-block`) and must not recurse, directly or through a mutual cycle (`loom.function-recursive`; recursion is fine for member functions, which emit as real methods). The call site trusts the declared return type, so a body of another type is `Function 'f' returns '…' but is declared to return '…'`.

```ddd
system Ch07 {
  function isBig(n: int): bool = n > 100
  context Demo {
    aggregate Order {
      qty: int
      function big(): bool = isBig(qty)
    }
  }
}
```

`isBig` leaves no trace of its own; `big` carries the inlined predicate:

::: tabs backend
== node
```ts
private big(): boolean { return (this._qty > 100); }
```
== dotnet
```csharp
private bool Big() => (this.Qty > 100);
```
== java
```java
private boolean big() {
    return (this.qty > 100);
}
```
== python
```python
def _big(self) -> bool:
    return (self._qty > 100)
```
== elixir
```elixir
def big(%ExApi.Demo.Order{} = record) do
  (record.qty > 100)
end
```
::: end

The **ambient prelude** ([`../stdlib.md`](../stdlib.md) § Layer 1 — `isBlank`, `isPresent`, `truncate`, `clamp`, `percentOf`, `roundTo`, `isOverdue`, …) is exactly this mechanism: auto-injected expression-form top-level functions, callable with nothing imported; an uncalled one emits nothing, and a user-declared top-level function of the same name shadows it. (The capability mixins in `src/macros/prelude.ts` — `auditable`, `softDeletable`, … — are a different prelude; see [Capabilities](11-capabilities-filters-stamps.md).)

A `workflow` may also declare `function` members (both forms). They are emitted at module/static scope, so a body that reads the workflow's own state fields or `this` is `loom.workflow-function-uses-state` — pass the value in as a parameter. See [`../workflow.md`](../workflow.md).

## `mask unless` — field read redaction

`field: T mask unless <currentUser predicate>` redacts the field to `null` on every read response unless the caller satisfies the predicate (fail-closed; the response schema becomes nullable; audit/provenance snapshots stay unmasked). The predicate must be `bool` (`'mask unless' on 'x' must be of type 'bool'`) and may reference only `currentUser` and constants (`loom.field-mask-not-current-user`); a masked field can't be read through a projection source without its mask (`loom.field-mask-projection-source`), and `loom.field-mask-unsupported` names the platforms that don't implement the redaction.

```ddd
user { id: string  role: string }
aggregate Employee {
  name: string
  salary: money mask unless currentUser.role == "admin"
}
```

```ts
// node — db/repositories/employee-repository.ts, on the read projection
if (!(currentUser !== null && (currentUser.role === "admin"))) wire.salary = null;
// http/employee.routes.ts:  salary: z.string().nullable(),
```

The full contract (per-backend serializers, projections, the `policy` ladder it composes with) is in [`../auth.md`](../auth.md) § *Field masking — `mask unless`* and [Auth](17-auth.md) — not duplicated here.

A `function` is the reusable-expression knob; for a reusable *predicate* shared across aggregates as a named specification, see [`criterion.md`](../criterion.md); for a stateless cross-aggregate calculator, see [Domain services](23-domain-services-and-seeds.md).

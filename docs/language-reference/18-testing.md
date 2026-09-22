# 18. Testing

In-language tests live beside the domain they exercise. A `test "…" { }` block on an aggregate, value object or domain service is an **executable unit test** of pure domain logic; the same block nested directly in a `context` (or hoisted anywhere with `for <Context>`) is an **in-process integration test** over the wired repositories; a `test e2e "…" against <Deployable> { }` drives a *running* deployable end-to-end. One `expect(<actual>).<matcher>(…)` assertion vocabulary serves all three, and the e2e **surface is chosen automatically from the target deployable's platform** — a backend target lowers to a vitest+fetch suite, a frontend target to a Playwright spec over generated page objects. Reach for it when you want the spec generated and traced alongside the code it covers.

> **Grammar:** `TestBlock` (`test … [for <Subject>] [verifies TC] { }`), `TestSubject` (`Aggregate | ValueObject | DomainService | BoundedContext`), `TestE2E` (`test e2e … against … [verifies TC]`), `TestStatement`, `ExpectStmt` · **Matchers:** [`src/util/intrinsic-matchers.ts`](../../src/util/intrinsic-matchers.ts) · **Validators:** `loom.test-needs-target`, `loom.test-redundant-for`, `loom.context-test-unsupported` ([`src/language/validators/test-placement.ts`](../../src/language/validators/test-placement.ts)); `loom.aggregate-test-context`, `loom.integration-find-must-bind`, `loom.e2e-unsupported-statement`, `loom.e2e-unresolved-ref`, `loom.e2e-unresolved-call`, `loom.e2e-unknown-{aggregate,method,workflow}` ([`src/ir/validate/checks/test-checks.ts`](../../src/ir/validate/checks/test-checks.ts)); `expect`/matcher arity ([`src/language/validators/match.ts`](../../src/language/validators/match.ts)) · **Docs:** [`../testing.md`](../testing.md), [`../traceability.md`](../traceability.md), [`../conformance.md`](../conformance.md), [`../old/proposals/test-placement.md`](../old/proposals/test-placement.md)

> **Output sourcing.** Every fragment below is generated from one scratch `SalesSystem` (`node bin/cli.js generate system tests.ddd -o out`, 2026-09-03): a `Sales` context with a `Money` value object, `Product` / `Order` aggregates, a `Pricing` domain service, one hoisted and one context-level `test`, and two `test e2e` blocks — one `against api` (node), one `against webApp` (react); a second `dotnet` deployable supplies the xUnit tabs.

## `test "…"` — an in-process unit test

`test name=STRING ('for' target)? ('verifies' TraceId)? { TestStatement* }`. Nested in an **aggregate**, **value object** or **domain service**, the enclosing declaration is the subject. The body may `let`, construct (`Order.create({…})`, `Money { … }`), call operations and pure functions, and `expect`. A statement that mutates aggregate state from the test itself (`n := 2`) or guards it (`precondition` / `requires` / `emit`) is rejected with `loom.aggregate-test-context` — the test has no `this`. The optional `verifies TC-xxx` back-links the test to a `testCase` in the traceability graph ([Requirements & traceability](19-requirements-traceability.md)).

```ddd
valueobject Money {
  amount: decimal
  currency: string
  invariant amount >= 0
  test "money keeps its amount" {
    let m = Money { amount: 5.00, currency: "USD" }
    expect(m.amount).toBe(5.00)
  }
}

aggregate Order with crudish {
  customerId: string
  status: OrderStatus
  contains lines: OrderLine[]
  entity OrderLine { productId: Product id  qty: int }
  operation addLine(productId: Product id, qty: int) { precondition qty > 0  lines += OrderLine { productId: productId, qty: qty } }
  operation confirm() { precondition lines.count > 0  status := Confirmed }

  test "adding a line then confirming yields a confirmed order" verifies TC-001 {
    let order = Order.create({ customerId: "c-1", status: Draft })
    order.addLine("00000000-0000-0000-0000-000000000002", 2)
    order.confirm()
    expect(order.status).toBe(Confirmed)
    expect(order.lines.count).toBe(1)
    expect(order.addLine("00000000-0000-0000-0000-000000000002", 0)).toThrow()
  }
}

domainService Pricing {
  operation lineTotal(unit: Money, qty: int): decimal { return unit.amount * qty }
  test "lineTotal multiplies" {
    expect(Pricing.lineTotal(Money { amount: 2.50, currency: "USD" }, 4)).toBe(10.00)
  }
}
```

The block lowers to one runnable spec per subject, emitted next to the domain class on **all five backends** (`domain/order.test.ts` on node, `Tests/<App>.Tests/Orders/OrderTests.cs` on .NET, `src/test/java/…/OrderTests.java` on Java, `tests/test_order.py` on Python, `test/<ctx>/order_test.exs` on Elixir). Enum literals resolve to the generated enum, id strings to the branded constructors, and `.count` becomes the backend-native length.

::: tabs backend
== node
```ts
// api/domain/order.test.ts
import { describe, it, expect } from "vitest";
import { Order } from "./order";
import { OrderStatus } from "./value-objects";

describe("Order", () => {
  it("adding a line then confirming yields a confirmed order", () => {
    const order = Order.create({ customerId: "c-1", status: OrderStatus.Draft });
    order.addLine("00000000-0000-0000-0000-000000000002", 2);
    order.confirm();
    expect(order.status).toBe(OrderStatus.Confirmed);
    expect(order.lines.length).toBe(1);
    expect(() => { order.addLine("00000000-0000-0000-0000-000000000002", 0); }).toThrow();
  });
});
```
```ts
// api/domain/pricing.test.ts — the domain-service subject
describe("Pricing", () => {
  it("lineTotal multiplies", () => {
    expect(Pricing.lineTotal(new Money(2.50, "USD"), 4)).toBe(10.00);
  });
});
```
== dotnet
```csharp
// api_dotnet/Tests/ApiDotnet.Tests/Orders/OrderTests.cs — xUnit + AwesomeAssertions
public sealed class OrderTests
{
    [Fact(DisplayName = "adding a line then confirming yields a confirmed order")]
    public void Adding_a_line_then_confirming_yields_a_confirmed_order()
    {
        var order = Order.Create(customerId: "c-1", status: OrderStatus.Draft);
        order.AddLine(new ProductId(Guid.Parse("00000000-0000-0000-0000-000000000002")), 2);
        order.Confirm();
        order.Status.Should().Be(OrderStatus.Confirmed);
        order.Lines.Count.Should().Be(1);
        Assert.Throws<DomainException>(() => { order.AddLine(new ProductId(Guid.Parse("00000000-0000-0000-0000-000000000002")), 0); });
    }
}
```
```csharp
// Tests/ApiDotnet.Tests/Services/PricingTests.cs
[Fact(DisplayName = "lineTotal multiplies")]
public void LineTotal_multiplies()
{
    Pricing.LineTotal(new Money(2.50m, "USD"), 4).Should().Be(10.00m);
}
```
::: end

The test name becomes the vitest `it(...)` label verbatim; on xUnit it is both the `[Fact(DisplayName = …)]` and a snake-cased method name. The subject name is the `describe(...)` / class scope.

### Placement — `for <Subject>`

A `test` may live outside its subject. Reachability is not a home: the `for` head names the subject exactly when nothing encloses it.

| Where the `test` sits | `for` | Subject |
|---|---|---|
| nested in an aggregate / value object / domain service | forbidden (`loom.test-redundant-for`) | the enclosing declaration |
| nested in a `context`, no `for` | — | the **context** (integration test, below) |
| nested in a `context`, `for <Agg\|VO\|Service>` | required to hoist | that declaration — lands in its file (`order.test.ts` above also carries the hoisted test) |
| nested in a `context`, `for <that context>` | redundant (`loom.test-redundant-for`) | the context |
| at file root | required (`loom.test-needs-target`) | the named subject |

```ddd
context Sales {
  aggregate Order with crudish { … }
  test "an order starts as Draft" for Order {           // hoisted — emitted into order.test.ts / OrderTests.cs
    let order = Order.create({ customerId: "c-2", status: Draft })
    expect(order.status).toBe(Draft)
  }
}
```

### Context integration tests

A `test` nested directly in a `context` (no `for`) is an **in-process integration test** — it boots the context's repositories against a real Postgres (`LOOM_PG_URL`, migrations applied) with **no HTTP**, so cross-aggregate persistence can be asserted without a deployable. Emitted on node, python, dotnet, java, and elixir (`test/<ctx>.integration.test.ts`, `Tests/<App>.Tests/<Ctx>IntegrationTests.cs`, …); a context hosted only on a frontend deployable warns `loom.context-test-unsupported`.

```ddd
context Sales {
  test "a saved order can be read back" {
    let o = Order.create({ customerId: "c-3", status: Draft })
    let read = Order.findById(o.id)
    expect(read.customerId).toBe("c-3")
  }
}
```

The persistence vocabulary is the aggregate-rooted `<Agg>.findById(id)` (a `let`-bound read — inside `expect(...)` it is `loom.integration-find-must-bind`); a factory-`let` is saved for you. Emitted (node):

```ts
// api/test/sales.integration.test.ts
beforeAll(async () => {
  const pool = new Pool({ connectionString: process.env.LOOM_PG_URL ?? "postgres://postgres:postgres@localhost:5432/postgres" });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: "./db/migrations" });
  repos = { order: new OrderRepository(db, NoopDomainEventDispatcher) };
});

describe("Sales (integration)", () => {
  it("a saved order can be read back", async () => {
    const o = Order.create({ customerId: "c-3", status: OrderStatus.Draft });
    await repos.order.save(o);
    const read = (await repos.order.findById(o.id))!;
    expect(read.customerId).toBe("c-3");
  });
});
```

> A repository call spelled the workflow way (`Orders.save(o)` / `Orders.getById(…)`) is **not** part of this vocabulary and is currently rendered verbatim (an unresolved identifier in the emitted test) without a diagnostic — use `<Agg>.findById` and let the factory save.

## `test e2e "…" against <Deployable>` — a live end-to-end test

`test e2e name=STRING 'against' deployable=[Deployable] ('verifies' TraceId)? { … }` is a system-level test (declared in the `system` body, not inside an aggregate) that drives a deployment. The body talks to the deployable through a **magic dispatcher** — `api.<aggregate>.<verb>(…)` against a backend, `ui.<aggregate>.<verb>(…)` against a frontend — plus `let` and `expect`. Domain mutations and guards are rejected (`loom.e2e-unsupported-statement`); an e2e body resolves no domain names, so a bare enum value (`st: On` instead of `"On"`) is `loom.e2e-unresolved-ref` and an unknown function `loom.e2e-unresolved-call` (the conversions `money(…)`, `decimal(…)`, `string(…)`, `int(…)` are built in); an unknown aggregate / verb / workflow is caught against the deployable's hosted contexts (`loom.e2e-unknown-aggregate` — whose message names the deployable's workflows as well as its aggregates, `loom.e2e-unknown-method` — which also covers a folded projection's `byKey` / `list` and a workflow's three verbs, `loom.e2e-unknown-workflow`).

The verb vocabulary per aggregate is `create`, `getById`, `all` (the paged list), every **public** operation, every repository `find`, `update` / `destroy` when declared, plus `api.<projection>.byKey(…)` / `.list()`, a workflow's own `api.<workflow>.run(…)` / `.instances()` / `.instance(key)`, and an explicit route's `api.<context>.<handler>(…)` (both below).

#### Calling a routed handler

An explicit `route <METHOD> <PATH> -> <Context>.<Handler>` binding in the api block (see [Apis, storage, resources, channels](14-apis-storage-resources-channels.md)) is reached through the **same two-level shape**, with the bounded CONTEXT in the slug position and the HANDLER in the method position — the spelling the route arrow already uses:

```ddd
api A from D {
  route POST "/echo/{text}"                   -> Sales.Echo
  route GET  "/sum/{a}/{b}"                   -> Sales.Sum
  route GET  "/orders/{orderId}/replacements" -> Sales.CountReplacing
}

test e2e "routed handlers answer" against d {
  expect(api.sales.echo("hi")).toBe("hi")
  expect(api.sales.sum(2, 3)).toBe(5)
  expect(api.sales.countReplacing("11111111-1111-4111-8111-111111111111")).toBe(0)
}
```

```ts
// e2e/HandlerTriad.e2e.test.ts
expect(await __route("POST", `${base}/api/echo/${encodeURIComponent(String("hi"))}`)).toBe("hi");
expect(await __route("GET", `${base}/api/sum/${encodeURIComponent(String(2))}/${encodeURIComponent(String(3))}`)).toBe(5);
expect(await __route("GET", `${base}/api/orders/${encodeURIComponent(String("11111111-1111-4111-8111-111111111111"))}/replacements`)).toBe(0);
```

Arguments are **positional, in declared param order**. A param whose name is a `{token}` in the path substitutes into the URL; every other param rides the JSON request body — the same split each backend's explicit-route emitter performs. The method comes off the route, not off the verb name.

Two refusals guard the shape: a wrong argument count is `loom.e2e-routed-handler-arity` (arguments bind positionally, so a miscount shifts every later one), and a `GET`/`DELETE` route whose handler declares a param no `{token}` binds is `loom.e2e-routed-handler-bodyless-method` — the backends read that param from a request body those methods cannot carry, so the argument would silently vanish.

An aggregate verb always wins: a routed handler is consulted only when the slug names no aggregate, or names one that does not have the verb. So a context whose name slugs like an aggregate changes no existing call.

Resolving the verb's NAME is only half the check. A second, phase-⑦ gate asks whether the route it lowers to is one **this same compilation emits**, resolving each verb against `deriveAggregateOperations` (`src/ir/util/api-surface.ts`) — the derivation all five backend route builders render from — and raising `loom.e2e-unrouted-verb` when it does not. This matters because several routes are conditional: `POST /api/<plural>` appears only for an aggregate with a canonical `create` (hand-written or `with crudish`), `DELETE /api/<plural>/{id}` only for an unnamed `destroy`, `GET /api/<plural>/{id}/history` only when `auditable`, and a find route only for a *declared* find. Until this gate landed, `api.products.create({…})` on a `create`-less aggregate compiled with `0 error(s), 0 warning(s)` and emitted a suite that POSTed to a route the same run had not mounted — `405 Method Not Allowed`, three failures out of three, from a model the compiler had just called clean. On the `ui` side the same code covers the page-object vocabulary: `create` (only where the scaffolded `New` page survives, i.e. the same create-surface gate), `getById`, and a public operation — a `ui.<agg>.<find>(…)` drives no page object.

### Against a backend — vitest + fetch

```ddd
test e2e "create, add a line to, and confirm an order" against api {
  let prod = api.products.create({ sku: "WIDGET-2", price: { amount: 5.00, currency: "USD" } })
  let ord  = api.orders.create({ customerId: "c-9", status: "Draft" })
  api.orders.addLine(ord, { productId: prod.id, qty: 3 })
  api.orders.confirm(ord)
  let read = api.orders.getById(ord)
  expect(read.status).toBe("Confirmed")
  expect(read.lines.length).toBe(1)
  api.orders.destroy(ord)
  expect(api.orders.getById(ord)).toThrow(404)
}
```

`api.<agg>.create(...)` → `POST /api/<plural>`, `getById` → `GET /api/<plural>/{id}`, an operation `addLine` → `POST /api/<plural>/{id}/add_line`, `destroy` → `DELETE /api/<plural>/{id}` (asserted as 204 + empty body). The suite reads its base URL from `E2E_<DEPLOYABLE>_BASE` (defaulting to the compose port) and forwards a principal when the target is `auth: required` — `E2E_BEARER_TOKEN` (OIDC) or `E2E_DEV_CLAIMS` (base64-JSON into `x-loom-dev-claims`).

```ts
// e2e/SalesSystem.e2e.test.ts — emitted once at the output root
const ENDPOINTS: Record<string, string> = {
  api: process.env.E2E_API_BASE ?? "http://localhost:3000",
  api_dotnet: process.env.E2E_API_DOTNET_BASE ?? "http://localhost:3002",
  web_app: process.env.E2E_WEB_APP_BASE ?? "http://localhost:3001",
};
// __post / __get / __delete helpers elided — they fetch, check status before parsing, throw on !ok.

describe("SalesSystem e2e", () => {
  it("create, add a line to, and confirm an order against api", async () => {
    const base = ENDPOINTS.api;
    const prod = await __post(`${base}/api/products`, ({ sku: "WIDGET-2", price: ({ amount: 5.00, currency: "USD" }) }));
    // …
  });
});
```

> The api-e2e suite is emitted as a single vitest+fetch file regardless of backend platform (it talks HTTP, so it is target-language-neutral) — there is no per-backend xUnit/ExUnit api-e2e variant. Only the in-process `test` blocks diverge per backend.

### Driving a workflow — `run` / `instances` / `instance`

A `test e2e` body reaches the **orchestration tier** through the workflow's own name in the slug position. Three verbs, onto the three routes every backend already mounts (`POST /api/workflows/<snake>`, `GET …/instances`, `GET …/instances/{key}`):

```ddd
test e2e "the command create persists a saga row and the reactor folds it" against d {
  let ord = api.orders.create({ sku: "SKU-1", status: "Placed" })
  api.fulfillment.run({ orderId: ord.id })

  let running = api.fulfillment.instances()
  expect(running.length).toBe(1)
  let started = api.fulfillment.instance(ord)
  expect(started.status).toBe("Pending")

  // The reactor's fold, over the wire: `ship()` emits, `on(e: OrderShipped)`
  // folds, and the SAME row reads back changed.
  api.orders.ship(ord)
  let shipped = api.fulfillment.instance(ord)
  expect(shipped.status).toBe("Shipped")
  expect(shipped.attempts).toBe(1)
}
```

```ts
// e2e/WorkflowCreateState.e2e.test.ts
const ord = await __post(`${base}/api/orders`, ({ sku: "SKU-1", status: "Placed" }));
await __post(`${base}/api/workflows/fulfillment`, ({ orderId: ord.id }));
const running = await __get(`${base}/api/workflows/fulfillment/instances`);
expect(running.length).toBe(1);
const started = await __get(`${base}/api/workflows/fulfillment/instances/${ord.id}`);
expect(started.status).toBe("Pending");
```

- `run(body?)` POSTs the workflow's **command** route; the single argument is the facade's `create` params by name, exactly like `api.<aggs>.create({…})`. It answers `204`, so bind it only if you want the empty body.
- `instances()` lists the persisted correlation rows; `instance(key)` reads one by its **correlation key**. Both return the workflow's instance wire shape — the correlation field plus its state fields — which is what makes a folded saga's scalars assertable.
- Like every other e2e accessor, a `let`-bound argument gets `.id` appended: `api.fulfillment.instance(ord)` reads `…/instances/${ord.id}`.
- The slug is the workflow's name (`fulfillment` / `schedule_visit`); the emitted path is always `snake`. An **aggregate** slug wins a collision, so no existing call changes meaning.

Both halves are route-contract checked (`loom.e2e-unrouted-verb`), because both routes are conditional: an **event-triggered** workflow is a reactor the in-process dispatcher starts and mounts no `POST`, so `.run()` on one is refused (drive the operation that emits its trigger event instead); a workflow with **no correlation field** persists no row, so `.instances()` / `.instance(key)` on one is refused. The two conditions are independent — a reactor still has readable instances, and a stateless command workflow still has a `run`.

The **body and the read are checked too**, against the same inputs the backends build their DTOs from — `wf.params` for `<Wf>Request`, `instanceWireShape` for `<Wf>InstanceResponse`:

- `api.<wf>.run({…})` — a key the facade does not declare is `loom.e2e-unknown-body-key`, and an omitted required parameter `loom.e2e-missing-required-field`. Note the asymmetry, which the two messages state: a **missing** key really does fail the schema (422), but an **extra** one does not — `<Wf>Request` is a plain object schema on every backend, so an unknown key is silently dropped and the POST still answers `204`. The body sends something the workflow never receives, and an assertion resting on it goes green having proved nothing. A parameter carrying an `= default` is still required on the wire: the default is applied in the body, after the schema has already run.
- `let one = api.<wf>.instance(key)` — a read of a field the row does not carry is `loom.e2e-unknown-response-field`. Readable is the correlation field followed by the state fields, in declaration order. `instances()` is deliberately **not** judged: its binding is a JSON array, so a member on it (`running.length`) is an array member and not an instance field, exactly as an aggregate's `all()` is excluded for its paged envelope.


### Against a frontend — Playwright over page objects

The *same* DSL, retargeted at a frontend deployable, lowers to a Playwright spec. `ui.<agg>.create(...)` walks the generated List → New → Detail page objects; `getById` re-opens the Detail page; an operation calls the detail-page method. No fetch — it drives the rendered UI.

```ddd
test e2e "place and confirm an order through the UI" against webApp verifies TC-001 {
  let prod = ui.products.create({ sku: "UI-WIDGET", price: { amount: 5.00, currency: "USD" } })
  let ord  = ui.orders.create({ customerId: "c-8", status: "Draft" })
  ui.orders.addLine(ord, { productId: prod.id, qty: 2 })
  ui.orders.confirm(ord)
  let read = ui.orders.getById(ord)
  expect(read.status).toHaveText("Confirmed")
  expect(read.lines).toHaveCount(1)
}
```

```ts
// web_app/e2e/SalesSystem.ui.spec.ts
import { test, expect } from "./fixtures";
import { ProductListPage } from "./pages/product";
import { OrderListPage, OrderDetailPage } from "./pages/order";

test("place and confirm an order through the UI", async ({ page }) => {
  const prod = await (async () => {   const __list = await new ProductListPage(page).goto();   const __new = await __list.create();   await __new.fill(({ sku: "UI-WIDGET", price: ({ amount: 5.00, currency: "USD" }) }));   const __detail = await __new.submit();   return { id: __detail.id }; })();
  const ord = await (async () => {   const __list = await new OrderListPage(page).goto();   const __new = await __list.create();   await __new.fill(({ customerId: "c-8", status: "Draft" }));   const __detail = await __new.submit();   return { id: __detail.id }; })();
  await new OrderDetailPage(page, ord.id).goto().then((__d) => __d.addLine(({ productId: prod.id, qty: 2 })));
  await new OrderDetailPage(page, ord.id).goto().then((__d) => __d.confirm());
  const read = await new OrderDetailPage(page, ord.id).goto();
  await expect(read.field("status")).toHaveText("Confirmed");
  await expect(read.linesRows()).toHaveCount(1);
});
```

Assert against a **`getById`-bound** read, as above. A locator assertion taken straight off a `create` result (`let o = ui.orders.create({…})` … `expect(o.reference).toHaveText("…")`) parses and validates clean but currently **crashes `generate system`** (`expect requires a matcher …` out of `renderExpectStmt`) — re-open the row with `getById` first.

`ui.workflows.<name>(…)` resolves through the generated workflow page object. The page objects (`web_app/e2e/pages/<agg>.ts`) are emitted from the same UI shape under [`src/generator/_frontend/`](../../src/generator/_frontend/) and shared across the frontends.

## Automatic api-vs-ui dispatch

There is **no DSL keyword** selecting the surface — the test's kind comes from the **target deployable's platform** (`descriptorFor(platform).isFrontend`): a frontend-only platform lowers to `ui` (Playwright), a backend to `api` (vitest+fetch). Both magic receivers are always bound, so the body's `api.` / `ui.` root must simply match what the kind renders. Retargeting a test from `against api` to `against webApp` and swapping the receiver is the *only* change needed to move from fetch to Playwright; the call shapes are identical.

| Target platform | Kind | Lowers to | Call shape |
|---|---|---|---|
| `node` / `dotnet` / `java` / `python` | `api` | vitest + `fetch` | `POST`/`GET`/`DELETE` against `/api/<plural>` |
| `react` / `vue` / `svelte` / `angular` / `feliz` / `flutter` (and `static`) | `ui` | Playwright spec | generated page-object navigation |
| `elixir` (fullstack — may mount a HEEx ui) | either | decided per block by its call root: a `ui.…` body → Playwright, an `api.…` body → fetch | — |

## Matchers — the `expect(<actual>).<matcher>(…)` vocabulary

A bare `expect <bool>` is rejected: every `expect` **must** end in an intrinsic matcher (`checkExpectMatcher` — *"'expect' requires a matcher — write 'expect(<actual>).toBe(<expected>)' (or .toThrow(), .toHaveText(…), …), not a bare expression."*). The catalogue is a fixed table — adding one is a table entry plus a per-backend lowering, no renderer special-case.

| Matcher | Arity | Reads | Notes |
|---|---|---|---|
| `toBe(x)` | 1 | value | strict equality |
| `toBeGreaterThan(x)` / `…OrEqual(x)` | 1 | value | numeric comparison |
| `toBeLessThan(x)` / `…OrEqual(x)` | 1 | value | numeric comparison |
| `toHaveText(s)` | 1 | locator | auto-retrying DOM-text assertion (ui) |
| `toHaveCount(n)` | 1 | locator | auto-retrying row/element count (ui) |
| `toBeVisible()` | 0 | locator | element is visible (ui) |
| `toBeSameInstant(iso)` | 1 | value | two ISO-8601 timestamps compared as instants (forgives `…00.0000000Z` vs `…00Z`); **`test e2e` only** — in a unit test it is rejected (*"'toBeSameInstant' compares wire timestamps and is only valid in a 'test e2e' block"*) |
| `toBeNull()` | 0 | value | the value is the language's one absence value (below) |
| `toBeAbsent()` | 0 | value | the KEY is not in the payload; **`test e2e` only** (below) |
| `toContain(x)` | 1 | value | collection membership or substring, by the subject's type (below) |
| `toThrow()` / `toThrow(<status>)` / `toThrow(<kind>)` | 0–1 | value | the throw assertion (below) |

Each `on: "locator"` matcher is **web-first**: against a UI it asserts on the live, auto-retrying Playwright locator rather than a snapshotted value — `expect(read.status).toHaveText("Confirmed")` lowers to `await expect(read.field("status")).toHaveText("Confirmed")`, and `expect(read.lines).toHaveCount(1)` to `await expect(read.linesRows()).toHaveCount(1)`. A `not.` prefix negates any `negatable` matcher (every matcher except `toThrow`). Arity is enforced by `checkMatcherArity`; `toThrow` is exempt (variable arity) and validated separately.

### Absence — `toBeNull()` / `toBeAbsent()`

Loom has **one** absence value. The wire has **two spellings of it**, and the
five backends have genuinely disagreed about which they send — which is why
`test/fixtures/corpus/absent-optional.ddd` exists. The pair lets a test pin the
spelling deliberately:

```ddd
expect(read.estimate).toBeNull()      // present, explicitly null
expect(read.estimate).toBeAbsent()    // the key is not in the payload at all
```

```ts
// generated (api e2e) — the second is rewritten onto the RECEIVER, because a
// value that has already evaluated to `undefined` cannot tell you whether its
// key was there.
expect(read.estimate).toBeNull();
expect("estimate" in read).toBe(false);
```

What stops that from being backend-roulette is not the author's care but the
**conformance gate**: every behavioural leg diffs its recording against the
committed wire golden with `diffBodies`, which unions both key sets and raises
a `key-set` divergence. The enforced contract today is **explicit null on all
five backends** — [RS-35](../conformance-semantics.md) — so `toBeNull()`
asserts the gated reality, and `toBeAbsent()` has **no passing subject on any
backend**. It is deliberately *not* special-cased into passing: a matcher that
says "this backend omitted the key" is how the next divergence gets caught.

`toBeAbsent()` is **`test e2e` only** (`loom.unit-absent-invalid`). "The key is
not in the payload" needs a payload to be about; a unit `test` asserts against
an in-memory aggregate, where a declared field always exists — on three of the
five backends (C# `int?`, Java `Integer`, an Elixir struct's `nil` default)
in-process absence is not observable at all. Lowering it there could only
degrade it to a null check — making it a silent synonym for `toBeNull()`, one
name carrying two strengths of claim — or emit an assertion that can never
pass. Use `toBeNull()` in a unit test; in-process, that is the whole of Loom's
absence.

Its subject must be a **field read** (`loom.absent-receiver-invalid`): the
generated form needs an object and a key to look for.

**Neither absence matcher is legal in a ui `test e2e` body**
(`loom.e2e-ui-absence-invalid`) — the same ruling `loom.e2e-ui-throw-invalid`
makes for `toThrow`, for the same reason. A ui assertion lowers onto
`(await <row>.field("…").innerText())`, which is always a string: `toBeNull()`
can never hold there, and `toBeAbsent()` is not a matcher the test runtime
defines at all, so the emitted spec would fail to run before asserting
anything. Assert what the page actually shows — `toHaveText("")` for an empty
cell, `toBeVisible()` for a field that should or should not be there — or move
the absence claim to a block targeting a backend deployable.

`toContain` is deliberately NOT swept up by that refusal: a substring of the
text the page rendered is a real, useful claim, so it stays legal in all three
tiers.

### `toContain()` — membership or substring

One matcher, two lowerings, chosen by the **subject's type**:

```ddd
expect(read.tags).toContain("urgent")   // collection membership
expect(read.title).toContain("Ship")    // substring
```

```elixir
# generated (elixir) — the one backend where the two lowerings are genuinely
# two different calls:
assert "urgent" in read.tags
assert String.contains?(read.title, "Ship")
```

Most targets spell both the same way — `in` in Python, `.contains(...)` in
Java, `Contain` in AwesomeAssertions, and vitest's own `toContain` dispatches
at run time — so only Elixir has to branch, and it *must*: `in` on a binary
raises `Protocol.UndefinedError` and `String.contains?/2` on a list raises
`FunctionClauseError`, so the wrong choice crashes the generated suite rather
than returning a wrong answer. The dispatch reads the subject's resolved type
off the IR, which phase ⑤ has already fully resolved.

Any other subject type is refused at the author's own source span
(`loom.contain-receiver-invalid`) — there is no third lowering, and without the
refusal each backend would invent its own answer.

### `toThrow()` — the throw assertion

`expect(<call>).toThrow()` asserts the call rejects. The lowering recognises the matcher and rewrites the `expect` into an `expect-throws` IR node, so every backend renders it as its idiomatic throw assertion. The bare form is valid in both unit and **api** e2e bodies; the single-argument form `toThrow(<status>)` **pins an HTTP status** and is only legal in a `test e2e` body (*"'toThrow(<status>)' pins an HTTP status and is only valid in a 'test e2e' block; use a bare 'toThrow()' in an in-process test."*) — the argument is an integer literal (`toThrow(404)`).

```ddd
// unit test — wrap the mutating call
expect(order.addLine("…", 0)).toThrow()
// api e2e — the negative path, pinned to a status
expect(api.orders.getById(ord)).toThrow(404)
```

**Neither form is legal in a UI e2e body** — a `test e2e` block whose target is a frontend deployable, which lowers to a Playwright spec driven through the generated page objects. `loom.e2e-ui-throw-invalid` rejects it at parse time. There is no HTTP response there to assert against: the emitted form validates **client-side** against a schema derived from the aggregate's own invariants, so an invalid submit issues no request at all — and the page object's `submit()` awaits the detail page's testid, which an invalid form never renders, so a throw assertion could only ever settle on a timeout.

This is a deliberate permanent refusal, not a gap: an HTTP status and a form-error DOM state are different assertions, and `toThrow` names the first. Assert the UI's negative path as the DOM state it actually is —

```ddd
// ui e2e — assert the rendered state, not a status
let read = ui.orders.getById(ord)
expect(read.status).toHaveText("Draft")
```

— or move the status assertion to a block written `against <backend-deployable>`, where a real response carries one.

#### `toThrow(precondition)` / `toThrow(invariant)` — which rule rejected

A bare `toThrow()` asserts only that *something* threw, and the domain floor has more than one rung. The 2026-09-13 testability audit found out the hard way: it deleted a `precondition` from a generated aggregate as a mutation probe and **the test stayed green**, because a guarded collection `invariant` threw in its place. A test named *"a fresh work order cannot be completed"* went on claiming something it no longer proved (F11).

The single-argument **kind** form pins the rung. It is legal only in a unit `test`.

```ddd
test "a fresh work order cannot be completed" {
  let wo = WorkOrder.create({ reference: "WO-1", customerName: "Ada", status: Draft })
  expect(wo.complete()).toThrow(precondition)
}
```

`precondition` and `invariant` are **keywords, not values** — they parse through a dedicated grammar slot and are legal only in this one argument position. Anywhere else (`expect(x).toBe(invariant)`, `wo.complete(precondition)`) the word would be silently dropped in lowering, so `loom.throw-kind-outside-tothrow` rejects it at the source span. `requires` is deliberately **not** a rung here: it is an authorization gate (403) needing a principal the unit tier has no vocabulary for.

**Three refusals bound the form**, each for a different reason:

| Code | When | Why |
|---|---|---|
| `loom.e2e-throw-kind-invalid` | in a `test e2e` body | Over HTTP both rungs answer **422**, and their only discriminator is the RFC 7807 `detail` sentence — which an authored `message "…"` on the rule overwrites. One matcher meaning two strengths of claim is the defect [#2959](https://github.com/Loom-Harness/Loc/pull/2959) fixed on the ui side. The e2e body keeps `toThrow(<status>)`. |
| `loom.throw-kind-integration-unsupported` | in a context-integration `test` | That rung renders through each backend's separate `integration-tests.ts`, which carries no rung — the argument would be dropped and the test would quietly assert only that something threw. |
| `loom.throw-kind-custom-message` | the rule under test carries `message "…"` | The node / python / java / .NET domain layers discriminate on the derived `"Precondition failed: "` / `"Invariant violated: "` prefix, and an authored message **replaces** that string. Elixir alone is structural — but one unit `test` is emitted for all five backends. Drop the `message`, or assert the bare `toThrow()` and pin the wording in a `test e2e` block, where the message is the RFC 7807 `detail`. |

::: tabs backend
== node
```ts
expect(() => { wo.complete(); }).toThrow(/^Precondition failed: /);
```
== python
```python
with pytest.raises(Exception, match=r"^Precondition failed: "):
    wo.complete()
```
== java
```java
DomainException __thrown1 = assertThrows(DomainException.class, () -> wo.complete());
assertTrue(__thrown1.getMessage().startsWith("Precondition failed: "),
    "expected a precondition to reject this call, but it threw: " + __thrown1.getMessage());
```
== dotnet
```csharp
var __thrown1 = Assert.Throws<DomainException>(() => { wo.Complete(); });
Assert.StartsWith("Precondition failed: ", __thrown1.Message);
```
== elixir
```elixir
# structural, not textual: GuardError is `defexception [:message, :kind]`
__thrown1 = assert_raise D.GuardError, fn -> D.Work.WorkOrder.complete(wo, %{}) end
assert __thrown1.kind == :precondition
```
::: end

**One backend asymmetry**, worth knowing before you reach for it. On **elixir**, `toThrow(invariant)` over an *aggregate operation* emits a `@tag :skip` carrying its reason. The vanilla pure op core runs preconditions and an in-memory struct update; aggregate invariants live in the Ecto changeset (`validate_invariants/1`), which no in-memory op call reaches. `toThrow(invariant)` over a `create` or a value-object construction runs normally there — both go through the changeset.

::: tabs backend
== node
```ts
// unit: the actual is wrapped in a thunk so vitest can catch the throw
expect(() => { order.addLine("00000000-0000-0000-0000-000000000002", 0); }).toThrow();
// e2e: the pinned status becomes a status-match against the fetch helper's error message
await expect(async () => { await __get(`${base}/api/orders/${ord.id}`); }).rejects.toThrow(/→ 404\b/);
```
== dotnet
```csharp
Assert.Throws<DomainException>(() => { order.AddLine(new ProductId(Guid.Parse("00000000-0000-0000-0000-000000000002")), 0); });
```
::: end

## Tracing tests back to requirements

The optional `verifies TC-xxx` clause on both `test` and `test e2e` links the spec to a `testCase`, which in turn `verifies` a `requirement`. `ddd generate system` emits the coverage/gaps rollup under `.loom/`, and `ddd verify --results <results.json>` joins an external test-results file onto that graph to produce per-requirement Definition-of-Done verdicts. The wiring (`requirement → solution → testCase → test`) is covered in [Requirements & traceability](19-requirements-traceability.md); cross-backend behavioral execution of these suites is [`../conformance.md`](../conformance.md).

# Demo: Acme — product catalog + sales orders, end to end

A short tour of what Loom does with one model.  The source is
[`acme.ddd`](acme.ddd): three subdomains, four deployables on three
platforms (.NET, Hono, React), a docker-compose stack, DSL-level e2e
tests, Playwright UI specs and requirement traceability.

## The tour

Run these from the repository root after the README's
[Quickstart](../README.md#quickstart) setup (`npm install`):

```sh
# Generate the Acme system into ./acme-out.
node bin/cli.js generate system examples/acme.ddd -o ./acme-out

# Bring it up.  The first boot builds every image and takes a few minutes.
cd acme-out
docker compose up -d --build --wait

# Hit the .NET API.  Every route is under /api.
curl -X POST http://localhost:8080/api/products \
    -H 'Content-Type: application/json' \
    -d '{"sku":"WIDGET-1","price":{"amount":9.99,"currency":"USD"}}'
curl http://localhost:8080/api/products

# The React frontend.
open http://localhost:3001     # or xdg-open, or just paste it in a browser
```

No hand-written controllers, migrations or forms: the `.ddd` source is the
single source of truth.  Each backend's full surface is `GET /openapi.json`.

## What's in the source

`acme.ddd` declares one `system` with three **subdomains** (`Catalog`,
`Sales`, `CustomerMgmt`), each holding one bounded **context**, plus the
`api`s, `storage`, `resource`s and **deployables** that ship them.

### Catalog — a value object and an aggregate

```ddd
context Products {

    valueobject Money {
        amount: decimal
        currency: string
        invariant amount >= 0
        invariant currency.length == 3
    }

    aggregate Product with crudish {
        sku: string
        price: Money
        invariant sku.length > 0
        derived display: string = sku
    }

    repository Products for Product { }
    criterion ProductsBySku(sku: string) of Product = this.sku == sku
}
```

What you get, on the Hono deployable (`catalog_web/`):

| File | Role |
| --- | --- |
| `domain/value-objects.ts` | `Money` with constructor-checked invariants |
| `domain/product.ts` | `Product` with private setters and a `create` factory |
| `domain/ids.ts` | Branded `ProductId` |
| `db/schema.ts` | Drizzle table: `id`, `sku`, `price_amount`, `price_currency` |
| `db/repositories/` | `findById`, `save`, `findAll`, … |
| `http/product.routes.ts` | OpenAPI-typed `POST /api/products`, `GET /api/products`, `GET /api/products/{id}`, plus the `crudish` update and destroy routes |

`with crudish` is a macro that adds the create / update / destroy
lifecycle.  The .NET deployables produce the same wire shape on EF Core,
ASP.NET controllers and Mediator command/query handlers.

### Sales — parts, operations, events, a query and a workflow

```ddd
context Orders {

    enum OrderStatus { Draft, Confirmed, Shipped, Cancelled }

    event OrderConfirmed { order: Order id, at: datetime }

    aggregate Order with crudish {
        customerId: string
        status: OrderStatus
        placedAt: datetime
        contains lines: OrderLine[]

        invariant lines.count > 0 when status == Confirmed

        function isMutable(): bool = status == Draft

        operation addLine(productId: Product id, qty: int) {
            precondition isMutable()
            precondition qty > 0
            lines += OrderLine {
                productId: productId, quantity: qty
            }
        }

        operation confirm() {
            precondition isMutable()
            precondition lines.count > 0
            status := Confirmed
            emit OrderConfirmed { order: id, at: now() }
        }

        entity OrderLine {
            productId: Product id
            quantity: int
            invariant quantity > 0
        }
    }

    repository Orders for Order { }
    criterion OrdersByCustomer(customerId: string) of Order = this.customerId == customerId
    queryHandler ListOrdersByCustomer(customerId: string): Order[] {
      let r = Orders.all(OrdersByCustomer(customerId))
      return r
    }

    workflow placeOrder {
      create(customerId: string, productId: Product id, quantity: int) {
        precondition quantity > 0
          let order = Order.create(
              customerId: customerId,
              status: Draft,
              placedAt: now()
          )
          order.addLine(productId, quantity)
      }
    }
}
```

Highlights:

- **`contains lines: OrderLine[]`** declares an entity part.  Loom
  generates the parent foreign key, the upsert in `save` and the
  whole-tree load in `findById`.
- **Invariants** are checked after every mutation.  A failed invariant
  or `precondition` is a domain error, answered with HTTP 422.
- **`function`** is pure: usable from invariants, derived fields and
  other operations.
- **`operation`** is what mutates state.  Each one becomes
  `POST /api/orders/{id}/<op>` (`/api/orders/{id}/add_line`,
  `/api/orders/{id}/confirm`) with a validated request body.
- **`emit`** records a domain event that is dispatched when the
  aggregate is saved.
- **`queryHandler`** is a named read; the `SalesApi` contract routes it
  as `GET /api/orders/by_customer/{customerId}`.
- **`workflow`** orchestrates several steps in one transaction and is
  served as `POST /api/workflows/place_order`; the frontend gets a page
  for it.

### Cross-aggregate references — by id only

Aggregates reference each other by id: `productId: Product id` is a
typed foreign key.  Writing `productId: Product` instead is rejected
(`loom.bare-aggregate-in-type`).  This is the DDD rule "aggregates
compose by id, not by reference", enforced by the validator.

### CustomerMgmt — validation rules at every layer

The `Customer` aggregate shows the wire-boundary validation: a `check`
on a property (`age: int check age >= 18 && age <= 150`) or an
`invariant` is enforced in the React form, at the backend route, and in
the domain model.  A `private invariant` stays out of the wire layers
and is enforced only in the domain.  The comments in `acme.ddd` walk
through each rule.

### Deployables — one source, three runtimes

```ddd
api CatalogApi      from Catalog
api SalesApi        from Sales {
  route GET "/orders/by_customer/{customerId}" -> Orders.ListOrdersByCustomer
}
api CustomerMgmtApi from CustomerMgmt

storage primarySql { type: postgres }
resource productsState  { for: Products, kind: state, use: primarySql }
resource ordersState    { for: Orders, kind: state, use: primarySql }
resource customersState { for: Customers, kind: state, use: primarySql }

deployable api {
    platform: dotnet
    contexts: [Products, Orders, Customers]
    dataSources: [productsState, ordersState, customersState]
    serves: CatalogApi, SalesApi, CustomerMgmtApi
    port: 8080
}

deployable catalogWeb {
    platform: node
    contexts: [Products, Customers]
    dataSources: [productsState, customersState]
    serves: CatalogApi, CustomerMgmtApi
    port: 3000
}

deployable catalogApi {
    platform: dotnet
    contexts: [Products, Customers]
    dataSources: [productsState, customersState]
    serves: CatalogApi, CustomerMgmtApi
    port: 8081
}

deployable webApp {
    platform: static
    targets: api
    ui: WebApp { Catalog: api, Sales: api, CustomerMgmt: api }
    port: 3001
}
```

One `docker-compose.yml` wires the four projects to a shared Postgres
(`8080`, `3000`, `8081` and `3001` on the host).  Three things to notice:

1. **`api` and `catalogApi` are both .NET, with different `contexts:`.**
   Each deployable compiles only the contexts it lists, so the same
   source produces different binaries.
2. **`catalogApi` (.NET) and `catalogWeb` (Hono) serve the same
   contracts on different runtimes.**  The `.loom/wire-spec.json`
   artifact and the cross-platform OpenAPI check in CI keep their wire
   shapes identical.
3. **`webApp` targets `api`** and binds each of the `WebApp` ui's api
   parameters to it.  `platform: static` builds the ui's framework
   (React with Mantine by default) into a static bundle; the
   `scaffold(subdomains: …)` macro on `ui WebApp` generates its list,
   detail and form pages.

## Tests — declared in `.ddd`, run against the live stack

```ddd
test e2e "create then confirm an order with one line" against api {
    let prod = api.products.create({ sku: "WIDGET-2", price: { amount: 5.00, currency: "USD" } })
    let ord = api.orders.create({ customerId: "cust-001", status: "Draft", placedAt: "2024-01-01T00:00:00Z" })
    api.orders.addLine(ord, { productId: prod.id, qty: 3 })
    api.orders.confirm(ord)
    let read = api.orders.getById(ord)
    expect(read.status).toBe("Confirmed")
    expect(read.lines.length).toBe(1)
}
```

The tests sit in `system Acme`, next to the deployables they target.
This one lowers to
a vitest spec, `e2e/Acme.e2e.test.ts`, that talks HTTP+JSON to the `api`
deployable.  `api.<aggregate>.<verb>(…)` lowers to typed `fetch` calls
built from the same schemas the backend emits.

A test whose target is the frontend deployable lowers to Playwright
through generated page objects instead:

```ddd
test e2e "create then confirm an order via UI" against webApp {
    let prod = ui.products.create({ sku: "WIDGET-UI-1", price: { amount: 5.0, currency: "USD" } })
    let ord = ui.orders.create({ customerId: "cust-ui", status: "Draft", placedAt: "2024-01-01T00:00" })
    ui.orders.addLine(ord, { productId: prod.id, qty: 3 })
    ui.orders.confirm(ord)
    let read = ui.orders.getById(ord)
    expect(read.status).toHaveText("Confirmed")
    expect(read.lines).toHaveCount(1)
}
```

It becomes `web_app/e2e/Acme.ui.spec.ts`: no selectors and no waits,
because `ui.<aggregate>` resolves to a generated page object.

Unit tests can sit on the aggregate itself (`test "confirming an order
with no lines is rejected" … { … }` inside `Order`), and the
`requirement` / `solution` / `testCase` blocks at the top and bottom of
`acme.ddd` link every test back to a user story — see
[`docs/traceability.md`](../docs/traceability.md).

## Try the inner loop

Edit `examples/acme.ddd` and regenerate on every save:

```sh
node bin/cli.js generate system examples/acme.ddd -o ./acme-out --watch
```

Loom compares every generated file with what is already on disk and
rewrites only the ones that changed, so the summary after a small edit
lists a handful of written files and the rest `unchanged`.  If an edit
does not parse, the watch loop prints the error and keeps watching;
fix it, save again, and generation resumes.

## Editor support

Install the [`vscode/`](../vscode/) extension and open `acme.ddd`:
hover a reference (`Product id`, `OrderLine`, `Money`) for its type,
Cmd/Ctrl+click to jump to a declaration, type `.` after a typed
receiver (`this.lines.`) for its members, and use Cmd/Ctrl+T to find
declarations across the workspace.

## What the generated tree looks like

```
acme-out/
├── docker-compose.yml          # db + 4 services (+ docker-compose.obs.yml)
├── db-init/                    # one database per backend
├── .loom/                      # wire-spec.json, diagrams, traceability
│
├── api/                        # .NET — all three contexts
│   ├── Domain/                 # aggregates, ids, value objects, events
│   ├── Application/            # Mediator commands, queries, workflows
│   ├── Infrastructure/         # EF DbContext, repositories
│   ├── Api/                    # ASP.NET controllers
│   ├── Migrations/
│   ├── Program.cs
│   └── Api.csproj
│
├── catalog_api/                # .NET — Products + Customers
├── catalog_web/                # Hono — Products + Customers (TS + Drizzle)
│
├── web_app/                    # React + Vite + React Query + Mantine
│   ├── src/api/                # generated hooks + schemas
│   ├── src/pages/              # list / detail / form pages
│   ├── e2e/pages/              # Playwright page objects
│   └── e2e/Acme.ui.spec.ts     # the UI tests
│
└── e2e/                        # vitest e2e against the API
    └── Acme.e2e.test.ts
```

About 300 files, none hand-written.

## Pinning customizations: `.loomignore`

When you hand-edit a generated file, list it in `.loomignore`
(gitignore syntax) in the output directory and Loom leaves it alone on
the next regeneration:

```
api/Program.cs           # custom DI
web_app/src/pages/       # bespoke page layouts
```

The regeneration summary reports those files as skipped.

## Going further

- [`docs/language.md`](../docs/language.md) — the language reference.
- [`docs/generators.md`](../docs/generators.md) — what each backend and
  frontend emits.
- [`docs/customization-gradient.md`](../docs/customization-gradient.md)
  — from scaffolded pages to hand-written ones.
- [`docs/tools.md`](../docs/tools.md) — the CLI: `.loomignore`, watch
  mode, migrations, the OpenAPI cross-check, proxy CAs.
- Other examples: [`sales.ddd`](sales.ddd) (one context, the DDD
  basics), [`banking.ddd`](banking.ddd) (cross-aggregate references with
  richer `where` filters), [`inventory.ddd`](inventory.ddd) (nested
  parts).

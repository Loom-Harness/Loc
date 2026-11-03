# 10. Repositories, queries & projections

Reading data: the `repository` and its read contract, the natural-key reads `getBy` / `findBy` over a declared `unique (…)` key, the restricted "queryable subset" a `where` clause admits, reusable `criterion` predicate specifications, `Repo.find(<Criterion>)` / `Repo.all(<Criterion>, sort:)` and `retrieval` query bundles with `sort`/`loads`, the `paged` read shape, the `ignoring` capability-filter bypass, and — the read-model surface that replaced the removed `view` — `projection` in its two flavours: **query-time** (`from … where … join … group by … select …`, computed on every read) and **folded** (`keyed by` + `on(e: Event) { … }`, a materialized read-model table). Reach for it when you need to know exactly what SQL a read lowers to on each backend, why a `where` is rejected, or which read shape (contract verb / criterion / retrieval / projection) to pick.

> **Grammar:** `Repository`, `IgnoringClause` (fragment), `Criterion`, `Retrieval`, `SortItem` (also the `sort:` slot of a member call), `LoadPath`, `Projection`, `ProjectionMember`, `ProjectionOn`, `ProjectionJoin`, `ProjectionSelect`, `QueryHandler` · **Validators:** `loom.parse-error#find-removed`, `loom.parse-error#retrieval-literal-removed`, `loom.repo-verb-renamed`, `loom.repo-get-criterion`, `loom.repo-find-retrieval`, `loom.repo-all-arg`, `loom.repo-sort-placement`, `loom.repo-key-not-unique`, `loom.repo-key-incomplete`, `loom.policy-read-gate-not-current-user`, `loom.index-suggestion`, `loom.findall-*`, `loom.criterion-*` (incl. `loom.criterion-retrieval-name-clash`), `loom.retrieval-*`, `loom.filter-bypass-*`, `loom.ignoring-clause-placement`, `loom.projection-*` (30 codes), `loom.field-mask-projection-source`, `loom.read-context-repo-write`, `loom.paged-query-handler-shape`, `loom.paged-param-reserved` (queryable oracle: `firstNonQueryableNode` + `firstNonQueryablePredicate` in `src/ir/validate/checks/shared.ts`) · **Docs:** [`../criterion.md`](../criterion.md), [`../scaffold-macros.md`](../scaffold-macros.md) (`scaffoldGet`, `scaffoldPaged`, `scaffoldDashboard`)

All multi-backend examples below are generated from one scratch `system` (`Catalog` context: `Product`, `Customer`, `Order with softDeletable`) once per backend pin; output is excerpted.

## `repository` — the read contract

A `repository` binds reads to one aggregate: `repository Name for Agg`, with an optional, empty `{ }`. It declares no reads of its own. Every read is one of the contract verbs (`src/util/repository-contract.ts`), each generated on every repository that is called with it:

| Call | Reads | Yields |
|---|---|---|
| `Repo.get(id)` | the row with that id | `T` — a miss answers the standard ProblemDetails 404 |
| `Repo.find(id)` | the row with that id | `T?` |
| `Repo.getBy(<col>: v, …)` | the row with a declared `unique (…)` key | `T` — a miss answers 404 |
| `Repo.findBy(<col>: v, …)` | the row with a declared `unique (…)` key | `T?` |
| `Repo.find(<Criterion>(args))` | the first row a criterion matches, in id order | `T?` |
| `Repo.all(<Criterion>(args), sort: […], page: {…})` | every row a criterion matches, in `sort:` order (paged with `page:` / by a paged `queryHandler`) | `T[]` |
| `Repo.all(<Retrieval>(args), page: {…})` | every row a retrieval selects, in its declared order | `T[]` |
| `Repo.all()` | every row | `T[]` |
| `Repo.remove(x)` | — deletes `x` (a write; it yields nothing) | — |

A `T?` read is an `if let` source, and a plain `let` binds it as `T?`. A trailing `ignoring …` widens one call past the capability filters (see [`ignoring`](#ignoring--capability-filter-bypass)). A name no verb spells — `Orders.byCode(c)` — is refused (`loom.workflow-unknown-repository-method` in a workflow, an unresolved member elsewhere).

```ddd
aggregate Product with crudish { sku: string  name: string  price: money  unique (sku) }
repository Products for Product

criterion Pricey(floor: money) of Product = this.price >= floor

let p = Products.getBy(sku: s)                       // Product
if let q = Products.find(Pricey(floor)) { … }        // Product? — the first match
let xs = Products.all(Pricey(floor))                  // Product[]
```

## The repository verbs

The verbs are `get`, `find`, `getBy`, `findBy`, `all` and `remove` ([D-REPO-VERBS](../decisions.md)). `get` answers the row or a 404; `find` answers the row or nothing; `all` answers a list. Two of them are decided by their argument:

- **`find` is overloaded on its argument.** A reference to a declared `criterion` (`Active`, `ByRef(r)`) is the criterion read — the first match. Any other argument is an id, and the call is the by-id read. A `retrieval` is a list, so `find(<Retrieval>)` is refused (`loom.repo-find-retrieval`) — run it with `all`.
- **`get` takes an id only.** `get(<Criterion>)` is refused (`loom.repo-get-criterion`), and the message points at `find`.
- **`all` runs a criterion or a retrieval**, or with no argument reads the whole collection. An inline predicate is not an argument: declare it as a `criterion` and pass the name (`loom.repo-all-arg`). `page: { offset?, limit? }` bounds the read. In a workflow body an `all(<Criterion>)` without `page:` is warned about (`loom.findall-no-page`).
- **`remove` is the one write.** It deletes the aggregate and yields no value.

Every verb reads the same in a workflow, a handler, a domain service and a context `test` (which names the aggregate instead of the repository: `Order.get(id)`). The emitted repository methods keep their own names (`getById`, `findById`, `findAll`, `run<Retrieval>`, `findAllBy<Criterion>`). Those are generated code, never `.ddd` spellings.

The previous spellings are a hard cutover. Each one is an error that names its replacement, and `node scripts/codemod-repo-verbs.mjs` rewrites a whole tree:

| Was | Is |
|---|---|
| `Orders.getById(id)` | `Orders.get(id)` |
| `Orders.findById(id)` | `Orders.find(id)` |
| `Orders.findAll(C, page: p)` / `Orders.run(C)` | `Orders.all(C, page: p)` / `Orders.all(C)` |
| `Orders.run(R(args), page: p)` | `Orders.all(R(args), page: p)` |
| `Orders.run(retrieval { where: C sort: [s] })` | `Orders.all(C, sort: [s])` |
| `Orders.findAll()` | `Orders.all()` |
| `Orders.delete(o)` | `Orders.remove(o)` |

```
error  loom.repo-verb-renamed
'Orders.getById(…)' is no longer a repository verb — it is 'Orders.get(…)'. The repository reads are
get(id) / find(id) / find(<Criterion>) / getBy(…) / findBy(…) / all(…), and the write is remove(x).
`node scripts/codemod-repo-verbs.mjs` migrates a whole tree.
```

### Sorting an `all` over a criterion

`sort:` orders an `all` over a criterion. It takes the same `SortItem`s a declared `retrieval` does: a structural path over the candidate (columnar only), each with an optional `asc` / `desc`. The order is completed by `id`, so it is total:

```ddd
let recent = Orders.all(Active, sort: [placedAt desc, code], page: { limit: 20 })
```

The read lowers to a synthetic retrieval named after its shape (`findAllByActiveByPlacedAtDescThenCodeAsc`). `sort:` anywhere else is refused (`loom.repo-sort-placement`): a retrieval declares its own `sort:`, and no other call reads one. The anonymous `retrieval { … }` literal this replaces is a parse error (`loom.parse-error#retrieval-literal-removed`).

### `find` declarations are removed

Before the repository contract, a repository body declared its own reads — `find byCode(c: string): Order? where this.code == c`, `find all(): Order[]`. That declaration is gone ([D-FINDDECL-REMOVED](../decisions.md)); a `find` left in a repository body is a parse error at the `find`:

```ddd
repository Orders for Order {
  find byCode(c: string): Order? where this.code == c
}
```

```
error  loom.parse-error
A repository declares no `find`s any more: read 'Order' through the repository contract instead —
`Orders.find(id)` / `get(id)`, `Orders.findBy(<column>: v)` / `getBy(…)` over a declared
`unique (…)` key, or a `criterion` read with `Orders.find(C)` (the first match) or `all(C)`. A read
a client calls is a `queryHandler` or `scaffoldGet`. Leave the repository body empty
(`repository Orders for Order`).
```

Each old shape has one replacement:

| Was | Is |
|---|---|
| `find byId(id: Order id): Order?` | `Orders.find(id)` / `get(id)` |
| `find bySku(sku: string): Product?` over a unique key | `unique (sku)` on the aggregate + `Products.findBy(sku: s)` / `getBy(…)` |
| `find byCode(c): Order? where <predicate>` | `criterion ByCode(c: string) of Order = <predicate>` + `Orders.find(ByCode(c))` |
| `find x(…): T[]` / `T paged` (a list) | a `criterion` / `retrieval` + `Orders.all(C(…))` — §[`Repo.all`](#repoall--the-paged-queryhandler) |
| `find all(): T[]` / `T paged` | the implicit `all` (paged for a plain relational aggregate) |
| `… ignoring <Cap>` on a find | `ignoring <Cap>` on the call (`Orders.find(C) ignoring softDeletable`) |
| `T or <Error>` / `T option` / `T envelope` returns | `T?` (a miss is absence) / `T` (a miss is the standard 404) |
| the find's route `GET /<aggs>/<find>` | `scaffoldGet` + `scaffoldGetApi` (same URL — [`scaffold-macros.md`](../scaffold-macros.md)) or a routed `queryHandler` |

## Natural-key reads — `getBy` / `findBy`

When the aggregate declares the key `unique (…)`, the repository answers it through two contract verbs ([D-REPO-KEY-LOOKUP](../decisions.md)):

```ddd
aggregate Product with crudish, softDeletable {
  sku: string  region: string  name: string
  unique (sku)
  unique (region, name)
}
repository Products for Product

let p = Products.getBy(sku: s)                        // Product — a miss answers the standard 404
if let q = Products.findBy(name: n, region: r) { … }  // Product? — any argument order
let a = Products.getBy(sku: s) ignoring *             // past the softDeletable filter
Products.findBy(name: n)        // loom.repo-key-incomplete: (region, name) misses 'region'
Products.findBy(price: x)       // loom.repo-key-not-unique, with a did-you-mean over the declared keys
```

The rules:

- The **named** arguments must equal one declared `unique (…)` tuple of the aggregate (inherited tuples count), in any order — every column present. A subset of a tuple is `loom.repo-key-incomplete` (so is a positional argument); a set no tuple covers is `loom.repo-key-not-unique`, which lists the declared keys and suggests the closest one.
- `getBy` yields the row: a miss raises not-found, answered as the standard ProblemDetails 404 (`"not_found"`). `findBy` yields `T?`: it is an `if let` source, and a plain `let` binds it as `T?` (read through a null test or narrowed by `if let`, like any `T?` read).
- Capability filters (soft-delete, tenancy) apply as on every read; a trailing `ignoring …` widens one call, on a `let` or an `if let` source.

Each backend emits **one repository method per used (verb, tuple, `ignoring` stance)**, named from the tuple's columns in declared order — `getBySku`, `findByRegionAndName`, `getBySkuIgnoringAll` — with a `WHERE` on exactly those columns. The method is derived from the calls in enrichment (phase ⑥), not declared, and has no HTTP route of its own; expose it with a routed `queryHandler`. Each backend renders the name through its own escaping (`GetBySku` on .NET, `get_by_sku` on Python and Elixir):

::: tabs backend
== node
```ts
// db/repositories/product-repository.ts
async getBySku(sku: string): Promise<Product> {
  const rootRows = await this.db.select().from(schema.products).where(and(eq(schema.products.sku, sku), not(eq(schema.products.isDeleted, true)))).orderBy(asc(schema.products.id)).limit(1);
  if (rootRows.length === 0) throw new AggregateNotFoundError("not_found");
  // …rehydrate
}
async findByRegionAndName(region: string, name: string): Promise<Product | null> { /* …returns null on a miss */ }
async getBySkuIgnoringAll(sku: string): Promise<Product> {
  const rootRows = await this.db.select().from(schema.products).where(eq(schema.products.sku, sku)).orderBy(asc(schema.products.id)).limit(1);
  // …
}
// http/workflows.ts — the call site
const p = await products.getBySku(sku);
```
== dotnet
```csharp
// Infrastructure/Repositories/ProductRepository.cs — the soft-delete filter is EF's HasQueryFilter
public async Task<Product> GetBySku(string sku, CancellationToken cancellationToken = default)
{
    var result = await _db.Products.Where(x => x.Sku == sku).FirstOrDefaultAsync(cancellationToken) ?? throw new AggregateNotFoundException("not_found");
    return result;
}
public async Task<Product> GetBySkuIgnoringAll(string sku, CancellationToken cancellationToken = default)
{
    var result = await _db.Products.IgnoreQueryFilters().Where(x => x.Sku == sku).FirstOrDefaultAsync(cancellationToken) ?? throw new AggregateNotFoundException("not_found");
    return result;
}
```
== java
```java
// ProductJpaRepository.java
@Query("select e from Product e where e.sku = :sku")
Product getBySku(@Param("sku") String sku);
// ProductRepositoryImpl.java
public Product getBySku(String sku) {
    var result = jpa.getBySku(sku);
    if (result == null) throw new AggregateNotFoundException("not_found");
    return result;
}
```
== python
```python
# app/db/repositories/product_repository.py
async def get_by_sku(self, sku: str) -> Product:
    row = (await self._session.execute(select(ProductRow).where(and_((ProductRow.sku == sku), not_(ProductRow.is_deleted))))).scalars().first()
    if row is None:
        raise AggregateNotFoundError("not_found")
    return await self._hydrate(row)
```
== elixir
```elixir
# lib/elixir_api/catalog/product_repository.ex
def get_by_sku(sku) do
  query = from(record in ElixirApi.Catalog.Product, where: (record.sku == ^sku) and (not record.is_deleted))

  case Repo.one(query) do
    nil -> {:error, :not_found}
    found -> {:ok, found}
  end
end
```
::: end

## The queryable subset

A `criterion` body (and a `retrieval` `where`, a `projection` `where`, a capability `filter`) is **not** a general expression — it must lower to SQL. The oracle `firstNonQueryableNode` admits exactly: comparisons (`== != < <= > >=`), `&& || !`, parenthesised groups, `this.<column>` (or the projection alias `o.<column>`) and one-level `this.<vo>.<sub>` flattened value-object refs, `currentUser.<field>`, parameter refs, literals and enum values, a named `criterion` reference, membership over a reference collection (`this.<refColl>.contains(x)` — an `EXISTS` subquery), and the bool-returning queryable intrinsics with the **column as receiver** (`this.path.startsWith(p)` → a prefix filter). Everything richer is rejected — lambdas, collection projections (`.count` / `.first`), arithmetic, value-object construction, calls, ternaries, `match`, conversions, and column-vs-column comparisons.

```ddd
// rejected: `.count` on a list is a projection needing a subquery
criterion Busy of Order = this.lines.count > 0
// … if let o = Orders.find(Busy) { … }
```

```
error  loom.retrieval-where-not-queryable
retrieval 'findAllByBusy': where-clause is not queryable (collection projection '.count' on a
list). Allowed: comparisons, &&/||/!, parens, 'this.<column>' / 'this.<vo>.<sub>' refs,
parameter refs, literals.
```

Sibling codes: `loom.criterion-not-selectable`, the `loom.retrieval-where-*` twins and `loom.projection-where-not-queryable` for the other positions. There is no per-backend escape hatch: rejecting at the IR layer means no backend silently emits broken SQL, and every relational adapter lowers the same subset.

The oracle comes in two halves, because a predicate and a value are different questions. `firstNonQueryableNode` asks "could this node reach SQL at all", which is right for a comparison OPERAND. `firstNonQueryablePredicate` (same file) asks the PREDICATE question: every leaf must TEST a column — a comparison with a column-rooted operand, a bare boolean column (`this.active`, `this.flags.active`), a `.contains(<value>)` membership, a bool-returning queryable intrinsic (`this.path.startsWith(p)`), or an authorization sentinel — combined with `&&` / `||` / `!`. So `where true`, `where f` (a `bool` parameter), `where currentUser.isAdmin` and `where 1 == 1` are refused: every relational lowerer's output vocabulary is `<fn>(<column>, <value>)`, with no bare-value position for them to land in.

## Return shapes

A single-row read is `T` (`getById`, `getBy` — a miss answers the standard ProblemDetails 404) or `T?` (`findById`, `findBy`, `find(C)`). A list read is `T[]` (`findAll`, `run`) or the `paged` envelope `{ items, page, pageSize, total, totalPages }` — the implicit `all` of a plain relational aggregate, `run` with `page:`, and a paged `queryHandler`.

A paged read auto-gains `page`/`pageSize`/`sort`/`dir` parameters and a `total`/`totalPages` count query (the same shape the auto-`findAll` and a paged `queryHandler` use).  Those four names are therefore **reserved** on a paged read: a declared parameter spelled `page`, `pageSize`, `sort` or `dir` — compared in snake form, so `page_size` and `Dir` too — on a paged `queryHandler`, or a criterion a paged `queryHandler` runs is refused (`loom.paged-param-reserved`), since it would be a second value for the same query key and a duplicate parameter in every generated signature. Rename it (`pageNo`, `sortKey`, …):

```ddd
repository Orders for Order
criterion OrdersForCustomer(c: string) of Order = this.customer == c
queryHandler ListForCustomer(c: string): Order paged {
  let r = Orders.all(OrdersForCustomer(c))
  return r
}
```

The paged `run` reads the repository's synthesised `findAllBy<Criterion>` page method.  `Order` carries `softDeletable`, so every read below also ANDs the capability filter `not is_deleted` ([chapter 11](11-capabilities-filters-stamps.md)):

::: tabs backend
== node
```ts
async findAllByOrdersForCustomer(c: string, page: number, pageSize: number, sort: string, dir: string):
    Promise<{ items: Order[]; page: number; pageSize: number; total: number; totalPages: number }> {
  const offset = (page - 1) * pageSize;
  const sortColumn = sortColumns[sort] ?? schema.orders.id;
  const orderBy = dir === "desc" ? desc(sortColumn) : asc(sortColumn);
  const countRows = await this.db.select({ value: count() }).from(schema.orders).where(and(eq(schema.orders.customer, c), not(eq(schema.orders.isDeleted, true))));
  const total = Number(countRows[0]?.value ?? 0);
  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
  const rootRows = await this.db.select().from(schema.orders).where(and(eq(schema.orders.customer, c), not(eq(schema.orders.isDeleted, true)))).orderBy(orderBy).limit(pageSize).offset(offset);
  // …
  return { items, page, pageSize, total, totalPages };
}
```
== dotnet
```csharp
public async Task<Paged<Order>> FindAllByOrdersForCustomer(string c, int page, int pageSize, string sort, string dir, CancellationToken cancellationToken = default)
{
    var offset = (page - 1) * pageSize;
    var sortColumn = sort switch { "customer" => "Customer", "ref" => "Ref", "total" => "Total", "status" => "Status", "placedAt" => "PlacedAt", _ => "Id" };
    var total = await _db.Orders.Where(x => x.Customer == c).CountAsync(cancellationToken);   // IsDeletedFilter applied by EF
    var totalPages = pageSize > 0 ? (int)System.Math.Ceiling((double)total / pageSize) : 0;
    var ordered = dir == "desc" ? _db.Orders.Where(x => x.Customer == c).OrderByDescending(e => EF.Property<object>(e, sortColumn)) : /* …OrderBy */;
    var items = await ordered.Skip(offset).Take(pageSize).ToListAsync(cancellationToken);
    return new Paged<Order>(items, page, pageSize, total, totalPages);
}
```
== java
```java
// OrderJpaRepository:  @Query("select e from Order e where e.customer = :c") Page<Order> findAllByOrdersForCustomer(@Param("c") String c, Pageable pageable);
public Paged<Order> findAllByOrdersForCustomer(String c, int page, int pageSize, String sort, String dir) {
    String __sortField = java.util.List.of("id", "customer", "ref", "total", "status", "placedAt").contains(sort) ? sort : "id";
    Sort __sort = Sort.by("desc".equals(dir) ? Sort.Direction.DESC : Sort.Direction.ASC, __sortField);
    var result = jpa.findAllByOrdersForCustomer(c, PageRequest.of(page - 1, pageSize, __sort));
    return new Paged<>(result.getContent(), page, pageSize, (int) result.getTotalElements(), result.getTotalPages());
}
```
== python
```python
async def find_all_by_orders_for_customer(self, c: str, page: int, page_size: int, sort: str, dir: str) -> PagedResult[Order]:
    offset = (page - 1) * page_size
    _sort_attr = getattr(OrderRow, _sort_columns.get(sort, "id"))
    _order = _sort_attr.desc() if dir == "desc" else _sort_attr.asc()
    total = (await self._session.execute(
        select(func.count()).select_from(OrderRow).where(and_((OrderRow.customer == c), not_(OrderRow.is_deleted))))).scalar_one()
    total_pages = (total + page_size - 1) // page_size if page_size > 0 else 0
    # …select(OrderRow).where(…).order_by(_order).limit(page_size).offset(offset)
```
== elixir
```elixir
def find_all_by_orders_for_customer(c, page \\ 1, page_size \\ 20, sort \\ "id", dir \\ "asc") do
  query = from(record in D.Catalog.Order, where: (record.customer == ^c) and (not record.is_deleted))
  total = Repo.aggregate(query, :count, :id)
  offset = (page - 1) * page_size
  sort_col = case sort do "customer" -> :customer  "ref" -> :ref  "total" -> :total  "status" -> :status  "placedAt" -> :placed_at  _ -> :id end
  dir_atom = if dir == "desc", do: :desc, else: :asc
  items = query |> order_by([record], [{^dir_atom, field(record, ^sort_col)}]) |> limit(^page_size) |> offset(^offset) |> Repo.all()
  {:ok, %{items: items, page: page, pageSize: page_size, total: total, totalPages: if(page_size > 0, do: ceil(total / page_size), else: 0)}}
end
```
::: end

### Gating a read — `policy { read X requires … }`

Who may read an aggregate is one line in its context's `policy` block, and it gates **every** read of the aggregate — the list and by-id routes, a `scaffoldGet` route, any hand-written `queryHandler` / `commandHandler` that reads the aggregate through its repository, the audit history read. It runs **before** the query, so it may only read `currentUser` (and constants) — `this.<field>` there is `loom.policy-read-gate-not-current-user`; use a criterion to scope rows and the read gate to allow/deny the caller. The enforcement story (403, `denyByDefault`, the scaffolded List page inheriting the gate) is in [chapter 17](17-auth.md#read--who-may-read-an-aggregate) and [`../auth.md`](../auth.md).

```ddd
repository Orders for Order
policy { read Order requires currentUser.role == "agent" }
```

```ts
// node — http/order.routes.ts, GET /orders
if (!(currentUser.role === "agent")) throw new ForbiddenError("Forbidden: list orders");
```

A projection keeps its own header gate (`projection P requires <expr> { … }`).

## `criterion`

A `criterion` is a named, parameterised, **pure boolean predicate** over a candidate type (the Specification pattern). `of <Agg>` names the candidate; inside the body, bare field names (and `this`) resolve against it — the same convention as `invariant`/`derived`. `of <Agg> as <alias>` binds an explicit candidate name instead (an alias that shadows a parameter is `loom.criterion-alias-collision`); `of bool` is an ambient predicate with no candidate — those two are the only admitted targets (`loom.criterion-unsupported-target`), and a criterion may only filter the aggregate it is declared `of` (`loom.criterion-target-mismatch` when a `find`/`retrieval`/`filter` on another aggregate names it). Criteria compose with `&& || !` (the boolean operators *are* the composition), must be pure (`loom.criterion-impure`), acyclic (`loom.criterion-cycle`), and called with the right arity (`loom.criterion-arity`).

```ddd
criterion ActiveOrder of Order = status != OrderStatus.Closed
criterion HighValue(min: money) of Order = total >= min
criterion Confirmed of Order as o = o.status == OrderStatus.Confirmed
```

A criterion reference is **inlined** wherever a boolean expression is expected (a `projection where`, an `invariant`, a criterion body composed with other terms) — it produces exactly the same lowered SQL as the hand-written filter. But when a `retrieval`'s or `filter`'s predicate is *exactly* one named criterion, it **reifies**: the backend emits a named predicate object the query consumes. The rule is simply "if it has a name." See [`../criterion.md`](../criterion.md) for the full validation table.

The reification target differs per backend — this is `HighValue` reified:

::: tabs backend
== node
```ts
// db/repositories/order-repository.ts — module-level predicate function
const highValueCriterion = (min: Decimal) => gte(schema.orders.total, min);
// …consumed by runBigActive / findAllByHighValue below
```
== dotnet
```csharp
// Domain/Criteria/HighValueCriterion.cs — Criterion<T> with both a runtime
// check and a query-side expression tree
public sealed class HighValueCriterion : Criterion<Order>
{
    private readonly decimal min;
    public HighValueCriterion(decimal min) { this.min = min; }
    public override bool IsSatisfiedBy(Order candidate) => candidate.Total >= min;
    public Expression<Func<Order, bool>> ToExpression() => candidate => candidate.Total >= min;
}
```
== java
```java
// domain/criteria/OrderCriteria.java — a Specification<T> factory per criterion
public static Specification<Order> HighValue(BigDecimal min) {
    return (root, query, cb) -> cb.greaterThanOrEqualTo(root.<BigDecimal>get("total"), min);
}
```
== python
```python
# SQLAlchemy is non-reifying: the predicate inlines at each call site
# select(OrderRow).where(and_((OrderRow.total >= min), not_(OrderRow.is_deleted)))
```
== elixir
```elixir
# Ecto is non-reifying too: the predicate inlines into each query module
# from(record in D.Catalog.Order, where: record.total >= ^min)
```
::: end

## `retrieval`

A `retrieval` is a named query *bundle* — a `where` predicate plus the shaping a real query carries: `sort` ordering and (reserved) `loads` fetch paths. Its `where` is a selection position with the same queryable-subset contract as a find — a bare predicate, a criterion, or a composition of both (`loom.retrieval-where-not-queryable` / `-unknown-field` / `-column-column`; a `sort` on a non-field is `loom.retrieval-sort-unknown-field`). The block form carries `where:` / `sort:` / `loads:` slots; the single-line form `retrieval Name of Agg = <expr>` is the bare-predicate shorthand. A retrieval may not share its name with a `criterion` in the same context (`loom.criterion-retrieval-name-clash`, an error): `Repo.all(<Name>)`, `scaffoldPaged(of: <Name>)` and a `where: <Name>` each resolve the bare name, so a name that meant both would have to pick one silently.

```ddd
retrieval BigActive(min: money) of Order {
  where: HighValue(min)
  sort:  [total desc, ref asc]
}
```

A retrieval is a domain declaration: it has no route and no `requires` of its own. To put one on the wire, expose it with [`scaffoldPaged(of: <Retrieval>, requires?: <Policy>)`](22-macros.md) + `scaffoldPagedApi(of: <Retrieval>)` — a paged route whose default order is the retrieval's `sort:` (§[paged `queryHandler`](#repoall--the-paged-queryhandler)).

A retrieval lowers to a `run<Name>` repository method that consumes the reified criterion and applies the sort. Paging is a **call-site** argument (`Repo.all(BigActive(m), page: { offset: 0, limit: 100 })`), never part of the declaration:

::: tabs backend
== node
```ts
async runBigActive(min: Decimal, page?: { offset?: number; limit?: number }): Promise<Order[]> {
  let query = this.db.select().from(schema.orders)
    .where(and(highValueCriterion(min), not(eq(schema.orders.isDeleted, true))))
    .orderBy(desc(schema.orders.total), asc(schema.orders.ref)).$dynamic();
  // if (page?.limit !== undefined) query = query.limit(page.limit); …offset
}
```
== dotnet
```csharp
// Domain/Orders/BigActiveSpec.cs — an Ardalis Specification bundling the criterion + sort
public sealed class BigActiveSpec : Specification<Order>
{
    public BigActiveSpec(decimal min)
    {
        Query.Where(new HighValueCriterion(min).ToExpression()).OrderByDescending(x => x.Total).ThenBy(x => x.Ref);
    }
}
// OrderRepository.RunBigActiveAsync(decimal min, (int? offset, int? limit)? page = null, FilterBypass bypass = default, …)
//   var __q = _db.Orders.AsQueryable();  if (bypass.All) __q = __q.IgnoreQueryFilters(); …
```
== java
```java
public List<Order> runBigActive(BigDecimal min, Integer offset, Integer limit) {
    return jpa.findAll(OrderCriteria.HighValue(min),
        new OffsetLimitPageRequest(offset, limit, Sort.by(Sort.Order.desc("total"), Sort.Order.asc("ref")))).getContent();
}
```
== python
```python
async def run_big_active(self, min: Decimal, offset: int | None = None, limit: int | None = None) -> list[Order]:
    query = select(OrderRow).where(and_((OrderRow.total >= min), not_(OrderRow.is_deleted))).order_by(OrderRow.total.desc(), OrderRow.ref.asc())
    if offset is not None:
        query = query.offset(offset)
    if limit is not None:
        query = query.limit(limit)
```
== elixir
```elixir
# lib/d/catalog/retrievals/big_active.ex
def run(min, opts \\ []) do
  query = from(record in D.Catalog.Order, where: record.total >= ^min)
  query = if opts[:ignore_all_filters] || "softDeletable" in (opts[:ignore_filters] || []), do: query, else: where(query, [record], not record.is_deleted)
  query = if opts[:limit], do: limit(query, ^opts[:limit]), else: query
  query = if opts[:offset], do: offset(query, ^opts[:offset]), else: query
  query = order_by(query, [record], [desc: record.total, asc: record.ref])
  {:ok, Repo.all(query)}
end
```
::: end

`Repo.all(<Criterion>, sort: […], page?)` is the call-site twin accepted from workflow / handler bodies — a criterion with an order, without declaring a retrieval (§[Sorting an `all` over a criterion](#sorting-an-all-over-a-criterion)). See [`../workflow.md`](../workflow.md) and [`../criterion.md`](../criterion.md).

### `loads:` shaping

`loads:` declares structural fetch paths through the candidate — e.g. `loads: [this.lines[].product]`, a flat dotted `LoadPath` with `[]` marking "across the collection" (mirrors `contains`). A leading `this.` is admitted and stripped.

**Honest gap:** explicit `loads:` is **not shipped** — a retrieval with one is rejected (`loom.retrieval-loads-unsupported`: "explicit 'loads:' is not supported yet — retrievals load the whole aggregate. (Per-operation autoload is planned.)"). Retrievals load the whole aggregate; treat `loads:` as reserved surface.

## `Repo.all` & the paged `queryHandler`

`Repo.all(<Criterion | Retrieval>(args))` is the read-only port a handler body reads through — the criterion-driven replacement for a list find. A `queryHandler` that returns `<Agg> paged` over it is the ergonomic paged list read (what [`scaffoldPaged`](22-macros.md) expands to): enrichment synthesises a paged find on the aggregate's repository — `findAllBy<Criterion>` for a criterion, `page<Retrieval>` for a retrieval — which is not auto-exposed (the handler's `route` is the exposure). The handler's return is auto-projected to `<Agg>Response paged`, and `page`/`pageSize`/`sort`/`dir` come from the paged infra, never from handler params. Over a retrieval, its `where` filters and its `sort:` is the default order: the route's `sort` defaults to `""`, which the paged find reads as "the declared terms, then `id`" (a whitelisted `sort` column still wins). Emitted on all five backends. The body is the handler's `requires` gates (each a 403 before the read) followed by `let r = Repo.all(<read>(args))` at the top level, then `return r`; anything else is refused with `loom.paged-query-handler-shape`. A sorted retrieval over an aggregate that pages in memory — event-log, `shape: document`/embedded, an inheritance subtype — is refused under the same code (`#sorted-retrieval-shape`) rather than silently left unordered.

```ddd
queryHandler ListBig(min: money): Order paged {
  let r = Orders.all(HighValue(min))
  return r
}
api CatalogApi from Sales { route GET "/big" -> Catalog.ListBig }
```

::: tabs backend
== node
```ts
// http/catalogApi-routes.ts
request: { query: z.object({ min: moneySchema, page: z.coerce.number().int().min(1).max(1000000).default(1), pageSize: z.coerce.number().int().min(1).max(500).default(20), sort: z.string().default("id"), dir: z.string().default("asc") }) },
// …
const result = await orders.findAllByHighValue(min, query.page, query.pageSize, query.sort, query.dir);
return httpCtx.json({ ...result, items: result.items.map((__e) => orders.toWire(__e)) }, 200);
```
== dotnet
```csharp
// Application/Orders/Queries/ListBigHandler.cs
public async ValueTask<Paged<OrderResponse>> Handle(ListBigQuery query, CancellationToken cancellationToken)
{
    var domain = await _orders.FindAllByHighValue(query.Min, query.Page, query.PageSize, query.Sort, query.Dir, cancellationToken);
    return new Paged<OrderResponse>(domain.Items.Select(d => new OrderResponse(/* … */)).ToList(), domain.Page, domain.PageSize, domain.Total, domain.TotalPages);
}
```
== java
```java
// application/workflows/ListBigHandler.java
public Paged<Order> handle(BigDecimal min, int page, int pageSize, String sort, String dir) {
    return ordersRepository.findAllByHighValue(min, page, pageSize, sort, dir);
}
```
== python
```python
# app/application/list_big.py
async def list_big(session: AsyncSession, min: Decimal, page: int, page_size: int, sort: str, dir: str) -> dict[str, object]:
    orders = OrderRepository(session, make_dispatcher(session))
    result = await orders.find_all_by_high_value(min, page, page_size, sort, dir)
    return {"items": [orders.to_wire(__e) for __e in result.items], "page": result.page, "pageSize": result.page_size, "total": result.total, "totalPages": result.total_pages}
```
== elixir
```elixir
# lib/d_web/controllers/catalog_api_routes_controller.ex
def list_big(conn, params) do
  with {:ok, page_arg} <- page_param(params, "page", 1, 1000000),
       {:ok, page_size_arg} <- page_param(params, "pageSize", 20, 500),
       {:ok, result} <- D.Catalog.find_all_by_high_value_order(params["min"], page_arg, page_size_arg, Map.get(params, "sort", "id"), Map.get(params, "dir", "asc")) do
    json(conn, %{result | items: Enum.map(result.items, &serialize/1)})
  end
end
```
::: end

The inline twin inside a handler / workflow body is `Repo.all(<Criterion>(args), page: { offset: 0, limit: N })` (optionally `… ignoring …`, see below): the criterion must exist on that aggregate with the right arity (`loom.findall-unknown-criterion` / `-criterion-mismatch` / `-criterion-arity`), and in a workflow body the `page:` bound is mandatory — an unbounded list read is `loom.findall-no-page`.

A read position (an api `GET`/`HEAD` route, a `queryHandler`, a `reading` service) may not reach the mutating repository face — a read-method route bound to a mutating `commandHandler` is `loom.read-context-repo-write`. Domain-service reads have their own rules (`loom.domain-service-read-unsupported`, `-cross-context-read` — [chapter 23](23-domain-services-and-seeds.md)), and a repository read inside a test `expect(...)` must be `let`-bound first (`loom.integration-find-must-bind` — [chapter 18](18-testing.md)).

## `ignoring` — capability-filter bypass

A trailing `ignoring` clause on a read skips the query-filters a capability contributed (soft-delete row hiding, tenancy scoping, a `filter` capability), keyed on the **capability** name. `ignoring *` bypasses every capability filter on the aggregate; `ignoring A, B` bypasses exactly those. `ignoring` is a soft keyword (fields/params named `ignoring` keep parsing). All five backends honour it:

```ddd
criterion Big of Order = this.total > 1000
// … let xs = Orders.all(Big()) ignoring softDeletable   — no `not is_deleted` term
```

The per-backend output of a widened read is under [Widened single-row reads](#widened-single-row-reads) below; each backend drops exactly the named capabilities' filters (`IgnoreQueryFilters(["IsDeletedFilter"])` on .NET, a disabled Hibernate filter on Java, the term left out of the `where` on node / Python / Elixir).

`ignoring` is read back only in these positions; anywhere else it parses, binds to the wrong expression, is never read back — and is an error (`loom.ignoring-clause-placement`):

| Position | Spelling |
|---|---|
| a query-time projection's `where` slot — **before** `join` / `group by` / `select` | `from Order as o ignoring softDeletable  group by …` |
| an inline list read bound by a `let` (`all(<Criterion | Retrieval>)`), or a natural-key `getBy` / `findBy` | `let xs = Orders.all(Big()) ignoring *` |
| in a workflow, reactor or handler body: a `let` or an `if let` over `find(<Criterion>)`, `find(id)` or `findBy` | `let o = Orders.find(ByRef(r)) ignoring softDeletable` · `if let o = Orders.find(id) ignoring * { … }` |
| an `if let` source over `findBy`, anywhere | `if let p = Products.findBy(sku: s) ignoring * { … }` |
| a single-row read in a `domainService` operation (`find(<Criterion>)`, `find(id)`, `getBy`, `findBy`) | `return Orders.find(id) ignoring * != null` |
| a context integration `test`: a `let` over `find(id)` | `let o = Order.find(id) ignoring softDeletable` |

A widened list read runs a retrieval of its own, named for its stance (`findAllBy<C>Ignoring<Caps>`, or `<Retrieval>Ignoring<Caps>` for a declared one), derived in enrichment with the stance on it, so the shared retrieval every other caller runs keeps its filters:

```ts
// node — let xs = Orders.all(Big()) ignoring softDeletable
async runFindAllByBigIgnoringSoftDeletable(page?: { offset?: number; limit?: number }): Promise<Order[]> {
  let query = this.db.select().from(schema.orders).where(bigCriterion()).orderBy(asc(schema.orders.id)).$dynamic();
```

```python
# python — the same read
async def run_find_all_by_big_ignoring_soft_deletable(self, offset: int | None = None, limit: int | None = None) -> list[Order]:
    query = select(OrderRow).where((OrderRow.total > 10)).execution_options(loom_ignoring=frozenset({"softDeletable"}))
```

### Widened single-row reads

`find(<Criterion>)` and `findById` normally run against methods every other caller shares — the criterion's `findAllBy<C>` retrieval and the by-id load — so a widened read gets a repository method of its own, named for the read and its stance: `findFirst<Criterion>Ignoring<Caps>` / `findByIdIgnoring<Caps>` (`…IgnoringAll` for `ignoring *`). Like the natural-key methods it is derived from the calls in enrichment and has no HTTP route. A criterion read keeps `find(C)`'s meaning — the first match, in id order — even where the predicate matches many rows.

```ddd
criterion ProductsInRegion(region: string) of Product = this.region == region

commandHandler ArchiveFirstInRegion(region: string): int {
  if let p = Products.find(ProductsInRegion(region)) ignoring softDeletable { p.archive() }
  return 0
}

domainService ProductQueries {
  operation everExisted(id: Product id): bool {
    return Products.find(id) ignoring softDeletable != null
  }
}
```

::: tabs backend
== node
```ts
async findFirstProductsInRegionIgnoringSoftDeletable(region: string): Promise<Product | null> {
  const rootRows = await this.db.select().from(schema.products)
    .where(productsInRegionCriterion(region)).orderBy(asc(schema.products.id)).limit(1);
  …
}
// the plain read still filters: runFindAllByProductsInRegion … where(and(productsInRegionCriterion(region), not(eq(schema.products.isDeleted, true))))
```
== dotnet
```csharp
public async Task<Product?> FindByIdIgnoringSoftDeletable(ProductId id, CancellationToken cancellationToken = default)
{
    var result = await _db.Products.IgnoreQueryFilters(["IsDeletedFilter"]).Where(x => x.Id == id).FirstOrDefaultAsync(cancellationToken);
    …
}
```
== java
```java
@Query("select e from Product e where e.region = :region order by e.id")
java.util.List<Product> findFirstProductsInRegionIgnoringSoftDeletable(@Param("region") String region, Pageable pageable);

// ProductRepositoryImpl: the promoted softDeletable @Filter is disabled around the read
__session.disableFilter("softDeletable");
try {
    var result = jpa.findFirstProductsInRegionIgnoringSoftDeletable(region, PageRequest.of(0, 1)).stream().findFirst().orElse(null);
    …
} finally {
    __session.enableFilter("softDeletable");
}
```
== python
```python
async def find_by_id_ignoring_soft_deletable(self, id: ProductId) -> Product | None:
    row = (await self._session.execute(select(ProductRow).where((ProductRow.id == id)).execution_options(loom_ignoring=frozenset({"softDeletable"})))).scalars().first()
    …
```
== elixir
```elixir
def find_first_products_in_region_ignoring_soft_deletable(region) do
  query = from(record in ElixirApi.Catalog.Product, where: record.region == ^region)
  {:ok, Repo.one(from(record in query, order_by: [asc: record.id], limit: 1))}
end
```
::: end

Naming a capability the aggregate does not implement is `loom.filter-bypass-unknown-capability`; naming one that contributes no filter (`ignoring auditable`) is `loom.filter-bypass-no-filter`; an `ignoring` over a workflow or projection source has nothing to bypass (`loom.projection-workflow-source-ignoring-no-effect` / `loom.projection-source-ignoring-no-effect`). See [chapter 11](11-capabilities-filters-stamps.md) for the `filter` capability that produces these predicates.

## `projection` — the read model

A `projection` is a named read model served at `GET /projections/<snake_name>` (and `/{key}` for a keyed one). It comes in two flavours, decided by which clauses the body carries — never both (`loom.projection-query-and-fold-invalid`):

| Flavour | Body | Storage | Serves |
|---|---|---|---|
| **query-time** | `from <Source> [as <alias>] [where …] [ignoring …] [join …]* [group by …] [select …]` | none — computed on every read | a list of rows (or one object for the whole-table aggregation) |
| **folded** | `keyed by <field>` + `on(e: <Event>) [by <expr>] { … }` folds | a materialized `<proj>` table, one row per key | the row list + `/{key}` |

Both may declare row fields (`name: type`), take parameters (`projection OrdersInRegion(region: string) { … }`), and carry a `requires` gate (`currentUser`-only — `loom.projection-gate-not-current-user`). The wire row is the declared fields (`wireShape`), so every backend serves the same JSON.

### Query-time — `from … select …`

The per-row read: `from` names the source, `where` is a criterion position over it (the queryable subset), each `join <Agg> as <c> on <idRef>` is a **by-id follow** (the reference's identity only — an arbitrary join key is rejected), and `select` fills each declared field from the source alias and join aliases. The query itself is the source aggregate's repository (a synthesised source find carrying the `where` and the capability filters); the joins are an app-level bulk load by id after it.

```ddd
projection OrderWithCustomer {
  orderId: Order id  ref: string  customerName: string
  from Order as o
  join Customer as c on o.customerId
  select orderId = o.id, ref = o.ref, customerName = c.name
}
```

::: tabs backend
== node
```ts
// http/query-projections.ts — GET /projections/order_with_customer
const OrderWithCustomerRow = z.object({ orderId: z.string(), ref: z.string(), customerName: z.string() }).openapi("OrderWithCustomerRow");
// …
const repo = new OrderRepository(db, events);
const rows = await repo.orderWithCustomer();                       // synthesised source find (+ capability filters)
const customerRepo = new CustomerRepository(db, events);
const customerById = new Map((await customerRepo.findManyByIds(rows.map((r) => r.customerId))).map((a) => [a.id as string, a]));
const projected = rows.map((r) => ({ orderId: r.id as string, ref: r.ref, customerName: customerById.get(r.customerId as string)!.name }));
```
== dotnet
```csharp
// Application/Projections/OrderWithCustomerQpHandler.cs
var domain = await _repo.OrderWithCustomer(cancellationToken);
var customerById = (await _customerRepo.FindManyByIdsAsync(domain.Select(d => d.CustomerId).ToList(), cancellationToken)).ToDictionary(__a => __a.Id);
return domain.Select(d => new OrderWithCustomerRow(d.Id.Value, d.Ref, customerById[d.CustomerId].Name)).ToList();
```
== java
```java
// application/views/CatalogQueryProjections.java
public List<OrderWithCustomerRow> orderWithCustomer() {
    var customerById = customersRepository.findAll().stream().collect(Collectors.toMap(__a -> __a.id().value(), __a -> __a));
    return ordersRepository.orderWithCustomer().stream()
        .map(a -> new OrderWithCustomerRow(a.id().value(), a.ref(), customerById.get(a.customerId().value()).name()))
        .toList();
}
```
== python
```python
# app/http/query_projections_routes.py
rows = await repo.order_with_customer()
customer_by_id = {str(a.id): a for a in await customer_repo.find_many_by_ids([r.customer_id for r in rows])}
return [{"orderId": r.id, "ref": r.ref, "customerName": customer_by_id[str(r.customer_id)].name} for r in rows]
```
== elixir
```elixir
# lib/d/catalog/query_projections/order_with_customer.ex
rows = from(record in D.Catalog.Order, where: not record.is_deleted) |> Repo.all()
customer_by_id = from(row in D.Catalog.Customer, where: row.id in ^Enum.map(rows, fn record -> record.customer_id end)) |> Repo.all() |> Map.new(&{&1.id, &1})
Enum.map(rows, fn record -> %{orderId: record.id, ref: record.ref, customerName: Map.get(customer_by_id, record.customer_id).name} end)
```
::: end

A `select` that names nothing resolvable is `loom.projection-select-unresolved`; a `where` outside the queryable subset is `loom.projection-where-not-queryable`.

### Shorthand — the `select`-less form

Omit **both** the row fields and the `select`, and the row is the **source aggregate's own full wire shape** — each filtered row serialized through the aggregate's own domain→wire mapper, exactly as its list route does. This is the replacement for the removed `view X = A where P`:

```ddd
projection ActiveOrders {
  from Order as o where ActiveOrder
}
```

```ts
// http/query-projections.ts (node) — GET /projections/active_orders
const ActiveOrdersRow = z.object({ id: z.string(), customer: z.string(), ref: z.string(), total: z.string(), status: z.enum([…]), placedAt: z.string(), customerId: z.string(), isDeleted: z.boolean(), deletedAt: z.string().nullish(), version: z.number().int() }).openapi("ActiveOrdersRow");
const rows = await repo.activeOrders();                 // where: status != "Closed" AND not isDeleted
const projected = rows.map((r) => repo.toWire(r));      // the aggregate's own mapper
```

Every backend does the same through its own serializer — .NET `domain.Select(d => new ActiveOrdersRow(d.Id.Value, d.Customer, …))`, Java `.map(a -> new ActiveOrdersRow(a.id().value(), …))`, Python `[repo.to_wire(r) for r in rows]`, Elixir `Enum.map(rows, &serialize/1)`. **Aggregate source only** — a `select`-less projection over a workflow or projection source is `loom.projection-shorthand-nonaggregate`; row fields with no `select` to fill them is the different error `loom.projection-fields-without-select`.

### Whole-table aggregation — the singleton

A `select` made only of aggregations (`count()` / `sum(col)` / `avg(col)` / `min(col)` / `max(col)`) is a **whole-table aggregation**: one SQL query, no rows rehydrated, and the read returns **one object** rather than a list. Aggregation arguments must be bare source columns (`sum(o.total)`, never `sum(o.total + o.tax)` — `loom.projection-aggregate-arg-not-columnar`).  `count` takes no argument — it counts rows, never a column's values — and the others take exactly one column; any other argument count is `loom.projection-aggregate-arity` (to count only the rows where a condition holds, narrow them with a `where` in a projection of their own).

```ddd
projection OrderVolume {
  total: int  revenue: money
  from Order as o
  where Confirmed
  select total = count(), revenue = sum(o.total)
}
```

::: tabs backend
== node
```ts
const OrderVolumeResponse = OrderVolumeRow.openapi("OrderVolumeResponse");   // one object, not an array
const [row] = await db.select({ total: count(), revenue: sum(schema.orders.total) }).from(schema.orders).where(and(eq(schema.orders.status, "Confirmed"), not(eq(schema.orders.isDeleted, true))));
const projected = { total: Number(row?.total ?? 0), revenue: new Decimal(row?.revenue ?? 0).toFixed(4) };
```
== dotnet
```csharp
var agg = await _db.Orders.AsNoTracking().Where(o => o.Status == OrderStatus.Confirmed)
    .GroupBy(_ => 1)
    .Select(g => new { Total = g.Count(), Revenue = g.Sum(o => o.Total) })
    .FirstOrDefaultAsync(cancellationToken);
return new OrderVolumeRow(agg?.Total ?? 0, (agg?.Revenue ?? 0m).ToString("F4", CultureInfo.InvariantCulture));
```
== java
```java
Object[] r = (Object[]) entityManager.createQuery("select count(e), sum(e.total) from Order e where e.status = com.loom.d.domain.enums.OrderStatus.Confirmed").getSingleResult();
return new OrderVolumeRow(((Number) r[0]).intValue(), r[1] == null ? "0.0000" : new java.math.BigDecimal(r[1].toString()).setScale(4, java.math.RoundingMode.HALF_UP).toPlainString());
```
== python
```python
row = (await session.execute(select(func.count(), func.sum(OrderRow.total)).select_from(OrderRow).where(and_((OrderRow.status == OrderStatus.Confirmed), not_(OrderRow.is_deleted))))).one()
return {"total": int(row[0] or 0), "revenue": money_str(Decimal(row[1] or 0))}
```
== elixir
```elixir
row = from(record in D.Catalog.Order, where: (record.status == ^"Confirmed") and (not record.is_deleted), select: %{total: count(record.id), revenue: sum(record.total)}) |> Repo.one()
%{total: row.total || 0, revenue: __money_wire(row.revenue || 0)}
```
::: end

Note the per-field wire coercions every backend applies identically: a `money` aggregate rides the wire as a 4-decimal string, `count` zero-defaults over an empty table.

### Grouped — `group by`

Mixing an aggregate `select` with a per-row `select` is a **GROUP BY** — one row per distinct value of the per-row column. Declare the grouping explicitly with `group by <col>, …` (between `where`/`join` and `select`); the mix without the clause is `loom.projection-groupby-missing`.

```ddd
projection SalesByStatus {
  status: OrderStatus  orders: int  revenue: money
  from Order as o
  group by o.status
  select status = o.status, orders = count(), revenue = sum(o.total)
}
```

The read happens **in SQL** and returns the list shape, **ordered by the grouping
columns, ascending, by their stored column value** — so it is deterministic across
backends.  For an ENUM key that means the **lexicographic order of the member name**,
not the order the members are declared in: an enum column is stored as `TEXT` on every
backend, so `enum OrderStatus { Draft Confirmed Cancelled }` grouped on comes back
`Cancelled`, `Confirmed`, `Draft`.  (A projection has no `order by` clause yet; a read
that wants declaration order selects an explicit rank column.)

::: tabs backend
== node
```ts
const rows = await db.select({ status: schema.orders.status, orders: count(), revenue: sum(schema.orders.total) }).from(schema.orders).where(not(eq(schema.orders.isDeleted, true))).groupBy(schema.orders.status).orderBy(schema.orders.status);
const projected = rows.map((r) => ({ status: r.status, orders: Number(r.orders ?? 0), revenue: new Decimal(r.revenue ?? 0).toFixed(4) }));
```
== dotnet
```csharp
var groups = await _db.Orders.AsNoTracking()
    .GroupBy(o => new { o.Status })
    .Select(g => new { g.Key.Status, Orders = g.Count(), Revenue = g.Sum(o => o.Total) })
    .OrderBy(x => x.Status)
    .ToListAsync(cancellationToken);
```
== java
```java
List<Object[]> rows = entityManager.createQuery("select e.status, count(e), sum(e.total) from Order e group by e.status order by e.status").getResultList();
```
== python
```python
select(OrderRow.status, func.count(), func.sum(OrderRow.total)).select_from(OrderRow).where(not_(OrderRow.is_deleted)).group_by(OrderRow.status).order_by(OrderRow.status)
```
== elixir
```elixir
from(record in D.Catalog.Order, where: not record.is_deleted, group_by: record.status, order_by: record.status, select: %{status: record.status, orders: count(record.id), revenue: sum(record.total)})
```
::: end

The shape discipline (each its own diagnostic):

- **Aggregate `from` source required** — workflow/projection sources and folded projections cannot be grouped (`loom.projection-groupby-source-invalid`).
- **At least one aggregate `select`** — a `group by` with only per-row selects is just DISTINCT (`loom.projection-groupby-no-aggregate`).
- **Per-row selects must be grouping columns** (`loom.projection-groupby-select-not-grouped`).
- **Grouping keys are source columns** — optionally bucketed by the one supported transform, `startOfDay()` on a `datetime` (`GroupKeyTransform` in `src/ir/util/projection-aggregate.ts`); any other computed key (arithmetic, another intrinsic) is `loom.projection-groupby-key-not-columnar`, and a key `select` must repeat the grouping expression exactly (`select day = o.placedAt` against `group by o.placedAt.startOfDay()` is per-row, not per-group).
- **No `join`, no `keyed by`** — a join is an app-level by-id load after the query (`loom.projection-groupby-join-invalid`), and grouped rows are the groups, not id-keyed entities (`loom.projection-groupby-keyed-invalid`).

The transform renders as the same `date_trunc('day', …)` in SELECT, GROUP BY and ORDER BY on every backend — a daily series:

```ddd
projection DailyRevenue {
  day: datetime  revenue: money
  from Order as o
  group by o.placedAt.startOfDay()
  select day = o.placedAt.startOfDay(), revenue = sum(o.total)
}
```

::: tabs backend
== node
```ts
const rows = await db.select({ day: sql`date_trunc('day', ${schema.orders.placedAt})`.mapWith(schema.orders.placedAt), revenue: sum(schema.orders.total) })
  .from(schema.orders).where(not(eq(schema.orders.isDeleted, true)))
  .groupBy(sql`date_trunc('day', ${schema.orders.placedAt})`).orderBy(sql`date_trunc('day', ${schema.orders.placedAt})`);
```
== elixir
```elixir
from(record in D.Catalog.Order, where: not record.is_deleted,
  group_by: fragment("date_trunc('day', ?)", record.placed_at),
  order_by: fragment("date_trunc('day', ?)", record.placed_at),
  select: %{day: fragment("date_trunc('day', ?)", record.placed_at), revenue: sum(record.total)})
```
::: end

**No paging, no `order by`.** A projection read returns the whole row list — there is no `paged` carrier or sort clause on a projection (the grammar reserves `order by` for a later slice; no `loom.projection-paged-*` code exists). Grouped reads are ordered by their grouping columns; for a paged list, use a paged `queryHandler` ([above](#repoall--the-paged-queryhandler)).

### Sources — aggregate, workflow, projection

`from` may name an **aggregate** (read through its repository — the default and only source that supports `join`, `ignoring`, the shorthand, and the direct-table arms), a **workflow** (read through its persisted instance rows — it must be state-backed and observable, i.e. have a single id-shaped correlation field: `loom.projection-workflow-source-not-observable`, `-eventsourced-invalid`; no `join`: `-join-invalid`), or another **materialized projection** (a folded one with a table — a query-time source has nothing to read `from`: `loom.projection-source-not-materialized`; never itself: `-source-self`; no `join`: `-source-join-invalid`).

```ddd
workflow Fulfil {
  orderId: Order id
  attempts: int
  create(p: OrderConfirmed) by p.orderRef { attempts := 1 }
}
projection ActiveFulfils {
  orderId: Order id  attempts: int
  from Fulfil as f where f.attempts > 0
  select orderId = f.orderId, attempts = f.attempts
}
```

The read goes straight to the workflow's instance-state table (no repository, no capability filters):

::: tabs backend
== node
```ts
// http/query-projections.ts — GET /projections/active_fulfils
const rows = await db.select().from(schema.fulfils).where(gt(schema.fulfils.attempts, 0));
const projected = rows.map((r) => ({ orderId: r.orderId, attempts: r.attempts }));
```
== elixir
```elixir
# lib/d/catalog/query_projections/active_fulfils.ex — "Source workflow: Fulfil (saga instance state)"
rows = from(record in D.Catalog.Workflows.FulfilState, where: record.attempts > 0) |> Repo.all()
Enum.map(rows, fn record -> %{orderId: record.order_id, attempts: record.attempts} end)
```
::: end

### The source has to have columns

The two **direct-table** arms — the whole-table aggregation and the grouped read — name columns on the source aggregate's own table, because the arithmetic happens in SQL. Three source shapes have no such columns, and the read is refused on **every** backend (`loom.projection-columnless-source`): `persistedAs: eventLog` (no state table), `shape: document` (the table is `(id, data, version)`; refused per column named — `count()` alone is fine), and a TPC abstract base (no table of its own). The way out is a different *read* — the per-row arm, or a folded projection.

One more condition bites the surviving document `count()`: a capability-filtered document source (`loom.projection-document-source-capability-filtered` — the filter predicates name `tenant_id` / `is_deleted`, columns the jsonb triple lacks; waive them with `ignoring` or store relationally). **Java used to be a second one** — its aggregation ran JPQL through the `EntityManager` and a document aggregate has no JPA entity to name — but since M-T4.2 it runs the same query natively against the `(id, data, version)` table, so all five backends aggregate a document source alike. `scaffoldDashboard` still skips document aggregates, on every backend, because only `id` is nameable there ([`../scaffold-macros.md`](../scaffold-macros.md)).

### Folded — `keyed by` + `on(e: Event)`

A projection with no query clauses and one or more `on(e: <Event>) { … }` handlers is a **materialized read model**: a table with one row per `keyed by` key, updated by a pure fold on each event. `keyed by` must name a declared id-shaped field (`loom.projection-key-unknown` / `-key-not-id`); the routing key is `e.<key>` unless `by <expr>` says otherwise (an event without the key field and no `by` is `loom.projection-event-unkeyed`). The grammar makes `keyed by` optional — but a *fold* without it has no key to route by and is refused by that same `loom.projection-event-unkeyed`; the keyless ("singleton") projection is the query-time whole-table aggregation above, not a fold. Each event type folds in exactly one handler (`loom.projection-duplicate-on`), and the body is a **pure fold** — `:=` assignments and `let` only; an `emit`, a call, a guard or a `return` is `loom.projection-fold-impure` (use a workflow `on(e)` reactor instead). An `on(e: E)` handler IS the subscription (**D-PROJECTION-IMPLICIT-SUB**): a fold whose event no `channel` carries still dispatches in-process on all five backends, so no carrying channel is required. The warning that once demanded one, `loom.projection-event-uncarried`, was retired with the decision; folding an event that carries a `mask unless` field would launder the masked value into an unredacted row, so it is refused too (`loom.field-mask-projection-source` — see [chapter 17](17-auth.md)).

```ddd
event OrderConfirmed { orderRef: Order id, at: datetime }
channel Lifecycle { carries: OrderConfirmed  delivery: broadcast  retention: ephemeral }

projection OrderBoard keyed by orderRef {
  orderRef: Order id
  confirmedAt: datetime
  on(e: OrderConfirmed) { orderRef := e.orderRef  confirmedAt := e.at }
}
```

::: tabs backend
== node
```ts
// http/projections.ts — load-or-allocate the row by key, fold, upsert
export async function foldOrderConfirmedIntoOrderBoard(db, e: Events.OrderConfirmed): Promise<void> {
  const __key = e.orderRef;
  const state = (await loadOrderBoard(db, __key)) ?? { orderRef: __key };
  state.orderRef = e.orderRef;
  state.confirmedAt = e.at;
  await saveOrderBoard(db, state);   // insert … onConflictDoUpdate({ target: schema.orderBoards.orderRef, set: state })
}
// GET /projections/order_board  →  OrderBoardListResponse;  GET /projections/order_board/{key}  →  OrderBoardResponse (404 on miss)
```
== dotnet
```csharp
// Application/Workflows/OrderBoardOnOrderConfirmedHandler.cs folds into
// Infrastructure/Persistence/Projections/OrderBoardRow.cs; served by Api/CatalogProjectionsController.cs
```
== java
```java
// infrastructure/repositories/OrderBoardRowRepository.java + api/CatalogProjectionsController.java
```
== python
```python
# app/http/projections_routes.py — the fold + GET /projections/order_board[/{key}]
```
== elixir
```elixir
# lib/d/catalog/projections/order_board/on_order_confirmed.ex
def handle(%D.Catalog.Events.OrderConfirmed{} = event) do
  key = event.order_ref
  state = case D.Repo.get(D.Catalog.Projections.OrderBoardRow, key) do
    nil -> %D.Catalog.Projections.OrderBoardRow{order_ref: key}
    existing -> existing
  end
  {:ok, _} = D.Repo.insert_or_update(Ecto.Changeset.change(state, %{confirmed_at: event.at |> then(&(&1 && DateTime.truncate(&1, :second)))}))
  :ok
end
```
::: end

The projection tracks **events, not rows**: an aggregate `update` that emits nothing leaves the read model untouched, and deleting the aggregate does not delete the fold row.

### Backend gates

Every projection shape above emits on all five backends, so none carries a per-backend support gate. There is no per-feature `docs/projections.md`; this chapter and [`../scaffold-macros.md`](../scaffold-macros.md) (`scaffoldDashboard`) are the reference.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// Python backend — criterion reads: a `criterion` body lowers to a SQLAlchemy
// predicate over the Row class (comparisons, and_/or_/not_, VO sub-columns,
// enum values, `<refColl>.contains` → correlated EXISTS against the join
// table) inside the repository's `run_find_all_by_<criterion>` method.  The
// fixture puts four criteria on the wire with `scaffoldGet` /
// `scaffoldGetApi`; their router mounts BEFORE the aggregate routers, so
// `/orders/by_status` is matched before `/orders/{id}` (Starlette matches in
// registration order).
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = fs.readFileSync(
  path.resolve(here, "../../e2e/fixtures/python-build/domain.ddd"),
  "utf8",
);

async function build() {
  return generateSystemFiles(FIXTURE);
}

describe("python criterion-read lowering", () => {
  it("comparison predicates lower to column expressions", async () => {
    const files = await build();
    const repo = files.get("api/app/db/repositories/order_repository.py")!;
    expect(repo).toContain(
      "async def run_find_all_by_by_status(self, status: OrderStatus, offset: int | None = None, limit: int | None = None) -> list[Order]:",
    );
    expect(repo).toContain("select(OrderRow).where((OrderRow.status == status))");
    expect(repo).toContain(
      "async def run_find_all_by_cheaper_than(self, ceiling: Decimal, offset: int | None = None, limit: int | None = None) -> list[Order]:",
    );
    expect(repo).toContain("select(OrderRow).where((OrderRow.unit_budget <= ceiling))");
  });

  it("refColl.contains lowers to a correlated EXISTS on the join table", async () => {
    const files = await build();
    const repo = files.get("api/app/db/repositories/order_repository.py")!;
    expect(repo).toContain(
      "select(OrderWatchersRow).where(OrderWatchersRow.order_id == OrderRow.id, OrderWatchersRow.customer_id == customer_id).exists()",
    );
  });

  it("scaffoldGet routes register before /{id} with coerced query params", async () => {
    const files = await build();
    const routes = files.get("api/app/http/sales_api_routes.py")!;
    expect(routes).toContain(
      '@router.get("/orders/by_status", operation_id="getOrderByStatus", responses=',
    );
    expect(routes).toContain(
      "async def get_order_by_status_route(status: OrderStatus, session: SessionDep) -> Any:",
    );
    expect(routes).toContain("await get_order_by_watched_by(session, CustomerId(customerId))");
    // A `money` param arrives as a wire string and is branded back to the
    // `Decimal` the handler expects at the wire→domain seam.  `MoneyStr`, not a
    // bare `str`: the annotation is what makes the `Decimal(ceiling)` below
    // total — `?ceiling=12,50` is a 422, never an `InvalidOperation` 500.
    expect(routes).toContain(
      "async def get_order_by_cheaper_than_route(ceiling: MoneyStr, session: SessionDep) -> Any:",
    );
    expect(routes).toContain("await get_order_by_cheaper_than(session, Decimal(ceiling))");
    // The handler reads the first match and answers 404 on a miss.
    const handler = files.get("api/app/application/get_order_by_cheaper_than.py")!;
    expect(handler).toContain(
      "__x_hits = await orders.run_find_all_by_cheaper_than(ceiling, limit=1)",
    );
    expect(handler).toContain('raise AggregateNotFoundError("not_found")');
    // Registration order: the explicit-route router precedes the `/{id}` one.
    const main = files.get("api/app/main.py")!;
    expect(main.indexOf("app.include_router(sales_api_router")).toBeGreaterThanOrEqual(0);
    expect(main.indexOf("app.include_router(sales_api_router")).toBeLessThan(
      main.indexOf("app.include_router(order_router"),
    );
  });

  it("the auto `all` read stays the dedicated method/route pair (no dupes)", async () => {
    const files = await build();
    const routes = files.get("api/app/http/order_routes.py")!;
    expect(routes.match(/@router\.get\(""/g)?.length).toBe(1);
    const repo = files.get("api/app/db/repositories/order_repository.py")!;
    expect(repo.match(/async def all\(/g)?.length).toBe(1);
  });
});

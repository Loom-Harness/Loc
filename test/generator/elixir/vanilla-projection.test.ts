import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

// ---------------------------------------------------------------------------
// Elixir-vanilla backend — projection read models (projection.md, v1).  A
// projection folds foreign events into a `<Proj>Row` Ecto read-model schema
// (non-key columns nullable), dispatched in-process via a pure fold handler on
// the context Dispatcher, and read through GET /api/projections/<snake>[/:key].
// Parity with the shipped Hono + Python + Java runtimes (4th backend).
// ---------------------------------------------------------------------------

const SRC = `system Shop { subdomain Sales { context Orders {
  enum OrderStatus { Placed Shipped }
  event OrderPlaced  { order: Order id, customer: Customer id }
  event OrderShipped { order: Order id }
  aggregate Customer { name: string }
  aggregate Order {
    status: OrderStatus
    create(customer: Customer id) {}
    operation ship() { emit OrderShipped { order: id } }
  }
  channel Lifecycle { carries: OrderPlaced, OrderShipped  retention: log  key: order }
  projection OrderBook keyed by order {
    order: Order id
    customer: Customer id
    status: OrderStatus
    on(e: OrderPlaced)  { order := e.order  customer := e.customer  status := Placed }
    on(e: OrderShipped) { status := Shipped }
  }
} } storage pg { type: postgres }
  resource oState { for: Orders, kind: state, use: pg }
  deployable salesApi { platform: elixir contexts: [Orders] dataSources: [oState] port: 4000 } }`;

// A projection-less system (same shape, projection removed) — additivity guard.
const SRC_NO_PROJECTION = `system Shop { subdomain Sales { context Orders {
  enum OrderStatus { Placed Shipped }
  event OrderShipped { order: Order id }
  aggregate Order {
    status: OrderStatus
    operation ship() { emit OrderShipped { order: id } }
  }
} } storage pg { type: postgres }
  resource oState { for: Orders, kind: state, use: pg }
  deployable salesApi { platform: elixir contexts: [Orders] dataSources: [oState] port: 4000 } }`;

async function build(src: string): Promise<Map<string, string>> {
  return await generateSystemFiles(src);
}

function file(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  if (!key) throw new Error(`no generated file ending in ${suffix}`);
  return files.get(key)!;
}

describe("elixir-vanilla projection runtime", () => {
  it("emits a nullable-non-key Ecto read-model row keyed by the correlation id", async () => {
    const row = file(await build(SRC), "orders/projections/order_book_row.ex");
    expect(row).toContain("defmodule SalesApi.Orders.Projections.OrderBookRow do");
    expect(row).toContain("use Ecto.Schema");
    expect(row).toContain('@schema_prefix "orders"');
    expect(row).toContain("@primary_key {:order, :binary_id, autogenerate: false}");
    expect(row).toContain('schema "order_books" do');
    expect(row).toContain("field :customer, :binary_id");
    // enum non-key field → Ecto.Enum (so the fold's `:Placed` atom round-trips)
    expect(row).toContain("field :status, Ecto.Enum, values: [:Placed, :Shipped]");
    expect(row).toContain("timestamps()");
  });

  it("emits nothing projection-related for a projection-less system (additivity)", async () => {
    const files = await build(SRC_NO_PROJECTION);
    const projectionFiles = [...files.keys()].filter(
      (k) => k.includes("/projections/") || k.endsWith("projections_controller.ex"),
    );
    expect(projectionFiles).toEqual([]);
  });
});

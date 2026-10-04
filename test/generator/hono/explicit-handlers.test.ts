// Hono/TS emission for the explicit application/transport layer
// (`commandHandler` / `queryHandler` + `route <M> "<path>" -> <Ctx>.<Handler>`).
//
// M-T9.42 slice 2: the RUNTIME claims this file used to pin as emitted text —
// load → mutate → save → return, a scalar or aggregate return projected through
// `toWire`, a value-object body param, a repository delete, the RFC 7807 404,
// and the router mounted under `/api` — are now driven on all five backends by
// the corpus fixtures `handler-aggregate-ops` (a live row) and `handler-triad`
// (an empty table), each read back through a different route against one wire
// golden.  What stays here is what no booted request can observe:
//   • the M-T5.10 200-schema typing (an OpenAPI/tsc contract, not a value);
//   • the `extern` scaffold-once impl (a user-owned stub that throws by design).
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

function fileEndingWith(m: Map<string, string>, suffix: string): string {
  const key = [...m.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return m.get(key!)!;
}

// M-T5.10: a SINGLE aggregate/entity return types its 200 as that entity's
// `<Agg>Response`, imported from the aggregate's own routes file (the
// `http/views.ts` pattern — single-registered there, so the spec keeps one
// `$ref`).  Collection / id / scalar returns keep `z.unknown()`: their
// `<expr> as unknown` body cast is deliberately loose, and a typed schema would
// reject the handler's return value under strict tsc (compile-gated in
// test/e2e/generated-build.test.ts).
const TYPED_200_SRC = `
system Shop {
  subdomain Sales {
    context Ordering {
      aggregate Order {
        code: string
        status: string
        operation cancel() { status := "cancelled" }
      }
      repository Orders for Order { }
      queryHandler GetOrder(orderId: Order id): Order { let o = Orders.getById(orderId)  return o }
      queryHandler CountOrders(): int { return 0 }
      commandHandler CancelOrder(orderId: Order id): Order id {
        let o = Orders.getById(orderId)
        o.cancel()
        return o.id
      }
      commandHandler Purge(orderId: Order id) { let o = Orders.getById(orderId)  o.cancel() }
    }
  }
  api SalesApi from Sales {
    route GET  "/orders/{orderId}"        -> Ordering.GetOrder
    route GET  "/orders/count"            -> Ordering.CountOrders
    route POST "/orders/{orderId}/cancel" -> Ordering.CancelOrder
    route POST "/orders/{orderId}/purge"  -> Ordering.Purge
  }
  storage pg { type: postgres }
  resource st { for: Ordering, kind: state, use: pg }
  deployable api { platform: node, contexts: [Ordering], dataSources: [st], serves: SalesApi, port: 5001 }
}
`;

describe("hono — explicit handler 200 body typing (M-T5.10)", () => {
  it("types a single-entity 200 as <Agg>Response (imported) and leaves scalar/id as z.unknown()", async () => {
    const router = fileEndingWith(
      await generateSystemFiles(TYPED_200_SRC),
      "http/salesApi-routes.ts",
    );
    // Single-entity return → `<Agg>Response`, imported once from the aggregate
    // routes file (the views.ts pattern) — not re-declared here.
    expect(router).toContain(
      '200: { description: "OK", content: { "application/json": { schema: OrderResponse } } }',
    );
    expect(router).toContain('import { OrderResponse } from "./order.routes";');
    expect(router).not.toContain("const OrderResponse =");
    expect(router).not.toContain("OrderResponseResponse");
    // Scalar (int) + id returns keep `z.unknown()` — their `as unknown` body cast
    // is loose; a typed schema would break the return under strict tsc.
    expect(router).toContain(
      '200: { description: "OK", content: { "application/json": { schema: z.unknown() } } }',
    );
    expect(router).toContain("return httpCtx.json(0 as unknown, 200);");
    expect(router).toContain("return httpCtx.json(o.id as unknown, 200);");
    // The void handler keeps its 204.
    expect(router).toContain('204: { description: "No content" }');
  });
});

// An `extern` handler is bodyless: the route still wires up, but instead of a
// rendered load→mutate→save body it calls a scaffold-once, user-owned impl
// module (`src/application/<kebab>-handler-impl.ts`).
const EXTERN_SRC = `
system Shop {
  subdomain Sales {
    context Ordering {
      aggregate Order { code: string }
      repository Orders for Order { }
      extern commandHandler PlaceOrder(code: string): Order id;
      extern queryHandler GetQuote(orderId: Order id): string;
    }
  }
  api SalesApi from Sales {
    route POST "/orders" -> Ordering.PlaceOrder
    route GET  "/orders/{orderId}/quote" -> Ordering.GetQuote
  }
  storage pg { type: postgres }
  resource st { for: Ordering, kind: state, use: pg }
  deployable api { platform: node, contexts: [Ordering], dataSources: [st], serves: SalesApi, port: 5001 }
}
`;

describe("hono — extern commandHandler / queryHandler", () => {
  it("route dispatch calls the scaffold-once impl and returns its value", async () => {
    const m = await generateSystemFiles(EXTERN_SRC);
    const router = fileEndingWith(m, "http/salesApi-routes.ts");
    // Imports + calls the user impl module (not an inline repo/workflow body).
    expect(router).toContain(
      'import { placeOrderImpl } from "../application/place-order-handler-impl";',
    );
    expect(router).toContain("const result = await placeOrderImpl(code);");
    expect(router).toContain("return httpCtx.json(result as unknown, 200);");
    expect(router).not.toContain("new OrderRepository(");
    // The extern query dispatches likewise (path-coerced id passed through).
    expect(router).toContain("const result = await getQuoteImpl(orderId);");
  });

  it("emits a scaffold-once impl stub that throws loudly", async () => {
    const m = await generateSystemFiles(EXTERN_SRC);
    const impl = fileEndingWith(m, "application/place-order-handler-impl.ts");
    expect(impl.split("\n")[0]).toContain("loom:scaffold-once");
    expect(impl).toContain(
      "export async function placeOrderImpl(code: string): Promise<Ids.OrderId>",
    );
    expect(impl).toContain("throw new ExternHandlerError(");
    expect(impl).toContain("is not implemented");
  });
});

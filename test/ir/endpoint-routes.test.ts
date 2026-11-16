// `route <METHOD> "<path>" -> Ctx.Decl.<endpoint>`: a route to a declaration's
// built-in endpoint, for the kinds the statement language has no handler form
// for (`declEndpoints`, src/ir/plan/decl-endpoints.ts).  Lowering keeps these
// apart from handler routes, the validator checks name / method / path
// parameters against the fact, a kind a handler serves is refused, and every
// backend refuses the route honestly until it mounts endpoint routes.

import { AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { declEndpoints } from "../../src/ir/plan/decl-endpoints.js";
import { allContexts } from "../../src/ir/types/loom-ir.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { isApi } from "../../src/language/generated/ast.js";
import { printStructural } from "../../src/language/print/print-structural.js";
import { parseString } from "../_helpers/parse.js";

const SYS = (routes: string, platform = "node") => `
system Shop {
  subdomain Sales {
    context Ordering {
      event OrderPlaced { order: Order id }
      aggregate Order audited with crudish {
        code: string
        open: bool
        operation close() when open { open := false }
      }
      repository Orders for Order { }
      projection OrderBook keyed by order {
        order: Order id
        status: string
        on(e: OrderPlaced) { status := "Placed" }
      }
      workflow Fulfilment {
        orderRef: Order id
        create(e: OrderPlaced) by e.order {
          orderRef := e.order
        }
      }
      abstract aggregate Vehicle inheritanceUsing: sharedTable {
        plate: string
      }
      aggregate Car extends Vehicle with crudish { seats: int }
      aggregate Truck extends Vehicle with crudish { payloadKg: int = 0 }
      repository Cars for Car { }
      repository Trucks for Truck { }
    }
  }
  api SalesApi {
    ${routes}
  }
  storage pg { type: postgres }
  resource st { for: Ordering, kind: state, use: pg }
  deployable api { platform: ${platform}, contexts: [Ordering], dataSources: [st], serves: SalesApi, port: 4000 }
}
`;

async function diagnose(routes: string, platform = "node") {
  const { model } = await parseString(SYS(routes, platform), { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model))).filter(
    (d) => d.severity === "error",
  );
}
const codes = async (routes: string, platform = "node") =>
  (await diagnose(routes, platform)).map((d) => d.code ?? "");

const VALID = `
    route GET "/orders/{id}/history"                -> Ordering.Order.history
    route GET "/orders/{id}/can_close"              -> Ordering.Order.canClose
    route GET "/projections/order_book"             -> Ordering.OrderBook.read
    route GET "/projections/order_book/{key}"       -> Ordering.OrderBook.byKey
    route GET "/vehicles"                           -> Ordering.Vehicle.all
    route GET "/vehicles/{id}"                      -> Ordering.Vehicle.getById
    route GET "/workflows/fulfilment/instances"     -> Ordering.Fulfilment.instances
    route GET "/workflows/fulfilment/instances/{id}" -> Ordering.Fulfilment.instance`;

describe("endpoint routes — the declEndpoints fact", () => {
  it("lists each declaration's built-in endpoints and the names a handler serves", async () => {
    const { model } = await parseString(SYS(""), { validate: false });
    const ctx = allContexts(enrichLoomModel(lowerModel(model))).find((c) => c.name === "Ordering")!;
    const names = (decl: string) => declEndpoints(ctx, decl)?.endpoints.map((e) => e.name);
    expect(names("Order")).toEqual(["history", "canClose"]);
    expect(declEndpoints(ctx, "Order")?.handlerForm).toEqual(
      expect.arrayContaining(["create", "getById", "all", "destroy", "close"]),
    );
    expect(names("OrderBook")).toEqual(["read", "byKey"]);
    expect(names("Vehicle")).toEqual(["getById", "all"]);
    expect(names("Fulfilment")).toEqual(["instances", "instance"]);
    expect(declEndpoints(ctx, "Fulfilment")?.handlerForm).toEqual(["start"]);
    expect(declEndpoints(ctx, "Nope")).toBeUndefined();
  });
});

describe("endpoint routes — lowering and printing", () => {
  it("lowers a three-segment target to ApiIR.endpointRoutes, never to routes", async () => {
    const { model } = await parseString(SYS(VALID), { validate: false });
    const api = lowerModel(model).systems[0]!.apis.find((a) => a.name === "SalesApi")!;
    expect(api.routes).toEqual([]);
    expect(api.endpointRoutes[0]).toEqual({
      method: "GET",
      path: "/orders/{id}/history",
      target: { context: "Ordering", decl: "Order", endpoint: "history" },
    });
    expect(api.endpointRoutes).toHaveLength(8);
  });

  it("prints a three-segment target back as source", async () => {
    const { model } = await parseString(SYS(VALID), { validate: false });
    const api = AstUtils.streamAllContents(model).find(isApi)!;
    expect(printStructural(api)).toContain(
      'route GET "/orders/{id}/history" -> Ordering.Order.history',
    );
  });
});

describe("endpoint routes — validation", () => {
  it("accepts every endpoint kind; each backend refuses the route until it mounts it", async () => {
    for (const platform of ["node", "dotnet", "python", "java", "elixir"]) {
      const ds = await diagnose(VALID, platform);
      expect(
        ds.filter((d) => d.code !== "loom.target-unsupported").map((d) => d.code),
        platform,
      ).toEqual([]);
      const refused = ds.filter((d) => d.code === "loom.target-unsupported");
      expect(refused, platform).toHaveLength(8);
      expect(refused[0]!.message).toContain("built-in endpoint 'Ordering.Order.history'");
    }
  });

  it("loom.route-endpoint-unknown — an endpoint the declaration does not have", async () => {
    const ds = await diagnose(`route GET "/orders/{id}/audit" -> Ordering.Order.audit`);
    expect(ds.map((d) => d.code)).toContain("loom.route-endpoint-unknown");
    expect(ds.find((d) => d.code === "loom.route-endpoint-unknown")!.message).toContain(
      "'history', 'canClose'",
    );
    expect(await codes(`route GET "/x" -> Ordering.Nope.read`)).toContain(
      "loom.route-endpoint-unknown",
    );
  });

  it("loom.route-endpoint-has-handler-form — a kind a handler serves", async () => {
    expect(await codes(`route GET "/orders/{id}" -> Ordering.Order.getById`)).toContain(
      "loom.route-endpoint-has-handler-form",
    );
    expect(await codes(`route POST "/orders" -> Ordering.Order.create`)).toContain(
      "loom.route-endpoint-has-handler-form",
    );
    expect(await codes(`route POST "/workflows/f" -> Ordering.Fulfilment.start`)).toContain(
      "loom.route-endpoint-has-handler-form",
    );
  });

  it("loom.route-endpoint-method — the endpoint answers GET only", async () => {
    expect(await codes(`route POST "/orders/{id}/history" -> Ordering.Order.history`)).toContain(
      "loom.route-endpoint-method",
    );
  });

  it("loom.route-endpoint-params — the path binds exactly the endpoint's parameters", async () => {
    expect(
      await codes(`route GET "/orders/{orderId}/history" -> Ordering.Order.history`),
    ).toContain("loom.route-endpoint-params");
    expect(await codes(`route GET "/orders/history" -> Ordering.Order.history`)).toContain(
      "loom.route-endpoint-params",
    );
  });
});

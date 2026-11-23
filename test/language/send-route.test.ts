// `route … send <Ctx>.<Record>`: the record's one handler catches it.  The
// printer writes both route forms back, the binding block included, and the
// IR route reaches the record's handler (`handlerFor`), so every route reader
// treats both forms alike.

import { AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { routeHandler } from "../../src/ir/plan/route-handler.js";
import { isApi } from "../../src/language/generated/ast.js";
import { printStructural } from "../../src/language/print/index.js";
import { parseString } from "../_helpers/parse.js";

const SRC = `
system S {
  subdomain Sales {
    context Ordering {
      aggregate Order with crudish { code: string }
      repository Orders for Order
      command ShipOrder { id: Order id  carrier: string }
      commandHandler ShipOrderHandler(cmd: ShipOrder) { let o = Orders.get(cmd.id) }
    }
  }
  api A from Sales {
    route POST "/orders/{id}/ship" send Ordering.ShipOrder
    route POST "/orders/{id}/hook" send Ordering.ShipOrder { carrier: header "X-Carrier" }
  }
  storage pg { type: postgres }
  resource st { for: Ordering, kind: state, use: pg }
  deployable d { platform: node contexts: [Ordering] dataSources: [st] serves: A port: 4000 }
}`;

describe("route … send <Ctx>.<Record>", () => {
  it("prints both send routes back, the binding block included", async () => {
    const { model } = await parseString(SRC, { validate: false });
    const api = [...AstUtils.streamAllContents(model)].find(isApi)!;
    const printed = printStructural(api);
    expect(printed).toContain('route POST "/orders/{id}/ship" send Ordering.ShipOrder');
    expect(printed).toContain(
      'route POST "/orders/{id}/hook" send Ordering.ShipOrder { carrier: header "X-Carrier" }',
    );
  });

  it("reaches the record's one handler in the IR", async () => {
    const { model } = await parseString(SRC, { validate: false });
    const loom = enrichLoomModel(lowerModel(model));
    const routes = loom.systems[0]!.apis[0]!.routes;
    const ctx = loom.systems[0]!.subdomains[0]!.contexts.find((c) => c.name === "Ordering")!;
    expect(routes.map((r) => routeHandler(r, ctx)?.handler.name)).toEqual([
      "ShipOrderHandler",
      "ShipOrderHandler",
    ]);
    expect(routes[1]!.binding).toEqual({
      kind: "send",
      context: "Ordering",
      record: "ShipOrder",
      binds: [{ field: "carrier", source: "header", header: "X-Carrier" }],
    });
  });
});

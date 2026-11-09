// F6d — Hono orchestrator rewire — proves that the hono system orchestrator
// dispatches per-aggregate routes emission through the layered
// StyleAdapter + byLayer LayoutAdapter.
// The byte-identical guarantee comes from the existing TypeScript
// generator fixture suite (test/generator/typescript/*) + the
// page-emitter byte-equivalence fixture suite (which captures the
// generated hono project under test/fixtures/baseline-output/).

import { describe, expect, it, vi } from "vitest";
import * as byLayerModule from "../../src/platform/hono/shared/adapters/by-layer-layout.js";
import * as layeredStyleModule from "../../src/platform/hono/shared/adapters/layered-style.js";
import { generateSystemFiles } from "../_helpers/generate.js";

const SYSTEM_SRC = `
system Sys {
  subdomain Sales {
    context Orders {
      aggregate Order {
        name: string
        invariant name.length > 0
      }
      repository Orders for Order { }
      criterion OrdersByName(name: string) of Order = this.name == name
    }
  }
  storage primary { type: postgres }
  resource ordersState { for: Orders, kind: state, use: primary }
  deployable api {
    platform: node
    contexts: [Orders]
    dataSources: [ordersState]
    port: 3000
  }
}
`;

describe("F6d — hono orchestrator rewire (system mode)", () => {
  it("dispatches the routes file through layeredStyleAdapter.emitForAggregate", async () => {
    const spy = vi.spyOn(layeredStyleModule.layeredStyleAdapter, "emitForAggregate");
    try {
      const files = await generateSystemFiles(SYSTEM_SRC);
      expect(spy).toHaveBeenCalled();
      const call = spy.mock.calls[0]!;
      const agg = call[0]!;
      expect((agg as { name: string }).name).toBe("Order");
      // Dispatched output lands at the byLayer path.
      const routesPath = [...files.keys()].find((k) => k.endsWith("/http/order.routes.ts"));
      expect(routesPath).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });

  it("routes the dispatched artifact through byLayerLayoutAdapter.pathFor with the http-routes category", async () => {
    const layoutSpy = vi.spyOn(byLayerModule.byLayerLayoutAdapter, "pathFor");
    try {
      await generateSystemFiles(SYSTEM_SRC);
      expect(layoutSpy.mock.calls.length).toBeGreaterThan(0);
      const httpRoutesCalls = layoutSpy.mock.calls.filter(
        (c) => (c[0] as { category?: string }).category === "http-routes",
      );
      expect(httpRoutesCalls.length).toBeGreaterThan(0);
    } finally {
      layoutSpy.mockRestore();
    }
  });
});

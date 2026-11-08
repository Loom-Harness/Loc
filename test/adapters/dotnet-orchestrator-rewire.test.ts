// F5d — orchestrator rewire — proves that the dotnet system orchestrator
// dispatches CQRS emission through the cqrs StyleAdapter +
// byLayer LayoutAdapter.  The byte-
// identical guarantee comes from the existing dotnet fixture suite
// (test/generator/dotnet/*) — those tests assert the produced Map
// hasn't changed.  This file's job is to prove the dispatch path
// fires, not the path's output (which is the same as before by
// construction).
//
// The dotnet generator imports its sibling adapters directly
// (`./adapters/cqrs-style.js` / `./adapters/by-layer-layout.js`)
// rather than resolving via `platform/resolve-adapters.js`, so the
// rewire test spies on the adapter modules themselves — not the
// registry.

import { describe, expect, it, vi } from "vitest";
import * as byLayerModule from "../../src/generator/dotnet/adapters/by-layer-layout.js";
import * as cqrsStyleModule from "../../src/generator/dotnet/adapters/cqrs-style.js";
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
    platform: dotnet
    contexts: [Orders]
    dataSources: [ordersState]
    port: 5000
  }
}
`;

describe("F5d — dotnet orchestrator rewire (system mode)", () => {
  it("dispatches CQRS through cqrsStyleAdapter.emitForAggregate for every dotnet aggregate", async () => {
    const spy = vi.spyOn(cqrsStyleModule.cqrsStyleAdapter, "emitForAggregate");
    try {
      const files = await generateSystemFiles(SYSTEM_SRC);
      // The adapter was invoked at least once per dotnet aggregate.
      expect(spy).toHaveBeenCalled();
      const call = spy.mock.calls[0]!;
      const agg = call[0]!;
      expect((agg as { name: string }).name).toBe("Order");
      // Sanity — the dispatched output landed in the file map at the
      // expected byLayer paths (proof that the path adapter fired too).
      const apiCsproj = [...files.keys()].find((k) => k.includes("api/Application/Orders/"));
      expect(apiCsproj).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });

  it("dispatches through both the style and layout adapter (path comes from byLayer.pathFor)", async () => {
    const layoutSpy = vi.spyOn(byLayerModule.byLayerLayoutAdapter, "pathFor");
    try {
      await generateSystemFiles(SYSTEM_SRC);
      // The path adapter was called at least once for each CQRS-emitted
      // file — every produced artifact's path comes from `pathFor`.
      expect(layoutSpy.mock.calls.length).toBeGreaterThan(0);
      // Every call carries an artifact with a category — the byLayer
      // adapter requires it.
      for (const call of layoutSpy.mock.calls) {
        const artifact = call[0]! as { category?: string };
        expect(artifact.category).toBeDefined();
      }
    } finally {
      layoutSpy.mockRestore();
    }
  });
});

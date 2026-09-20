// An `on(e: E)` with NO `channel` carrying `E` dispatches on all five backends
// (**D-PROJECTION-IMPLICIT-SUB**), for BOTH consumer kinds — a folded
// projection and a workflow reactor.
//
// WHY THIS GATE IS SHAPED THE WAY IT IS.  The defect it closes was not a
// per-backend emitter bug: `deriveEventSubscriptions` (`src/ir/enrich`) opened
// with `if (!channels || channels.length === 0) return []` and then kept only
// events some channel `carries:`, so an uncarried consumer produced no
// subscription at all and EVERY backend was correct downstream of an empty
// list.  A per-backend test would therefore have passed on the broken tree with
// a carried fixture and failed to exist for the uncarried one — which is
// exactly what happened (ledger `G2646-open-projection-on-event-no-channel`,
// open for two months behind a warning that described the hole instead of
// closing it).  So the assertions below are over the SHARED corpus fixture that
// carries the uncarried shape, swept across every backend, and each backend
// names the concrete symbol its own dispatcher emits — five independent
// observations rather than one matcher that could be wrong five times.
//
// The vacuity guard matters more than usual here: the whole fixture is defined
// by the ABSENCE of a `channel`, and a fixture that quietly grew one would make
// every assertion below pass while proving the opposite thing.

import { describe, expect, it } from "vitest";
import type { Backend } from "../fixtures/corpus/backends.js";
import {
  corpusSource,
  generateCorpusCase,
  validateCorpusCase,
} from "../fixtures/corpus/harness.js";

const FIXTURE = "projection-implicit-sub";

/** Per backend: a substring that can only appear if the PROJECTION fold is
 *  emitted, and one that can only appear if the WORKFLOW reactor is. */
const EXPECTED: Record<Backend, { fold: string; reactor: string }> = {
  node: {
    fold: "export async function foldOrderShippedIntoOrderBoard(",
    reactor: "export async function fulfilmentOnOrderShipped(",
  },
  dotnet: {
    fold: "public sealed class OrderBoardOnOrderShippedHandler : INotificationHandler<OrderShipped>",
    reactor:
      "public sealed class FulfilmentOnOrderShippedHandler : INotificationHandler<OrderShipped>",
  },
  java: {
    fold: "public void onOrderBoardOnOrderShipped(OrderShipped e) {",
    reactor: "public void onFulfilmentOnOrderShipped(OrderShipped e) {",
  },
  python: {
    fold: "async def _proj_order_board_order_shipped(",
    reactor: "async def _fulfilment_on_order_shipped(",
  },
  vanilla: {
    fold: "D.Orders.Projections.OrderBoard.OnOrderShipped.handle(event)",
    reactor: "D.Orders.Workflows.Fulfilment.OnOrderShipped.handle(event)",
  },
};

describe("implicit in-process subscription — no channel, still dispatched", () => {
  it("the fixture declares NO channel (vacuity guard)", () => {
    const src = corpusSource(FIXTURE);
    expect(src).not.toMatch(/^\s*channel\s+\w+/m);
    expect(src).not.toMatch(/^\s*carries:/m);
    // …and it really does declare both consumer kinds on the same event.
    expect(src).toMatch(/on\(e: OrderShipped\)\s+\{ status := Shipped/);
    expect(src).toMatch(/on\(e: OrderShipped\) by e\.orderRef \{/);
  });

  for (const [backend, { fold, reactor }] of Object.entries(EXPECTED) as [
    Backend,
    { fold: string; reactor: string },
  ][]) {
    it(`${backend} emits the uncarried projection fold and workflow reactor`, async () => {
      const files = await generateCorpusCase(FIXTURE, backend);
      const all = [...files.entries()]
        .filter(([k]) => !k.startsWith(".loom/"))
        .map(([, c]) => c)
        .join("\n");
      expect(all, "projection fold not emitted").toContain(fold);
      expect(all, "workflow reactor not emitted").toContain(reactor);
    });
  }

  // The two retired warnings are the other half of the decision: an uncarried
  // consumer is no longer described as one that never fires, because it fires.
  it("no uncarried-consumer diagnostic is raised any more", async () => {
    for (const backend of Object.keys(EXPECTED) as Backend[]) {
      const codes = (await validateCorpusCase(FIXTURE, backend)).map((d) => d.code);
      expect(codes).not.toContain("loom.projection-event-uncarried");
      expect(codes).not.toContain("loom.reactor-event-uncarried");
    }
  });
});

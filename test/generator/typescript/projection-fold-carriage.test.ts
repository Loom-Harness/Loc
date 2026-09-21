// G2646 / **D-PROJECTION-IMPLICIT-SUB** — node's folded-projection emission and
// the channel that is not required to trigger it.
//
// History, because the assertions below are the exact inverse of what this file
// used to assert.  `loom.projection-event-uncarried` warned, verbatim, that a
// fold whose event no `channel` carries "never runs and the read-model row is
// never written", and four backends behaved that way while node folded it
// anyway.  The first fix made node agree with the warning.  The DECISION went
// the other way: `on(e: E)` IS the subscription, a `channel` decides
// cross-deployable delivery and durability (`docs/channels.md`) — nothing in a
// projection's own syntax mentions transport — so the warning is retired and
// the other four backends learned to dispatch the uncarried fold.  Node's
// original leniency was right; what was wrong was that it was alone.
//
// So what this file gates now is that carriage is IRRELEVANT to emission: the
// no-channel system and the carries-both system produce the same folds and the
// same tee.  It is still worth gating per-event, because the regression it
// guards against (a tee `case` naming a `fold…` function the module did not
// declare — TS2304 in the generated project) comes back the moment the tee and
// the fold emission read different handler lists.
//
// The cross-backend half — all five dispatching the same uncarried fold — is
// `test/generator/projection-implicit-sub.test.ts` over the shared corpus
// fixture.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

function sys(channel: string): string {
  return `
  system Shop {
    subdomain Sales { context Orders {
      enum OrderStatus { Placed Shipped }
      event OrderPlaced  { order: Order id }
      event OrderShipped { order: Order id }
      aggregate Customer { name: string }
      aggregate Order { status: OrderStatus  create(customer: Customer id) {} }
      ${channel}
      projection OrderBook keyed by order {
        order: Order id
        status: OrderStatus
        on(e: OrderPlaced)  { status := Placed }
        on(e: OrderShipped) { status := Shipped }
      }
    }}
    api SalesApi from Sales
    storage primarySql { type: postgres }
    resource ordersState { for: Orders, kind: state, use: primarySql }
    deployable api {
      platform: node
      contexts: [Orders]
      dataSources: [ordersState]
      serves: SalesApi
      port: 8080
    }
  }`;
}

const CARRIES_BOTH = `channel Lifecycle { carries: OrderPlaced, OrderShipped  delivery: broadcast  retention: ephemeral }`;
const CARRIES_ONE = `channel Lifecycle { carries: OrderPlaced  delivery: broadcast  retention: ephemeral }`;

async function projections(channel: string): Promise<string> {
  const files = await generateSystemFiles(sys(channel));
  const k = [...files.keys()].find((key) => key.endsWith("http/projections.ts"));
  expect(k, "http/projections.ts not emitted").toBeDefined();
  return files.get(k!)!;
}

describe("node folds a projection whether or not a channel carries the event", () => {
  it("a carried fold is emitted and routed by the tee", async () => {
    const src = await projections(CARRIES_BOTH);
    expect(src).toContain("export async function foldOrderPlacedIntoOrderBook(");
    expect(src).toContain("export async function foldOrderShippedIntoOrderBook(");
    expect(src).toContain('case "OrderPlaced":');
    expect(src).toContain('case "OrderShipped":');
  });

  it("an UNCARRIED fold is emitted and routed IDENTICALLY — no channel needed", async () => {
    const src = await projections("");
    expect(src).toContain("export async function foldOrderPlacedIntoOrderBook(");
    expect(src).toContain("export async function foldOrderShippedIntoOrderBook(");
    expect(src).toContain('case "OrderPlaced":');
    expect(src).toContain('case "OrderShipped":');
    // The fold needs its load/save helpers and the `Events` namespace import,
    // and the tee must be a real decorator rather than the identity.
    expect(src).toContain("async function loadOrderBook");
    expect(src).not.toContain("  return inner;\n}");
    expect(src).toContain('import type * as Events from "../domain/events"');
  });

  it("declaring a channel changes nothing about the emitted folds", async () => {
    const withChannel = await projections(CARRIES_BOTH);
    const without = await projections("");
    // Byte-identical: carriage is a delivery/durability knob, not a codegen one.
    expect(without).toBe(withChannel);
  });

  it("the READ surface is emitted either way", async () => {
    const src = await projections("");
    expect(src).toContain("export function projectionsRoutes(");
    expect(src).toContain('path: "/order_book"');
  });

  it("the tee routes exactly the handlers the module declares", async () => {
    // The TS2304 guard: a `case` for an event whose `fold…` function is absent
    // does not compile in the generated project.  Asserted over the partial
    // carriage system too, since that is where the two lists last diverged.
    for (const channel of [CARRIES_BOTH, CARRIES_ONE, ""]) {
      const src = await projections(channel);
      const cases = [...src.matchAll(/case "(\w+)":/g)].map((m) => m[1]);
      expect(cases.length, `no tee cases for channel=${channel || "<none>"}`).toBeGreaterThan(0);
      for (const ev of cases) {
        expect(src, `tee routes ${ev} with no fold function`).toContain(
          `export async function fold${ev}IntoOrderBook(`,
        );
      }
    }
  });
});

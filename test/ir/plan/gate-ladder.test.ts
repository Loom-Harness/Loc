// The gate ladder (`src/ir/plan/gate-ladder.ts`): which `requires` gate runs
// before the load and which after.  Pure IR facts, pinned here; the order's
// behaviour is the authz ladder's gate-order rungs (`AUTHZ_LADDERS`).

import { describe, expect, it } from "vitest";
import {
  canOpLadder,
  destroyLadder,
  GATE_ORDER,
  gateRank,
  operationLadder,
} from "../../../src/ir/plan/gate-ladder.js";
import { buildLoomModel, enrichedAggregates } from "../../_helpers/ir.js";

const SRC = `
system G {
  user { id: guid  role: string }
  subdomain S {
    context C {
      aggregate Ticket with crudish {
        open: bool
        limit: int
        function isOpenNow(): bool = open
        operation archive() {
          requires isOpenNow()
          open := false
        }
        operation reopen(by: int) when !open {
          requires currentUser.role == "agent"
          requires by <= limit
          open := true
        }
      }
      repository Tickets for Ticket { }
      aggregate Shipment {
        quantity: int
        create(quantity: int) { quantity := quantity }
        destroy {
          requires currentUser.role == "agent"
          requires quantity == 0
        }
      }
      repository Shipments for Shipment { }
    }
  }
}
`;

describe("gate-ladder plan", () => {
  it("orders the rungs as the owner's ruling does", () => {
    expect(GATE_ORDER).toEqual([
      "authn",
      "shape",
      "requires",
      "load",
      "row-requires",
      "version",
      "when",
      "domain",
    ]);
    expect(gateRank("requires")).toBeLessThan(gateRank("load"));
  });

  it("puts a principal-only gate before the load and a row-reading one after it", async () => {
    const t = enrichedAggregates(await buildLoomModel(SRC)).find((a) => a.name === "Ticket")!;
    const op = t.operations.find((o) => o.name === "reopen")!;
    expect(operationLadder(op, { readsIfMatch: true }).map((c) => c.step)).toEqual([
      "requires",
      "load",
      "row-requires",
      "version",
      "when",
    ]);
    // The probe carries no If-Match.
    expect(canOpLadder(op).map((c) => c.step)).toEqual([
      "requires",
      "load",
      "row-requires",
      "when",
    ]);
  });

  it("puts a destroy's principal-only gate before the load and its row gate after it", async () => {
    const sh = enrichedAggregates(await buildLoomModel(SRC)).find((a) => a.name === "Shipment")!;
    const ladder = destroyLadder(sh.destroys?.[0], { readsIfMatch: true });
    expect(ladder.map((c) => c.step)).toEqual(["requires", "load", "row-requires", "version"]);
  });

  it("puts a gate that calls the aggregate's own function after the load", async () => {
    const t = enrichedAggregates(await buildLoomModel(SRC)).find((a) => a.name === "Ticket")!;
    const op = t.operations.find((o) => o.name === "archive")!;
    expect(operationLadder(op, { readsIfMatch: false }).map((c) => c.step)).toEqual([
      "load",
      "row-requires",
    ]);
  });
});

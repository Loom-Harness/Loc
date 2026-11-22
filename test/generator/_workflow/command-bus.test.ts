// Gate for D-COMMAND-BUS (docs/decisions).
// The bus renders each record's dispatch in plan order, then the typed bus; a
// leaf table that misses a part does not type-check.

import { describe, expect, it } from "vitest";
import {
  type CommandBusLeaves,
  renderCommandBus,
} from "../../../src/generator/_workflow/command-bus.js";
import type { HandlerBinding } from "../../../src/ir/plan/index.js";

const entry = (record: string, kind: "command" | "query" = "command"): HandlerBinding => ({
  kind,
  context: "Ordering",
  record,
  handler: {
    form: kind === "command" ? "commandHandler" : "queryHandler",
    name: `${record}Handler`,
  },
});

const LEAVES: CommandBusLeaves = {
  handlerSignature: (e) => `(record: ${e.record}, ctx: HandlerCtx)`,
  dispatch: (e) => [`dispatch${e.record}`],
  bus: (es) => [`bus(${es.map((e) => e.record).join(",")})`],
  routeCall: ({ entry: e, record, ctx }) => `dispatch${e.record}(${record}, ${ctx})`,
};

describe("renderCommandBus", () => {
  it("renders the dispatches in plan order, then the bus", () => {
    expect(renderCommandBus([entry("ShipOrder"), entry("GetOrder", "query")], LEAVES)).toEqual([
      "dispatchShipOrder",
      "dispatchGetOrder",
      "bus(ShipOrder,GetOrder)",
    ]);
  });

  it("renders only the bus for a context without records", () => {
    expect(renderCommandBus([], LEAVES)).toEqual(["bus()"]);
  });

  it("requires every part in a leaf table", () => {
    // @ts-expect-error `routeCall` is missing, so the table is not a CommandBusLeaves.
    const incomplete: CommandBusLeaves = {
      handlerSignature: LEAVES.handlerSignature,
      dispatch: LEAVES.dispatch,
      bus: LEAVES.bus,
    };
    expect(Object.keys(incomplete)).toHaveLength(3);
  });
});

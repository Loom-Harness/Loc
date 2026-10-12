// `when` canCommand gate (criterion.md, use site 2) — IR side.
//
// `operation x() when <pred> { … }` lowers the predicate into
// `OperationIR.when` in the AGGREGATE env (op params are out of scope),
// and the validators pin the surface: param references are rejected, the
// predicate must be bool, and private ops warn (no route → no gate).  Every
// backend emits the gate + can-query.

import { describe, expect, it } from "vitest";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { allContexts } from "../../src/ir/types/loom-ir.js";
import { parseString } from "../_helpers/parse.js";

const SRC = `
  context Orders {
    enum OrderStatus { Draft, Shipped, Cancelled }
    aggregate Order {
      status: OrderStatus
      operation cancel() when this.status != Shipped {
        status := Cancelled
      }
    }
    repository Orders for Order { }
  }
`;

describe("when gate — lowering", () => {
  it("lowers the predicate into OperationIR.when", async () => {
    const { model, errors } = await parseString(SRC);
    expect(errors).toEqual([]);
    const ctx = allContexts(lowerModel(model)).find((c) => c.name === "Orders")!;
    const op = ctx.aggregates[0]!.operations.find((o) => o.name === "cancel")!;
    expect(op.when).toBeDefined();
    expect(op.when!.kind).toBe("binary");
  });
});

describe("when gate — language validators", () => {
  const errsOf = async (src: string): Promise<string[]> => {
    const { errors } = await parseString(src);
    return errors ?? [];
  };

  it("rejects a parameter reference in the predicate", async () => {
    const errors = await errsOf(`
      context Orders {
        aggregate Order {
          total: int
          operation pay(amount: int) when amount > 0 { total := amount }
        }
        repository Orders for Order { }
      }
    `);
    expect(errors.some((e) => /references parameter 'amount'/.test(e))).toBe(true);
  });

  it("rejects a non-bool predicate", async () => {
    const errors = await errsOf(`
      context Orders {
        aggregate Order {
          note: string
          operation touch() when this.note { note := "x" }
        }
        repository Orders for Order { }
      }
    `);
    expect(errors.some((e) => /'when' must be of type 'bool'/.test(e))).toBe(true);
  });
});

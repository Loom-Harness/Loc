// A member call on a record (aggregate, entity part, value object) is that
// record's own operation or function, even when its name is also a collection
// op.  `expect(o.take(0)).toThrow()` on an `Order` with `operation take(n: int)`
// must lower to a plain method call on `o`; flagged as the collection op, every
// backend rendered `slice`/`Take()`/`o[:0]` on the instance instead.
//
// Every collection-op name that is a legal operation name is covered, as an
// expression inside `expect` (where the defect showed).  A collection receiver
// keeps the op.

import { describe, expect, it } from "vitest";
import type { ExprIR, TestStmtIR } from "../../src/ir/types/loom-ir.js";
import { allAggregates } from "../../src/ir/types/loom-ir.js";
import { walkExprDeep } from "../../src/ir/util/walk.js";
import { buildLoomModel } from "../_helpers/index.js";

// `where`, `contains` and `join` are keywords, so no operation can carry them.
const NAMES = [
  "count",
  "sum",
  "all",
  "any",
  "first",
  "firstOrNull",
  "map",
  "sortBy",
  "distinct",
  "take",
  "skip",
  "min",
  "max",
  "avg",
] as const;

const SRC = `
  context C {
    aggregate Order {
      status: string = "x"
      tags: string[]
${NAMES.map((n) => `      operation ${n}(n: int) { precondition n > 0  status := "y" }`).join("\n")}
      test "record ops" {
        let o = Order.create(tags: ["a", "b"])
${NAMES.map((n) => `        expect(o.${n}(0)).toThrow()`).join("\n")}
        expect(o.tags.take(1).count).toBe(1)
      }
    }
    repository Orders for Order { }
  }
`;

function methodCalls(stmts: readonly TestStmtIR[]): Extract<ExprIR, { kind: "method-call" }>[] {
  const out: Extract<ExprIR, { kind: "method-call" }>[] = [];
  for (const s of stmts) {
    if (s.kind !== "expect" && s.kind !== "expect-throws") continue;
    walkExprDeep(s.expr, (e) => {
      if (e.kind === "method-call") out.push(e);
    });
  }
  return out;
}

describe("a record operation named like a collection op lowers as the operation", () => {
  it("is a plain method call on the record for every collection-op name", async () => {
    const loom = await buildLoomModel(SRC);
    const order = allAggregates(loom).find((a) => a.name === "Order")!;
    const calls = methodCalls(order.tests[0]!.statements);
    for (const name of NAMES) {
      const call = calls.find((c) => c.member === name && c.receiverType?.kind === "entity");
      expect(call, `o.${name}(0)`).toBeDefined();
      expect(call!.isCollectionOp ?? false, `o.${name}(0) is Order.${name}, not the collection op`).toBe(
        false,
      );
    }
    // The collection receiver still gets the collection op.
    const onTags = calls.find((c) => c.member === "take" && c.receiverType?.kind === "array");
    expect(onTags?.isCollectionOp).toBe(true);
  });
});

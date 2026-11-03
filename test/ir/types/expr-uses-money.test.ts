// `exprUsesMoney` answers "does this expression tree touch money anywhere".
// It drives the frontends' decimal.js gate (`aggregateUsesMoney`), so money
// reachable only through a less common kind — a list element, a conversion, a
// variant-match arm, a block-bodied lambda — must still count.

import { describe, expect, it } from "vitest";
import type { ExprIR } from "../../../src/ir/types/loom-ir.js";
import { exprUsesMoney } from "../../../src/ir/types/loom-ir.js";
import { litExpr, STRING_T } from "../../_helpers/ir-builders.js";

const money = litExpr("money", "10.00");

describe("exprUsesMoney", () => {
  it("sees money in a list element", () => {
    expect(exprUsesMoney({ kind: "list", elements: [money] })).toBe(true);
  });

  it("sees money under a conversion", () => {
    expect(exprUsesMoney({ kind: "convert", target: "string", from: "money", value: money })).toBe(
      true,
    );
  });

  it("sees money in a variant-match arm", () => {
    const e: ExprIR = {
      kind: "match",
      arms: [],
      variantArms: [{ varType: STRING_T, value: money }],
    };
    expect(exprUsesMoney(e)).toBe(true);
  });

  it("answers false for a money-free tree (control)", () => {
    expect(exprUsesMoney({ kind: "list", elements: [litExpr("int", "1")] })).toBe(false);
  });
});

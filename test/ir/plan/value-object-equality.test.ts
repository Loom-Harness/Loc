// `valueObjectEqualityPlan` (ruling 457): which `==` / `!=` nodes compare value
// objects, and which side may be absent.  The by-value, absence-safe answer
// itself is proved at runtime by the `value-object-equality` corpus fixture.

import { describe, expect, it } from "vitest";
import { valueObjectEqualityPlan } from "../../../src/ir/plan/value-object-equality.js";
import type { ExprIR, TypeIR } from "../../../src/ir/types/loom-ir.js";

const VO = { kind: "valueobject", name: "Address" } as TypeIR;
const opt = (t: TypeIR): TypeIR => ({ kind: "optional", inner: t });
const ref = (name: string, type: TypeIR): ExprIR => ({ kind: "ref", name, refKind: "param", type });
const eq = (lt: TypeIR, rt: TypeIR, right?: ExprIR) =>
  ({
    kind: "binary",
    op: "==",
    left: ref("a", lt),
    right: right ?? ref("b", rt),
    leftType: lt,
    rightType: rt,
    resultType: { kind: "primitive", name: "bool" },
  }) as Extract<ExprIR, { kind: "binary" }>;

describe("valueObjectEqualityPlan", () => {
  it("names which side may be absent", () => {
    expect(valueObjectEqualityPlan(eq(VO, VO))).toEqual({
      leftOptional: false,
      rightOptional: false,
    });
    expect(valueObjectEqualityPlan(eq(opt(VO), VO))).toEqual({
      leftOptional: true,
      rightOptional: false,
    });
    expect(valueObjectEqualityPlan(eq(VO, opt(VO)))).toEqual({
      leftOptional: false,
      rightOptional: true,
    });
  });

  it("is a presence test, not a value comparison, against the null literal", () => {
    const nullLit: ExprIR = { kind: "literal", lit: "null", value: "null" };
    expect(valueObjectEqualityPlan(eq(opt(VO), opt(VO), nullLit))).toBeUndefined();
  });

  it("does not claim scalar comparisons", () => {
    const s = { kind: "primitive", name: "string" } as TypeIR;
    expect(valueObjectEqualityPlan(eq(s, s))).toBeUndefined();
  });
});

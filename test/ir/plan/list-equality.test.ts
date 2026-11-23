// `listEqualityPlan` (ruling 456): which `==` / `!=` nodes compare two lists,
// and how their elements compare.  Each target's spelling is proved at runtime
// by the `list-equality` corpus fixture.

import { describe, expect, it } from "vitest";
import { listEqualityPlan } from "../../../src/ir/plan/list-equality.js";
import type { ExprIR, TypeIR } from "../../../src/ir/types/loom-ir.js";

const prim = (name: string): TypeIR => ({ kind: "primitive", name }) as TypeIR;
const list = (element: TypeIR): TypeIR => ({ kind: "array", element });
const ref = (name: string, type: TypeIR): ExprIR => ({ kind: "ref", name, refKind: "param", type });
const eq = (lt: TypeIR, rt: TypeIR, op: "==" | "!=" = "==", right?: ExprIR) =>
  ({
    kind: "binary",
    op,
    left: ref("a", lt),
    right: right ?? ref("b", rt),
    leftType: lt,
    rightType: rt,
    resultType: prim("bool"),
  }) as Extract<ExprIR, { kind: "binary" }>;

describe("listEqualityPlan", () => {
  it("classifies each element kind by its own value equality", () => {
    expect(listEqualityPlan(eq(list(prim("string")), list(prim("string"))))?.element).toBe("host");
    expect(listEqualityPlan(eq(list(prim("money")), list(prim("money"))))).toMatchObject({
      element: "decimal",
      money: true,
    });
    expect(listEqualityPlan(eq(list(prim("decimal")), list(prim("decimal"))))).toMatchObject({
      element: "decimal",
      money: false,
    });
    expect(listEqualityPlan(eq(list(prim("datetime")), list(prim("datetime"))))?.element).toBe(
      "instant",
    );
    const vo: TypeIR = { kind: "valueobject", name: "Amount" } as TypeIR;
    expect(listEqualityPlan(eq(list(vo), list(vo)))?.element).toBe("value-object");
  });

  it("marks an optional side", () => {
    const opt: TypeIR = { kind: "optional", inner: list(prim("string")) };
    expect(listEqualityPlan(eq(opt, list(prim("string"))))).toMatchObject({
      leftOptional: true,
      rightOptional: false,
    });
  });

  it("is not a list comparison against the null literal, between scalars, or for an ordering", () => {
    const nullLit: ExprIR = { kind: "literal", lit: "null", value: "null" };
    expect(
      listEqualityPlan(eq(list(prim("string")), prim("string"), "==", nullLit)),
    ).toBeUndefined();
    expect(listEqualityPlan(eq(prim("string"), prim("string")))).toBeUndefined();
    const lt = { ...eq(list(prim("int")), list(prim("int"))), op: "<" as const };
    expect(listEqualityPlan(lt)).toBeUndefined();
  });
});

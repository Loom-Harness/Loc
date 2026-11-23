// The decision table `numericOpPlan` answers for every backend and frontend
// leaf (src/ir/plan/numeric-op.ts).  Spelling is pinned per target elsewhere;
// this pins WHICH operation a node is, including the rules
// `docs/language.md` "Comparing a nullable money or decimal" states.

import { describe, expect, it } from "vitest";
import { negatedFamily, numericOpPlan } from "../../../src/ir/plan/numeric-op.js";
import type { ExprIR, TypeIR } from "../../../src/ir/types/loom-ir.js";

type BinOp = Extract<ExprIR, { kind: "binary" }>["op"];
const prim = (name: string): TypeIR => ({ kind: "primitive", name }) as TypeIR;
const opt = (t: TypeIR): TypeIR => ({ kind: "optional", inner: t });
const MONEY = prim("money");
const DECIMAL = prim("decimal");
const INT = prim("int");
const BOOL = prim("bool");
const STRING = prim("string");

const ref = (name: string, type: TypeIR): ExprIR => ({ kind: "ref", name, refKind: "param", type });
const NULL: ExprIR = { kind: "literal", lit: "null", value: "null" };
const bin = (
  op: BinOp,
  lt: TypeIR,
  rt: TypeIR,
  result: TypeIR,
  left: ExprIR = ref("a", lt),
  right: ExprIR = ref("b", rt),
): Extract<ExprIR, { kind: "binary" }> => ({
  kind: "binary",
  op,
  left,
  right,
  leftType: lt,
  rightType: rt,
  resultType: result,
});

describe("numericOpPlan", () => {
  it("a null literal on either side is a null test, whatever the type", () => {
    expect(numericOpPlan(bin("==", opt(MONEY), STRING, BOOL, undefined, NULL))).toEqual({
      kind: "null-test",
      subject: "left",
    });
    expect(numericOpPlan(bin("!=", STRING, opt(INT), BOOL, NULL))).toEqual({
      kind: "null-test",
      subject: "right",
    });
  });

  it("arithmetic typed `decimal` is exact decimal arithmetic; `int / int` is marked widened", () => {
    expect(numericOpPlan(bin("+", DECIMAL, INT, DECIMAL)).kind).toBe("decimal-arithmetic");
    const div = numericOpPlan(bin("/", INT, INT, DECIMAL));
    expect(div).toMatchObject({ kind: "decimal-arithmetic", intDivWidened: true });
  });

  it("an ordering with an absent side and a money/decimal side answers through absent-ordering", () => {
    expect(numericOpPlan(bin("<", opt(MONEY), MONEY, BOOL)).kind).toBe("absent-ordering");
    expect(numericOpPlan(bin(">", opt(INT), DECIMAL, BOOL)).kind).toBe("absent-ordering");
    expect(numericOpPlan(bin("<", opt(MONEY), INT, BOOL)).kind).toBe("absent-ordering");
  });

  it("an equality with an absent side and a money/decimal side is absent-equality", () => {
    expect(numericOpPlan(bin("==", opt(MONEY), opt(MONEY), BOOL)).kind).toBe("absent-equality");
  });

  it("nullable integers alone stay native (the host's own null semantics)", () => {
    expect(numericOpPlan(bin("<", opt(INT), INT, BOOL)).kind).toBe("native");
  });

  it("present money names the scalar side to lift", () => {
    expect(numericOpPlan(bin("*", MONEY, INT, MONEY))).toMatchObject({
      kind: "money",
      lift: "right",
    });
    expect(numericOpPlan(bin("*", DECIMAL, MONEY, MONEY))).toMatchObject({
      kind: "money",
      lift: "left",
    });
    expect(numericOpPlan(bin("+", MONEY, MONEY, MONEY))).toMatchObject({
      kind: "money",
      lift: undefined,
    });
  });

  it("a present decimal comparison without money is decimal-comparison", () => {
    expect(numericOpPlan(bin("<=", INT, DECIMAL, BOOL)).kind).toBe("decimal-comparison");
  });

  it("a synthesized node with an unstamped operand type reads the operand's own type", () => {
    const e: Extract<ExprIR, { kind: "binary" }> = {
      kind: "binary",
      op: "-",
      left: ref("credit", MONEY),
      right: { kind: "literal", lit: "money", value: "0.50" },
      leftType: MONEY,
      resultType: MONEY,
    };
    expect(numericOpPlan(e)).toMatchObject({ kind: "money", lift: undefined });
  });

  it("non-numeric operands are native", () => {
    expect(numericOpPlan(bin("+", STRING, STRING, STRING)).kind).toBe("native");
  });
});

describe("negatedFamily", () => {
  it("names money / decimal under a unary minus, nothing else", () => {
    expect(negatedFamily({ kind: "unary", op: "-", operand: ref("m", MONEY) })).toBe("money");
    expect(negatedFamily({ kind: "unary", op: "-", operand: ref("d", DECIMAL) })).toBe("decimal");
    expect(negatedFamily({ kind: "unary", op: "-", operand: ref("i", INT) })).toBeUndefined();
    expect(negatedFamily({ kind: "unary", op: "!", operand: ref("b", BOOL) })).toBeUndefined();
  });
});

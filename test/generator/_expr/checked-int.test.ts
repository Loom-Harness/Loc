// RS-48 — integer `+ - *` and unary `-` in domain code are range-checked on
// every backend; the refusal is the domain floor's 422, never a silent wrap.

import { describe, expect, it } from "vitest";
import { checkedBinaryKind, checkedUnaryKind } from "../../../src/generator/_expr/checked-int.js";
import { renderCsExpr } from "../../../src/generator/dotnet/render-expr.js";
import { renderExpr as renderEx } from "../../../src/generator/elixir/render-expr.js";
import { renderJavaExpr } from "../../../src/generator/java/render-expr.js";
import { renderPyExpr } from "../../../src/generator/python/render-expr.js";
import { renderTsExpr } from "../../../src/generator/typescript/render-expr.js";
import { wireCode, wireRejection } from "../../../src/ir/enrich/wire-policy.js";
import type { ExprIR, TypeIR } from "../../../src/ir/types/loom-ir.js";

const INT: TypeIR = { kind: "primitive", name: "int" };
const LONG: TypeIR = { kind: "primitive", name: "long" };
const MONEY: TypeIR = { kind: "primitive", name: "money" };
const ref = (name: string, type: TypeIR): ExprIR => ({
  kind: "ref",
  name,
  refKind: "param",
  type,
});
const lit = (v: string): ExprIR => ({ kind: "literal", lit: "int", value: v });
const bin = (op: "+" | "-" | "*", l: ExprIR, r: ExprIR, lt: TypeIR, rt: TypeIR, res: TypeIR) =>
  ({
    kind: "binary",
    op,
    left: l,
    right: r,
    leftType: lt,
    rightType: rt,
    resultType: res,
  }) as Extract<ExprIR, { kind: "binary" }>;

const intSum = bin("+", ref("stock", INT), ref("n", INT), INT, INT, INT);
const longProduct = bin("*", ref("a", LONG), ref("b", LONG), LONG, LONG, LONG);
const intNeg: ExprIR = { kind: "unary", op: "-", operand: ref("n", INT) };

describe("checked integer arithmetic (RS-48)", () => {
  it("classifies only integer + - * and unary -", () => {
    expect(checkedBinaryKind(intSum)).toBe("int");
    expect(checkedBinaryKind(longProduct)).toBe("long");
    expect(checkedBinaryKind(bin("+", ref("a", INT), ref("b", LONG), INT, LONG, LONG))).toBe(
      "long",
    );
    expect(checkedBinaryKind(bin("+", ref("a", MONEY), ref("b", MONEY), MONEY, MONEY, MONEY))).toBe(
      null,
    );
    expect(checkedBinaryKind(bin("+", lit("1"), lit("2"), INT, INT, INT))).toBe(null);
    expect(checkedUnaryKind(intNeg as Extract<ExprIR, { kind: "unary" }>)).toBe("int");
    expect(
      checkedUnaryKind({ kind: "unary", op: "-", operand: lit("5") } as Extract<
        ExprIR,
        { kind: "unary" }
      >),
    ).toBe(null);
  });

  it("the fact is the domain floor's status with one fixed sentence and its own code", () => {
    expect(wireRejection("arithmetic-overflow")).toMatchObject({
      status: 422,
      title: "Unprocessable Entity",
      stage: "domain",
      detail: { kind: "fixed", text: "Value out of range" },
      errors: "none",
    });
    expect(wireCode("arithmetic-overflow")).toBe("problem.arithmetic-overflow");
  });

  it("node range-checks int32 and the safe-integer ceiling, throwing DomainError", () => {
    const sum = renderTsExpr(intSum);
    expect(sum).toContain("(stock + n)");
    expect(sum).toContain("__v < -2147483648 || __v > 2147483647");
    expect(sum).toContain("throw DomainError.arithmeticOverflow()");
    expect(renderTsExpr(longProduct)).toContain(
      "__v < -9007199254740991 || __v > 9007199254740991",
    );
    expect(renderTsExpr(intNeg)).toContain("(-n)");
    expect(renderTsExpr(lit("1"))).toBe("1");
  });

  it("python wraps in check_int with the declared bounds", () => {
    expect(renderPyExpr(intSum)).toContain("(stock + n, -2147483648, 2147483647)");
    expect(renderPyExpr(longProduct)).toContain(
      "(a * b, -9223372036854775808, 9223372036854775807)",
    );
    expect(renderPyExpr(intNeg)).toContain("(-n, -2147483648, 2147483647)");
  });

  it("elixir raises the typed GuardError outside the range", () => {
    const out = renderEx(intSum, { thisName: "record", contextModule: "App.Stock" });
    expect(out).toContain("case stock + n do v when v >= -2147483648 and v <= 2147483647 -> v");
    expect(out).toContain('raise(App.GuardError, kind: :overflow, message: "Value out of range")');
    expect(renderEx(longProduct, { thisName: "record", contextModule: "App.Stock" })).toContain(
      "v >= -9223372036854775808 and v <= 9223372036854775807",
    );
  });

  it("java uses Math.*Exact", () => {
    expect(renderJavaExpr(intSum)).toBe("Math.addExact(stock, n)");
    expect(renderJavaExpr(longProduct)).toBe("Math.multiplyExact(a, b)");
    expect(renderJavaExpr(intNeg)).toBe("Math.negateExact(n)");
    expect(renderJavaExpr(bin("-", ref("a", INT), ref("b", INT), INT, INT, INT))).toBe(
      "Math.subtractExact(a, b)",
    );
  });

  it("dotnet wraps in checked(...)", () => {
    expect(renderCsExpr(intSum)).toBe("checked(stock + n)");
    expect(renderCsExpr(intNeg)).toBe("checked(-n)");
  });
});

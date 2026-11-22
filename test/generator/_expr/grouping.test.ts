// Operator grouping is decided once, in the shared dispatcher, from the tree's
// shape — never from whether a construction site remembered a `paren` node.
//
// The trees below are SYNTHESIZED (no `paren` anywhere), the shape a lowering
// pass, an enrichment or a macro builds.  Every `ExprTarget` must render them
// with the grouping the tree gives them.  What a grouped value COMPUTES is
// asserted at runtime by the `operator-grouping` corpus fixture on every
// backend; this file pins the decision table and that each target routes
// through it (spelling, not behaviour).

import { describe, expect, it } from "vitest";
import {
  type GroupingPolicy,
  isSelfDelimited,
  needsGrouping,
  type OperandPosition,
} from "../../../src/generator/_expr/grouping.js";
import { jsExprLeaves } from "../../../src/generator/_walker/js-expr-leaves.js";
import { renderCsExpr } from "../../../src/generator/dotnet/render-expr.js";
import { renderExpr as renderHeexExpr } from "../../../src/generator/elixir/heex-walker-core.js";
import { renderExpr as renderExExpr } from "../../../src/generator/elixir/render-expr.js";
import { FS_LEAVES } from "../../../src/generator/feliz/fs-expr.js";
import { DART_LEAVES } from "../../../src/generator/flutter/dart-expr.js";
import { renderJavaExpr } from "../../../src/generator/java/render-expr.js";
import { renderPyExpr } from "../../../src/generator/python/render-expr.js";
import { renderTsExpr } from "../../../src/generator/typescript/render-expr.js";
import type { ExprIR, TypeIR } from "../../../src/ir/types/loom-ir.js";

type BinOp = Extract<ExprIR, { kind: "binary" }>["op"];

const INT: TypeIR = { kind: "primitive", name: "int" };
const BOOL: TypeIR = { kind: "primitive", name: "bool" };
const STRING: TypeIR = { kind: "primitive", name: "string" };

// `bool`-typed literals keep every target on its plain operator arm (no
// checked-int wrapper, no decimal or money method form), so the operator text
// is the whole rendering.
const t = (v: string): ExprIR => ({ kind: "literal", lit: "bool", value: v });
const bin = (op: BinOp, left: ExprIR, right: ExprIR, operand: TypeIR = BOOL): ExprIR => ({
  kind: "binary",
  op,
  left,
  right,
  leftType: operand,
  rightType: operand,
  resultType: ["+", "-", "*", "/", "%"].includes(op) ? operand : BOOL,
});

const RENDERERS: Record<string, (e: ExprIR) => string> = {
  node: (e) => renderTsExpr(e),
  dotnet: (e) => renderCsExpr(e),
  "dotnet-ef": (e) => renderCsExpr(e, { thisName: "this", efQuery: true } as never),
  java: (e) => renderJavaExpr(e),
  python: (e) => renderPyExpr(e),
  elixir: (e) => renderExExpr(e),
  "elixir-filter": (e) => renderExExpr(e, { thisName: "record", filterArgs: true } as never),
  "elixir-doc": (e) => renderExExpr(e, { thisName: "record", docStruct: true } as never),
  heex: (e) => renderHeexExpr(e, {} as never),
};

/** Strip the host's spelling of the operators and literals so one expectation
 *  reads across targets: what is left is the bracket structure. */
const shape = (text: string): string =>
  text
    .replace(/\b(true|false|True|False)\b/g, "x")
    .replace(/===|!==|==|!=|&&|\|\||\band\b|\bor\b/g, "~")
    .replace(/\s+/g, "");

describe("the shared dispatcher groups synthesized operands on every ExprTarget", () => {
  // `(true == false) == true` built right-nested: `true == (false == true)`.
  const rightNestedEquality = bin("==", t("true"), bin("==", t("false"), t("true")));
  // `(true != false) == true`, left-nested: no group needed on the C family,
  // a group needed where the host chains comparisons.
  const leftNestedEquality = bin("==", bin("!=", t("true"), t("false")), t("true"));
  // `!(true && false)`.
  const negatedConjunction: ExprIR = {
    kind: "unary",
    op: "!",
    operand: bin("&&", t("true"), t("false")),
  };

  for (const [target, render] of Object.entries(RENDERERS)) {
    it(`${target}: a right-nested comparison keeps its group`, () => {
      expect(shape(render(rightNestedEquality))).toBe("x~(x~x)");
    });
    it(`${target}: a negated conjunction keeps its group`, () => {
      expect(render(negatedConjunction)).toMatch(/^(!|not )\(/);
    });
  }

  it("python groups a comparison nested in a comparison on either side (it chains them)", () => {
    expect(shape(renderPyExpr(leftNestedEquality))).toBe("(x~x)~x");
  });

  it("the C-family targets leave a left-nested comparison bare (left-associative already)", () => {
    for (const target of ["node", "dotnet", "java", "elixir"]) {
      expect(shape(RENDERERS[target]!(leftNestedEquality))).toBe("x~x~x");
    }
  });
});

describe("needsGrouping — the decision table", () => {
  const ref = (name: string, type: TypeIR = INT): ExprIR => ({
    kind: "ref",
    name,
    refKind: "param",
    type,
  });
  const at = (op: BinOp, side: "left" | "right"): OperandPosition => ({
    parent: "binary",
    op,
    side,
  });
  const PY: GroupingPolicy = { groupNestedComparisons: true };

  it("groups a right operand at the same level (`x - (a - b)`), never a left one", () => {
    const inner = bin("-", ref("a"), ref("b"), INT);
    expect(needsGrouping(inner, at("-", "right"))).toBe(true);
    expect(needsGrouping(inner, at("-", "left"))).toBe(false);
  });

  it("groups a looser operand on either side (`(a + b) * c`)", () => {
    const sum = bin("+", ref("a"), ref("b"), INT);
    expect(needsGrouping(sum, at("*", "left"))).toBe(true);
    expect(needsGrouping(sum, at("*", "right"))).toBe(true);
  });

  it("leaves a tighter operand bare (`a + b * c`)", () => {
    expect(needsGrouping(bin("*", ref("a"), ref("b"), INT), at("+", "right"))).toBe(false);
  });

  it("treats `&&` / `||` runs as associative", () => {
    expect(needsGrouping(bin("&&", t("true"), t("false")), at("&&", "right"))).toBe(false);
    expect(needsGrouping(bin("||", t("true"), t("false")), at("&&", "right"))).toBe(true);
  });

  it("splices a string concatenation into an enclosing one, but not a numeric `+` on its left spine", () => {
    const concat = bin("+", ref("s", STRING), ref("u", STRING), STRING);
    expect(needsGrouping(concat, at("+", "right"))).toBe(false);
    // `(1 + 2) + "u"` is a string, but `"s" + 1 + 2 + "u"` is not its splice.
    const numericSpine: ExprIR = {
      kind: "binary",
      op: "+",
      left: bin("+", ref("a"), ref("b"), INT),
      right: ref("u", STRING),
      leftType: INT,
      rightType: STRING,
      resultType: STRING,
    };
    expect(needsGrouping(numericSpine, at("+", "right"))).toBe(true);
  });

  it("groups a comparison under a comparison only for a host that chains them", () => {
    const lt = bin("<", ref("a"), ref("b"), INT);
    expect(needsGrouping(lt, at("==", "left"))).toBe(false);
    expect(needsGrouping(lt, at("==", "left"), PY)).toBe(true);
  });

  it("groups any operator node in receiver position, and `- -x`", () => {
    expect(needsGrouping(bin("+", ref("a"), ref("b"), INT), { parent: "postfix" })).toBe(true);
    expect(needsGrouping(ref("a"), { parent: "postfix" })).toBe(false);
    const neg: ExprIR = { kind: "unary", op: "-", operand: ref("a") };
    expect(needsGrouping(neg, { parent: "unary", op: "-" })).toBe(true);
    expect(
      needsGrouping({ kind: "unary", op: "!", operand: t("true") }, { parent: "unary", op: "!" }),
    ).toBe(false);
  });

  it("never groups a primary term or an author-written paren", () => {
    expect(
      needsGrouping({ kind: "paren", inner: bin("-", ref("a"), ref("b"), INT) }, at("-", "right")),
    ).toBe(false);
  });
});

describe("isSelfDelimited — only suppresses a group a leaf already wrote", () => {
  it.each([
    ["(a - b)", true],
    ["a.minus(b)", true],
    ["Decimal.sub(a, b)", true],
    ['f(")", x)', true],
    ["x!.Value", true],
    ["a?.b", true],
    ["a - b", false],
    ["(a) - (b)", false],
    ["-a", false],
    ["!a", false],
    ["not a", false],
    ["c ? a : b", false],
    ["x is None", false],
  ])("%s → %s", (text, expected) => {
    expect(isSelfDelimited(text)).toBe(expected);
  });
});

// The frontend walker does not ride `renderExprWith`: its JS / F# / Dart leaf
// tables group every operator node they render themselves, which is what keeps
// a synthesized operand grouped on the six frontends.  Pinned here so a leaf
// that drops its outer brackets fails (the census in
// test/system/operator-grouping-census.test.ts names this file as the proof).
describe("frontend leaf tables group every operator node they render", () => {
  const leaves = {
    js: {
      binary: (l: string, r: string) => jsExprLeaves.exprBinary(l, r, "-"),
      unary: (o: string) => jsExprLeaves.exprUnary("!", o),
      ternary: (c: string, a: string, b: string) => jsExprLeaves.exprTernary(c, a, b),
    },
    fsharp: {
      binary: (l: string, r: string) => FS_LEAVES.binary(l, r, "-"),
      unary: (o: string) => FS_LEAVES.unary("!", o),
      ternary: (c: string, a: string, b: string) => FS_LEAVES.ternary(c, a, b),
    },
    dart: {
      binary: (l: string, r: string) => DART_LEAVES.binary(l, r, "-"),
      unary: (o: string) => DART_LEAVES.unary("!", o),
      ternary: (c: string, a: string, b: string) => DART_LEAVES.ternary(c, a, b),
    },
  };
  for (const [host, l] of Object.entries(leaves)) {
    it(host, () => {
      expect(isSelfDelimited(l.binary("a - b", "c"))).toBe(true);
      expect(isSelfDelimited(l.unary("a && b"))).toBe(true);
      expect(isSelfDelimited(l.ternary("c", "a", "b"))).toBe(true);
    });
  }
});

import { describe, expect, it } from "vitest";
import {
  refineClauseFor,
  refineRenderable,
  renderRefineExpr,
  takeSingleFieldChain,
} from "../../src/generator/zod-refine.js";
import type { ExprIR, InvariantIR, TypeIR } from "../../src/ir/types/loom-ir.js";
import { generateCorpusCase } from "../fixtures/corpus/harness.js";

// ---------------------------------------------------------------------------
// M-T6.74 N2 — the wire-boundary zod `.refine` computes `decimal` arithmetic
// EXACTLY (RS-37), the way the node domain does.
//
// A Loom `decimal` is a JS `number` on the wire, and the refine used to render
// `data.a + data.b <= 0.3`: 0.1 + 0.2 is 0.30000000000000004 in binary, so
// node's route schema answered 422 for a body the domain's own exact check
// (and .NET FluentValidation / Java BigDecimal / python Decimal / elixir
// Decimal) admit — 201 everywhere else.  The runtime proof is the
// `decimal-exact` wire golden (its create now crosses `invariant a + b <= 0.3`
// on the boundary); this file is the per-PR, no-boot pin of the shape.
// ---------------------------------------------------------------------------

const DEC: TypeIR = { kind: "primitive", name: "decimal" };
const BOOL: TypeIR = { kind: "primitive", name: "bool" };

const field = (name: string): ExprIR => ({ kind: "ref", name, refKind: "this-prop", type: DEC });
const decLit = (value: string): ExprIR => ({ kind: "literal", lit: "decimal", value });
const plus = (left: ExprIR, right: ExprIR): ExprIR => ({
  kind: "binary",
  op: "+",
  left,
  right,
  leftType: DEC,
  resultType: DEC,
});

/** `invariant a + b <= 0.3` as lowering emits it. */
const INV: InvariantIR = {
  expr: {
    kind: "binary",
    op: "<=",
    left: plus(field("a"), field("b")),
    right: decLit("0.3"),
    leftType: DEC,
    resultType: BOOL,
  },
  source: "a + b <= 0.3",
};
const CTX = { available: new Set(["a", "b"]) };

describe("zod-refine — decimal arithmetic (RS-37)", () => {
  it("exact mode renders through decimal.js and narrows once, like the node domain", () => {
    expect(refineRenderable(INV.expr, "exact")).toBe(true);
    expect(refineClauseFor(INV, CTX, "exact")).toBe(
      '.refine((data: any) => new Decimal(data.a).plus(data.b).toNumber() <= 0.3, { path: ["a"], message: "Invariant violated: a + b <= 0.3" })',
    );
  });

  it("a nested chain stays Decimal to its root — one `.toNumber()`", () => {
    const chain: ExprIR = {
      kind: "binary",
      op: "*",
      left: { kind: "paren", inner: plus(field("a"), field("b")), type: DEC } as ExprIR,
      right: decLit("3"),
      leftType: DEC,
      resultType: DEC,
    };
    const out = renderRefineExpr(chain);
    expect(out).toBe("(new Decimal(data.a).plus(data.b)).times(3).toNumber()");
    expect(out.split(".toNumber()").length - 1).toBe(1);
  });

  it("the default (the four JS frontends) screens it out — the server's exact check owns it", () => {
    // A frontend stack carries decimal.js only for `money`; a client-side
    // pre-check that 422s what the server admits is worse than none.
    expect(refineRenderable(INV.expr)).toBe(false);
    expect(refineClauseFor(INV, CTX)).toBeNull();
    expect(takeSingleFieldChain(INV, CTX)).toBeNull();
  });

  it("non-arithmetic decimal comparisons still render natively in both modes", () => {
    const cmp: InvariantIR = {
      expr: {
        kind: "binary",
        op: "<=",
        left: field("a"),
        right: field("b"),
        leftType: DEC,
        resultType: BOOL,
      },
      source: "a <= b",
    };
    expect(refineClauseFor(cmp, CTX)).toContain("data.a <= data.b");
    expect(refineClauseFor(cmp, CTX, "exact")).toContain("data.a <= data.b");
  });
});

describe("decimal-exact fixture — node's route schema refines exactly", () => {
  it("the create request's refine is the exact decimal.js chain, and the file imports decimal.js", async () => {
    const files = await generateCorpusCase("decimal-exact", "node");
    const routes = files.get("d/http/sample.routes.ts");
    expect(routes, "d/http/sample.routes.ts").toBeDefined();
    expect(routes).toContain(
      ".refine((data: any) => new Decimal(data.a).plus(data.b).toNumber() <= 0.3,",
    );
    // The float spelling that 422'd `0.1 + 0.2`.
    expect(routes).not.toContain("data.a + data.b <= 0.3");
    expect(routes).toContain('import Decimal from "decimal.js";');
  });
});

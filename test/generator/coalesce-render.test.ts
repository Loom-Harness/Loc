// `a ?? b` lowers to `a == null ? b : a` sharing ONE left node.  Every backend
// must render the left once (an effectful left — a call — must not run twice)
// and keep the fallback lazy.

import { describe, expect, it } from "vitest";
import { spellMarkers } from "../../src/generator/_imports/symbol.js";
import { renderCsExpr } from "../../src/generator/dotnet/render-expr.js";
import { renderExpr as renderExUnspelled } from "../../src/generator/elixir/render-expr.js";
import { renderJavaExpr } from "../../src/generator/java/render-expr.js";
import { renderPyExpr } from "../../src/generator/python/render-expr.js";
import { renderTsExpr } from "../../src/generator/typescript/render-expr.js";
import type { ExprIR, TypeIR } from "../../src/ir/types/loom-ir.js";

const STRING: TypeIR = { kind: "primitive", name: "string" };
const BOOL: TypeIR = { kind: "primitive", name: "bool" };

const call = (name: string): ExprIR => ({ kind: "call", callKind: "function", name, args: [] });
const str = (v: string): ExprIR => ({ kind: "literal", lit: "string", value: v });

/** The lowerer's shape: `cond.left` and `otherwise` are the same node. */
const coalesce = (left: ExprIR, fallback: ExprIR): ExprIR => ({
  kind: "ternary",
  cond: {
    kind: "binary",
    op: "==",
    left,
    right: { kind: "literal", lit: "null", value: "" },
    leftType: STRING,
    rightType: STRING,
    resultType: BOOL,
  },
  // biome-ignore lint/suspicious/noThenProperty: the ternary IR node's branch field is named `then`
  then: fallback,
  otherwise: left,
});

const exCtx = { thisName: "record", contextModule: "MyApp" };
const renderEx = (e: ExprIR): string => spellMarkers(renderExUnspelled(e, exCtx));

const targets: Array<[string, (e: ExprIR) => string, RegExp]> = [
  ["ts", (e) => renderTsExpr(e), /lookupNick/g],
  ["dotnet", (e) => renderCsExpr(e), /LookupNick/g],
  ["java", (e) => spellMarkers(renderJavaExpr(e)), /lookupNick/g],
  ["python", (e) => spellMarkers(renderPyExpr(e)), /lookup_nick/g],
  ["elixir", renderEx, /lookup_nick/g],
];

describe("coalesce renders the left operand once", () => {
  for (const [name, render, needle] of targets) {
    it(`${name}: a call on the left appears once and no null test is rendered`, () => {
      const out = render(coalesce(call("lookupNick"), str("anon")));
      expect(out.match(needle)?.length).toBe(1);
      expect(out).not.toMatch(/==\s*null|is None|is_nil|=== null|== nil/);
    });

    it(`${name}: a chain a ?? b ?? c renders each operand once`, () => {
      const out = render(coalesce(call("lookupNick"), coalesce(call("lookupNick"), str("c"))));
      expect(out.match(needle)?.length).toBe(2);
    });
  }
});

describe("coalesce per-backend shape", () => {
  const e = coalesce(call("lookupNick"), str("anon"));
  it("ts / c# use ??", () => {
    expect(renderTsExpr(e)).toContain(" ?? ");
    expect(renderCsExpr(e)).toBe('(this.LookupNick() ?? ("anon"))');
  });
  it("java keeps the fallback lazy", () => {
    expect(spellMarkers(renderJavaExpr(e))).toBe(
      'java.util.Optional.ofNullable(this.lookupNick()).orElseGet(() -> "anon")',
    );
  });
  it("python binds once without a walrus", () => {
    const out = spellMarkers(renderPyExpr(e));
    expect(out).toContain("for __c in (");
    expect(out).not.toContain(":=");
  });
  it("elixir matches only nil (false is kept)", () => {
    const out = renderEx(e);
    expect(out).toMatch(/^\(case .* do nil -> "anon"; loom_c -> loom_c end\)$/);
    expect(out).not.toContain("||");
  });
});

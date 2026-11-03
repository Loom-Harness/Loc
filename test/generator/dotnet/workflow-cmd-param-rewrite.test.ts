// A command / event param referenced anywhere in a workflow expression is
// rewritten to `command.<Pascal>`.  The rewrite rides `mapExprChildren`, so a
// param nested in a kind the renderer special-cases nowhere (a conversion, a
// list literal, a match arm) is rewritten too — a bare `n` would name an
// undeclared identifier in the generated handler (CS0103).

import { describe, expect, it } from "vitest";
import { renderExprWithCmdParams } from "../../../src/generator/dotnet/workflow-emit.js";
import type { ExprIR } from "../../../src/ir/types/loom-ir.js";
import { INT_T, litExpr, paramRef } from "../../_helpers/ir-builders.js";

const n = paramRef("n", INT_T);
const render = (e: ExprIR): string => renderExprWithCmdParams(e, new Set(["n"]));

describe("dotnet workflow command-param rewrite", () => {
  it("rewrites a param inside a conversion", () => {
    const out = render({ kind: "convert", target: "string", from: "int", value: n });
    expect(out).toContain("command.N");
    expect(out).not.toMatch(/\bn\b/);
  });

  it("rewrites a param inside a list literal", () => {
    const out = render({ kind: "list", elements: [n, litExpr("int", "1")] });
    expect(out).toContain("command.N");
    expect(out).not.toMatch(/\bn\b/);
  });

  it("rewrites a param at the top level (control)", () => {
    expect(render(n)).toBe("command.N");
  });
});

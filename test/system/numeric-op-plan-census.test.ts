// Census: which numeric operation a `binary` node is (a null test, an absent-
// side ordering / equality, money with a lifted scalar, exact decimal
// arithmetic, …) is decided once, in `src/ir/plan/numeric-op.ts`.  The
// expression leaves only spell the decision.
//
// Each leaf below must consult the plan, and may name `money` / `decimal`
// only as a plan answer (`plan.kind`, a `case` label, an operand's `family`) —
// never by reading `leftType` / `rightType` / `resultType` against them.  A
// leaf that re-derives the decision is how five backends came to answer
// `money? < int` three different ways.  A listed function that no longer
// exists fails too, so a rename cannot drop a leaf from the census.

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

const ROOT = path.resolve(__dirname, "../..");

/** file → the functions that decide a binary node's numeric operation, and
 *  whether each must call `numericOpPlan` itself (a helper handed the plan
 *  does not). */
const LEAVES: Record<string, Record<string, "calls-plan" | "receives-plan">> = {
  "src/generator/typescript/render-expr.ts": {
    renderBinary: "calls-plan",
    renderAbsentComparison: "receives-plan",
  },
  "src/generator/python/render-expr.ts": { renderBinary: "calls-plan" },
  "src/generator/java/render-expr.ts": { renderBinary: "calls-plan" },
  "src/generator/dotnet/render-expr.ts": { renderCsBinary: "calls-plan" },
  "src/generator/elixir/render-expr.ts": { renderBinary: "calls-plan", renderUnary: "calls-plan" },
  "src/generator/_walker/js-expr-leaves.ts": { renderJsMoneyBinary: "calls-plan" },
  "src/generator/flutter/dart-expr.ts": { dartMoneyBinary: "calls-plan" },
  "src/generator/feliz/fs-expr.ts": { fsMoneyBinary: "calls-plan", fsNumericBinary: "calls-plan" },
  "src/generator/zod-refine.ts": { isDecimalArithmetic: "calls-plan" },
};

/** A `"money"` / `"decimal"` literal that reads a plan answer. */
const PLAN_READ =
  /(family|element)\s*[!=]==\s*"(money|decimal)"|case "(money|decimal)":|\bkind\s*[!=]==\s*"money"/;

function functions(file: string): Map<string, string> {
  const text = fs.readFileSync(path.join(ROOT, file), "utf8");
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found = new Map<string, string>();
  const visit = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name) found.set(n.name.text, n.getText(src));
    ts.forEachChild(n, visit);
  };
  visit(src);
  return found;
}

/** Calls of a negation helper count as consulting the plan for a unary leaf. */
const CONSULTS_PLAN = /\b(numericOpPlan|negatedFamily)\(/;

describe("numeric-op plan census", () => {
  const rows = Object.entries(LEAVES).flatMap(([file, fns]) => {
    const bodies = functions(file);
    return Object.entries(fns).map(([fn, mode]) => ({ file, fn, mode, body: bodies.get(fn) }));
  });

  it("reaches every listed leaf", () => {
    expectReach("numeric-op leaves", rows.filter((r) => r.body !== undefined).length, 12);
    expect(rows.filter((r) => r.body === undefined).map((r) => `${r.file}#${r.fn}`)).toEqual([]);
  });

  it("every leaf consults the plan", () => {
    const missing = rows
      .filter((r) => r.mode === "calls-plan" && r.body !== undefined && !CONSULTS_PLAN.test(r.body))
      .map((r) => `${r.file}#${r.fn}`);
    expect(missing).toEqual([]);
  });

  it("every backend binary leaf decides list equality through the plan (ruling 456)", () => {
    const binaryLeaves = rows.filter(
      (r) => ["renderBinary", "renderCsBinary"].includes(r.fn) && r.file.endsWith("render-expr.ts"),
    );
    expect(binaryLeaves.length).toBe(5);
    const missing = binaryLeaves
      .filter((r) => !(r.body ?? "").includes("listEqualityPlan("))
      .map((r) => `${r.file}#${r.fn}`);
    expect(missing).toEqual([]);
  });

  it("no leaf decides money / decimal from operand types", () => {
    const offenders = rows.flatMap((r) =>
      (r.body ?? "")
        .split("\n")
        .filter((line) => /"(money|decimal)"/.test(line) && !PLAN_READ.test(line))
        .map((line) => `${r.file}#${r.fn}: ${line.trim()}`),
    );
    expect(offenders, "read the decision off numericOpPlan instead").toEqual([]);
  });
});

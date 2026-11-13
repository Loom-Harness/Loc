import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { irTypeModules } from "../_helpers/ir-types-source.js";

// ---------------------------------------------------------------------------
// Line budget for the IR vocabulary under `src/ir/types/`.
//
// The IR is one module per declaration area, re-exported by `loom-ir.ts`, so
// parallel changes to different areas touch different files.  A module over
// the budget is the single-file shape coming back: split it along a
// declaration boundary and re-export the new module from the barrel.  The
// barrel itself declares nothing, so every declaration lives in a module this
// budget covers.
//
// The optional-member count is pinned per module and only moves down.  An
// optional field cannot tell "not applicable to this node" from "this
// construction site forgot to set it"; each one removed is a field made
// required, folded into a discriminated union, or derived on demand.  A new
// optional fails here until its module's row is raised in review with the
// reason the field is genuinely absent on some nodes.
// ---------------------------------------------------------------------------

const BUDGET = 800;
const OPTIONAL_MEMBERS: Readonly<Record<string, number>> = {
  "aggregate.ts": 14,
  // +3: a policy level's `when` (absent = every caller) and the context's
  // `policyRowRules` list, absent like its `policyReadLevels` siblings.
  // +2: the context's `policyShareGates` list and a share gate's `when`
  // (absent = every caller), the same shape again.
  "context.ts": 33,
  "deployment.ts": 22,
  // `exists` carries `forWrite` (only on `for write`) and `read` (only in an
  // in-app gate position; a query-position quantifier has no read).
  "expr.ts": 33,
  "members.ts": 16,
  // +2: `LoomModel.unresolvedTypes` (absent on every model that validates) and
  // `UnresolvedTypeSite.origin` (absent for a node with no source span); +1:
  // `EnumValueRenameIntentIR.context` (a root-level enum has no declaring context);
  // +2: `LoomModel.loweringViolations` (absent on every model that lowers
  // well-formed) and `LoweringViolation.origin` (absent when the offending node
  // and its statement carry no source span).
  "model.ts": 13,
  "projection.ts": 16,
  "queries.ts": 1,
  "stmt.ts": 16,
  "system.ts": 29,
  "traceability.ts": 5,
  "types.ts": 2,
  "ui.ts": 20,
  "workflow.ts": 14,
  "workflow-stmt.ts": 26,
};

/** `name?:` property signatures anywhere in one module's text. */
function optionalMembers(fileName: string, text: string): number {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  let n = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isPropertySignature(node) && node.questionToken) n++;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return n;
}

const typesDir = path.resolve(import.meta.dirname, "..", "..", "src", "ir", "types");

describe("IR types — per-module line budget", () => {
  const files = fs.readdirSync(typesDir).filter((f) => f.endsWith(".ts"));

  it("every module under src/ir/types/ stays within the budget", () => {
    expect(files.length).toBeGreaterThan(10);
    const over = files
      .map((f) => [f, fs.readFileSync(path.join(typesDir, f), "utf8").split("\n").length] as const)
      .filter(([, n]) => n > BUDGET);
    expect(over, `modules over ${BUDGET} lines`).toEqual([]);
  });

  it("loom-ir.ts only re-exports — it declares nothing of its own", () => {
    const code = fs
      .readFileSync(path.join(typesDir, "loom-ir.ts"), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "" && !l.startsWith("//"));
    expect(code.every((l) => /^export \* from "\.\/[\w-]+\.js";$/.test(l))).toBe(true);
    expect(irTypeModules().length).toBe(code.length);
  });

  it("the scanner counts optional members, not optional parameters", () => {
    expect(optionalMembers("a.ts", "interface A { x?: number; y: string; z?: { w?: 1 } }")).toBe(3);
    expect(optionalMembers("a.ts", "function f(x?: number) {}")).toBe(0);
  });

  it("the per-module optional-member count matches the pinned map exactly", () => {
    const live = Object.fromEntries(
      irTypeModules().map((f) => [
        path.basename(f),
        optionalMembers(f, fs.readFileSync(f, "utf8")),
      ]),
    );
    expect(
      live,
      "An optional member was added or removed: lower the row for a removal; " +
        "raise it only with the reason the field is genuinely absent on some nodes.",
    ).toEqual(OPTIONAL_MEMBERS);
  });
});

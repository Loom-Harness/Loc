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
  // One block per module, a blank line apart, so parallel slices that lower
  // different rows merge without touching each other's lines.

  "aggregate.ts": 11,

  // Kept: the read clauses a find may lack (`requires`, `filter`,
  // `criterionRef`, `defaultSort`) and its four synthesis flags, the history
  // find, a policy rule's `when` (absent = every caller), a channel's key, a
  // union payload's variants, a monomorphized payload's carrier, a domain
  // service op's return, a retrieval's criterion, the shared `Bypassing`
  // stance, `readsDefaultDenied`, and the enrichment-derived maps and sibling
  // pools (absent on a loose, single-context lowering).
  "context.ts": 17,

  // Kept: a binding's per-kind knobs (absent = not declared, which the
  // capability check tells apart from a declared knob), a frontend's target /
  // design / ui binding, a backend's realization axes, `auth`, `favicon`, and
  // the subdomain's `migrationsOwner` (absent for a frontend-only subdomain).
  "deployment.ts": 20,

  // `exists` carries `forWrite` (only on `for write`) and `read` (only in an
  // in-app gate position; a query-position quantifier has no read).
  "expr.ts": 32,

  "members.ts": 12,

  // `UnresolvedTypeSite`/`LoweringViolation` carry `origin` through `Sourced`.
  // Kept: the table move's two contexts (qualified form only), an enum rename's
  // context (absent at root level), the raw brand, a subscription's channel
  // (absent = implicit in-process) and projection (absent = workflow saga),
  // and the enriched overlay's sibling value objects.
  "model.ts": 7,

  "projection.ts": 10,

  "queries.ts": 0,

  "stmt.ts": 9,

  // Kept: the declared-or-absent system blocks (`user`, `auth`, `tenancy`,
  // `theme`), each theme token (absent = the design pack's default), the OIDC
  // endpoints a preset may leave unset, the auth preset name, the principal's
  // tenancy registry, a timer's inert clauses, and a storage's instance /
  // connection (absent = derived by the orchestrator).
  "system.ts": 25,

  "traceability.ts": 5,

  "types.ts": 2,

  "ui.ts": 19,

  "workflow.ts": 9,

  "workflow-stmt.ts": 14,
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

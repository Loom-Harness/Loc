import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

// ---------------------------------------------------------------------------
// Value-object-params census: "which params of a command entry point bear a
// value object" has ONE implementation, `src/ir/plan/value-object-params.ts`,
// and every backend that judges a value object's rules at the wire asks it.
//
// The copies are where the backends drifted: java and .NET each spelled their
// own `voBorne`, and a workflow `create` was never asked the question at all,
// so a workflow value-object param that broke an invariant answered the domain
// floor (pointer "") on java/.NET/elixir while node/python answered the wire
// 422 at `/<param>/<member>`.
//
// THE DETECTOR (TypeScript AST, so comments and strings never count):
//
//   borne   a `switch` with `"valueobject"`, `"array"` and `"optional"` arms
//           whose `"array"` arm descends into `.element` and whose
//           `"valueobject"` arm builds a `{ name, each }` result — a local
//           copy of `valueObjectBorne`.
//
// THE READERS: each emitter that renders a backend's workflow or command
// request validation, where the decision is spelled, imports
// `valueObjectParams` / `valueObjectBorne`.  A backend that judges through a
// schema (zod, pydantic) builds it from the declared types and is not a
// reader.  A new backend's request validator is added here.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PLAN = "src/ir/plan/value-object-params.ts";

const READERS: readonly { file: string; name: string }[] = [
  { file: "src/generator/java/emit/validator.ts", name: "valueObjectParams" },
  { file: "src/generator/dotnet/validator-emit.ts", name: "valueObjectParams" },
  { file: "src/generator/dotnet/workflow-emit.ts", name: "valueObjectParams" },
  { file: "src/generator/elixir/vanilla/workflow-execution-emit.ts", name: "valueObjectParams" },
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name !== "generated") out.push(...tsFiles(full));
    } else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

function source(file: string): ts.SourceFile {
  return ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
}

/** `switch` statements that re-spell `valueObjectBorne`. */
function borneCopies(sf: ts.SourceFile): number[] {
  const lines: number[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isSwitchStatement(n)) {
      const arms = new Map<string, ts.CaseClause>();
      for (const c of n.caseBlock.clauses) {
        if (ts.isCaseClause(c) && ts.isStringLiteral(c.expression)) arms.set(c.expression.text, c);
      }
      const vo = arms.get("valueobject");
      const arr = arms.get("array");
      if (
        vo &&
        arr &&
        arms.has("optional") &&
        /\.element\b/.test(arr.getText(sf)) &&
        /\{\s*name:[^}]*\beach:/.test(vo.getText(sf))
      ) {
        lines.push(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return lines;
}

function imports(sf: ts.SourceFile, name: string): boolean {
  return sf.statements.some(
    (s) =>
      ts.isImportDeclaration(s) &&
      ts.isStringLiteral(s.moduleSpecifier) &&
      s.moduleSpecifier.text.endsWith("/ir/plan/value-object-params.js") &&
      s.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(s.importClause.namedBindings) &&
      s.importClause.namedBindings.elements.some((e) => e.name.text === name),
  );
}

describe("value-object-params census", () => {
  it("no source file re-spells which type bears a value object", () => {
    const files = tsFiles(path.join(repoRoot, "src"));
    expectReach("source files", files.length, 1300);
    const hits: string[] = [];
    for (const f of files) {
      const rel = path.relative(repoRoot, f);
      if (rel === PLAN) continue;
      for (const line of borneCopies(source(f))) hits.push(`${rel}:${line}`);
    }
    expect(hits, "use valueObjectBorne / valueObjectParams from src/ir/plan/").toEqual([]);
  });

  it("the plan module itself is what the detector recognises", () => {
    // Reach for the detector: if it stops matching the one implementation it
    // exists to protect, it would pass every copy too.
    expect(borneCopies(source(path.join(repoRoot, PLAN)))).toHaveLength(1);
  });

  it("every request-validation reader asks the plan", () => {
    const missing = READERS.filter(
      (r) => !imports(source(path.join(repoRoot, r.file)), r.name),
    ).map((r) => `${r.file} does not import ${r.name}`);
    expect(missing).toEqual([]);
  });
});

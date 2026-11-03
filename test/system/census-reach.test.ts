// Every census / ratchet in `test/system/` asserts a reach floor.
//
// A census that silently stops reaching its universe passes while checking
// nothing (see `test/_helpers/census-reach.ts`).  This gate requires each
// `*census*` / `*ratchet*` test file to call `expectReach` from that helper,
// so no census can be added — or have its floor deleted — without one.
//
// The check is syntactic (a call to an identifier named `expectReach` that is
// imported from the helper), parsed with the TypeScript parser so a mention in
// a comment or string does not count.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

const DIR = "test/system";

function censusFiles(): string[] {
  return readdirSync(DIR)
    .filter(
      (f) => /(census|ratchet)/.test(f) && f.endsWith(".test.ts") && f !== "census-reach.test.ts",
    )
    .sort();
}

function callsExpectReach(file: string): boolean {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
  const imported = sf.statements.some(
    (st) =>
      ts.isImportDeclaration(st) &&
      ts.isStringLiteral(st.moduleSpecifier) &&
      st.moduleSpecifier.text.endsWith("_helpers/census-reach.js") &&
      st.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(st.importClause.namedBindings) &&
      st.importClause.namedBindings.elements.some((e) => e.name.text === "expectReach"),
  );
  if (!imported) return false;
  let called = false;
  const visit = (n: ts.Node): void => {
    if (called) return;
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "expectReach"
    ) {
      called = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return called;
}

describe("census reach floors", () => {
  const files = censusFiles();

  it("finds the census files it governs", () => {
    expectReach("census/ratchet test files", files.length, 28);
  });

  it("every census / ratchet asserts a reach floor via expectReach", () => {
    const missing = files.filter((f) => !callsExpectReach(join(DIR, f)));
    expect(
      missing,
      `${missing.length} census/ratchet file(s) assert no reach floor.  Import ` +
        "`expectReach` from test/_helpers/census-reach.js and call it with the number " +
        `of items the scan covered:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });
});

// Every rule in a shipped example is named.
//
// An unnamed `invariant` / field `check` / `precondition` answers the generic
// "Business rule violated" / "Invalid value" (see `src/generator/_i18n/rule-text.ts`).
// The examples are what a newcomer runs first, in the playground and from
// `examples/`; a refusal there must read as the rule it broke, so each rule
// carries a name, which is its message key and its English default.
//
// Walks the parsed AST (not the text), so a comment or string mentioning
// `invariant` does not count and a multi-line rule is still seen.

import * as fs from "node:fs";
import * as path from "node:path";
import { AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import { isInvariant, isPreconditionStmt, isProperty } from "../../src/language/generated/ast.js";
import { declaredRuleName, type RuleNode, ruleOwner } from "../../src/language/rule-names.js";
import { expectReach } from "../_helpers/census-reach.js";
import { parseRawResult } from "../_helpers/index.js";

const ROOTS = ["examples", "web/src/examples"];

function dddFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return dddFiles(p);
    return e.isFile() && e.name.endsWith(".ddd") ? [p] : [];
  });
}

const isRule = (n: unknown): n is RuleNode =>
  isInvariant(n) || isPreconditionStmt(n) || (isProperty(n) && n.check !== undefined);

describe("example rule-name census", () => {
  it("every invariant, field check and precondition in the examples is named, once per owner", () => {
    const files = ROOTS.flatMap(dddFiles).sort();
    let rules = 0;
    const unnamed: string[] = [];
    const duplicates: string[] = [];
    for (const file of files) {
      const parsed = parseRawResult(fs.readFileSync(file, "utf8"));
      const seen = new Map<unknown, Set<string>>();
      for (const node of AstUtils.streamAst(parsed.value)) {
        if (!isRule(node)) continue;
        rules++;
        const line = (node.$cstNode?.range.start.line ?? -1) + 1;
        const name = declaredRuleName(node);
        if (name === undefined) {
          unnamed.push(`${file}:${line}  ${node.$cstNode?.text.split("\n")[0].trim()}`);
          continue;
        }
        // `ddd parse` drops this error when the file is imported, so
        // the census checks it per file itself.
        const owner = ruleOwner(node);
        const names = seen.get(owner) ?? new Set<string>();
        if (names.has(name)) duplicates.push(`${file}:${line}  ${owner?.name}.${name}`);
        names.add(name);
        seen.set(owner, names);
      }
    }
    expectReach("example .ddd files", files.length, 80);
    expectReach("example rules", rules, 300);
    expect(
      unnamed,
      `unnamed rules — name each one (\`invariant nameIsRequired: …\`):\n${unnamed.join("\n")}`,
    ).toEqual([]);
    expect(duplicates, "rule names repeated within one owner").toEqual([]);
  });
});

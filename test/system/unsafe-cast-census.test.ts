import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

// ---------------------------------------------------------------------------
// Unsafe-cast census: `as any` and `x as unknown as T` in the toolchain.
//
// Both tell the compiler to stop checking.  Most of them could be type guards
// (`isFilterDecl(m)`), `in` narrowing (`"name" in node`), or a parameter
// typed by what it reads.  The ones left are boundaries where no static type
// exists: hand-built AST nodes, which lack Langium's container members; a
// generic reflective clone; the parser's undeclared rule-entry surface; and the
// Feliz/Flutter render context, which types scalar fields while the walker
// passes object arrays.  Each kept site carries a comment saying which.
//
// The scan is on the TypeScript AST: the backends EMIT TypeScript that casts
// (`as any` in a generated route), and that text is a string literal, not an
// expression node.  Only a cast the toolchain itself compiles is counted.
//
// The map is EXACT per file, so the count only moves down: a fix deletes or
// lowers its row in the same change, and a new cast fails until it is typed
// properly or argued into the map.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcRoot = path.join(repoRoot, "src");

const PINNED: Readonly<Record<string, number>> = {
  // The render context types scalar fields; the walker passes object arrays.
  "src/generator/feliz/pack.ts": 2,
  "src/generator/flutter/pack.ts": 2,
  // A synthesized `LetStmt` handed to the statement lowerer.
  "src/ir/lower/lower-workflow.ts": 1,
  // `LangiumParser`'s rule-entry surface is not in its declared type.
  "src/language/parse-errors.ts": 1,
  // The macro API's one pre-link → post-link bridge.
  "src/macros/api/_mk.ts": 1,
  // The reflective structural clone, in and out.
  "src/macros/api/factories.ts": 2,
  // A hand-built `Capability` node.
  "src/macros/prelude.ts": 1,
  // A member-only suffix list, and a reflective container-slot write.
  "src/macros/stdlib/auto-paged-table.ts": 2,
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path.relative(srcRoot, full) !== path.join("language", "generated")) {
        sourceFiles(full, out);
      }
    } else if (/\.[cm]?tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** `as any` and `as unknown as T` expressions in one source text. */
function unsafeCasts(fileName: string, text: string): number {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  let n = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isAsExpression(node)) {
      const viaUnknown =
        ts.isAsExpression(node.expression) &&
        node.expression.type.kind === ts.SyntaxKind.UnknownKeyword;
      if (node.type.kind === ts.SyntaxKind.AnyKeyword || viaUnknown) n++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return n;
}

describe("unsafe-cast census — `as any` / `as unknown as` under src/", () => {
  const files = sourceFiles(srcRoot);
  const live: Record<string, number> = {};
  for (const f of files) {
    const n = unsafeCasts(f, fs.readFileSync(f, "utf8"));
    if (n > 0) live[path.relative(repoRoot, f).split(path.sep).join("/")] = n;
  }

  it("scans the toolchain (guard against a vacuous pass)", () => {
    expectReach("source files under src/", files.length, 1000);
  });

  it("the scanner counts real casts and ignores emitted text", () => {
    expect(unsafeCasts("a.ts", "const x = y as any;")).toBe(1);
    expect(unsafeCasts("a.ts", "const x = y as unknown as Foo;")).toBe(1);
    expect(unsafeCasts("a.ts", "const x = y as unknown;")).toBe(0);
    expect(unsafeCasts("a.ts", "const x = y as Foo;")).toBe(0);
    expect(unsafeCasts("a.ts", "const s = `const x = y as any;`;")).toBe(0);
  });

  it("the per-file count matches the pinned map exactly", () => {
    expect(
      live,
      "A new `as any` / `as unknown as`: type it (a guard, `in` narrowing, a parameter " +
        "typed by what it reads) or add it to PINNED with the reason no static type exists. " +
        "A removed one: lower or delete its row.",
    ).toEqual(PINNED);
  });
});

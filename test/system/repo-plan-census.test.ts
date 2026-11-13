import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

// ---------------------------------------------------------------------------
// Repository-plan census: each repository / query fact `src/ir/plan/repo-*`
// owns has ONE implementation, and the generators, platform packages and the
// system composer ask the plan for it instead of recomputing it.
//
// A recomputed copy is where the persistence adapters drift: seven adapters
// spell the same read across three storage shapes, and the copy that forgets
// a rule answers a different row on one of them.
//
// THE DETECTORS (TypeScript AST, so comments and strings never count):
//
//   first-match  a read of a find's `.takeFirst` flag — the per-adapter
//               decision whether a single-row read is ordered.
//               → use `singleReadOrder`.
//
// SCOPE.  `src/generator/`, `src/platform/`, `src/system/`, `src/ir/validate/`.
// The plan itself (`src/ir/plan/`) is the one place allowed to spell them.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCANNED_ROOTS = ["src/generator", "src/platform", "src/system", "src/ir/validate"];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...tsFiles(full));
    else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

interface Violation {
  rule: string;
  where: string;
  text: string;
}

/** The violations one source text holds; exported shape kept local so the
 *  mutation cases below drive the same scanner the census runs. */
function scanSource(file: string, text: string): Violation[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const rel = path.relative(repoRoot, file);
  const at = (n: ts.Node): string =>
    `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const out: Violation[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n) && n.name.text === "takeFirst") {
      out.push({ rule: "first-match", where: at(n), text: n.getText(sf) });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function scan(file: string): Violation[] {
  return scanSource(file, fs.readFileSync(file, "utf8"));
}

describe("repo-plan census: repository read facts are not recomputed outside src/ir/plan/", () => {
  const files = SCANNED_ROOTS.flatMap((r) => tsFiles(path.join(repoRoot, r)));
  const violations = files.flatMap(scan);

  it("reaches the scanned trees", () => {
    expectReach("source files", files.length, 700);
  });

  it("the detector fires on a hand-spelled first-match test", () => {
    const hits = scanSource(
      path.join(repoRoot, "src/generator/x.ts"),
      "const order = f.takeFirst ? 'order by id' : '';",
    );
    expect(hits.map((h) => h.rule)).toEqual(["first-match"]);
  });

  it("no backend decides on its own whether a single-row read is ordered (use singleReadOrder)", () => {
    const hits = violations.filter((v) => v.rule === "first-match");
    expect(hits.map((v) => `${v.where}  ${v.text}`)).toEqual([]);
  });
});

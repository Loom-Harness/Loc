import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// ---------------------------------------------------------------------------
// Site extractor for `generator-throw-census.test.ts`. It isn't a test file,
// so vitest doesn't discover it. The census and its dump mode both import it.
//
// A SITE is one `throw new Error(…)` in `src/generator/**` or
// `src/platform/**`: a place where `ddd generate` can crash after `ddd parse`
// has already said the model is fine. A site's key is
// `<relFile>#<enclosingName>[$N]`, the same edit-stable shape as
// `ir-walk-census.test.ts`, so line churn elsewhere in a file doesn't move it.
// ---------------------------------------------------------------------------

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const SCANNED_ROOTS = ["src/generator", "src/platform"] as const;

export interface ThrowSite {
  id: string;
  file: string;
  line: number;
  /** The source text of the thrown message argument. */
  message: string;
  /** Bare `loom.*` codes the message names through
   *  `diagMessage("loom.x#…")`. A throw that renders a catalogued validator
   *  message is, by construction, the emitter-side twin of that diagnostic. */
  diagCodes: string[];
}

function listTs(dir: string, out: string[]): void {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) listTs(p, out);
    else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts")) out.push(p);
  }
}

function enclosingName(node: ts.Node): string {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.text;
    if ((ts.isMethodDeclaration(cur) || ts.isGetAccessor(cur)) && ts.isIdentifier(cur.name)) {
      return cur.name.text;
    }
    if (ts.isPropertyAssignment(cur) && ts.isIdentifier(cur.name)) {
      const init = cur.initializer;
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return cur.name.text;
    }
    if (
      ts.isVariableDeclaration(cur) &&
      ts.isIdentifier(cur.name) &&
      cur.initializer &&
      (ts.isArrowFunction(cur.initializer) || ts.isFunctionExpression(cur.initializer))
    ) {
      return cur.name.text;
    }
    cur = cur.parent;
  }
  return "<module>";
}

let cached: ThrowSite[] | null = null;

export function computeThrowSites(): ThrowSite[] {
  if (cached) return cached;
  const files: string[] = [];
  for (const r of SCANNED_ROOTS) listTs(path.join(repoRoot, r), files);
  files.sort();

  const sites: ThrowSite[] = [];
  const idCounts = new Map<string, number>();
  const nextId = (base: string): string => {
    const n = (idCounts.get(base) ?? 0) + 1;
    idCounts.set(base, n);
    return n === 1 ? base : `${base}$${n}`;
  };

  for (const abs of files) {
    const rel = path.relative(repoRoot, abs).replaceAll(path.sep, "/");
    const sf = ts.createSourceFile(abs, fs.readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (
        ts.isThrowStatement(node) &&
        node.expression &&
        ts.isNewExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "Error"
      ) {
        const arg = node.expression.arguments?.[0];
        const message = arg ? arg.getText(sf) : "";
        const diagCodes = [
          ...new Set(
            [...message.matchAll(/diagMessage\(\s*"(loom\.[a-z0-9-]+)(?:#[^"]*)?"/g)].map(
              (m) => m[1],
            ),
          ),
        ];
        sites.push({
          id: nextId(`${rel}#${enclosingName(node)}`),
          file: rel,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          message,
          diagCodes,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  cached = sites;
  return sites;
}

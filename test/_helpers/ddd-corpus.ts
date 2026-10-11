// The tracked `.ddd` population — one definition, shared by every census.
//
// Extracted when the clause census joined the file census: two sweeps over
// "every `.ddd` in the repo" that each computed the population themselves would
// drift the moment one grew an exclusion, and a census whose denominator is
// wrong is worse than no census (`experience_gathered.md` §84's coverage-claim
// class — a wrong denominator makes a coverage argument unfalsifiable).

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

export const REPO_ROOT = resolve(import.meta.dirname, "..", "..");

/** Every `.ddd` git tracks — the whole population, by construction rather than
 *  by a list someone maintains. */
export function trackedDddFiles(): string[] {
  return execSync("git ls-files '*.ddd'", { cwd: REPO_ROOT, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
}

/** `__PLATFORM__`-tokenized corpus fixtures are templates, not sources — the
 *  runners substitute a backend before parsing, and so does every census. */
export function dddSourceOf(file: string): string {
  return readFileSync(resolve(REPO_ROOT, file), "utf8").replaceAll("__PLATFORM__", "node");
}

/** The one tracked `.ddd` that cannot parse: a design document carrying a
 *  `.ddd` extension, which says so in its own header. Pinned (with the full
 *  reasoning) by `ddd-source-census.test.ts`; every other sweep skips it
 *  because a partial AST would silently under-count. */
export const UNPARSEABLE_DDD = "examples/sales-ui.ddd";

export interface InlineDoc {
  readonly file: string;
  /** 1-based line of the literal's opening backtick, so a failure is clickable. */
  readonly line: number;
  readonly text: string;
}

/** A literal is a DOCUMENT when its first meaningful line opens a top-level
 *  declaration.  `import` must be followed by a STRING — Loom's import takes a
 *  path, and without that check every embedded TypeScript fixture
 *  (`import type { X } from …`) reads as a `.ddd` document. */
const TOP_LEVEL = /^(?:system|subdomain)\b|^import\s+"/;

/** Sources written for a substitution step: the runners replace the token before
 *  parsing, and a document still carrying one is a template, not a source. */
const PLACEHOLDER = /__[A-Z][A-Z0-9_]*__/;

/** Braces balance — the property that separates a whole document from the
 *  `PRELUDE` / `EPILOGUE` halves several suites concatenate before parsing.
 *  Counted with double-quoted strings removed, so a `"{"` in a literal does not
 *  skew it; a `.ddd` source inside a TS template literal cannot contain a
 *  backtick (it would have closed the literal), so quotes are the only case. */
function bracesBalance(text: string): boolean {
  const bare = text.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  let depth = 0;
  for (const ch of bare) {
    if (ch === "{") depth++;
    else if (ch === "}" && --depth < 0) return false;
  }
  return depth === 0;
}

function firstMeaningfulLine(text: string): string {
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length > 0 && !line.startsWith("//")) return line;
  }
  return "";
}

/** Every whole `.ddd` document embedded as a template literal in a tracked
 *  test file — the inline half of the fleet (shared by the inline-source
 *  census and the M-T5.47 typing differential). */
export function inlineDddDocuments(): InlineDoc[] {
  const files = execSync("git ls-files 'test/**/*.ts'", { cwd: REPO_ROOT, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
  const docs: InlineDoc[] = [];
  for (const file of files) {
    const src = readFileSync(resolve(REPO_ROOT, file), "utf8");
    if (!src.includes("`")) continue;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isNoSubstitutionTemplateLiteral(node)) {
        const text = node.text;
        if (
          TOP_LEVEL.test(firstMeaningfulLine(text)) &&
          text.includes("{") &&
          bracesBalance(text) &&
          !PLACEHOLDER.test(text)
        ) {
          docs.push({
            file,
            line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            text,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return docs;
}

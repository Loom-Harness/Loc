import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ORG_CONTEXT_HEADER } from "../../src/util/principal.js";
import { expectReach } from "../_helpers/census-reach.js";
import { generateSystemFiles } from "../_helpers/generate.js";

// ---------------------------------------------------------------------------
// The operating-org request header has ONE spelling, `ORG_CONTEXT_HEADER`.
//
// Two readers must agree on it byte for byte: the auth layer that gates the
// switch and the api client that forwards it to the callee.  A hand-spelled
// copy in either drifts silently — the forwarded header stops matching the
// gate and the callee quietly operates in the caller's home org.  The scan is
// on string/template literal TEXT in the AST, so prose in comments is fine.
//
// Behaviour note: a booted proof needs tenancy plus an org registry on the
// callee AND a probe that echoes the operating org; the `api-call` corpus has
// neither, so the forwarding half is pinned at the string tier below (the
// emitted carrier on every backend), not by a wire golden.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOTS = ["src/generator", "src/platform"].map((r) => path.join(repoRoot, r));

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.[cm]?tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** String / template-literal fragments of one source text that spell the header. */
function literalSpellings(fileName: string, text: string): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      node.text.toLowerCase().includes(ORG_CONTEXT_HEADER)
    ) {
      hits.push(`${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

describe("org-context header census", () => {
  const files = ROOTS.flatMap((r) => sourceFiles(r));

  it("scans the emitters (guard against a vacuous pass)", () => {
    expectReach("emitter source files", files.length, 500);
  });

  it("the scanner flags a literal and ignores comments and identifiers", () => {
    expect(literalSpellings("a.ts", 'const h = "x-org-context";')).toHaveLength(1);
    expect(literalSpellings("a.ts", 'const h = `a "X-Org-Context" ${b}`;')).toHaveLength(1);
    expect(
      literalSpellings("a.ts", "// the x-org-context header\nconst h = ORG_CONTEXT_HEADER;"),
    ).toEqual([]);
  });

  it("no emitter hand-spells the header; all read ORG_CONTEXT_HEADER", () => {
    const offenders = files.flatMap((f) =>
      literalSpellings(f, fs.readFileSync(f, "utf8")).map(
        (line) => `${path.relative(repoRoot, f).split(path.sep).join("/")}:${line}`,
      ),
    );
    expect(
      offenders,
      "Import ORG_CONTEXT_HEADER from src/util/principal.ts and interpolate it.",
    ).toEqual([]);
  });
});

describe("api clients forward the org switch alongside the credential", () => {
  // String tier (see the header): the carrier that copies the inbound
  // credential also copies the org-switch header, on every backend.
  const src = fs.readFileSync(
    path.join(repoRoot, "test/fixtures/corpus/api-call-auth.ddd"),
    "utf8",
  );
  for (const platform of ["node", "dotnet", "java", "python", "elixir"]) {
    it(platform, async () => {
      const files = await generateSystemFiles(src.replaceAll("__PLATFORM__", platform));
      const carriers = [...files].filter(
        ([, c]) => c.includes("x-loom-dev-claims") && c.includes(ORG_CONTEXT_HEADER),
      );
      expect(
        carriers.length,
        "a file forwarding both the credential and the org switch",
      ).toBeGreaterThan(0);
    });
  }
});

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

// ---------------------------------------------------------------------------
// OpenAPI documents come from each framework's own generator
// (D-OPENAPI-FRAMEWORK-NATIVE).
//
// A backend configures its OpenAPI generator and declares source metadata the
// generator reads (routes, annotations, response types, schema modules).  It
// never post-processes the generated document and never hand-builds one.  This
// census fails on emitted code that does either:
//
//   - a springdoc `OpenApiCustomizer`;
//   - a Swashbuckle `IDocumentFilter` / `IOperationFilter` / `ISchemaFilter`,
//     or its `c.DocumentFilter<…>()`-style registration;
//   - an `Add(Document|Operation|Schema)Transformer` on ASP.NET OpenAPI options;
//   - a FastAPI `custom_openapi` override or an `openapi_schema =` assignment;
//   - a hand-built `paths: %{` map in an OpenApiSpex spec module.
//
// The scan reads only string and template-literal text in the TypeScript AST:
// that is the code a generator EMITS.  A comment or a TypeScript identifier
// that names one of these (a renderer called `renderJavaOpenApiCustomizer`)
// is not emitted and is not flagged.
//
// A waiver is per backend directory and is always `deferred`: parked work with
// a review date and the issue that removes the violation.  A waiver whose
// backend no longer emits a violation fails, so the PR that removes the
// post-processing deletes its waiver too.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCAN_ROOTS = ["src/generator", "src/platform"];

/** Emitted-text patterns that post-process or hand-build an OpenAPI document. */
const FORBIDDEN: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: "springdoc OpenApiCustomizer", re: /\bOpenApiCustomizer\b/ },
  { id: "Swashbuckle filter", re: /\bI(?:Document|Operation|Schema)Filter\b/ },
  { id: "Swashbuckle filter registration", re: /\.(?:Document|Operation|Schema)Filter</ },
  { id: "OpenAPI transformer", re: /\bAdd(?:Document|Operation|Schema)Transformer\b/ },
  { id: "FastAPI custom_openapi", re: /\bcustom_openapi\b/ },
  { id: "FastAPI openapi_schema assignment", re: /\bopenapi_schema\s*=(?!=)/ },
  { id: "hand-built OpenApiSpex paths", re: /\bpaths:\s*%\{/ },
];

type Waiver = { deferred: string; reviewUntil: string; blockedBy: string };

/** A deferral may not be parked further out than this. */
const MAX_DEFERRAL_DAYS = 180;

/** One waiver per backend directory that still post-processes its document. */
const WAIVERS: Record<string, Waiver> = {
  "src/generator/dotnet/": {
    deferred:
      "ValueObjectSchemaMergeFilter folds each value object's per-direction, per-aggregate " +
      "wire records into one component; replaced by one shared wire record per value object",
    reviewUntil: "2027-03-31",
    blockedBy: "#5321",
  },
  "src/generator/python/": {
    deferred:
      "custom_openapi() rewrites 4xx/5xx content after get_openapi(); replaced by " +
      "per-route responses= and Pydantic discriminated unions",
    reviewUntil: "2027-03-31",
    blockedBy: "#4872",
  },
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.[cm]?ts$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

/** Forbidden patterns found in the string and template-literal text of one
 *  source file, as `line: pattern-id`. */
function emittedViolations(fileName: string, text: string): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      for (const { id, re } of FORBIDDEN) {
        if (re.test(node.text)) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          hits.push(`${line}: ${id}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

function rel(file: string): string {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}

describe("OpenAPI framework-native census — no document post-processing", () => {
  const files = SCAN_ROOTS.flatMap((r) => sourceFiles(path.join(repoRoot, r)));
  const violations = files.flatMap((f) =>
    emittedViolations(f, fs.readFileSync(f, "utf8")).map((hit) => ({
      file: rel(f),
      hit,
    })),
  );

  it("scans the generator and platform trees (guard against a vacuous pass)", () => {
    expectReach("generator/platform source files", files.length, 680);
  });

  it("the scanner sees emitted text and ignores comments and identifiers", () => {
    expect(
      emittedViolations(
        "a.ts",
        "const s = `import org.springdoc.core.customizers.OpenApiCustomizer;`;",
      ),
    ).toHaveLength(1);
    expect(
      emittedViolations("a.ts", 'const s = "public sealed class F : IDocumentFilter";'),
    ).toHaveLength(1);
    expect(emittedViolations("a.ts", "const s = `    c.OperationFilter<F>();`;")).toHaveLength(1);
    expect(emittedViolations("a.ts", "const s = `o.AddSchemaTransformer<T>();`;")).toHaveLength(1);
    expect(emittedViolations("a.ts", "const s = `def custom_openapi():`;")).toHaveLength(1);
    expect(emittedViolations("a.ts", "const s = `app.openapi_schema = schema`;")).toHaveLength(1);
    expect(emittedViolations("a.ts", "const s = `if app.openapi_schema == x:`;")).toEqual([]);
    expect(emittedViolations("a.ts", "const s = `${a}\n      paths: %{\n`;")).toHaveLength(1);
    expect(emittedViolations("a.ts", "// emits an OpenApiCustomizer\nconst x = 1;")).toEqual([]);
    expect(emittedViolations("a.ts", "function renderJavaOpenApiCustomizer() {}")).toEqual([]);
  });

  it("no unwaived backend post-processes or hand-builds its OpenAPI document", () => {
    const unwaived = violations
      .filter((v) => !Object.keys(WAIVERS).some((prefix) => v.file.startsWith(prefix)))
      .map((v) => `${v.file}:${v.hit}`);
    expect(
      unwaived,
      "Produce the OpenAPI document with the framework's own generator: configure it and " +
        "declare source metadata it reads (routes, annotations, response types, schema " +
        "modules).  Do not edit the generated document or build one by hand " +
        "(D-OPENAPI-FRAMEWORK-NATIVE).  If the parity check reports a framework-native " +
        "spelling of the same contract, teach test/_helpers/openapi-normalize.ts the " +
        "equivalence.",
    ).toEqual([]);
  });

  it("every waiver still covers a violation (the ratchet)", () => {
    const stale = Object.keys(WAIVERS).filter(
      (prefix) => !violations.some((v) => v.file.startsWith(prefix)),
    );
    expect(
      stale,
      "These backends no longer post-process their OpenAPI document — delete the waiver.",
    ).toEqual([]);
  });

  it("every waiver is a dated deferral that names the issue removing it", () => {
    const now = Date.now();
    const bad: string[] = [];
    for (const [prefix, w] of Object.entries(WAIVERS)) {
      if (!/^#\d+$/.test(w.blockedBy))
        bad.push(`${prefix}: blockedBy "${w.blockedBy}" is not #NNNN`);
      const due = /^\d{4}-\d{2}-\d{2}$/.test(w.reviewUntil)
        ? Date.parse(`${w.reviewUntil}T23:59:59Z`)
        : Number.NaN;
      if (Number.isNaN(due))
        bad.push(`${prefix}: reviewUntil "${w.reviewUntil}" is not YYYY-MM-DD`);
      else if (due < now)
        bad.push(
          `${prefix}: DEFERRAL EXPIRED on ${w.reviewUntil} (${w.blockedBy}) — remove the violation or re-justify`,
        );
      else if (due - now > MAX_DEFERRAL_DAYS * 86_400_000)
        bad.push(
          `${prefix}: reviewUntil ${w.reviewUntil} is past the ${MAX_DEFERRAL_DAYS}-day cap`,
        );
    }
    expect(bad).toEqual([]);
  });
});

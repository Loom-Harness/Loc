import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

// ---------------------------------------------------------------------------
// No `process.env` read in the pure layers.
//
// Generation is a pure function of (model, options).  An environment read
// inside the toolchain makes output depend on the machine it ran on, and
// breaks the browser playground, which imports `src/` directly.  A host
// setting — a debug knob, a commit label — is read once at its Node-only
// boundary (`src/cli/`, `src/mcp/`, `src/dap-server/`) and passed in as an
// explicit option.
//
// The scan is on the TypeScript AST, not the text: the backends EMIT code that
// reads `process.env` (`process.env.PORT` in a generated Hono entry), and that
// text lives inside string and template literals, where it is not an
// expression node.  Only a read the toolchain itself executes is flagged.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcRoot = path.join(repoRoot, "src");

/** Node-only islands that own the host boundary, plus generated parser code. */
const HOST_BOUNDARY = ["cli", "mcp", "dap-server", "language/generated"];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(srcRoot, full).split(path.sep).join("/");
    if (HOST_BOUNDARY.some((b) => rel === b || rel.startsWith(`${b}/`))) continue;
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.[cm]?tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** `process.env`, `process["env"]` and `globalThis.process.env` reads in one
 *  source text, as `line: snippet`. */
function envReads(fileName: string, text: string): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const isProcess = (e: ts.Expression): boolean =>
    (ts.isIdentifier(e) && e.text === "process") ||
    (ts.isPropertyAccessExpression(e) &&
      e.name.text === "process" &&
      ts.isIdentifier(e.expression) &&
      e.expression.text === "globalThis");
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    const isEnvAccess =
      (ts.isPropertyAccessExpression(node) &&
        node.name.text === "env" &&
        isProcess(node.expression)) ||
      (ts.isElementAccessExpression(node) &&
        ts.isStringLiteral(node.argumentExpression) &&
        node.argumentExpression.text === "env" &&
        isProcess(node.expression));
    if (isEnvAccess) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      hits.push(`${line}: ${node.parent.getText().split("\n")[0]}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

describe("process.env census — no environment read outside the host boundary", () => {
  const files = sourceFiles(srcRoot);

  it("scans the toolchain (guard against a vacuous pass)", () => {
    expectReach("source files outside the host boundary", files.length, 1000);
  });

  it("the scanner sees a real read and ignores emitted text", () => {
    expect(envReads("a.ts", "const p = process.env.PORT;")).toHaveLength(1);
    expect(envReads("a.ts", 'const p = process["env"].PORT;')).toHaveLength(1);
    expect(envReads("a.ts", "const p = globalThis.process.env.PORT;")).toHaveLength(1);
    expect(envReads("a.ts", "const s = `const port = process.env.PORT;`;")).toEqual([]);
    expect(envReads("a.ts", 'const s = "process.env.PORT";')).toEqual([]);
  });

  it("no file outside src/cli, src/mcp and src/dap-server reads process.env", () => {
    const offenders = files.flatMap((f) =>
      envReads(f, fs.readFileSync(f, "utf8")).map(
        (hit) => `${path.relative(repoRoot, f).split(path.sep).join("/")}:${hit}`,
      ),
    );
    expect(
      offenders,
      "Read the setting once at the host boundary (src/cli, src/mcp, src/dap-server) " +
        "and pass it in as an explicit option — generation must not depend on the " +
        "machine it runs on, and src/ is imported by the browser playground.",
    ).toEqual([]);
  });
});

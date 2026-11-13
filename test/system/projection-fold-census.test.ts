import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

// Projection fold-plan census (D-PROJECTION-FOLD).
//
// What a fold body means — the immutable key, sequential statements, the
// collection `-=` rule, the starting value of a fresh row — is decided once,
// in `src/ir/plan/projection-fold.ts` (`foldSteps`, `foldRowSeeds`).  A
// backend that walks a fold handler's raw `statements` decides those things
// again, and the five copies drifted apart before (one moved the row on a key
// assignment, three removed only the first match, one read stale values).
//
// THE DETECTOR.  Every `<recv>.statements` property access in
// `src/generator/**` and `src/platform/**` whose receiver's STATIC TYPE is a
// `ProjectionOnIR`, verified with the real TypeScript checker.  There is no
// waiver list: a site is fixed by rendering `foldSteps(projection, handler)`.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const SCANNED_ROOTS = ["src/generator/", "src/platform/"];

interface Scan {
  /** Every `.statements` access scanned, whatever its receiver. */
  statementsReads: number;
  /** The ones whose receiver is a fold handler. */
  sites: string[];
  /** Files that call `foldSteps(`. */
  consumers: Set<string>;
}

let cached: Scan | null = null;

function scan(): Scan {
  if (cached) return cached;
  const configFile = ts.readConfigFile(path.join(repoRoot, "tsconfig.json"), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, repoRoot);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const checker = program.getTypeChecker();
  const out: Scan = { statementsReads: 0, sites: [], consumers: new Set() };
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const rel = path.relative(repoRoot, sf.fileName).replaceAll(path.sep, "/");
    if (!SCANNED_ROOTS.some((r) => rel.startsWith(r))) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) && node.name.text === "statements") {
        out.statementsReads++;
        const recv = checker.typeToString(
          checker.getTypeAtLocation(node.expression),
          undefined,
          ts.TypeFormatFlags.NoTruncation,
        );
        if (/\bProjectionOnIR\b/.test(recv)) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          out.sites.push(`${rel}:${line} \`${node.getText(sf)}\``);
        }
      }
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "foldSteps"
      ) {
        out.consumers.add(rel);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  cached = out;
  return out;
}

describe("projection fold-plan census — no backend walks a fold handler's raw statements", () => {
  it("scans the emitters' statement reads", () => {
    expectReach("`.statements` reads", scan().statementsReads, 150);
  });

  it("every fold emitter renders the plan's steps", () => {
    // node, .NET, java, python, elixir.
    expectReach("files calling foldSteps", scan().consumers.size, 5);
  });

  it("reads no `ProjectionOnIR.statements` outside src/ir/plan", () => {
    const { sites } = scan();
    expect(
      sites,
      `${sites.join("\n")}\n— render the fold through \`foldSteps(projection, handler)\` ` +
        "(src/ir/plan/projection-fold.ts) instead of re-deciding its semantics here.",
    ).toEqual([]);
  });
});

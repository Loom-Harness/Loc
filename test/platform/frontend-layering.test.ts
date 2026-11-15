// The React frontend and the shared layers it emits through hold no runtime
// dependency on the compiler's lowering, enrichment or validation passes.
//
// A frontend target emits from the Frontend Contract (D-FRONTEND-CONTRACT): a
// fact it needs is either decided on the server and shipped in the contract,
// or a pure predicate over shapes the contract carries, which lives in
// `src/ir/util/`.  A value import of `ir/lower`, `ir/enrich` or `ir/validate`
// from these directories is a frontend reaching behind the contract into a
// compiler pass.  Type-only imports carry no runtime edge and are not checked
// here.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

const repo = path.resolve(__dirname, "../..");

/** Directories under `src/generator/` the React target emits through. */
const FRONTEND_DIRS = ["react", "_frontend", "_walker", "_packs"];
const COMPILER_PASSES = /(?:^|\/)ir\/(lower|enrich|validate)\//;

function tsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return tsFiles(p);
    return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [p] : [];
  });
}

/** Every value import of `f` (a statement that brings a runtime binding in),
 *  as its resolved repo-relative module path.  An inline `import("…").T` is a
 *  type position and carries no runtime edge. */
function valueImports(f: string, text: string): string[] {
  const out: string[] = [];
  const stmt = /import\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/gs;
  for (const m of text.matchAll(stmt)) {
    if (m[1]) continue;
    const clause = m[2]!.trim();
    const braces = clause.match(/\{([^}]*)\}/);
    const outside = clause
      .replace(/\{[^}]*\}/, "")
      .replace(/,/g, "")
      .trim();
    const named = (braces?.[1] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (outside === "" && named.every((n) => n.startsWith("type "))) continue;
    const spec = m[3]!;
    if (!spec.startsWith(".")) continue;
    out.push(
      path
        .relative(repo, path.resolve(path.dirname(f), spec))
        .split(path.sep)
        .join("/"),
    );
  }
  return out;
}

describe("frontend layering", () => {
  it("no value import of a compiler pass under the React target's directories", () => {
    const files = FRONTEND_DIRS.flatMap((d) => tsFiles(path.join(repo, "src/generator", d)));
    expectReach("frontend emitter files", files.length, 120);
    const hits = files.flatMap((f) =>
      valueImports(f, fs.readFileSync(f, "utf8"))
        .filter((m) => COMPILER_PASSES.test(m))
        .map((m) => `${path.relative(repo, f)} -> ${m}`),
    );
    expect(hits).toEqual([]);
  });

  it("the import scan sees value imports and skips type-only ones", () => {
    const f = path.join(repo, "src/generator/react/x.ts");
    const src = [
      'import { a } from "../../ir/enrich/one.js";',
      'import type { B } from "../../ir/enrich/two.js";',
      'import { type C, type D } from "../../ir/validate/three.js";',
      'import {\n  type E,\n  f,\n} from "../../ir/lower/four.js";',
      'import * as g from "../../ir/util/five.js";',
    ].join("\n");
    expect(valueImports(f, src)).toEqual([
      "src/ir/enrich/one.js",
      "src/ir/lower/four.js",
      "src/ir/util/five.js",
    ]);
  });
});

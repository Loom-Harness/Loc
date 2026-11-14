import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

// ---------------------------------------------------------------------------
// A query-time projection's declared parameters reach every backend's read
// route through ONE plan: `projectionQueryParams` (`src/ir/plan/projection-params.ts`,
// D-PROJECTION-PARAMS).
//
// The defect class: each emission arm (grouped, singleton, repository,
// workflow- / projection-sourced) spelled its own walk over `proj.params`, and
// the arms drifted — the grouped and singleton arms bound no parameter at all
// on four backends (a free `r` in the `where`), the singleton java method took
// none while its controller passed one, and Phoenix coerced through helpers it
// never defined.  The behaviour is pinned by the `projection-params` corpus
// fixture's wire golden on every leg; this census keeps the next arm from
// reading the parameters around the plan.
//
// THE DETECTOR is textual: a `<proj>.params` / `p.params` read in a listed
// emitter, comments excluded, is a finding, and each listed file must call the
// plan, so a file that stops reading parameters (or is renamed away) is
// noticed rather than vacuously clean.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Every backend's query-time projection read emitter. */
const QUERY_PROJECTION_EMITTERS: readonly string[] = [
  "src/platform/hono/shared/projection-query-routes-builder.ts",
  "src/generator/python/query-projections-builder.ts",
  "src/generator/dotnet/query-projection-emit.ts",
  "src/generator/java/emit/query-projection-reads.ts",
  "src/generator/elixir/vanilla/query-projections-emit.ts",
];

/** A projection's parameter list read off the IR node directly. */
const DIRECT_READ = /\b(proj|p|projection)\.params\b/g;

const PLAN_READ = /\bprojectionQueryParams\(/;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Direct parameter-list reads in `src`, as `<line>: <read>`. */
function directReads(src: string): string[] {
  const out: string[] = [];
  stripComments(src)
    .split("\n")
    .forEach((line, i) => {
      for (const m of line.matchAll(DIRECT_READ)) out.push(`${i + 1}: ${m[0]}`);
    });
  return out;
}

describe("projection-params census: query-time reads bind their params through the plan", () => {
  for (const rel of QUERY_PROJECTION_EMITTERS) {
    it(rel, () => {
      const file = path.join(ROOT, rel);
      expect(
        fs.existsSync(file),
        `${rel} is listed but missing — update QUERY_PROJECTION_EMITTERS`,
      ).toBe(true);
      const src = fs.readFileSync(file, "utf8");
      expect(directReads(src), `${rel} reads a projection's params around the plan`).toEqual([]);
      expect(PLAN_READ.test(stripComments(src)), `${rel} never calls projectionQueryParams`).toBe(
        true,
      );
    });
  }

  it("scans every backend's emitter", () => {
    const present = QUERY_PROJECTION_EMITTERS.filter((rel) => fs.existsSync(path.join(ROOT, rel)));
    expectReach("query-projection emitter files", present.length, 5);
  });

  it("the detector sees a direct read and ignores a commented one", () => {
    expect(directReads("const a = proj.params.map(f);\n// p.params\n")).toEqual(["1: proj.params"]);
    expect(directReads("projectionQueryParams(proj, ctx).map(f)")).toEqual([]);
  });
});

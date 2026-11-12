import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

// ---------------------------------------------------------------------------
// The domain layer spells names only through the symbol plan
// (`src/generator/_symbols/plan.ts`).
//
// The defect class: a definition and its uses format one `.ddd` name
// independently, and the copies drift — the TS domain-service function is
// DEFINED as `calc_base` while a sibling call spells `base`; a python method
// is escaped to `raise_` at its `def` while a caller spells `raise`.  The
// plan holds each spelling once, so the domain emitters below must reach the
// target's escaping funnels only through it.
//
// THE DETECTOR is textual: a call to any raw funnel (`pythonIdent(`,
// `escapeTsIdent(`, `jid(`, …) in a listed file, comments excluded, is a
// finding.  Each listed file must also read the plan, so a file that stops
// spelling names at all (or is renamed away) is noticed rather than vacuously
// clean.
//
// Scope: the domain class emitters (aggregate / part / value object / enum /
// event / domain service) of the five backends.  The workflow, handler,
// repository, OpenAPI and walker emitters migrate in #5224's follow-ups.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The domain class emitters, per backend. */
const DOMAIN_EMITTERS: readonly string[] = [
  "src/generator/typescript/emit/aggregate.ts",
  "src/generator/typescript/emit/value-objects.ts",
  "src/generator/typescript/emit/domain-service.ts",
  "src/generator/python/emit/aggregate.ts",
  "src/generator/python/emit/value-objects.ts",
  "src/generator/python/emit/domain-service.ts",
  "src/generator/python/emit/events.ts",
  "src/generator/dotnet/emit/entity.ts",
  "src/generator/dotnet/emit/enums-vos.ts",
  "src/generator/dotnet/emit/domain-service.ts",
  "src/generator/java/emit/entity.ts",
  "src/generator/java/emit/enums-vos.ts",
  "src/generator/java/emit/domain-service.ts",
  "src/generator/java/emit/events.ts",
  "src/generator/elixir/vanilla/domain-core-emit.ts",
];

/** The raw escaping funnels the plan wraps. */
const RAW_FUNNEL =
  /\b(escapeTsIdent|escapeTargetMember|escapeTargetFieldMember|escapeTargetIdent|escapeCsharpIdent|escapeJavaIdent|jid|escapePythonIdent|escapePythonBuiltin|pythonIdent|pythonModuleFn|escapeElixirIdent|elixirLocal)\(/g;

/** The plan's reader surface. */
const PLAN_READ =
  /\b(DOMAIN_NAMES|tsServiceOpFn|tsServiceSiblingScope|pythonAnnotationIn|pythonModuleFnName)\b/;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Raw funnel calls in `src`, as `<line>: <call>`. */
function rawFunnelCalls(src: string): string[] {
  const out: string[] = [];
  stripComments(src)
    .split("\n")
    .forEach((line, i) => {
      for (const m of line.matchAll(RAW_FUNNEL)) out.push(`${i + 1}: ${m[1]}(`);
    });
  return out;
}

describe("symbol-plan census: the domain emitters spell names through the plan", () => {
  for (const rel of DOMAIN_EMITTERS) {
    it(rel, () => {
      const file = path.join(ROOT, rel);
      expect(fs.existsSync(file), `${rel} is listed but missing — update DOMAIN_EMITTERS`).toBe(
        true,
      );
      const src = fs.readFileSync(file, "utf8");
      expect(rawFunnelCalls(src), `${rel} formats a domain name itself`).toEqual([]);
      expect(PLAN_READ.test(stripComments(src)), `${rel} never reads the symbol plan`).toBe(true);
    });
  }

  it("scans every listed domain emitter", () => {
    const present = DOMAIN_EMITTERS.filter((rel) => fs.existsSync(path.join(ROOT, rel)));
    expectReach("domain emitter files", present.length, 15);
  });

  it("the detector sees a raw funnel call and ignores a commented one", () => {
    expect(rawFunnelCalls("const a = pythonIdent(f.name);\n// jid(x)\n")).toEqual([
      "1: pythonIdent(",
    ]);
    expect(rawFunnelCalls("DOMAIN_NAMES.java.field(n)")).toEqual([]);
  });
});

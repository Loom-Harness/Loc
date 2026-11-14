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
// event / domain service) of the five backends, and the USE-SITE emitters
// that name those constructs from outside: the workflow and command / query
// handler emitters.  The other emitters still name symbols locally.
//
// The use-site emitters are held to a stricter rule than the domain classes:
// the casing helpers (`snake(`, `lowerFirst(`, `upperFirst(`, …) are refused
// too, because a use site that cases an operation, field or type name itself
// is a second copy of the spelling the plan's `op` / `prop` / `type` / `stem`
// slots own.  A name that is NOT a code symbol — a route segment, a file
// path, a table or column, an OpenAPI operation id — is waived by its exact
// call text and count; a new call, or a stale waiver, fails.
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

/** A casing call a use-site emitter keeps: the name it formats is not a code
 *  symbol, so the plan does not own its spelling. */
interface CasingWaiver {
  /** The call exactly as written, e.g. `snake(wf.name)`. */
  readonly call: string;
  /** How many times the file makes it. */
  readonly count: number;
  /** What the name is, and why the plan does not own it. */
  readonly standing: string;
}

/** The workflow and command / query handler emitters, per backend, with the
 *  casing calls each one keeps. */
const USE_SITE_EMITTERS: Readonly<Record<string, readonly CasingWaiver[]>> = {
  "src/platform/hono/shared/workflow-builder.ts": [
    { call: "snake(wf.name)", count: 2, standing: "route segment of the workflow's endpoints" },
  ],
  "src/platform/hono/shared/workflow-eventsourced-builder.ts": [],
  "src/platform/hono/shared/explicit-handlers-builder.ts": [
    { call: "snake(name)", count: 1, standing: "file stem of the extern handler module" },
    { call: "lowerFirst(h.name)", count: 2, standing: "OpenAPI operationId, a wire identifier" },
  ],
  "src/generator/python/workflows-builder.ts": [
    { call: "snake(wf.name)", count: 2, standing: "route segment of the workflow's endpoints" },
  ],
  "src/generator/python/workflow-eventsourced-emit.ts": [],
  "src/generator/python/explicit-handlers-emit.ts": [
    { call: "snake(name)", count: 2, standing: "route path parameter, a wire name" },
    { call: "snake(p.name)", count: 1, standing: "request-model attribute, a wire name" },
  ],
  "src/generator/python/dispatch-builder.ts": [],
  "src/generator/python/entry-result-emit.ts": [],
};

/** The raw escaping funnels the plan wraps. */
const RAW_FUNNEL =
  /\b(escapeTsIdent|escapeTargetMember|escapeTargetFieldMember|escapeTargetIdent|escapeCsharpIdent|escapeJavaIdent|jid|escapePythonIdent|escapePythonBuiltin|pythonIdent|pythonModuleFn|escapeElixirIdent|elixirLocal)\(/g;

/** The casing helpers a use-site emitter may not apply to a domain name. */
const CASING = /(?<![\w.])(snake|pascal|camel|lowerFirst|upperFirst)\(/g;

/** The plan's reader surface. */
const PLAN_READ = /\b(DOMAIN_NAMES|tsServiceOpFn|tsServiceSiblingScope|pythonModuleFnName)\b/;

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

/** The casing calls in `src` with their argument text, as `fn(arg)`. */
function casingCalls(src: string): string[] {
  const code = stripComments(src);
  const out: string[] = [];
  for (const m of code.matchAll(CASING)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < code.length && depth > 0; i++) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")") depth--;
    }
    out.push(code.slice(m.index, i).replace(/\s+/g, " "));
  }
  return out;
}

function tally(calls: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of [...calls].sort()) out[c] = (out[c] ?? 0) + 1;
  return out;
}

describe("symbol-plan census: the use-site emitters spell names through the plan", () => {
  for (const [rel, waivers] of Object.entries(USE_SITE_EMITTERS)) {
    it(rel, () => {
      const file = path.join(ROOT, rel);
      expect(fs.existsSync(file), `${rel} is listed but missing — update USE_SITE_EMITTERS`).toBe(
        true,
      );
      const src = fs.readFileSync(file, "utf8");
      expect(rawFunnelCalls(src), `${rel} escapes a domain name itself`).toEqual([]);
      expect(
        tally(casingCalls(src)),
        `${rel} cases a name itself — read DOMAIN_NAMES.<target>.{op,prop,type,stem}, or waive ` +
          `the call in USE_SITE_EMITTERS when the name is not a code symbol`,
      ).toEqual(Object.fromEntries(waivers.map((w) => [w.call, w.count])));
      expect(PLAN_READ.test(stripComments(src)), `${rel} never reads the symbol plan`).toBe(true);
    });
  }

  it("scans every listed use-site emitter", () => {
    const present = Object.keys(USE_SITE_EMITTERS).filter((rel) =>
      fs.existsSync(path.join(ROOT, rel)),
    );
    expectReach("use-site emitter files", present.length, 8);
  });

  it("the detector reads a casing call with its argument and ignores a plan read", () => {
    expect(casingCalls("x(`${upperFirst(wf.name)}State`, snake(f(a)));\n// snake(z)\n")).toEqual([
      "upperFirst(wf.name)",
      "snake(f(a))",
    ]);
    expect(casingCalls("DOMAIN_NAMES.ts.stem(r.repoName)")).toEqual([]);
  });
});

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

// D-FRONTEND-CONTRACT: React generates from the Frontend Contract and its host
// alone.
//
// `generateReactFromContract(contract, host, options)` (`src/generator/react/
// from-contract.ts`) is the entry everything React emits goes through; the
// enriched-side `generateReactForContexts` in `index.ts` only builds the host
// and the `--sourcemap` origin sidecar and hands over.  So no module under
// `src/generator/react/`, and no generator module React's entry reaches
// through its value imports (`_frontend/`, `_walker/`, `_packs/`, …), may:
//   - name an `Enriched*` IR type — the enriched model is not React's input;
//   - value-import `src/ir/lower/`, `src/ir/enrich/` or `src/ir/validate/` —
//     the passes that build that model.
// The modules React reaches are computed from the entry's value-import graph,
// so a new module it starts importing is checked the moment it is reached.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../_helpers/ddd-corpus.js";

const ENTRY = "src/generator/react/from-contract.ts";

/** The relative specifiers `text` imports or re-exports at runtime: every
 *  `import`/`export … from` except an `import type` / `export type` or a
 *  braces list naming only `type` members. */
function valueSpecifiers(text: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[1]) continue;
    const clause = (m[2] ?? "").trim();
    if (/^\{[^}]*\}$/.test(clause)) {
      const members = clause
        .slice(1, -1)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      if (members.length > 0 && members.every((x) => x.startsWith("type "))) continue;
    }
    out.push(m[3] ?? "");
  }
  const bare = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;
  for (let m = bare.exec(text); m; m = bare.exec(text)) out.push(m[1] ?? "");
  return out;
}

function resolve(from: string, spec: string): string | undefined {
  if (!spec.startsWith(".")) return undefined;
  const p = join(dirname(from), spec).replace(/\.js$/, ".ts");
  return existsSync(join(REPO_ROOT, p)) ? p : undefined;
}

/** Every repo module `entry` reaches through value imports. */
function valueClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const spec of valueSpecifiers(readFileSync(join(REPO_ROOT, f), "utf8"))) {
      const p = resolve(f, spec);
      if (p) queue.push(p);
    }
  }
  return seen;
}

function sourcesUnder(dir: string): string[] {
  return readdirSync(join(REPO_ROOT, dir), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(dir, f));
}

/** `text` without its comments, so prose naming a type is not a use of it. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const BUILD_PASSES = /\/ir\/(lower|enrich|validate)\//;

/** The `file: what` violations in `sources`. */
function violations(sources: readonly { file: string; text: string }[]): string[] {
  const out: string[] = [];
  for (const { file, text } of sources) {
    const enriched = [...new Set(code(text).match(/\bEnriched[A-Z]\w*/g) ?? [])];
    for (const name of enriched) out.push(`${file}: names ${name}`);
    for (const spec of valueSpecifiers(text)) {
      if (BUILD_PASSES.test(spec)) out.push(`${file}: value-imports ${spec}`);
    }
  }
  return out;
}

describe("React reads the Frontend Contract only", () => {
  it("no React module, and no generator module React's entry reaches, reads the enriched model", () => {
    const closure = valueClosure(ENTRY);
    // The scan must reach the shared layers React renders through.
    for (const reached of [
      "src/generator/react/pages-emitter.ts",
      "src/generator/_walker/walker-core.ts",
      "src/generator/_frontend/api-module.ts",
      "src/generator/_packs/loader.ts",
    ]) {
      expect(closure, reached).toContain(reached);
    }
    const files = [
      ...new Set([
        ...sourcesUnder("src/generator/react"),
        ...[...closure].filter((f) => f.startsWith("src/generator/")),
      ]),
    ].sort();
    const sources = files.map((file) => ({
      file: relative(REPO_ROOT, join(REPO_ROOT, file)),
      text: readFileSync(join(REPO_ROOT, file), "utf8"),
    }));
    expect(violations(sources)).toEqual([]);
  });

  it("names each reach a seeded module makes", () => {
    const seeded = [
      {
        file: "seed.ts",
        text: [
          'import { enrichLoomModel } from "../../ir/enrich/enrichments.js";',
          'import type { EnrichedAggregateIR } from "../../ir/types/loom-ir.js";',
          'export { lowerModel } from "../../ir/lower/lower.js";',
          'import type { LoomDiagnostic } from "../../ir/validate/diagnostic.js";',
          "// an EnrichedBoundedContextIR named in a comment is prose",
          "const a: EnrichedAggregateIR | undefined = undefined;",
        ].join("\n"),
      },
    ];
    expect(violations(seeded)).toEqual([
      "seed.ts: names EnrichedAggregateIR",
      "seed.ts: value-imports ../../ir/enrich/enrichments.js",
      "seed.ts: value-imports ../../ir/lower/lower.js",
    ]);
  });
});

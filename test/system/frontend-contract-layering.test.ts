// D-FRONTEND-CONTRACT: each contract-built frontend generates from the
// Frontend Contract and its host alone.
//
// A contract-built frontend has one entry, `generate<Framework>FromContract(
// contract, host, options)` in `src/generator/<framework>/from-contract.ts`,
// that everything it emits goes through; the enriched-side
// `generate<Framework>ForContexts` in its `index.ts` only builds the host and
// the `--sourcemap` origin sidecar and hands over.  So no module under
// `src/generator/<framework>/`, and no generator module the entry reaches
// through its value imports (`_frontend/`, `_walker/`, `_packs/`, …), may:
//   - name an `Enriched*` IR type — the enriched model is not its input;
//   - value-import `src/ir/lower/`, `src/ir/enrich/` or `src/ir/validate/` —
//     the passes that build that model.
// The modules each entry reaches are computed from its value-import graph, so
// a new module it starts importing is checked the moment it is reached.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../_helpers/ddd-corpus.js";

/** Each contract-built frontend: its directory, and modules its entry must
 *  reach (or the scan proves nothing). */
const FRONTENDS: readonly { dir: string; reaches: readonly string[] }[] = [
  {
    dir: "src/generator/react",
    reaches: [
      "src/generator/react/pages-emitter.ts",
      "src/generator/_walker/walker-core.ts",
      "src/generator/_frontend/api-module.ts",
      "src/generator/_packs/loader.ts",
    ],
  },
  {
    dir: "src/generator/vue",
    reaches: [
      "src/generator/vue/walker/page-shell.ts",
      "src/generator/_walker/walker-core.ts",
      "src/generator/_frontend/api-module.ts",
      "src/generator/_packs/loader.ts",
    ],
  },
  {
    dir: "src/generator/svelte",
    reaches: [
      "src/generator/svelte/routes-emitter.ts",
      "src/generator/svelte/walker/page-shell.ts",
      "src/generator/svelte/api-builder.ts",
      "src/generator/_walker/walker-core.ts",
      "src/generator/_packs/loader.ts",
    ],
  },
  {
    dir: "src/generator/angular",
    reaches: [
      "src/generator/angular/walker/page-shell.ts",
      "src/generator/angular/walker/angular-target.ts",
      "src/generator/angular/components-emit.ts",
      "src/generator/angular/api-module.ts",
      "src/generator/angular/create-form.ts",
      "src/generator/_walker/walker-core.ts",
      "src/generator/_packs/loader.ts",
    ],
  },
  {
    dir: "src/generator/feliz",
    reaches: [
      "src/generator/feliz/feliz-target.ts",
      "src/generator/feliz/wire.ts",
      "src/generator/feliz/component-emit.ts",
      "src/generator/feliz/form-prefill.ts",
      "src/generator/feliz/i18n.ts",
      "src/generator/_walker/walker-core.ts",
      "src/generator/_walker/walker-model.ts",
    ],
  },
  {
    dir: "src/generator/flutter",
    reaches: [
      "src/generator/flutter/flutter-target.ts",
      "src/generator/flutter/dart-model-emit.ts",
      "src/generator/flutter/forms-emit.ts",
      "src/generator/flutter/reads-emit.ts",
      "src/generator/flutter/riverpod-emit.ts",
      "src/generator/flutter/component-emit.ts",
      "src/generator/flutter/i18n.ts",
      "src/generator/_walker/walker-core.ts",
      "src/generator/_walker/walker-model.ts",
    ],
  },
];

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

/** How the closure reads the module graph: a module's text, or `undefined`
 *  when no such module exists.  The repository on disk, or a seeded graph. */
type ModuleReader = (path: string) => string | undefined;

const repoReader: ModuleReader = (path) => {
  const abs = join(REPO_ROOT, path);
  return existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
};

function resolve(from: string, spec: string, read: ModuleReader): string | undefined {
  if (!spec.startsWith(".")) return undefined;
  const p = join(dirname(from), spec).replace(/\.js$/, ".ts");
  return read(p) !== undefined ? p : undefined;
}

/** Every module `entry` reaches through value imports, each mapped to the
 *  module that first imported it (breadth-first, so the chain to it is a
 *  shortest one; the entry maps to `undefined`). */
function valueClosure(
  entry: string,
  read: ModuleReader = repoReader,
): Map<string, string | undefined> {
  const parent = new Map<string, string | undefined>([[entry, undefined]]);
  const queue = [entry];
  for (let f = queue.shift(); f !== undefined; f = queue.shift()) {
    for (const spec of valueSpecifiers(read(f) ?? "")) {
      const p = resolve(f, spec, read);
      if (p !== undefined && !parent.has(p)) {
        parent.set(p, f);
        queue.push(p);
      }
    }
  }
  return parent;
}

const BUILD_PASS_MODULE = /^src\/ir\/(lower|enrich|validate)\//;

/** One reach of a build pass: the edge that enters it (the importing module,
 *  outside the passes, and the pass module it imports) and the chain from the
 *  entry to it. */
interface PassReach {
  edge: string;
  chain: string;
}

/** Every build-pass module the closure reaches, as the edge that enters the
 *  passes and the import chain from the entry. */
function passReaches(closure: ReadonlyMap<string, string | undefined>): PassReach[] {
  const out: PassReach[] = [];
  for (const [mod, from] of closure) {
    if (!BUILD_PASS_MODULE.test(mod) || from === undefined || BUILD_PASS_MODULE.test(from))
      continue;
    const chain: string[] = [];
    for (let c: string | undefined = mod; c !== undefined; c = closure.get(c)) chain.unshift(c);
    out.push({ edge: `${from} -> ${mod}`, chain: chain.join(" -> ") });
  }
  return out.sort((a, b) => a.edge.localeCompare(b.edge));
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

/** A known reach of a build pass, parked until the relay is cut. */
interface Waiver {
  deferred: string;
  reviewUntil: string;
}

/** The edges into the build passes the contract-built frontends still reach,
 *  each through a module that serves both the contract adapters and the
 *  enriched-model adapters beside them. */
const WAIVED_EDGES: Readonly<Record<string, Waiver>> = {
  "src/ir/plan/create-request.ts -> src/ir/enrich/wire-projection.ts": {
    deferred:
      "`createRequestFields` (what a create form sends) shares its module with `createRequestRequiredNames`, which reads `isRequiredCreateInput` off the wire projection; the frontend half moves to a module that does not",
    reviewUntil: "2026-11-30",
  },
  "src/ir/util/audit-history.ts -> src/ir/enrich/mask-taint.ts": {
    deferred:
      "the api module reads only the `AUDIT_HISTORY_FIND` name from a module that also derives the audit-history response's masks; the name moves to a leaf of its own",
    reviewUntil: "2026-11-30",
  },
  "src/ir/util/declared-response.ts -> src/ir/enrich/mask-taint.ts": {
    deferred:
      "the walker model's enriched adapter reads `contractResponsesFor` (which taints masked fields) beside the contract adapter; the enriched adapters leave the frontends' closure",
    reviewUntil: "2026-11-30",
  },
};

/** The longest a waiver may park its edge. */
const MAX_DEFERRAL_DAYS = 30;

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

describe("contract-built frontends read the Frontend Contract only", () => {
  it.each(
    FRONTENDS,
  )("no module of $dir, and no generator module its entry reaches, reads the enriched model", ({
    dir,
    reaches,
  }) => {
    const closure = valueClosure(`${dir}/from-contract.ts`);
    for (const r of reaches) expect([...closure.keys()], r).toContain(r);
    const files = [
      ...new Set([
        ...sourcesUnder(dir),
        ...[...closure.keys()].filter((f) => f.startsWith("src/generator/")),
      ]),
    ].sort();
    const sources = files.map((file) => ({
      file: relative(REPO_ROOT, join(REPO_ROOT, file)),
      text: readFileSync(join(REPO_ROOT, file), "utf8"),
    }));
    expect(violations(sources)).toEqual([]);
  });

  it.each(FRONTENDS)("the entry of $dir reaches no build pass, through any module", ({ dir }) => {
    const found = passReaches(valueClosure(`${dir}/from-contract.ts`));
    expect(found.filter((r) => !Object.hasOwn(WAIVED_EDGES, r.edge)).map((r) => r.chain)).toEqual(
      [],
    );
  });

  it("every waived edge is still reached and not past its review date", () => {
    const reached = new Set(
      FRONTENDS.flatMap(({ dir }) =>
        passReaches(valueClosure(`${dir}/from-contract.ts`)).map((r) => r.edge),
      ),
    );
    const today = new Date().toISOString().slice(0, 10);
    const cap = new Date(Date.now() + MAX_DEFERRAL_DAYS * 86_400_000).toISOString().slice(0, 10);
    const problems: string[] = [];
    for (const [edge, w] of Object.entries(WAIVED_EDGES)) {
      if (!reached.has(edge))
        problems.push(`${edge}: stale — no frontend reaches it; delete the waiver`);
      if (w.reviewUntil < today) problems.push(`${edge}: deferral expired on ${w.reviewUntil}`);
      if (w.reviewUntil > cap)
        problems.push(
          `${edge}: reviewUntil ${w.reviewUntil} is past the ${MAX_DEFERRAL_DAYS}-day cap`,
        );
    }
    expect(problems).toEqual([]);
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

  it("finds a build pass reached through a relay outside the generators", () => {
    // entry -> a generator helper -> a neutral-looking ir/util relay -> the
    // enrich pass; a type-only import of the validator is no reach.
    const graph: Record<string, string> = {
      "src/generator/x/from-contract.ts": 'import { h } from "../_frontend/helper.js";',
      "src/generator/_frontend/helper.ts": [
        'import { relay } from "../../ir/util/relay.js";',
        'import type { LoomDiagnostic } from "../../ir/validate/diagnostic.js";',
      ].join("\n"),
      "src/ir/util/relay.ts":
        'export { enrichLoomModel as relay } from "../enrich/enrichments.js";',
      "src/ir/enrich/enrichments.ts": 'import { lowerModel } from "../lower/lower.js";',
      "src/ir/lower/lower.ts": "export const lowerModel = 1;",
      "src/ir/validate/diagnostic.ts": "export type LoomDiagnostic = string;",
    };
    const found = passReaches(valueClosure("src/generator/x/from-contract.ts", (p) => graph[p]));
    expect(found).toEqual([
      {
        edge: "src/ir/util/relay.ts -> src/ir/enrich/enrichments.ts",
        chain:
          "src/generator/x/from-contract.ts -> src/generator/_frontend/helper.ts -> src/ir/util/relay.ts -> src/ir/enrich/enrichments.ts",
      },
    ]);
  });
});

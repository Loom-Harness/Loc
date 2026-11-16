// D-FRONTEND-CONTRACT — The per-aggregate api module and the Playwright page objects know an
// aggregate only through `FrontendAggregate`
// (`src/generator/_frontend/aggregate-model.ts`).
//
// Both render the client surface of one aggregate, and what they need about it
// is a fixed, narrow set of facts.  An emitter that reaches for the domain IR
// widens that set silently, and a target that builds its own model answers it
// its own way.  This census holds both shut:
//   - `api-module.ts` and `page-objects-builder.ts` name no bounded context,
//     enriched node or domain declaration type;
//   - each frontend builds the model with one adapter.  React and Vue build it
//     from the Frontend Contract (`contractAggregate` /
//     `frontendAggregatesOfContract`); Svelte, Angular and Feliz build it from
//     the enriched contexts (`frontendAggregateOf` / `frontendAggregatesOf`).

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

const repo = path.resolve(__dirname, "../..");

function tsFiles(dir: string): string[] {
  return fs.readdirSync(path.join(repo, dir), { withFileTypes: true }).flatMap((e) => {
    const p = path.posix.join(dir, e.name);
    if (e.isDirectory()) return tsFiles(p);
    return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [p] : [];
  });
}

function code(f: string): string {
  return (
    fs
      .readFileSync(path.join(repo, f), "utf8")
      // Line comments first: a line comment can hold `/*` (`/api/*`).
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
  );
}

const EMITTERS = [
  "src/generator/_frontend/api-module.ts",
  "src/generator/_frontend/page-objects-builder.ts",
];

/** What the emitters must not name: the domain IR the model replaces. */
const DOMAIN_READS =
  /\b(BoundedContextIR|Enriched\w+|AggregateIR|EntityPartIR|OperationIR|PayloadIR|ValueObjectIR|EnumIR|FieldIR)\b/g;

describe("frontend aggregate model census", () => {
  it("the api module and page objects read no domain IR", () => {
    const hits = EMITTERS.flatMap((f) =>
      [...new Set(code(f).match(DOMAIN_READS) ?? [])].map((m) => `${f}: ${m}`),
    );
    expect(hits).toEqual([]);
  });

  it("React and Vue build the model from the contract, every other frontend from the enriched IR", () => {
    const CONTRACT = ["react", "vue"];
    const ENRICHED = ["svelte", "angular", "feliz"];
    const calls = (f: string, fns: readonly string[]) =>
      fns.some((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(code(f)));
    const modes: Record<string, string[]> = {};
    for (const target of [...CONTRACT, ...ENRICHED]) {
      const files = tsFiles(`src/generator/${target}`);
      expectReach(`${target} files`, files.length, 5);
      const seen = new Set<string>();
      for (const f of files) {
        if (calls(f, ["contractAggregate", "frontendAggregatesOfContract"])) seen.add("contract");
        if (calls(f, ["frontendAggregateOf", "frontendAggregatesOf"])) seen.add("enriched");
      }
      modes[target] = [...seen].sort();
    }
    expect(modes).toEqual({
      react: ["contract"],
      vue: ["contract"],
      svelte: ["enriched"],
      angular: ["enriched"],
      feliz: ["enriched"],
    });
  });
});

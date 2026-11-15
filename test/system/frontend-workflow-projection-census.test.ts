// One source for the workflows and projections a client calls: the Frontend
// Contract's `wire.workflows` / `wire.projections`
// (`src/ir/contract/frontend-contract.ts`), read through `clientWorkflows` /
// `clientProjections` (`src/generator/_frontend/contract.ts`).
//
// Which workflows a client starts or observes, the body of a start, whether a
// start answers the created record's id, the instance row, which projections
// are readable, whether a read answers one row or a list, and the row fields
// are decided once, when the contract is built.  The workflows and projections
// api modules render those answers.  This census holds that none of them
// reaches back into the domain IR for one of those facts.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repo = path.resolve(__dirname, "../..");

/** Every emitter of a frontend's workflows or projections api module. */
const API_MODULES = [
  "src/generator/_frontend/workflows-module.ts",
  "src/generator/_frontend/projections-module.ts",
  "src/generator/svelte/workflow-builder.ts",
  "src/generator/angular/workflows-module.ts",
  "src/generator/angular/projections-module.ts",
];

/** The domain-IR reads the contract decides. */
const CONTRACT_DECIDED = [
  "instanceWireShape",
  "emitsCommandRoute",
  "workflowResultSegment",
  "commandCreateResult",
  "projectionReadShape",
  "isFrontendReadableProjection",
  "wireShape",
];

/** Gates the contract replaced; a frontend that brings one back re-derives. */
const RETIRED = ["readableProjections", "hasAnyWorkflow", "workflowHasApiSurface"];

function code(f: string): string {
  return fs
    .readFileSync(path.join(repo, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

function tsFiles(dir: string): string[] {
  return fs.readdirSync(path.join(repo, dir), { withFileTypes: true }).flatMap((e) => {
    const p = path.posix.join(dir, e.name);
    if (e.isDirectory()) return tsFiles(p);
    return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [p] : [];
  });
}

const naming = (files: readonly string[], symbols: readonly string[]): string[] =>
  files.flatMap((f) => {
    const c = code(f);
    return symbols.filter((s) => new RegExp(`\\b${s}\\b`).test(c)).map((s) => `${f}: ${s}`);
  });

describe("frontend workflow / projection census", () => {
  it("the api modules read workflows and projections off the contract", () => {
    for (const f of API_MODULES) expect(fs.existsSync(path.join(repo, f)), f).toBe(true);
    expect(naming(API_MODULES, CONTRACT_DECIDED)).toEqual([]);
  });

  it("no frontend brings back a retired re-derivation", () => {
    const dirs = ["_walker", "_frontend", "react", "vue", "svelte", "angular", "feliz", "flutter"];
    const files = dirs.flatMap((d) => tsFiles(`src/generator/${d}`));
    expect(files.length).toBeGreaterThan(200);
    expect(naming(files, RETIRED)).toEqual([]);
  });
});

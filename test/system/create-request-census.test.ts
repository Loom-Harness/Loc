// One source for what a create request is (`src/ir/plan/create-request.ts`).
//
// Every create form, create request schema, page object and i18n chrome entry
// a frontend emits reads the create request through `createRequestFields`: the
// declared `Create<Agg>Command` / `<Verb><Agg>Command` record.  Reading the
// derived create input beside it gave one app two answers — an event-sourced
// aggregate's form asked for folded state its create command does not take,
// and the React page failed `tsc` against its own schema.
//
// This census holds three things:
//   - no frontend emitter imports the derived `createInputFields`;
//   - `declaredCreateCommandFor` has one caller, the plan, so there is no
//     second record reader;
//   - `undeclaredCreateRequestFields` (the aggregate whose context declares no
//     create record) is reached only through the plan and the api module, and
//     no served aggregate of a shipped model reaches it: the scaffold splices
//     a create record for every concrete aggregate.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { createRequestRecord } from "../../src/ir/plan/create-request.js";
import { emitsRestCreate } from "../../src/ir/util/canonical-lifecycle.js";
import { expectReach } from "../_helpers/census-reach.js";
import { dddSourceOf, trackedDddFiles } from "../_helpers/ddd-corpus.js";
import { fenceProblem } from "../_helpers/live-fences.js";
import { parseString } from "../_helpers/parse.js";

const repo = path.resolve(__dirname, "../..");
const src = path.join(repo, "src");

function tsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return tsFiles(p);
    return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [p] : [];
  });
}

const rel = (p: string) => path.relative(repo, p).split(path.sep).join("/");

/** The emitters that render a frontend's create form, request schema, page
 *  object or chrome: the shared walker and frontend layers, each frontend, and
 *  the LiveView side of the Elixir target. */
function frontendEmitters(): string[] {
  const dirs = ["_walker", "_frontend", "react", "vue", "svelte", "angular", "feliz", "flutter"];
  const files = dirs.flatMap((d) => tsFiles(path.join(src, "generator", d)));
  const elixir = tsFiles(path.join(src, "generator", "elixir")).filter((f) =>
    /\/heex[^/]*\.ts$|\/page-objects-emit\.ts$/.test(f),
  );
  return [...files, ...elixir].map(rel);
}

/** The files whose code (comments stripped) names `symbol`. */
function filesNaming(symbol: string, files: readonly string[]): string[] {
  const word = new RegExp(`\\b${symbol}\\b`);
  return files.filter((f) => {
    const code = fs
      .readFileSync(path.join(repo, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    return word.test(code);
  });
}

/** The derived create-request fallback (`undeclaredCreateRequestFields`) and
 *  the files that still read it.  No served create reaches it (the last test
 *  holds that at zero); what does is a create request schema the Elixir
 *  OpenAPI emitter and the Svelte api module emit for an aggregate that serves
 *  no create.  Deferred, not standing: once both gate that schema on a served
 *  create, the fallback and this waiver go. */
const UNDECLARED_FALLBACK = {
  readers: ["src/generator/_frontend/api-module.ts", "src/ir/plan/create-request.ts"],
  deferred: "dead create request schemas for aggregates with no create route still read it",
  reviewUntil: "2026-12-15",
  blockedBy: "#5951",
};

describe("create request census", () => {
  it("no frontend emitter reads the derived create input", () => {
    const files = frontendEmitters();
    expectReach("frontend emitter files", files.length, 220);
    expect(filesNaming("createInputFields", files)).toEqual([]);
  });

  it("the declared create record has one reader, the plan", () => {
    const all = tsFiles(src).map(rel);
    expect(filesNaming("declaredCreateCommandFor", all)).toEqual([
      "src/ir/plan/create-request.ts",
      "src/ir/util/declared-request.ts",
    ]);
    expect(filesNaming("undeclaredCreateRequestFields", all)).toEqual(UNDECLARED_FALLBACK.readers);
  });

  it("the derived create-request fallback is a live, unexpired deferral", () => {
    expect(fenceProblem(UNDECLARED_FALLBACK.blockedBy)).toBe("");
    const until = Date.parse(`${UNDECLARED_FALLBACK.reviewUntil}T00:00:00Z`);
    const now = Date.now();
    expect(until, "the deferral expired: settle it or re-justify it").toBeGreaterThan(now);
    expect(until - now, "a deferral parks at most 60 days out").toBeLessThanOrEqual(
      60 * 86_400_000,
    );
  });

  it("every served creatable aggregate has a declared create record", async () => {
    const undeclared: string[] = [];
    let served = 0;
    for (const file of trackedDddFiles().filter(
      (f) =>
        (f.startsWith("test/fixtures/corpus/") ||
          f.startsWith("examples/") ||
          f.startsWith("web/src/examples/")) &&
        f.endsWith(".ddd"),
    )) {
      const { model, errors } = await parseString(dddSourceOf(file), { validate: true });
      if (errors.length > 0) continue;
      const loom = enrichLoomModel(lowerModel(model));
      for (const sys of loom.systems) {
        for (const sd of sys.subdomains) {
          for (const ctx of sd.contexts) {
            for (const agg of ctx.aggregates) {
              if (!emitsRestCreate(agg)) continue;
              if (!ctx.repositories.some((r) => r.aggregateName === agg.name)) continue;
              served++;
              if (!createRequestRecord(ctx.payloads, agg))
                undeclared.push(`${file}: ${ctx.name}.${agg.name}`);
            }
          }
        }
      }
    }
    expectReach("served creatable aggregates", served, 400);
    expect(undeclared).toEqual([]);
  }, 300_000);
});

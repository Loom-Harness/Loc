// The page-body walker knows the domain only through `WalkerModel`
// (`src/generator/_walker/walker-model.ts`).
//
// The walker renders page bodies for six frontends and LiveView.  What it
// needs about the bounded contexts a ui reaches is a fixed, narrow set of facts
// — a form's type scope, a repository find, the readable projections, a create
// request, an error record, a model-text owner — and `WalkerModel` is that
// set.  A walker file that reaches for a bounded context directly widens it
// silently, and a target that builds its own model answers those facts its own
// way.  This census holds both shut:
//   - no file under `_walker/` other than `walker-model.ts` names a bounded
//     context type or the per-aggregate / per-workflow context maps;
//   - `walkerModelOf` is the one adapter: no other source file builds a
//     `WalkerModel` literal.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

const repo = path.resolve(__dirname, "../..");
const ADAPTER = "src/generator/_walker/walker-model.ts";

function tsFiles(dir: string): string[] {
  return fs.readdirSync(path.join(repo, dir), { withFileTypes: true }).flatMap((e) => {
    const p = path.posix.join(dir, e.name);
    if (e.isDirectory()) return tsFiles(p);
    return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [p] : [];
  });
}

function code(f: string): string {
  return fs
    .readFileSync(path.join(repo, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/** What a walker file must not name: a bounded context, enriched or not, and
 *  the context maps the model replaces. */
const CONTEXT_READS = /\b(BoundedContextIR|Enriched\w+|bcByAggregate|bcByWorkflow)\b/g;

describe("walker model census", () => {
  it("no walker file outside the adapter reads a bounded context", () => {
    const files = tsFiles("src/generator/_walker").filter((f) => f !== ADAPTER);
    expectReach("walker files", files.length, 40);
    const hits = files.flatMap((f) =>
      [...new Set(code(f).match(CONTEXT_READS) ?? [])].map((m) => `${f}: ${m}`),
    );
    expect(hits).toEqual([]);
  });

  it("walkerModelOf is the one WalkerModel adapter", () => {
    // Every model member is a required property; a second adapter has to
    // spell this one.
    const files = tsFiles("src").filter((f) => f !== ADAPTER);
    expectReach("source files", files.length, 1000);
    const builders = files.filter((f) => /\bhomeOfAggregate\s*:/.test(code(f)));
    expect(builders).toEqual([]);
    expect(/\bhomeOfAggregate\s*:/.test(code(ADAPTER))).toBe(true);
  });
});

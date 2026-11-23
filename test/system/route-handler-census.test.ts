// The handler a `route` reaches has one answer: `routeHandler` /
// `routeHandlerName` (`src/ir/plan/route-handler.ts`), which asks
// `handlerFor` for a sent record and reads the named handler of a `->` route.
// A route stores no resolved handler, so a reader that reads the binding's
// handler name itself would answer `->` routes and miss every `send` route,
// and two readers could reach different handlers for one route.
//
// This census holds: no `src/` file but the plan reads a route binding's
// handler name, whether by member access (`binding.handler`) or by
// destructuring the binding.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

const repo = path.resolve(__dirname, "../..");
const SANCTIONED = new Set(["src/ir/plan/route-handler.ts"]);

function tsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "generated" ? [] : tsFiles(p);
    return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [p] : [];
  });
}

const rel = (p: string) => path.relative(repo, p).split(path.sep).join("/");

/** Reading a binding's handler name: `x.binding.handler`, destructuring
 *  `const { …handler… } = x.binding`, or through an alias
 *  (`const b = x.binding; … b.handler`). */
function readsBindingHandler(code: string): boolean {
  if (/\bbinding\.handler\b/.test(code)) return true;
  if (/\{[^}]*\bhandler\b[^}]*\}\s*=\s*[\w.]*\bbinding\b/.test(code)) return true;
  for (const m of code.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*[\w.]*\bbinding\s*;/g)) {
    if (new RegExp(`\\b${m[1]}\\.handler\\b`).test(code)) return true;
  }
  return false;
}

describe("route handler census", () => {
  it("only the plan reads the handler a route's binding names", () => {
    const files = tsFiles(path.join(repo, "src")).map(rel);
    expectReach("src files", files.length, 1400);
    const offenders = files.filter((f) => {
      if (SANCTIONED.has(f)) return false;
      const code = fs
        .readFileSync(path.join(repo, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      return readsBindingHandler(code);
    });
    expect(offenders).toEqual([]);
    // The plan is where the answer lives, and the rule does see its read.
    const plan = fs.readFileSync(path.join(repo, "src/ir/plan/route-handler.ts"), "utf8");
    expect(readsBindingHandler(plan)).toBe(true);
  });
});

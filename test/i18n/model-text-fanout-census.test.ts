// Census of the targets that still render `label(…)` / `plural(…)` model text
// as its English default rather than through their translation runtime
// (i18n identity keys, #4448).
//
// React is the reference: it routes model text — explicit and implicit (form
// labels, enum options, submit buttons) — through `t(<identity key>, …)`.  A
// target that has not caught up carries a `model-text-fanout(<target>)` marker
// at each English-default stand-in; this list pins them, so a target's port
// deletes its rows here in the same change that deletes its markers, and a NEW
// stand-in cannot land unnoticed.  The four JSX/markup frontends that do not
// set `WalkerTarget.modelTextImplicitSites` are tracked by that flag instead.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const MARKER = /model-text-fanout\((\w+)\)/g;

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return filesUnder(p);
    return p.endsWith(".ts") ? [p] : [];
  });
}

const PINNED: readonly string[] = ["src/generator/feliz/fs-expr.ts feliz"];

describe("model-text fan-out census", () => {
  it("pins every English-default stand-in for model text", () => {
    const found: string[] = [];
    for (const file of filesUnder(join(ROOT, "src"))) {
      for (const m of readFileSync(file, "utf8").matchAll(MARKER)) {
        found.push(`${relative(ROOT, file)} ${m[1]}`);
      }
    }
    expect(found.sort()).toEqual([...PINNED]);
  });
});

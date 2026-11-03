// Census of the targets that still render `label(…)` / `plural(…)` model text
// as its English default rather than through their translation runtime
// (i18n identity keys, #4448).
//
// React is the reference: it routes model text — explicit and implicit (form
// labels, enum options, submit buttons) — through `t(<identity key>, …)`.  A
// target that has not caught up carries a `model-text-fanout(<target>)` marker
// at each English-default stand-in; this list pins them, so a target's port
// deletes its rows here in the same change that deletes its markers, and a NEW
// stand-in cannot land unnoticed.  The frontends whose packs read the
// implicit-site tokens set `WalkerTarget.modelTextImplicitSites` instead (checked
// against the catalog gate below).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { angularTarget } from "../../src/generator/angular/walker/angular-target.js";
import { felizTarget } from "../../src/generator/feliz/feliz-target.js";
import { flutterTarget } from "../../src/generator/flutter/flutter-target.js";
import { tsxTarget } from "../../src/generator/react/walker/tsx-target.js";
import { svelteTarget } from "../../src/generator/svelte/walker/svelte-target.js";
import { vueTarget } from "../../src/generator/vue/walker/vue-target.js";
import { IMPLICIT_MODEL_TEXT_FORMATS } from "../../src/system/i18n-catalog.js";

const ROOT = join(__dirname, "..", "..");
const MARKER = /model-text-fanout\((\w+)\)/g;

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return filesUnder(p);
    return p.endsWith(".ts") ? [p] : [];
  });
}

// Every target routes model text through its translation runtime; a new
// English-default stand-in must add its row here (and a reason).
const PINNED: readonly string[] = [];

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

describe("implicit model-text gate", () => {
  it("lists in the catalog exactly the frontend formats whose target sets the flag", () => {
    const flagged: Record<string, boolean> = {
      tsx: tsxTarget.modelTextImplicitSites === true,
      vue: vueTarget.modelTextImplicitSites === true,
      svelte: svelteTarget.modelTextImplicitSites === true,
      angular: angularTarget.modelTextImplicitSites === true,
      feliz: felizTarget.modelTextImplicitSites === true,
      flutter: flutterTarget.modelTextImplicitSites === true,
      // HEEx runs its own walker, not `walkBody`: its implicit sites key
      // through `heex-model-text.ts` whenever the UI is i18n-enabled.
      heex: true,
    };
    const listed = Object.fromEntries(
      Object.keys(flagged).map((f) => [f, IMPLICIT_MODEL_TEXT_FORMATS.has(f)]),
    );
    expect(listed).toEqual(flagged);
    expect([...IMPLICIT_MODEL_TEXT_FORMATS].sort()).toEqual(Object.keys(flagged).sort());
  });
});

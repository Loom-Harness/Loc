// Census: a frontend's form code renders the shared form model, it does not
// re-classify the field's type.
//
// `src/generator/_frontend/form-spec.ts` decides, once, every scaffolded form
// field's kind (scalar / money / date / enum / reference / value object /
// collection), its absence (required / null / empty array), its enum values,
// its picker and its value-object children.  A frontend that re-reads the
// `TypeIR` to decide the same things drifts from the other frontends the next
// time the classifier changes — the defect class the shared model exists to
// close.
//
// Every source file under `src/generator/` that imports the form model is
// scanned for the shapes of a type classification: a `.kind` comparison or a
// `case` over a `TypeIR`-only kind, a primitive-name comparison, and an
// `optional === true` read.  Feliz and Flutter carry none and may carry none.
// Other files are ratcheted at their current count (`CEILINGS`): a new site
// fails, and a removed one fails until its ceiling is lowered.
//
// A field's starting value is decided once too: `FormFieldSpec.zero` (the value
// an untouched field submits — `""`, `0`, `"0"`, `false`, an enum's first
// value).  A form file that picks an enum's first member itself
// (`enumValues[0]`, `.values[0]`) re-derives it; only the JS frontends'
// `initialValueTs` still does, ratcheted in `ZERO_CEILINGS`, and the Feliz,
// Flutter and Angular form code must read the zero.
//
// What this asserts is the ABSENCE of a classification in emitter source,
// which no compile or booted tier observes; the forms' booted behaviour runs
// in the behavioural UI legs over `test/behavioral/form-spec-ui.ddd`.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** `TypeIR` kinds no form-model or widget kind shares (so `"enum"` is left out:
 *  it is a `FormFieldKind` and a widget kind too). */
const TYPE_ONLY_KINDS = "optional|array|primitive|id|valueobject|entity|genericInstance|union";
const PRIMITIVE_NAMES = "money|date|datetime|File|int|long|decimal|bool|string";

const CLASSIFICATION = new RegExp(
  [
    `\\.kind (?:===|!==) "(?:${TYPE_ONLY_KINDS})"`,
    `case "(?:${TYPE_ONLY_KINDS})":`,
    `\\.name (?:===|!==) "(?:${PRIMITIVE_NAMES})"`,
    `\\.optional === true`,
  ].join("|"),
  "g",
);

/** Files allowed some classification sites, each at exactly its count.  Every
 *  entry is tracked work: the JS frontends' remaining sites are #5601. */
const CEILINGS: Record<string, number> = {
  "src/generator/_frontend/form-helpers.ts": 25,
  // The request-schema emitters read the model only for `typeBlankBlocks`;
  // their sites are the wire type dispatch of a zod schema.
  "src/generator/_frontend/workflows-module.ts": 11,
  "src/generator/_frontend/zod-schemas.ts": 7,
  "src/generator/_walker/primitives/forms.ts": 3,
  "src/generator/angular/form-fields.ts": 52,
  "src/generator/svelte/walker/page-shell.ts": 15,
  "src/generator/vue/walker/page-shell.ts": 17,
};

/** An enum's first member picked by hand — the start value `zero` carries. */
const ZERO_REDERIVATION = /enumValues(?:\?\.)?\[0\]|\.values(?:\?\.)?\[0\]/g;

/** Files allowed some hand-picked start values, each at exactly its count. */
const ZERO_CEILINGS: Record<string, number> = {
  "src/generator/_frontend/form-helpers.ts": 1,
};

/** The form files that build initial values and must read the field's zero. */
const ZERO_READERS = [
  "src/generator/angular/form-fields.ts",
  "src/generator/feliz/form-fields.ts",
  "src/generator/flutter/forms-emit.ts",
];

/** Frontends whose form code is fully on the shared model: no ceiling. */
const CLEAN_FRONTENDS = ["src/generator/feliz/", "src/generator/flutter/"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return p.endsWith(".ts") ? [p] : [];
  });
}

/** Every generator source that imports the form model (the model itself aside). */
function formFiles(): string[] {
  return sourceFiles("src/generator")
    .filter((p) => p !== "src/generator/_frontend/form-spec.ts")
    .filter((p) => /from "[./]*(?:_frontend\/)?form-spec\.js"/.test(readFileSync(p, "utf8")))
    .sort();
}

function sites(path: string): number {
  return readFileSync(path, "utf8").match(CLASSIFICATION)?.length ?? 0;
}

describe("form-spec re-derivation census", () => {
  it("Feliz and Flutter form code reads the form model, never the field's type", () => {
    const files = formFiles().filter((p) => CLEAN_FRONTENDS.some((d) => p.startsWith(d)));
    // The scan must reach both frontends' form code, or it proves nothing.
    expect(files).toEqual(
      expect.arrayContaining([
        "src/generator/feliz/form-fields.ts",
        "src/generator/flutter/forms-emit.ts",
      ]),
    );
    for (const p of files) expect(sites(p), p).toBe(0);
    for (const p of Object.keys(CEILINGS)) {
      expect(
        CLEAN_FRONTENDS.some((d) => p.startsWith(d)),
        `${p} may not carry a ceiling`,
      ).toBe(false);
    }
  });

  it("every other form file sits exactly at its ceiling", () => {
    const actual: Record<string, number> = {};
    for (const p of formFiles()) {
      const n = sites(p);
      if (n > 0 || p in CEILINGS) actual[p] = n;
    }
    expect(actual).toEqual(CEILINGS);
  });

  it("a field's starting value is its zero, never a hand-picked enum member", () => {
    const actual: Record<string, number> = {};
    for (const p of formFiles()) {
      const n = readFileSync(p, "utf8").match(ZERO_REDERIVATION)?.length ?? 0;
      if (n > 0 || p in ZERO_CEILINGS) actual[p] = n;
    }
    expect(actual).toEqual(ZERO_CEILINGS);
    for (const p of ZERO_READERS) {
      expect(formFiles(), p).toContain(p);
      expect(readFileSync(p, "utf8"), p).toMatch(/formZeroText\(|\.zero\b/);
    }
  });
});

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
// Which blank inputs hold the submit is decided once too: `formBlankBlocks` (a
// required file or reference), rendered per target as a request schema that
// refuses the blank (`typeBlankBlocks`), a submit guard or a picker validator.
// Every target's form code must call it, and none may decide it from a kind
// and an optionality of its own (`kind === "ref" && !optional`), spell its own
// `Validators.required`, or emit the uuid pattern a blank fails outside the
// decision.
//
// Whether a field's invariant rules judge its blank input is decided once too:
// `formRulesSkipBlank` (only an optional field's blank, which is absent, is
// skipped).  The Angular, Feliz and Flutter rule emitters must read it, and
// every skip-blank guard they spell — a blank short-circuit, or an Angular
// built-in that skips an empty control — must sit behind that decision's
// `skipsBlank ?` / `rulesSkipBlank ?` choice.
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
  "src/generator/angular/form-fields.ts": 46,
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

/** A blank-block decided locally: a reference / file kind tested together with
 *  an optionality. */
const BLANK_BLOCK_REDERIVATION =
  /\.kind\s*===\s*"(?:ref|file)"\s*&&[^;\n]*(?:optional|required|absence)|(?:optional|required|absence)[^;\n]*&&\s*[\w.]+\.kind\s*===\s*"(?:ref|file)"/g;

/** Each target's renderer of the blank-block decision, and the call it makes. */
const BLANK_BLOCK_READERS: Record<string, RegExp> = {
  "src/generator/_frontend/zod-schemas.ts": /typeBlankBlocks\(/,
  "src/generator/_frontend/workflows-module.ts": /typeBlankBlocks\(/,
  "src/generator/angular/form-fields.ts": /formBlankBlocks\(/,
  "src/generator/feliz/form-fields.ts": /formBlankBlocks\(/,
  "src/generator/flutter/forms-emit.ts": /formBlankBlocks\(/,
};

/** The form files that must read the rules-skip-blank decision. */
const SKIP_BLANK_READERS = [
  "src/generator/angular/form-fields.ts",
  "src/generator/feliz/form-fields.ts",
  "src/generator/flutter/forms-emit.ts",
];

/** Each rule emitter's skip-blank guard spellings. */
const SKIP_BLANK_GUARDS: Record<string, readonly string[]> = {
  "src/generator/angular/form-validators.ts": [
    'c.value == null || c.value === ""',
    "Validators.min(",
    "Validators.max(",
    "Validators.pattern(",
  ],
  "src/generator/feliz/form-validators.ts": ["not (System.String.IsNullOrEmpty "],
  "src/generator/flutter/forms-emit.ts": ["if (s.isEmpty) { return null; }"],
};

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
    const unread = ZERO_READERS.filter(
      (p) => !formFiles().includes(p) || !/formZeroText\(|\.zero\b/.test(readFileSync(p, "utf8")),
    );
    expect(unread, "form files that must read the field's zero").toEqual([]);
  });

  it("a blank input holds the submit only through formBlankBlocks", () => {
    const files = formFiles();
    const unread = Object.entries(BLANK_BLOCK_READERS)
      .filter(([p, call]) => !files.includes(p) || !call.test(readFileSync(p, "utf8")))
      .map(([p]) => p);
    expect(unread, "renderers that must call formBlankBlocks / typeBlankBlocks").toEqual([]);
    for (const p of files) {
      const src = readFileSync(p, "utf8");
      expect(src.match(BLANK_BLOCK_REDERIVATION) ?? [], p).toEqual([]);
      // Angular's emptiness validator is spelled once, behind the decision.
      const required = src.match(/"Validators\.required"/g)?.length ?? 0;
      expect(required, p).toBe(p === "src/generator/angular/form-fields.ts" ? 1 : 0);
      // The uuid pattern (which a blank fails) only behind the decision.
      const ungated = src
        .split("\n")
        .filter((l) => l.includes("${UUID_WIRE_REGEX_LITERAL}") && !l.includes("typeBlankBlocks("));
      expect(ungated, p).toEqual([]);
    }
  });

  it("a rule skips a blank input only through formRulesSkipBlank", () => {
    const unread = SKIP_BLANK_READERS.filter(
      (p) => !/formRulesSkipBlank\(/.test(readFileSync(p, "utf8")),
    );
    expect(unread, "form files that must read formRulesSkipBlank").toEqual([]);
    for (const [p, guards] of Object.entries(SKIP_BLANK_GUARDS)) {
      const src = readFileSync(p, "utf8");
      for (const guard of guards) {
        const all = src.split(guard).length - 1;
        const gated =
          src.match(new RegExp(`[sS]kips?Blank\\s*\\?\\s*[\\s\\S]{0,12}${escapeRe(guard)}`, "g"))
            ?.length ?? 0;
        expect(all, `${p}: ${guard} is never spelled`).toBeGreaterThan(0);
        expect(gated, `${p}: every ${JSON.stringify(guard)} sits behind skipsBlank ?`).toBe(all);
      }
    }
  });
});

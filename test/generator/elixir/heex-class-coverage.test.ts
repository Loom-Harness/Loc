// ---------------------------------------------------------------------------
// HEEx class coverage census.
//
// The HEEx walker and the packs' function components write class names into
// the emitted `.ex` sources.  A name that is neither a Tailwind utility nor
// defined by the pack's CSS styles nothing, and the page degrades silently:
// the compiler is happy, the route answers 200, and the breadcrumb `<ol>`
// stacks vertically.  This census closes that for both HEEx packs: every
// static class token the heex-showcase fixture emits must be
//
//   (a) a Tailwind utility (classifier below),
//   (b) defined as `.token` in the pack's emitted CSS
//       (`assets/css/app.css`, `priv/static/assets/theme.css`),
//   (c) for daisyui, a daisyUI component / theme-colour class, or
//   (d) a deliberate marker that carries no style (`MARKERS`).
//
// This is an absence / wiring claim — "no emitted class is left without a
// definition" — that no booted tier observes cheaply (a missing rule is a
// layout difference, not an error).  The one behaviour that matters most,
// breadcrumbs on a single row, is asserted on the rendered page in
// test/behavioral/heex-ui-roundtrip.pw.ts.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { repoRoot } from "../../_helpers/examples.js";
import { generateSystemFiles } from "../../_helpers/generate.js";

const FIXTURE = path.join(repoRoot, "test/fixtures/heex-showcase.ddd");
const PACKS = ["coreComponents", "daisyui"] as const;
type Pack = (typeof PACKS)[number];

/** Emitted classes that deliberately carry no style, with the reason. */
const MARKERS: Record<string, string> = {};

/** daisyUI 4 component classes the daisyui pack's markup relies on, named by
 *  the daisyUI component that defines them. */
const DAISYUI_COMPONENTS = new Set([
  "alert", // alert
  "alert-error",
  "alert-info",
  "alert-warning",
  "badge", // badge
  "badge-ghost",
  "btn", // button
  "btn-outline",
  "btn-xs",
  "card", // card
  "card-bordered",
  "card-body",
  "card-title",
  "checkbox", // checkbox
  "hover", // table row hover
  "input", // text input
  "input-bordered",
  "label-text", // form-control label
  "select", // select
  "select-bordered",
  "skeleton", // skeleton
  "stat", // stat
  "stat-value",
  "tab", // tabs
  "tab-active",
  "tabs",
  "table", // table
  "table-zebra",
  "textarea", // textarea
  "textarea-bordered",
]);

/** daisyUI theme colours extend Tailwind's colour utilities (`bg-base-100`). */
const DAISYUI_THEME_COLOUR =
  /^(bg|text|border|ring|divide|fill|stroke|outline)-(base-(100|200|300|content)|primary|secondary|accent|neutral|info|success|warning|error)(-content)?$/;

const UTILITY_EXACT = new Set([
  "absolute",
  "antialiased",
  "block",
  "border",
  "container",
  "contents",
  "fixed",
  "flex",
  "grid",
  "hidden",
  "inline",
  "inline-block",
  "inline-flex",
  "inline-grid",
  "relative",
  "rounded",
  "shadow",
  "sr-only",
  "not-sr-only",
  "static",
  "sticky",
  "table",
  "transition",
  "truncate",
  "underline",
  "uppercase",
  "lowercase",
  "capitalize",
  "italic",
  "ring",
  "resize",
  "visible",
  "invisible",
  "grow",
  "shrink",
]);

const UTILITY_PREFIXES = [
  "animate",
  "aspect",
  "basis",
  "bg",
  "border",
  "bottom",
  "col",
  "content",
  "cursor",
  "decoration",
  "divide",
  "fill",
  "flex",
  "font",
  "gap",
  "grid",
  "grow",
  "h",
  "inset",
  "items",
  "justify",
  "leading",
  "left",
  "list",
  "m",
  "max",
  "mb",
  "min",
  "ml",
  "mr",
  "mt",
  "mx",
  "my",
  "object",
  "opacity",
  "order",
  "outline",
  "overflow",
  "p",
  "pb",
  "pl",
  "pr",
  "pt",
  "px",
  "py",
  "place",
  "pointer-events",
  "right",
  "ring",
  "rounded",
  "row",
  "select",
  "self",
  "shadow",
  "shrink",
  "size",
  "space",
  "stroke",
  "text",
  "top",
  "tracking",
  "transition",
  "translate",
  "w",
  "whitespace",
  "z",
];

/** Strip variants (`hover:`, `md:`, `focus:`, `phx-click-loading:`), the
 *  important marker and a leading negation, then the `/opacity` suffix. */
function utilityCore(token: string): string {
  let t = token;
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "[") depth++;
    else if (c === "]") depth--;
    else if (c === ":" && depth === 0) cut = i + 1;
  }
  t = t.slice(cut).replace(/^[!-]+/, "");
  if (!t.startsWith("[")) t = t.replace(/\/[\w.[\]%-]+$/, "");
  return t;
}

function isTailwindUtility(token: string): boolean {
  const core = utilityCore(token);
  // Arbitrary property (`[scrollbar-gutter:stable]`).
  if (/^\[[^\]]+:[^\]]+\]$/.test(core)) return true;
  if (UTILITY_EXACT.has(core)) return true;
  const prefix = UTILITY_PREFIXES.find((p) => core.startsWith(`${p}-`));
  return prefix !== undefined;
}

/** Every static class token in the emitted web sources: `class="…"`
 *  attributes (the `{…}` dynamic parts dropped) and the string literals of a
 *  `class={[…]}` expression. */
function emittedClassTokens(files: Map<string, string>): Map<string, string> {
  const seen = new Map<string, string>();
  const add = (list: string, file: string) => {
    // The class-token alphabet; Elixir operators between two literals are not tokens.
    for (const tok of list.split(/\s+/))
      if (/^[\w:/.[\]!%-]+$/.test(tok) && !seen.has(tok)) seen.set(tok, file);
  };
  for (const [file, text] of files) {
    if (!/\/lib\/[^/]+_web\/.*\.ex$/.test(file) && !/\/lib\/[^/]+_web\.ex$/.test(file)) continue;
    for (const m of text.matchAll(/\bclass="([^"]*)"/g))
      add(m[1]!.replace(/\{[^}]*\}/g, " "), file);
    // A string compared with `==` / `!=` is a value, not a class list.
    for (const m of text.matchAll(/\bclass=\{([^}]*)\}/g))
      for (const s of m[1]!.replace(/[=!]=\s*"[^"]*"/g, " ").matchAll(/"([^"]*)"/g))
        add(s[1]!, file);
  }
  return seen;
}

function cssDefinedClasses(files: Map<string, string>): Set<string> {
  const defined = new Set<string>();
  for (const [file, text] of files) {
    if (!/\/(assets\/css\/app|priv\/static\/assets\/theme)\.css$/.test(file)) continue;
    const bare = text.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of bare.matchAll(/\.([A-Za-z_][\w-]*)/g)) defined.add(m[1]!);
  }
  return defined;
}

describe("HEEx class coverage", () => {
  const generated = new Map<Pack, Map<string, string>>();

  beforeAll(async () => {
    const source = fs.readFileSync(FIXTURE, "utf8");
    for (const pack of PACKS) {
      const withDesign = source.replace(
        "platform: elixir\n",
        `platform: elixir\n    design: ${pack}\n`,
      );
      expect(withDesign, "fixture has a `platform: elixir` deployable to carry `design:`").not.toBe(
        source,
      );
      generated.set(pack, await generateSystemFiles(withDesign));
    }
  }, 180_000);

  for (const pack of PACKS) {
    it(`${pack}: every emitted class is a utility, defined by the pack CSS, or a marker`, () => {
      const files = generated.get(pack)!;
      const tokens = emittedClassTokens(files);
      expect(tokens.size, "the census reads emitted classes").toBeGreaterThan(50);
      const css = cssDefinedClasses(files);
      expect(css.has("phx-loading"), "the pack CSS is read").toBe(true);

      const unstyled: string[] = [];
      for (const [tok, file] of tokens) {
        if (isTailwindUtility(tok)) continue;
        if (css.has(tok)) continue;
        if (
          pack === "daisyui" &&
          (DAISYUI_COMPONENTS.has(tok) || DAISYUI_THEME_COLOUR.test(utilityCore(tok)))
        )
          continue;
        if (tok in MARKERS) continue;
        unstyled.push(`${tok}  (first emitted in ${file})`);
      }
      expect(
        unstyled,
        `emitted classes with no Tailwind utility, no pack CSS rule${pack === "daisyui" ? ", no daisyUI component" : ""} and no MARKERS entry:\n${unstyled.join("\n")}`,
      ).toEqual([]);
    });

    it(`${pack}: MARKERS only names classes that are still emitted and still unstyled`, () => {
      const files = generated.get(pack)!;
      const tokens = emittedClassTokens(files);
      const css = cssDefinedClasses(files);
      for (const marker of Object.keys(MARKERS)) {
        expect(tokens.has(marker), `marker \`${marker}\` is no longer emitted`).toBe(true);
        expect(css.has(marker), `marker \`${marker}\` is now styled; drop it from MARKERS`).toBe(
          false,
        );
      }
    });
  }

  it("the daisyUI component list names only classes the daisyui pack emits or defines", () => {
    const files = generated.get("daisyui")!;
    const tokens = emittedClassTokens(files);
    const css = cssDefinedClasses(files);
    // A list entry nothing emits is dead weight that would mask a later gap.
    const dead = [...DAISYUI_COMPONENTS].filter((c) => !tokens.has(c) && !css.has(c));
    expect(dead, `daisyUI list entries nothing emits: ${dead.join(", ")}`).toEqual([]);
  });
});

// Which web font a `theme {}` names, and whether the generator can bundle it.
//
// A font stack (`fontFamily` / `fontFamilyMono`) names a web font when its
// FIRST family is not a CSS generic family or a system-font alias: that family
// is bundled with the generated app, and the later families are fallbacks the
// browser already has.  A stack that starts with a generic family
// (`system-ui, …`, the default) names no web font and loads none.
//
// A named family is bundleable when Fontsource publishes it
// (`src/util/fontsource-families.ts`); one it does not publish is refused with
// `loom.theme-font-unbundleable` on every design that honours the token
// (`src/util/theme-tokens.ts`), never left for the browser to fall back from.
//
// The validator and every in-scope frontend read this one module, so the
// family the check accepts is exactly the family the generated app loads.

import { FONTSOURCE_DEFAULT_VERSION, FONTSOURCE_FAMILIES } from "./fontsource-families.js";
import { THEME_TOKENS_HONOURED } from "./theme-tokens.js";

/** The theme tokens that name a font. */
export const THEME_FONT_TOKENS = ["fontFamily", "fontFamilyMono"] as const;
export type ThemeFontToken = (typeof THEME_FONT_TOKENS)[number];

/** CSS generic families and the system-font aliases: a stack that starts with
 *  one of these names the platform's own font, so nothing is bundled. */
const SYSTEM_FAMILIES: ReadonlySet<string> = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
  "-apple-system",
  "blinkmacsystemfont",
]);

/** The weights a bundled font loads for each token, when its package ships
 *  them (in hundreds): body text, medium and semibold controls and bold
 *  headings; code in regular and bold. */
const LOADED_WEIGHTS: Readonly<Record<ThemeFontToken, readonly string[]>> = {
  fontFamily: ["4", "5", "6", "7"],
  fontFamilyMono: ["4", "7"],
};

/** A font the generated app bundles from its Fontsource package. */
export interface BundledFont {
  /** The family as Fontsource spells it. */
  family: string;
  /** The npm package, `@fontsource/<id>`. */
  packageName: string;
  /** The exact version the generated `package.json` pins. */
  version: string;
  /** The upright weights loaded (`"400"`, …).  Empty when the package ships
   *  none of the token's `LOADED_WEIGHTS`: its default stylesheet is loaded. */
  weights: string[];
}

/** The first family of a CSS font stack, unquoted, or `undefined` when the
 *  stack is empty. */
function firstFamily(stack: string): string | undefined {
  const m = /^\s*(?:"([^"]*)"|'([^']*)'|([^,]*))/.exec(stack);
  const name = (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim().replace(/\s+/g, " ");
  return name === "" ? undefined : name;
}

/** The web font a stack names: its first family, unless that family is a
 *  generic family or a system-font alias. */
export function namedFontFamily(stack: string): string | undefined {
  const first = firstFamily(stack);
  if (first === undefined || SYSTEM_FAMILIES.has(first.toLowerCase())) return undefined;
  return first;
}

const BY_FAMILY: ReadonlyMap<string, string> = new Map(
  Object.entries(FONTSOURCE_FAMILIES).map(([id, [name]]) => [name.toLowerCase(), id]),
);

/** The Fontsource package for `family` (matched case-insensitively) as the
 *  `token` font loads it, or `undefined` when Fontsource does not publish it. */
export function fontsourceFont(
  family: string,
  token: ThemeFontToken = "fontFamily",
): BundledFont | undefined {
  const id = BY_FAMILY.get(family.toLowerCase());
  if (id === undefined) return undefined;
  const [name, weights, version] = FONTSOURCE_FAMILIES[id] as readonly [string, string, string?];
  return {
    family: name,
    packageName: `@fontsource/${id}`,
    version: version ?? FONTSOURCE_DEFAULT_VERSION,
    weights: LOADED_WEIGHTS[token].filter((w) => weights.includes(w)).map((w) => `${w}00`),
  };
}

/** The font tokens `design` honours. */
export function fontTokensHonoured(design: string): ThemeFontToken[] {
  const honoured = THEME_TOKENS_HONOURED[design] ?? [];
  return THEME_FONT_TOKENS.filter((t) => honoured.includes(t));
}

/** The fonts a deployable rendering with `design` bundles: the Fontsource
 *  family each honoured font token names, once per package (a family both
 *  tokens name loads the weights of both), in token order.  A design the token
 *  table does not know (a custom pack) bundles nothing. */
export function themeFontsToBundle(
  theme: Partial<Record<ThemeFontToken, string>> | undefined,
  design: string,
): BundledFont[] {
  const out: BundledFont[] = [];
  for (const token of fontTokensHonoured(design)) {
    const stack = theme?.[token];
    const family = stack === undefined ? undefined : namedFontFamily(stack);
    const font = family === undefined ? undefined : fontsourceFont(family, token);
    if (font === undefined) continue;
    const same = out.find((f) => f.packageName === font.packageName);
    if (same === undefined) out.push(font);
    else same.weights = [...new Set([...same.weights, ...font.weights])].sort();
  }
  return out;
}

/** The stylesheets that load `font`: one per loaded weight, or the package's
 *  default stylesheet. */
export function fontStylesheets(font: BundledFont): string[] {
  return font.weights.length === 0
    ? [font.packageName]
    : font.weights.map((w) => `${font.packageName}/${w}.css`);
}

/** The font files those stylesheets reference, as globs relative to
 *  `node_modules` (each stylesheet's `url(./files/…)`), for a pipeline that
 *  serves them itself. */
export function fontFiles(font: BundledFont): string[] {
  return font.weights.length === 0
    ? [`${font.packageName}/files/*`]
    : font.weights.map((w) => `${font.packageName}/files/*-${w}-normal.woff*`);
}

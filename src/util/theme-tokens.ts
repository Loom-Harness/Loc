// Which `theme {}` tokens each design honours.  A design is a built-in pack
// family (`mantine`, `vuetify`, `daisyui`, …) or a self-rendered frontend that
// has no pack pipeline (`feliz`, `flutter`, keyed by its
// `selfRenderedUiFormat`).
//
// A token a design honours reaches the generated app (its theme, its CSS, its
// component props); a token it does not is refused: setting it is the error
// `loom.theme-token-unsupported` on every deployable that renders with that
// design, never a silent drop.  `test/generator/_frontend/theme-token-coverage.test.ts`
// holds this table to what each design actually emits, both ways: a listed
// token must change the output, an unlisted one must not.

/** Every `theme {}` token, in declaration order. */
export const THEME_TOKENS = [
  "primary",
  "neutral",
  "secondary",
  "accent",
  "success",
  "warning",
  "error",
  "radius",
  "fontFamily",
  "fontFamilyMono",
  "colorScheme",
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];

/** The tokens each design honours. */
export const THEME_TOKENS_HONOURED: Readonly<Record<string, readonly ThemeToken[]>> = {
  angularMaterial: ["primary", "accent", "fontFamily"],
  chakra: ["primary", "radius", "fontFamily", "fontFamilyMono"],
  coreComponents: ["primary", "neutral", "radius", "fontFamily", "fontFamilyMono"],
  daisyui: ["primary", "neutral", "radius", "fontFamily", "fontFamilyMono"],
  feliz: [],
  flowbite: ["primary", "neutral", "error", "radius", "fontFamily", "fontFamilyMono"],
  flutter: [],
  mantine: ["primary", "neutral", "radius", "fontFamily", "fontFamilyMono"],
  mui: ["primary", "radius", "fontFamily"],
  primeng: ["primary", "accent", "fontFamily"],
  shadcn: ["primary", "neutral", "radius", "fontFamily"],
  shadcnSvelte: ["primary", "neutral", "error", "radius", "fontFamily", "fontFamilyMono"],
  shadcnVue: [],
  spartanNg: ["primary", "accent", "fontFamily"],
  vuetify: ["primary", "secondary", "accent", "success", "warning", "error", "colorScheme"],
};

/** The tokens `design` refuses (every token for a design the table does not
 *  know, so a new design is in scope the day it is registered). */
export function themeTokensRefused(design: string): ThemeToken[] {
  const honoured = new Set(THEME_TOKENS_HONOURED[design] ?? []);
  return THEME_TOKENS.filter((t) => !honoured.has(t));
}

// ---------------------------------------------------------------------------
// View-model preparer for the design-token theme.
//
// Resolves defaults for any tokens the DSL leaves blank, expands shade
// ramps for the brand + neutral colours, and returns a plain JSON
// ThemeVM that any pack can render against.  The shade-ramp helpers
// live here (not in a Handlebars helper) so packs that don't need
// shades — e.g. a "minimalist" pack reading a single base colour —
// aren't forced to compute them.
// ---------------------------------------------------------------------------

import type { ThemeIR } from "../../ir/types/loom-ir.js";
import { generateShades } from "../../util/color.js";
import type { ThemeVM } from "./view-models.js";

/** Default brand colour when the system declares no `theme.primary`.
 *  Indigo — readable as a primary on white, distinct enough from
 *  Mantine's stock blue that generated apps look intentionally
 *  themed rather than untouched defaults. */
const DEFAULT_PRIMARY_HEX = "#4f46e5";
/** Default neutral.  Subtle warm-grey ramp keeps surfaces (cards,
 *  table rows) from feeling laboratory-cold the way pure mantine
 *  greys do. */
const DEFAULT_NEUTRAL_HEX = "#64748b";
/** Default semantic colours — chosen to read coherently across
 *  light + dark schemes and against the indigo / slate baseline.
 *  The baseline keeps templates that always emit semantic slots
 *  from rendering blank. */
const DEFAULT_SECONDARY_HEX = "#6fd1ff";
const DEFAULT_ACCENT_HEX = "#ffb98a";
const DEFAULT_SUCCESS_HEX = "#22c55e";
const DEFAULT_WARNING_HEX = "#f59e0b";
const DEFAULT_ERROR_HEX = "#ef4444";
/** Default body / heading family: the platform's own UI font.  No web font
 *  is loaded unless the theme names one, so the default names none. */
const SYSTEM_FONT_STACK =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const DEFAULT_FONT_FAMILY_MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
const DEFAULT_RADIUS = "md";
const DEFAULT_COLOR_SCHEME: "light" | "dark" | "auto" = "light";

/** Every `theme {}` token, the declared value or its default.  The one place
 *  a default is chosen: every target's theme reads these. */
export interface ResolvedTheme {
  primary: string;
  neutral: string;
  secondary: string;
  accent: string;
  success: string;
  warning: string;
  error: string;
  radius: string;
  fontFamily: string;
  fontFamilyMono: string;
  colorScheme: "light" | "dark" | "auto";
}

export function resolveTheme(t: ThemeIR | undefined): ResolvedTheme {
  return {
    primary: t?.primary ?? DEFAULT_PRIMARY_HEX,
    neutral: t?.neutral ?? DEFAULT_NEUTRAL_HEX,
    secondary: t?.secondary ?? DEFAULT_SECONDARY_HEX,
    accent: t?.accent ?? DEFAULT_ACCENT_HEX,
    success: t?.success ?? DEFAULT_SUCCESS_HEX,
    warning: t?.warning ?? DEFAULT_WARNING_HEX,
    error: t?.error ?? DEFAULT_ERROR_HEX,
    radius: t?.radius ?? DEFAULT_RADIUS,
    fontFamily: t?.fontFamily ?? SYSTEM_FONT_STACK,
    fontFamilyMono: t?.fontFamilyMono ?? DEFAULT_FONT_FAMILY_MONO,
    colorScheme: t?.colorScheme ?? DEFAULT_COLOR_SCHEME,
  };
}

export function prepareThemeVM(t: ThemeIR | undefined): ThemeVM {
  const {
    primary,
    neutral,
    secondary,
    accent,
    success,
    warning,
    error,
    radius,
    fontFamily,
    fontFamilyMono: fontFamilyMonospace,
    colorScheme,
  } = resolveTheme(t);
  return {
    brandShades: generateShades(primary),
    neutralShades: generateShades(neutral),
    secondaryShades: generateShades(secondary),
    accentShades: generateShades(accent),
    successShades: generateShades(success),
    warningShades: generateShades(warning),
    errorShades: generateShades(error),
    radius,
    fontFamily,
    fontFamilyMonospace,
    colorScheme,
  };
}

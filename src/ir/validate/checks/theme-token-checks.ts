// ---------------------------------------------------------------------------
// A `theme {}` token the design cannot honour is refused, never dropped.
//
// Each deployable that renders a ui renders it with one design: its built-in
// design pack, or (Feliz, Flutter) the frontend's own rendering.  A token the
// system sets that the design does not honour (`src/util/theme-tokens.ts`)
// refuses generation with one `loom.theme-token-unsupported` per deployable,
// naming the tokens, the design and the deployable.  A
// custom pack (`design: "./path"`) is not in the table and is not checked.
//
// A font token a design honours names a web font the generator bundles
// (`src/util/theme-fonts.ts`); one Fontsource does not publish cannot be
// bundled and refuses generation with one `loom.theme-font-unbundleable` per
// token.
// ---------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { factsFor } from "../../../platform/metadata.js";
import { parseBuiltinDesignRef } from "../../../util/builtin-formats.js";
import {
  fontsourceFont,
  fontTokensHonoured,
  namedFontFamily,
  THEME_FONT_TOKENS,
} from "../../../util/theme-fonts.js";
import { THEME_TOKENS_HONOURED, themeTokensRefused } from "../../../util/theme-tokens.js";
import type { EnrichedSystemIR } from "../../types/loom-ir.js";
import type { LoomDiagnostic } from "./diagnostic.js";

/** The design a deployable renders its ui with, or `undefined` when it renders
 *  none or names a custom pack. */
function designOf(d: EnrichedSystemIR["deployables"][number]): string | undefined {
  const own = factsFor(d.platform)?.selfRenderedUiFormat;
  if (own) return d.uiName ? own : undefined;
  if (d.design === undefined) return undefined;
  return parseBuiltinDesignRef(d.design)?.family;
}

export function validateThemeTokens(sys: EnrichedSystemIR, diags: LoomDiagnostic[]): void {
  const theme = sys.theme;
  if (!theme) return;
  const declared = Object.entries(theme)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k);
  const fontHonouredBy = new Map<string, string[]>();
  for (const d of sys.deployables) {
    const design = designOf(d);
    if (design === undefined || !Object.hasOwn(THEME_TOKENS_HONOURED, design)) continue;
    for (const t of fontTokensHonoured(design)) {
      fontHonouredBy.set(t, [...(fontHonouredBy.get(t) ?? []), d.name]);
    }
    const refused = themeTokensRefused(design).filter((t) => declared.includes(t));
    if (refused.length === 0) continue;
    diags.push({
      severity: "error",
      message: diagMessage("loom.theme-token-unsupported", {
        name: d.name,
        design,
        tokens: refused.join(", "),
      }),
      source: `${sys.name}/${d.name}`,
      code: "loom.theme-token-unsupported",
    });
  }
  for (const token of THEME_FONT_TOKENS) {
    const stack = theme[token];
    const deployables = fontHonouredBy.get(token);
    if (stack === undefined || deployables === undefined) continue;
    const family = namedFontFamily(stack);
    if (family === undefined || fontsourceFont(family) !== undefined) continue;
    diags.push({
      severity: "error",
      message: diagMessage("loom.theme-font-unbundleable", {
        token,
        family,
        deployables: deployables.join(", "),
      }),
      source: `${sys.name}/theme`,
      code: "loom.theme-font-unbundleable",
    });
  }
}

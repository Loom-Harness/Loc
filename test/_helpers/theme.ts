// A `.ddd` source retargeted onto another design keeps only the `theme {}`
// tokens that design honours: a refused token is the error
// `loom.theme-token-unsupported`, and a test that sweeps one source across
// every design is about the pages, not the theme.

import { THEME_TOKENS, themeTokensRefused } from "../../src/util/theme-tokens.js";

/** `source` with the theme tokens `design` refuses removed. */
export function withoutRefusedThemeTokens(source: string, design: string): string {
  const refused = new Set(themeTokensRefused(design));
  return source.replace(
    /(\n[ \t]*theme \{\n)([\s\S]*?)(\n[ \t]*\})/,
    (_m, open: string, body: string, close: string) => {
      const kept = body.split("\n").filter((line) => {
        const key = line.trim().split(":")[0]?.trim();
        return !(
          key &&
          (THEME_TOKENS as readonly string[]).includes(key) &&
          refused.has(key as never)
        );
      });
      return `${open}${kept.join("\n")}${close}`;
    },
  );
}

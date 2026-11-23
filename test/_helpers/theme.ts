// A `.ddd` source retargeted onto another design keeps only the `theme {}`
// tokens that design honours: a refused token is the error
// `loom.theme-token-unsupported`, and a test that sweeps one source across
// every design is about the pages, not the theme.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TARGET_FACTS } from "../../src/platform/target-facts.js";
import { THEME_TOKENS, type ThemeToken, themeTokensRefused } from "../../src/util/theme-tokens.js";
import { applyFrontend } from "../behavioral/frontend-fixture.mjs";

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

// One theme fixture per design: every built-in pack in `designs/` and every
// self-rendered frontend in `TARGET_FACTS`, each rendering the same ui.

const FIXTURE = readFileSync("test/behavioral/form-spec-ui.ddd", "utf8");

const FORMAT_FRAMEWORK: Record<string, string> = {
  tsx: "react",
  vue: "vue",
  svelte: "svelte",
  angular: "angular",
  heex: "phoenixLiveView",
};

export interface ThemeCase {
  design: string;
  framework: string;
  pack?: string;
}

export function themeCases(): ThemeCase[] {
  const out: ThemeCase[] = [];
  for (const family of readdirSync("designs")) {
    for (const version of readdirSync(join("designs", family))) {
      const manifest = JSON.parse(
        readFileSync(join("designs", family, version, "pack.json"), "utf8"),
      ) as { format?: string };
      const framework = FORMAT_FRAMEWORK[manifest.format ?? "tsx"];
      if (!framework) throw new Error(`theme census: pack ${family} has an unknown format`);
      out.push({ design: family, framework, pack: family });
    }
  }
  for (const facts of Object.values(TARGET_FACTS)) {
    if ("selfRenderedUiFormat" in facts && facts.selfRenderedUiFormat) {
      out.push({ design: facts.selfRenderedUiFormat, framework: facts.selfRenderedUiFormat });
    }
  }
  return out;
}

export function themedFixture(c: ThemeCase, theme: Partial<Record<ThemeToken, string>>): string {
  let src: string;
  if (c.framework === "phoenixLiveView") {
    src = FIXTURE.replace("{ __FRAMEWORK__ }", "{ api C: CoverApi }")
      .replace(
        "    platform: node\n",
        `    platform: elixir\n    ui: WebApp { C: api }\n    design: ${c.pack}\n`,
      )
      .replace(/ {2}deployable webApp \{[\s\S]*?\n {2}\}\n/, "");
  } else {
    src = applyFrontend(FIXTURE, c.framework);
    if (c.pack) src = src.replace("    ui: WebApp\n", `    ui: WebApp\n    design: ${c.pack}\n`);
  }
  const block = Object.entries(theme)
    .map(([k, v]) => `    ${k}: "${v}"`)
    .join("\n");
  return src.replace(/(system \w+ \{\n)/, `$1  theme {\n${block}\n  }\n`);
}

/** The ui project's files: the frontend deployable, or the LiveView app. */
export function uiFiles(c: ThemeCase, files: Map<string, string>): Map<string, string> {
  const prefix = c.framework === "phoenixLiveView" ? "api/" : "web_app/";
  return new Map([...files].filter(([p]) => p.startsWith(prefix)));
}

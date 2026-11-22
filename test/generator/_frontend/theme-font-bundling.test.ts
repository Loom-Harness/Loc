// A web font a `theme {}` names is bundled by the generator, on every design
// that honours the font token (`src/util/theme-fonts.ts`).
//
// For each design whose row in `THEME_TOKENS_HONOURED` lists `fontFamily` or
// `fontFamilyMono`, the theme fixture names a Fontsource family in each
// honoured token, and the generated ui project must depend on the family's
// `@fontsource/<id>` package at the table's pin and load each of its
// stylesheets from an entry module or stylesheet; the LiveView asset pipeline
// must also copy the font files beside the built `app.css`.  The default
// theme, and a stack that starts with a generic family, bundle nothing.  A new
// design that honours a font token is covered the day its row says so.
//
// This is wiring no compile tier observes: a missing import or dependency
// builds and boots fine, it only paints in the fallback font.

import { describe, expect, it } from "vitest";
import {
  fontStylesheets,
  fontsourceFont,
  fontTokensHonoured,
  type ThemeFontToken,
} from "../../../src/util/theme-fonts.js";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { type ThemeCase, themeCases, themedFixture, uiFiles } from "../../_helpers/theme.js";

const NAMED: Record<ThemeFontToken, string> = {
  fontFamily: "Inter, system-ui, sans-serif",
  fontFamilyMono: "JetBrains Mono, ui-monospace, monospace",
};

const inScope = themeCases().filter((c) => fontTokensHonoured(c.design).length > 0);

function packageJson(c: ThemeCase, files: Map<string, string>) {
  const path =
    c.framework === "phoenixLiveView" ? "api/assets/package.json" : "web_app/package.json";
  const text = files.get(path);
  if (text === undefined) throw new Error(`${c.design}: no ${path}`);
  return JSON.parse(text) as {
    dependencies: Record<string, string>;
    scripts?: Record<string, string>;
  };
}

/** Whether some module or stylesheet of the project loads `sheet`. */
function loads(files: Map<string, string>, sheet: string): boolean {
  const re = new RegExp(`(?:^|\\n)\\s*(?:@?import) "${sheet.replace(/[/.]/g, "\\$&")}";`);
  return [...files].some(([p, s]) => !p.endsWith("package.json") && re.test(s));
}

describe("theme font bundling", () => {
  it("covers every design that honours a font token", () => {
    expect(inScope.map((c) => c.design).sort()).toEqual(
      [
        "angularMaterial",
        "chakra",
        "coreComponents",
        "daisyui",
        "flowbite",
        "mantine",
        "mui",
        "primeng",
        "shadcn",
        "shadcnSvelte",
        "spartanNg",
      ].sort(),
    );
  });

  it.each(inScope.map((c) => [c.design, c] as const))(
    "%s bundles each named Fontsource family",
    async (_name, c) => {
      const tokens = fontTokensHonoured(c.design);
      const theme = Object.fromEntries(tokens.map((t) => [t, NAMED[t]]));
      const files = uiFiles(c, await generateSystemFiles(themedFixture(c, theme)));
      const pkg = packageJson(c, files);
      for (const t of tokens) {
        const font = fontsourceFont(NAMED[t].split(",")[0] as string, t);
        if (!font) throw new Error(`${NAMED[t]} is not a Fontsource family`);
        expect(pkg.dependencies[font.packageName], `${c.design}: ${font.packageName}`).toBe(
          font.version,
        );
        for (const sheet of fontStylesheets(font)) {
          expect(loads(files, sheet), `${c.design}: loads ${sheet}`).toBe(true);
        }
        if (c.framework === "phoenixLiveView") {
          for (const w of font.weights) {
            expect(pkg.scripts?.["build:fonts"], `${c.design}: copies ${w}`).toContain(
              `node_modules/${font.packageName}/files/*-${w}-normal.woff*`,
            );
          }
          expect(pkg.scripts?.build).toMatch(/^npm run build:fonts && /);
          expect(files.get("api/Dockerfile")).toContain(
            "COPY --from=assets-build /priv/static/assets/files priv/static/assets/files",
          );
        }
      }
    },
    300_000,
  );

  it.each(inScope.map((c) => [c.design, c] as const))(
    "%s bundles nothing for the default theme or a generic first family",
    async (_name, c) => {
      const generic = Object.fromEntries(
        fontTokensHonoured(c.design).map((t) => [t, "system-ui, Inter, sans-serif"]),
      );
      for (const theme of [{}, generic]) {
        const files = uiFiles(c, await generateSystemFiles(themedFixture(c, theme)));
        const mentions = [...files].filter(([, s]) => s.includes("@fontsource/"));
        expect(
          mentions.map(([p]) => p),
          c.design,
        ).toEqual([]);
        if (c.framework === "phoenixLiveView") {
          expect(files.get("api/Dockerfile")).not.toContain("/priv/static/assets/files");
        }
      }
    },
    300_000,
  );
});

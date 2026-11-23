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
      // Every claim is collected and asserted once: the list names what is missing.
      const missing: string[] = [];
      for (const t of tokens) {
        const font = fontsourceFont(NAMED[t].split(",")[0] as string, t);
        if (!font) throw new Error(`${NAMED[t]} is not a Fontsource family`);
        if (pkg.dependencies[font.packageName] !== font.version) {
          missing.push(`dependency ${font.packageName}@${font.version}`);
        }
        for (const sheet of fontStylesheets(font)) {
          if (!loads(files, sheet)) missing.push(`load of ${sheet}`);
        }
        if (c.framework === "phoenixLiveView") {
          const copy = pkg.scripts?.["build:fonts"] ?? "";
          for (const w of font.weights) {
            const glob = `node_modules/${font.packageName}/files/*-${w}-normal.woff*`;
            if (!copy.includes(glob)) missing.push(`build:fonts copy of ${glob}`);
          }
          if (!pkg.scripts?.build?.startsWith("npm run build:fonts && ")) {
            missing.push("build running build:fonts first");
          }
          const ship =
            "COPY --from=assets-build /priv/static/assets/files priv/static/assets/files";
          if (!files.get("api/Dockerfile")?.includes(ship)) missing.push("Dockerfile font copy");
        }
      }
      expect(missing, c.design).toEqual([]);
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
        // Absence: no file names a Fontsource package, and the LiveView image
        // copies no font files.
        const leaks = [...files]
          .filter(
            ([p, s]) =>
              s.includes("@fontsource/") ||
              (p === "api/Dockerfile" && s.includes("/priv/static/assets/files")),
          )
          .map(([p]) => p);
        expect(leaks, c.design).toEqual([]);
      }
    },
    300_000,
  );
});

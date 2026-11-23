// A web font a theme names is bundled or refused (`src/util/theme-fonts.ts`):
// a first family Fontsource does not publish is `loom.theme-font-unbundleable`
// on a design that honours the token; a generic or system first family names
// no web font and is never refused.

import { describe, expect, it } from "vitest";
import { validateLoomModel } from "../../../src/ir/validate/validate.js";
import { fontsourceFont, namedFontFamily } from "../../../src/util/theme-fonts.js";
import { buildLoomModelUnchecked } from "../../_helpers/ir.js";

const system = (theme: string, ui: string) => `
system S {
  theme {
    ${theme}
  }
  subdomain D { context C {
    aggregate Thing with crudish { name: string }
    repository Things for Thing
  } }
  api A from D
  ui W with scaffold(subdomains: [D]) { }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api { platform: node, contexts: [C], dataSources: [st], serves: A, port: 3000 }
  deployable app { ${ui}, targets: api, ui: W, port: 3001 }
}`;

const MANTINE = "platform: web, design: mantine";
const MUI = "platform: web, design: mui";

async function codes(theme: string, ui = MANTINE): Promise<string[]> {
  const loom = await buildLoomModelUnchecked(
    system(theme, ui),
    "the theme check is asserted directly, refusals included",
  );
  return validateLoomModel(loom)
    .filter((d) => d.code?.startsWith("loom.theme-"))
    .map((d) => d.code as string);
}

describe("theme font refusal", () => {
  it("refuses a first family Fontsource does not publish", async () => {
    expect(await codes('fontFamily: "Helvetica Neue, sans-serif"')).toEqual([
      "loom.theme-font-unbundleable",
    ]);
    expect(await codes('fontFamilyMono: "Consolas, monospace"')).toEqual([
      "loom.theme-font-unbundleable",
    ]);
  });

  it("accepts a Fontsource family, matched case-insensitively", async () => {
    expect(await codes('fontFamily: "inter, sans-serif"')).toEqual([]);
    expect(await codes("fontFamily: \"'Open Sans', Arial, sans-serif\"")).toEqual([]);
  });

  it("never refuses a generic first family, nor a fallback after it", async () => {
    expect(await codes('fontFamily: "system-ui, Helvetica Neue, sans-serif"')).toEqual([]);
    expect(await codes('fontFamilyMono: "ui-monospace, Consolas, monospace"')).toEqual([]);
    expect(await codes('fontFamily: "-apple-system, Helvetica Neue"')).toEqual([]);
  });

  it("leaves a token the design refuses to the token check", async () => {
    // mui honours fontFamily but not fontFamilyMono.
    expect(await codes('fontFamilyMono: "Consolas, monospace"', MUI)).toEqual([
      "loom.theme-token-unsupported",
    ]);
  });
});

describe("named font family", () => {
  it("is the first family, unquoted, unless it is generic", () => {
    expect(namedFontFamily('"Open Sans", sans-serif')).toBe("Open Sans");
    expect(namedFontFamily("'JetBrains Mono',monospace")).toBe("JetBrains Mono");
    expect(namedFontFamily("Inter")).toBe("Inter");
    expect(namedFontFamily("Sans-Serif, Inter")).toBeUndefined();
    expect(namedFontFamily("system-ui")).toBeUndefined();
    expect(namedFontFamily("  ")).toBeUndefined();
  });

  it("resolves to its Fontsource package and pin", () => {
    expect(fontsourceFont("open sans")).toMatchObject({
      family: "Open Sans",
      packageName: "@fontsource/open-sans",
      weights: ["400", "500", "600", "700"],
    });
    expect(fontsourceFont("JetBrains Mono", "fontFamilyMono")?.weights).toEqual(["400", "700"]);
    // Buda ships only 300: its package's default stylesheet loads it.
    expect(fontsourceFont("Buda")?.weights).toEqual([]);
    expect(fontsourceFont("Helvetica Neue")).toBeUndefined();
  });
});

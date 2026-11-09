// A rich `Text` whose emphasis carries an ICU plural hole is still ONE message:
// the compile-time ICU gate (`loom.interp-format-invalid`) accepts it, the
// React and Flutter pages resolve it through `tRich` with the counted value,
// and the translator-side check (`validateTranslation`, what `ddd i18n check`
// runs) accepts a translation that keeps the tags and supplies the locale's
// plural forms — while still rejecting one that drops a required form.

import { describe, expect, it } from "vitest";
import { messageKey } from "../../../src/generator/_walker/i18n-extract.js";
import { validateTranslation } from "../../../src/i18n/icu.js";
import { generateSystemFiles } from "../../_helpers/index.js";

const PLURAL = "{count, plural, one {# order} other {# orders}}";
const SENTENCE = `You have <b>${PLURAL}</b> waiting`;
const KEY = messageKey(
  "WebApp.page.Home",
  "text",
  "You have <b>{0, plural, one {# order} other {# orders}}</b> waiting",
);

const system = (platform: string, pack: string): string => `
  system Shop {
    api ShopApi from Catalog
    subdomain Catalog {
      context Cat {
        aggregate Product { name: string }
        repository Products for Product { }
      }
    }
    storage db { type: postgres }
    resource s { for: Cat, kind: state, use: db }
    ui WebApp {
      ${platform === "flutter" ? "framework: flutter" : ""}
      api Shop: ShopApi
      page Home {
        route: "/"
        state { count: int = 0 }
        body: Text { "You have ", Bold { \`{count, plural, one {# order} other {# orders}}\` }, " waiting" }
      }
    }
    deployable api { platform: node contexts: [Cat] dataSources: [s] serves: ShopApi port: 3000 }
    deployable web {
      platform: ${platform} ${pack ? `design: "${pack}"` : ""} targets: api
      ui: WebApp { Shop: api } port: 3005
    }
  }
`;

function fileEnding(files: Map<string, string>, suffix: string): string {
  const hit = [...files].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`no ${suffix} among ${[...files.keys()].join(", ")}`);
  return hit[1];
}

describe("rich text with a plural hole", () => {
  for (const [id, platform, pack, page] of [
    ["react", "static", "mantine", "pages/home.tsx"],
    ["flutter", "flutter", "", "pages/home_page.dart"],
  ] as const) {
    it(`${id}: validates, is one catalog entry, and the page passes the count to tRich`, async () => {
      // generateSystemFiles rejects on any validation error, the ICU gate included.
      const files = await generateSystemFiles(system(platform, pack));
      const catalog = JSON.parse(files.get(".loom/messages.en.json") ?? "{}") as Record<
        string,
        string
      >;
      expect(catalog[KEY]).toBe(SENTENCE);
      const src = fileEnding(files, page);
      expect(src).toContain("tRich");
      expect(src).toContain(KEY);
      expect(src).toMatch(/count/);
    });
  }

  it("the translator check accepts the tags and enforces the locale's plural forms", () => {
    const ru = `У вас <b>{count, plural, one {# заказ} few {# заказа} many {# заказов} other {# заказа}}</b> в ожидании`;
    expect(validateTranslation(SENTENCE, ru, "ru")).toEqual([]);
    const missingFew = `У вас <b>{count, plural, one {# заказ} many {# заказов} other {# заказа}}</b> в ожидании`;
    expect(validateTranslation(SENTENCE, missingFew, "ru").length).toBeGreaterThan(0);
  });
});

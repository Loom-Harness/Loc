// Inline emphasis is ONE sentence, not fragments.
//
//   Text { "Read the ", Bold { "terms" }, " first" }
//
// is a single catalog message — `Read the <b>terms</b> first` — so a translator
// can reorder the parts, and every child is translated (the old shape keyed the
// first string alone and shipped the rest in English).  Every frontend renders
// the runtime's answer as styled inline markup; HEEx goes through `loom_rich`.

import { describe, expect, it } from "vitest";
import { messageKey } from "../../../src/generator/_walker/i18n-extract.js";
import { generateSystemFiles } from "../../_helpers/index.js";

const SENTENCE = "Read the <b>terms</b> first";
const KEY = messageKey("WebApp.page.Home", "text", SENTENCE);

const system = (platform: string, pack: string, body: string): string => `
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
      ${platform === "feliz" || platform === "flutter" ? `framework: ${platform}` : ""}
      api Shop: ShopApi
      page Home { route: "/" body: ${body} }
    }
    deployable api { platform: node contexts: [Cat] dataSources: [s] serves: ShopApi port: 3000 }
    deployable web {
      platform: ${platform} ${pack ? `design: "${pack}"` : ""} targets: api
      ui: WebApp { Shop: api } port: 3005
    }
  }
`;

const heex = (body: string): string => `
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
      api Shop: ShopApi
      page Home { route: "/" body: ${body} }
    }
    deployable phoenixApp {
      platform: elixir contexts: [Cat] dataSources: [s] serves: ShopApi
      design: "coreComponents" ui: WebApp { Shop: phoenixApp } port: 4000
    }
  }
`;

const BODY = `Text { "Read the ", Bold { "terms" }, " first" }`;

function pageOf(files: Map<string, string>, suffix: string): string {
  const entry = [...files].find(([p]) => p.endsWith(suffix));
  if (!entry) throw new Error(`no ${suffix} among ${[...files.keys()].join(", ")}`);
  const src = entry[1];
  if (!suffix.endsWith("App.fs")) return src;
  const start = src.indexOf("module I18n =");
  if (start < 0) return src;
  const rest = src.slice(start + 1);
  const next = rest.search(/\n(?:module|let|type|open) /);
  return src.slice(0, start) + (next < 0 ? "" : rest.slice(next));
}

describe("rich text: one whole-sentence message per target", () => {
  const TARGETS: ReadonlyArray<[id: string, platform: string, pack: string, page: string]> = [
    ["react", "static", "mantine", "pages/home.tsx"],
    ["vue", "vue", "vuetify", "pages/home.vue"],
    ["svelte", "svelte", "flowbite", "+page.svelte"],
    ["angular", "angular", "angularMaterial", "pages/home.component.ts"],
    ["feliz", "feliz", "", "src/App.fs"],
    ["flutter", "flutter", "", "pages/home_page.dart"],
  ];

  for (const [id, platform, pack, suffix] of TARGETS) {
    it(`${id}: the sentence is one catalog entry and the page resolves it`, async () => {
      const files = await generateSystemFiles(system(platform, pack, BODY));
      const catalog = JSON.parse(files.get(".loom/messages.en.json") ?? "{}") as Record<
        string,
        string
      >;
      expect(catalog[KEY]).toBe(SENTENCE);
      // No fragment keys: the emphasis text and the trailing text are NOT
      // separate catalog messages.
      // (A page's own `name` entry is the page's label, not a fragment.)
      expect(
        Object.keys(catalog).filter(
          (k) => k.startsWith("WebApp.page.Home.") && !k.includes(".name."),
        ),
      ).toEqual([KEY]);
      const page = pageOf(files, suffix);
      expect(page).toContain(KEY);
      // The runtime call that returns the styled markup: `tRich` (JS), `I18n.rich` (F#).
      expect(page).toContain(id === "feliz" ? "I18n.rich" : "tRich");
    });
  }

  it("heex: one loom_rich call over the same key", async () => {
    const files = await generateSystemFiles(heex(BODY));
    const page = pageOf(files, "home_live.ex");
    expect(page).toContain(`loom_rich(pgettext("${KEY}"`);
    const runtime = [...files].find(([p]) => p.endsWith("/i18n.ex"))?.[1] ?? "";
    expect(runtime).toContain("def loom_rich(");
  });

  it("an interpolated child stays a hole in the same sentence", async () => {
    const files = await generateSystemFiles(
      system("static", "mantine", `Text { "Hello ", Bold { \`{name}\` }, ", welcome" }`).replace(
        "page Home {",
        `page Home { state { name: string = "" }`,
      ),
    );
    const catalog = JSON.parse(files.get(".loom/messages.en.json") ?? "{}") as Record<
      string,
      string
    >;
    expect(Object.values(catalog)).toContain("Hello <b>{name}</b>, welcome");
  });

  it("a Text with a non-inline child is still refused", async () => {
    await expect(
      generateSystemFiles(system("static", "mantine", `Text { "a", Badge { "b" } }`)),
    ).rejects.toThrow(/loom\.page-primitive-extra-children/);
  });
});

// Whole-sentence chrome and translated page titles.
//
//   * `CreateForm` success toast — `chrome.created.<Agg>` ("Order created"),
//     not a `${name} created` frame; `WorkflowForm` likewise (`completed`).
//   * The dynamic-row "Add <item>" button on Angular and Feliz is the
//     `chrome.addItem.<ValueObject>` sentence, not raw `Add ${label}`.
//   * An interpolated page `title:` is an ICU catalog entry, translated on every
//     target; a literal root title also keys the static `index.html` <title>.

import { describe, expect, it } from "vitest";
import { messageKey } from "../../../src/generator/_walker/i18n-extract.js";
import { generateSystemFiles } from "../../_helpers/index.js";

const MODEL = `
      context Cat {
        valueobject Line { sku: string  qty: int }
        aggregate Order { name: string  lines: Line[] }
        repository Orders for Order { }
        workflow Fulfil { create(n: string) { let o = Order.create(name: n, lines: []) } }
      }`;

const system = (platform: string, pack: string, page: string): string => `
  system Shop {
    api ShopApi from Catalog
    subdomain Catalog { ${MODEL} }
    storage db { type: postgres }
    resource s { for: Cat, kind: state, use: db }
    ui WebApp {
      ${platform === "feliz" || platform === "flutter" ? `framework: ${platform}` : ""}
      api Shop: ShopApi
      ${page}
    }
    deployable api { platform: node contexts: [Cat] dataSources: [s] serves: ShopApi port: 3000 }
    deployable web {
      platform: ${platform} ${pack ? `design: "${pack}"` : ""} targets: api
      ui: WebApp { Shop: api } port: 3005
    }
  }
`;

const catalogOf = (files: Map<string, string>): Record<string, string> =>
  JSON.parse(files.get(".loom/messages.en.json") ?? "{}") as Record<string, string>;

// Two pages — a page may host one form of each shape only once — and a literal
// `Text` so the ui has translatable strings (the catalog gate).
const FORMS = `
      page New { route: "/new" body: Stack { Text { "New" }, CreateForm { of: Order } } }
      page Run { route: "/run" body: Stack { Text { "Run" }, WorkflowForm { runs: Fulfil } } }`;

describe("form success sentences are catalog messages", () => {
  // [platform, pack, create page, run page]
  const PACKS: ReadonlyArray<[string, string, string, string]> = [
    ["static", "mantine", "pages/new.tsx", "pages/run.tsx"],
    ["static", "shadcn", "pages/new.tsx", "pages/run.tsx"],
    ["vue", "vuetify", "pages/new.vue", "pages/run.vue"],
    ["svelte", "flowbite", "new/+page.svelte", "run/+page.svelte"],
  ];
  for (const [platform, pack, createPage, runPage] of PACKS) {
    it(`${platform}/${pack}: created + completed are keyed sentences`, async () => {
      const files = await generateSystemFiles(system(platform, pack, FORMS));
      const catalog = catalogOf(files);
      expect(catalog["chrome.created.Order"]).toBe("Order created");
      expect(catalog["chrome.completed.Fulfil"]).toBe("Fulfil completed");
      const created = [...files].find(([p]) => p.endsWith(createPage))?.[1] ?? "";
      const run = [...files].find(([p]) => p.endsWith(runPage))?.[1] ?? "";
      expect(created).toContain('t("chrome.created.Order", "Order created")');
      expect(run).toContain('t("chrome.completed.Fulfil", "Fulfil completed")');
    });
  }
});

describe("the dynamic-row Add button is a catalog sentence on every hand-built form", () => {
  for (const [platform, pack, suffix] of [
    ["angular", "angularMaterial", "pages/new.component.ts"],
    ["feliz", "", "src/App.fs"],
  ] as const) {
    it(`${platform}: chrome.addItem.Line`, async () => {
      const files = await generateSystemFiles(system(platform, pack, FORMS));
      expect(catalogOf(files)["chrome.addItem.Line"]).toBe("Add Line");
      const page = [...files].find(([p]) => p.endsWith(suffix))?.[1] ?? "";
      // The button text IS the runtime call — not a bare `Add Line` literal.
      expect(page).toMatch(
        platform === "feliz"
          ? /prop\.text \(I18n\.t "chrome\.addItem\.Line" "Add Line"\)/
          : />\{\{ t\("chrome\.addItem\.Line", "Add Line"\) \}\}<\/button>/,
      );
    });
  }
});

describe("interpolated page titles", () => {
  const PAGE = `page Home { route: "/hello/:who" title: \`Hello {who}\` body: Text { "hi" } }`;
  const KEY = messageKey("WebApp.page.Home", "title", "Hello {0}");

  for (const [platform, pack] of [
    ["static", "mantine"],
    ["vue", "vuetify"],
    ["svelte", "flowbite"],
    ["angular", "angularMaterial"],
    ["feliz", ""],
    ["flutter", ""],
  ] as const) {
    it(`${platform}: the title is an ICU catalog entry the page resolves`, async () => {
      const files = await generateSystemFiles(system(platform, pack, PAGE));
      expect(catalogOf(files)[KEY]).toMatch(/^Hello \{\w+\}$/);
      const emitted = [...files.values()].join("\n");
      expect(emitted).toContain(KEY);
    });
  }

  it("heex: the title is assigned in handle_params, through the ICU runtime", async () => {
    const files = await generateSystemFiles(
      `
  system Shop {
    api ShopApi from Catalog
    subdomain Catalog { ${MODEL} }
    storage db { type: postgres }
    resource s { for: Cat, kind: state, use: db }
    ui WebApp { api Shop: ShopApi  ${PAGE} }
    deployable phoenixApp {
      platform: elixir contexts: [Cat] dataSources: [s] serves: ShopApi
      design: "coreComponents" ui: WebApp { Shop: phoenixApp } port: 4000
    }
  }`,
    );
    const page = [...files].find(([p]) => p.endsWith("home_live.ex"))?.[1] ?? "";
    expect(page).toContain(`loom_icu(pgettext("${KEY}"`);
    // Set where the route params exist — not in `mount/3`.
    const mount = page.slice(page.indexOf("def mount"), page.indexOf("def handle_params"));
    expect(mount).not.toContain(":page_title");
    expect(page.slice(page.indexOf("def handle_params"))).toContain("assign(socket, :page_title");
  });
});

describe("the static index.html <title>", () => {
  const PAGE = `page Home { route: "/" title: "Storefront" body: Text { "hi" } }`;
  const KEY = messageKey("WebApp.page.Home", "title", "Storefront");

  for (const [platform, pack] of [
    ["static", "mantine"],
    ["vue", "vuetify"],
  ] as const) {
    it(`${platform}: the <title> carries its catalog key and the runtime re-spells it`, async () => {
      const files = await generateSystemFiles(system(platform, pack, PAGE));
      const index =
        files.get("web/index.html") ??
        [...files].find(([p]) => p.endsWith("index.html"))?.[1] ??
        "";
      expect(index).toContain(`<title data-loom-title="${KEY}">Storefront</title>`);
      const runtime = [...files].find(([p]) => p.endsWith("src/i18n.ts"))?.[1] ?? "";
      expect(runtime).toContain("title[data-loom-title]");
    });
  }
});

// Vue translation runtime (M-T1.11) — the React i18n runtime ported to the Vue
// frontend.  A UI with user-visible strings emits `{{ t("<key>", "<default>") }}`
// for literal text slots (keyed IDENTICALLY to the `.loom/messages.en.json`
// catalog, via the SHARED walker seam), plus a generated `src/i18n.ts` shim and
// `src/locales/en.json`.  A string-less app is byte-identical to pre-i18n.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SYSTEM = (body: string) => `
  system Shop {
    subdomain Sales {
      context Sales {
        aggregate Order with crudish { status: string }
        repository Orders for Order { }
      }
    }
    api SalesApi from Sales
    ui Web {
      api Sales: SalesApi
      page Home { route: "/" state { status: string = "" } body: ${body} }
    }
    storage primary { type: postgres }
    resource salesState { for: Sales, kind: state, use: primary }
    deployable api {
      platform: node
      contexts: [Sales]
      dataSources: [salesState]
      serves: SalesApi
      port: 3000
    }
    deployable web { platform: vue targets: api ui: Web { Sales: api } port: 3100 }
  }
`;

async function homeOf(files: Map<string, string>): Promise<string> {
  const entry = [...files].find(([p]) => p.endsWith("home.vue"));
  if (!entry) throw new Error("home.vue not emitted");
  return entry[1];
}

describe("Vue i18n runtime", () => {
  it("emits the src/i18n.ts shim and src/locales/en.json catalog", async () => {
    const files = await generateSystemFiles(SYSTEM(`Heading { "Storefront" }`));
    const i18n = [...files].find(([p]) => p.endsWith("src/i18n.ts"))?.[1];
    const locale = [...files].find(([p]) => p.endsWith("src/locales/en.json"))?.[1];
    expect(i18n).toContain("export function t(");
    expect(i18n).toContain('import en from "./locales/en.json"');
    expect(locale).toBeDefined();
    const catalog = JSON.parse(locale!) as Record<string, string>;
    expect(Object.values(catalog)).toContain("Storefront");
    // Flat, key-sorted.
    const keys = Object.keys(catalog);
    expect(keys).toEqual([...keys].sort());
  });

  it("leaves a dynamic text slot untranslated (no stable source string)", async () => {
    const files = await generateSystemFiles(
      SYSTEM(`Stack { Heading { "Orders" }, Text { status } }`),
    );
    const home = await homeOf(files);
    expect(home).toMatch(/\{\{ t\("[^"]*", "Orders"\) \}\}/); // literal heading translated
    // `status` is a page param ref — interpolated, never a t() call.
    expect(home).not.toContain('t("Web.page.Home.text');
  });

  it("does not emit the runtime for a string-less app", async () => {
    // A page whose only text is a dynamic ref has no extractable strings.
    const files = await generateSystemFiles(SYSTEM(`Text { status }`));
    expect([...files].some(([p]) => p.endsWith("src/i18n.ts"))).toBe(false);
    expect([...files].some(([p]) => p.endsWith("locales/en.json"))).toBe(false);
    const home = await homeOf(files);
    expect(home).not.toContain("import { t }");
  });

  it("emits an interpolated template as a 3-arg ICU t() call + catalog entry", async () => {
    // A page param so the interpolation hole resolves to a real ref.
    const withParam = SYSTEM("Heading { `Status: {code}` }").replace(
      'page Home { route: "/"',
      'page Home(code: string) { route: "/:code"',
    );
    const files = await generateSystemFiles(withParam);
    const home = [...files].find(([p]) => p.endsWith("home.vue"))![1];
    // Named-display default + a values object; keyed to the catalog.  Vue mustache
    // form (`{{ t(...) }}`), produced by `vueTarget.renderInterpolation`.
    expect(home).toMatch(/\{\{ t\("[^"]*", "Status: \{code\}", \{ code: code \}\) \}\}/);
    const locale = [...files].find(([p]) => p.endsWith("src/locales/en.json"))?.[1];
    expect(Object.values(JSON.parse(locale!) as Record<string, string>)).toContain(
      "Status: {code}",
    );
  });

  it("threads the prefix into a component body (component.<Name> keys)", async () => {
    const withComponent = SYSTEM("Banner()").replace(
      "page Home",
      'component Banner() { body: Heading { "Shop Banner" } }\n      page Home',
    );
    const files = await generateSystemFiles(withComponent);
    const banner = [...files].find(([p]) => p.endsWith("components/Banner.vue"))![1];
    expect(banner).toMatch(/\{\{ t\("Web\.component\.Banner\.[^"]*", "Shop Banner"\) \}\}/);
    expect(banner).toContain(`import { t } from "../lib/locale"`);
    const locale = [...files].find(([p]) => p.endsWith("src/locales/en.json"))?.[1];
    expect(Object.values(JSON.parse(locale!) as Record<string, string>)).toContain("Shop Banner");
  });

  it("emits a formatted hole with ICU skeleton, IntlMessageFormat shim, + the dep", async () => {
    // `{total, number, ::currency/USD}` (i18n slice 1) — the skeleton rides into
    // the catalog + the t() default, `values` carries the RAW money value.
    const withParam = SYSTEM("Heading { `Total: {total, number, ::currency/USD}` }").replace(
      'page Home { route: "/"',
      'page Home(total: money) { route: "/:total"',
    );
    const files = await generateSystemFiles(withParam);
    const home = await homeOf(files);
    expect(home).toMatch(
      /\{\{ t\("[^"]*", "Total: \{total, number, ::currency\/USD\}", \{ total: total \}\) \}\}/,
    );
    const locale = [...files].find(([p]) => p.endsWith("src/locales/en.json"))![1];
    expect(Object.values(JSON.parse(locale) as Record<string, string>)).toContain(
      "Total: {total, number, ::currency/USD}",
    );
    const i18n = [...files].find(([p]) => p.endsWith("src/i18n.ts"))![1];
    expect(i18n).toContain('import { IntlMessageFormat } from "intl-messageformat"');
    expect(i18n).toContain("formatterFor(current, message).format(formatValues(message, values))");
    expect(i18n).toContain("new IntlMessageFormat(message, locale)");
    const pkg = [...files].find(([p]) => p.endsWith("web/package.json"))![1];
    expect(pkg).toContain("intl-messageformat");
  });

  it("translates the app-shell skip link through t() when the UI is i18n-enabled", async () => {
    // Pack-chrome (M-T1.11): the shell's baked-in "Skip to content" link binds
    // through `t()` keyed to the merged APP_SHELL_CHROME catalog, and App.vue
    // imports `{ t }` from `./i18n` (the shell sits at `src/App.vue`).
    const files = await generateSystemFiles(SYSTEM(`Heading { "Welcome" }`));
    const app = [...files].find(([p]) => p.endsWith("src/App.vue"))![1];
    expect(app).toContain(`{{ t("chrome.skipToContent", "Skip to content") }}`);
    // The primary-navigation landmark aria binds through Vue's `:aria-label`.
    expect(app).toContain(`:aria-label='t("chrome.primaryNav", "Primary navigation")'`);
    expect(app).toContain(`import { t } from "./lib/locale"`);
    const catalog = JSON.parse(
      [...files].find(([p]) => p.endsWith("src/locales/en.json"))![1],
    ) as Record<string, string>;
    expect(catalog["chrome.skipToContent"]).toBe("Skip to content");
    expect(catalog["chrome.primaryNav"]).toBe("Primary navigation");
    // The error boundary's heading is a `title=` PROP on vuetify's `<v-alert>`
    // (a text child on shadcnVue) — the attribute form binds as `:title='t(…)'`.
    expect(app).toContain(`:title='t("chrome.somethingWentWrong", "Something went wrong")'`);
    expect(catalog["chrome.somethingWentWrong"]).toBe("Something went wrong");
  });

  it("leaves the app-shell skip link byte-identical for a string-less app", async () => {
    // No authored strings ⇒ no translation runtime; the shell renders the raw
    // "Skip to content" text and emits NO `t` import (pre-i18n byte-identical).
    const files = await generateSystemFiles(SYSTEM(`Text { status }`));
    const app = [...files].find(([p]) => p.endsWith("src/App.vue"))![1];
    expect(app).toContain(`>Skip to content<`);
    expect(app).toContain(`title="Something went wrong"`);
    expect(app).not.toContain("import { t }");
    expect([...files].some(([p]) => p.endsWith("locales/en.json"))).toBe(false);
  });

  it("reads the Toolbar's DEFAULT accessible name through the catalog", async () => {
    // The a11y contract's fallback name has no source literal; it reads the
    // `chrome.toolbarActions` catalog entry so a locale can translate it.
    const files = await generateSystemFiles(SYSTEM(`Toolbar { Heading { "Orders" } }`));
    expect(await homeOf(files)).toContain("chrome.toolbarActions");
    expect(await homeOf(files)).not.toContain(`role="toolbar" aria-label="Actions"`);
  });

  it("never translates the CodeBlock source (the caption's binding is the round-trip gate's)", async () => {
    const home = await homeOf(
      await generateSystemFiles(
        SYSTEM(`CodeBlock { "let total = 1", language: "typescript", title: "Example" }`),
      ),
    );
    expect(home).toContain("let total = 1");
  });
});

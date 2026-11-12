// React translation runtime (M-T1.11, i18n.md Phase 2) — a UI with user-visible
// strings emits `{t("<key>", "<default>")}` for literal text slots (keyed
// IDENTICALLY to the `.loom/messages.en.json` catalog), plus a generated
// `src/i18n.ts` shim and `src/locales/en.json`. A string-less app is unchanged.

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
    deployable web { platform: react targets: api ui: Web { Sales: api } port: 3100 }
  }
`;

async function pageOf(files: Map<string, string>): Promise<string> {
  const entry = [...files].find(([p]) => p.endsWith("home.tsx"));
  if (!entry) throw new Error("home.tsx not emitted");
  return entry[1];
}

/** The emitted app catalog (`src/locales/en.json`). */
function catalogOf(files: Map<string, string>): Record<string, string> {
  return JSON.parse([...files].find(([p]) => p.endsWith("src/locales/en.json"))![1]) as Record<
    string,
    string
  >;
}

describe("React i18n runtime", () => {
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
    const home = await pageOf(files);
    expect(home).toContain('"Orders")'); // the literal heading is translated
    // `status` is a page param ref — interpolated, never a t() call.
    expect(home).not.toContain('t("Web.page.Home.text');
  });

  it("does not emit the runtime for a string-less app", async () => {
    // A page whose only text is a dynamic ref has no extractable strings.
    const files = await generateSystemFiles(SYSTEM(`Text { status }`));
    expect([...files].some(([p]) => p.endsWith("src/i18n.ts"))).toBe(false);
    expect([...files].some(([p]) => p.endsWith("locales/en.json"))).toBe(false);
    const home = await pageOf(files);
    expect(home).not.toContain("import { t }");
  });

  it("emits an interpolated template as a 3-arg ICU t() call + catalog entry", async () => {
    // A page param so the interpolation hole resolves to a real ref.
    const withParam = SYSTEM("Heading { `Status: {code}` }").replace(
      'page Home { route: "/"',
      'page Home(code: string) { route: "/:code"',
    );
    const files = await generateSystemFiles(withParam);
    const home = [...files].find(([p]) => p.endsWith("home.tsx"))![1];
    // Named-display default + a values object; keyed to the catalog.
    expect(home).toMatch(
      /<Title order=\{2\}>\{t\("[^"]*", "Status: \{code\}", \{ code: code \}\)\}<\/Title>/,
    );
    const locale = [...files].find(([p]) => p.endsWith("src/locales/en.json"))?.[1];
    expect(Object.values(JSON.parse(locale!) as Record<string, string>)).toContain(
      "Status: {code}",
    );
  });

  it("formats the shim via intl-messageformat (ICU, not a {name} regex)", async () => {
    // Slice 1 swaps the old `message.replace(/{name}/)` regex shim for the ICU
    // engine so a `, number` / `, date` format suffix locale-formats at runtime.
    const files = await generateSystemFiles(SYSTEM(`Heading { "Hi" }`));
    const i18n = [...files].find(([p]) => p.endsWith("src/i18n.ts"))![1];
    expect(i18n).toContain('import { IntlMessageFormat } from "intl-messageformat"');
    expect(i18n).toContain("formatterFor(current, message).format(formatValues(message, values))");
    expect(i18n).toContain("new IntlMessageFormat(message, locale)");
    // `values` widened to admit Date (`, date`), boolean and a Decimal (`, number`).
    expect(i18n).toContain(
      "type Values = Record<string, string | number | boolean | Date | NumberLike>;",
    );
    expect(i18n).toMatch(/values\?: Values/);
    // No leftover regex shim.
    expect(i18n).not.toContain("message.replace(");
    // A plain 2-arg call (no values) still returns the message untouched (no parse cost).
    expect(i18n).toContain("if (values === undefined) return message;");
  });

  it("emits a formatted hole as an ICU message with skeleton + the raw value in values", async () => {
    // `{total, number, ::currency/USD}` — the skeleton rides into the catalog +
    // the t() default, and `values` carries the RAW money value (not stringified).
    const withParam = SYSTEM("Heading { `Total: {total, number, ::currency/USD}` }").replace(
      'page Home { route: "/"',
      'page Home(total: money) { route: "/:total"',
    );
    const files = await generateSystemFiles(withParam);
    const home = [...files].find(([p]) => p.endsWith("home.tsx"))![1];
    expect(home).toMatch(
      /\{t\("[^"]*", "Total: \{total, number, ::currency\/USD\}", \{ total: total \}\)\}/,
    );
    const locale = [...files].find(([p]) => p.endsWith("src/locales/en.json"))![1];
    expect(Object.values(JSON.parse(locale) as Record<string, string>)).toContain(
      "Total: {total, number, ::currency/USD}",
    );
    // The stack carries the ICU engine dependency.
    const pkg = [...files].find(([p]) => p.endsWith("web/package.json"))![1];
    expect(pkg).toContain("intl-messageformat");
  });

  it("emits a plural + select hole as a nested-brace ICU message (slice 2)", async () => {
    // The brace-balanced lexer captures the whole plural/select body; the raw
    // ICU string rides verbatim into the catalog + the t() default, and the
    // intl-messageformat runtime renders the count-/value-selected branch.
    const withParam = SYSTEM(
      "Stack { " +
        "Text { `You have {count, plural, one {# order} other {# orders}}` }, " +
        "Text { `Status: {status, select, shipped {Shipped} other {Pending}}` } }",
    )
      // `status` arrives as a route PARAM here, so the page-state declaration
      // the other legs carry would collide with it.
      .replace(' state { status: string = "" }', "")
      .replace(
        'page Home { route: "/"',
        'page Home(count: int, status: string) { route: "/:count"',
      );
    const files = await generateSystemFiles(withParam);
    const home = [...files].find(([p]) => p.endsWith("home.tsx"))![1];
    expect(home).toContain(
      't("Web.page.Home.text.io7xmj", "You have {count, plural, one {# order} other {# orders}}", { count: count })',
    );
    expect(home).toContain(
      't("Web.page.Home.text.0lqlui", "Status: {status, select, shipped {Shipped} other {Pending}}", { status: status })',
    );
    const catalog = JSON.parse(
      [...files].find(([p]) => p.endsWith("src/locales/en.json"))![1],
    ) as Record<string, string>;
    expect(Object.values(catalog)).toContain(
      "You have {count, plural, one {# order} other {# orders}}",
    );
    expect(Object.values(catalog)).toContain(
      "Status: {status, select, shipped {Shipped} other {Pending}}",
    );
  });

  it("keeps the Toolbar's DEFAULT accessible name a static attribute", async () => {
    // "Actions" is the a11y contract's fallback — no source literal, so it is not
    // in the catalog and must never bind through `t()` (its key would resolve to
    // nothing).  Byte-identical to the pre-i18n emission.
    const files = await generateSystemFiles(SYSTEM(`Toolbar { Heading { "Orders" } }`));
    expect(await pageOf(files)).toContain(`role="toolbar" aria-label="Actions"`);
  });

  it("renders the translated Divider label on the chakra packs too", async () => {
    // A `hasLabel` branch identical to the unlabelled one extracts the label
    // into the catalog and renders it NOWHERE — a translator translating a
    // string the app never shows.  The pack splits the rule around the label.
    for (const design of ["chakra", `"chakra@v3"`]) {
      const files = await generateSystemFiles(
        SYSTEM(`Divider { label: "Section break" }`).replace(
          "ui: Web { Sales: api } port: 3100",
          `ui: Web { Sales: api } port: 3100 design: ${design}`,
        ),
      );
      const home = await pageOf(files);
      expect(home, design).toMatch(/t\("Web\.page\.Home\.dividerLabel\.\w+", "Section break"\)/);
      expect(home, design).toContain("<HStack");
    }
  });
  // --- the two AUTHORED slots that had no catalog entry (M-T1.11) ----------

  it("keeps a decorative Icon hidden — no name, no catalog entry", async () => {
    // The decorative-by-default arm is byte-identical to pre-i18n: a glyph with
    // no `label:` is `aria-hidden`, and there is nothing to translate.
    const home = await pageOf(
      await generateSystemFiles(SYSTEM(`Stack { Heading { "Orders" }, Icon { name: "check" } }`)),
    );
    expect(home).toContain(`aria-hidden="true"`);
    expect(home).not.toContain("iconLabel");
  });

  it("never translates the CodeBlock source (the caption's binding is the round-trip gate's)", async () => {
    const files = await generateSystemFiles(
      SYSTEM(`CodeBlock { "let total = 1", language: "typescript", title: "Example" }`),
    );
    const home = await pageOf(files);
    // The SOURCE is code, not prose — translating it would break it.
    expect(home).toContain("let total = 1");
    const catalog = catalogOf(files);
    expect(Object.values(catalog)).not.toContain("let total = 1");
  });
});

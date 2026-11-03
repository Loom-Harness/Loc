// `i18n { source: … }` — the declared source language replaces the hardcoded
// `en` in every place the generators wrote it: the source catalog's file name,
// the runtime fallback, the `<html lang>` of the shells, Phoenix's `.po` tree.
// A system with no `i18n` block is byte-for-byte the English output.

import { describe, expect, it } from "vitest";
import { generateSystemFiles, parseString } from "../_helpers/index.js";

const DOMAIN = `
    subdomain S {
      context C {
        aggregate Doc with crudish { name: string }
        repository Docs for Doc { }
      }
    }
    api DemoApi from S`;

const UI = `
    ui Web {
      api Ops: DemoApi
      page Home { route: "/" body: Stack { Heading { "Willkommen" } } }
    }`;

const system = (i18n: string, deployable: string): string => `
  system Demo {${i18n}${DOMAIN}
    ${UI}
    storage loomDb { type: postgres }
    resource cState { for: C, kind: state, use: loomDb }
    deployable api { platform: node, contexts: [C], dataSources: [cState], serves: DemoApi, port: 3000 }
    ${deployable}
  }
`;

const spa = (platform: string, i18n = ""): string =>
  system(
    i18n,
    `deployable web { platform: ${platform}, targets: api, ui: Web { Ops: api }, port: 3001 }`,
  );

const phoenix = (i18n = ""): string => `
  system Demo {${i18n}${DOMAIN}
    ${UI}
    storage loomDb { type: postgres }
    resource cState { for: C, kind: state, use: loomDb }
    deployable phoenixApp {
      platform: elixir, contexts: [C], dataSources: [cState], serves: DemoApi,
      ui: Web { Ops: phoenixApp }, port: 4000
    }
  }
`;

const DE = '\n  i18n { source: "de" }';

const file = (files: Map<string, string>, suffix: string): string | undefined =>
  [...files].find(([p]) => p.endsWith(suffix))?.[1];

describe("i18n { source } — the grammar and the validators", () => {
  it('parses `i18n { source: "de" }` and the empty block', async () => {
    for (const block of ['i18n { source: "pt-BR" }', "i18n { }", 'i18n { source: "de", }']) {
      const { diagnostics } = await parseString(
        `system S { subdomain D { context C { aggregate A { n: string } } } ${block} }`,
      );
      expect(diagnostics.filter((d) => d.severity === 1)).toEqual([]);
    }
  });

  it("rejects a tag that is not BCP-47 (loom.i18n-source-invalid)", async () => {
    const { diagnostics } = await parseString(
      'system S { subdomain D { context C { aggregate A { n: string } } } i18n { source: "en_US" } }',
    );
    expect(diagnostics.map((d) => d.code)).toContain("loom.i18n-source-invalid");
  });

  it("rejects a second block (loom.i18n-duplicate)", async () => {
    const { diagnostics } = await parseString(
      'system S { subdomain D { context C { aggregate A { n: string } } } i18n { source: "en" } i18n { source: "de" } }',
    );
    expect(diagnostics.map((d) => d.code)).toContain("loom.i18n-duplicate");
  });
});

describe('i18n { source: "de" } — generated output', () => {
  it("names the source catalog after the declared language", async () => {
    const files = await generateSystemFiles(spa("react", DE));
    expect(file(files, ".loom/messages.de.json")).toBeDefined();
    expect(file(files, ".loom/messages.en.json")).toBeUndefined();
  });

  for (const platform of ["react", "vue", "svelte", "angular"]) {
    it(`${platform}: the catalog file, the import and the fallback follow the source`, async () => {
      const files = await generateSystemFiles(spa(platform, DE));
      const catalog = [...files.keys()].find((p) => /locales\/de\.json$/.test(p));
      expect(catalog, "source catalog").toBeDefined();
      expect([...files.keys()].some((p) => /locales\/en\.json$/.test(p))).toBe(false);
      const runtime = [...files].find(([p]) => /\/i18n\.ts$/.test(p))![1];
      expect(runtime).toContain('/locales/de.json"');
      expect(runtime).toContain('"de"');
      expect(runtime).not.toContain('"en"');
      expect(runtime).toContain('export const SOURCE_LOCALE = "de";');
      const html = [...files].find(([p]) => /(^|\/)(index|app)\.html$/.test(p))![1];
      expect(html).toContain('<html lang="de"');
    });
  }

  it("a translated locale is registered beside the source, never the source itself", async () => {
    const files = await generateSystemFiles(spa("react", DE), {
      translations: new Map<string, Record<string, string>>([
        ["de", { "x.y": "ignored: de is the source" }],
        ["fr", { "Web.page.Home.heading.zzzzzz": "Bienvenue" }],
      ]),
    });
    const runtime = file(files, "src/i18n.ts")!;
    expect(runtime).toContain('"fr": loc_fr as Catalog');
    // One import of `de.json`: the source catalog, not a second translated copy.
    expect(runtime.match(/\.\/locales\/de\.json/g)).toHaveLength(1);
    expect(file(files, "src/locales/fr.json")).toBeDefined();
    expect(file(files, "src/locales/de.json")).not.toContain("ignored");
  });

  it("feliz and flutter fall back to the source language", async () => {
    const feliz = await generateSystemFiles(spa("feliz", DE));
    const fs = file(feliz, "src/App.fs")!;
    expect(fs).toContain('Map.ofList [ "de", src_de ]');
    expect(fs).toContain('else "de"');
    expect(fs).toContain("'de').split('-')");
    expect(file(feliz, "index.html")).toContain('<html lang="de"');
    expect(fs).not.toContain('"en"');

    const flutter = await generateSystemFiles(spa("flutter", DE));
    const dart = file(flutter, "lib/i18n.dart")!;
    expect(dart).toContain("'de': _src_de,");
    expect(dart).toContain(": 'de';");
    expect(dart).not.toContain("'en'");
  });

  it("phoenix: the .po tree, gettext's default locale, the CLDR backend and the layout lang", async () => {
    const files = await generateSystemFiles(phoenix(DE));
    const po = file(files, "priv/gettext/de/LC_MESSAGES/default.po")!;
    expect(po).toContain('"Language: de\\n"');
    expect([...files.keys()].some((p) => p.includes("priv/gettext/en/"))).toBe(false);
    expect(file(files, "config/config.exs")).toContain('config :gettext, :default_locale, "de"');
    expect(file(files, "layouts/root.html.heex")).toContain('<html lang="de"');
    expect(file(files, "controllers/error_html.ex")).toContain('<html lang="de">');
  });

  it("phoenix with an interpolated message points the CLDR backend at the source", async () => {
    const source = phoenix(DE).replace(
      'page Home { route: "/" body: Stack { Heading { "Willkommen" } } }',
      'page Home { route: "/" state { name: string = "" } body: Stack { Heading { "Willkommen" }, Text { `Hallo {name}` } } }',
    );
    const files = await generateSystemFiles(source);
    const cldr = file(files, "/cldr.ex");
    expect(cldr).toContain('locales: ["de"]');
    expect(cldr).toContain('default_locale: "de"');
  });
});

describe("no i18n block — the English output is unchanged", () => {
  it("keeps `en` everywhere the source language is written", async () => {
    const files = await generateSystemFiles(spa("react"));
    expect(file(files, ".loom/messages.en.json")).toBeDefined();
    const runtime = file(files, "src/i18n.ts")!;
    expect(runtime).toContain('import en from "./locales/en.json";');
    expect(runtime).toContain('export const SOURCE_LOCALE = "en";');
    expect(file(files, "index.html")).toContain('<html lang="en"');

    const ph = await generateSystemFiles(phoenix());
    expect(file(ph, "priv/gettext/en/LC_MESSAGES/default.po")).toContain('"Language: en\\n"');
    expect(file(ph, "config/config.exs")).not.toContain(":default_locale");
  });

  it('an explicit `source: "en"` is the same output as no block', async () => {
    const a = await generateSystemFiles(spa("react"));
    const b = await generateSystemFiles(spa("react", '\n  i18n { source: "en" }'));
    expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
    for (const [p, c] of a) expect(b.get(p), p).toBe(c);
  });
});

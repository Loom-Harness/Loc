// The runtime locale model of the generated frontends (issue "runtime locale
// model"): the negotiation chain, the reactive store, the locale names and
// directions computed at generate time, and what the React app wires to it
// (the shell switcher, `Accept-Language`, locale-aware formatters).
//
// The runtime is JS the generator EMITS, so the behavioural tests compile the
// emitted `src/i18n.ts` and run it against a faked browser — asserting on its
// text alone would pass for a module that negotiates in the wrong order.

import ts from "typescript";
import { describe, expect, it } from "vitest";
import { renderI18nModule } from "../../../src/generator/_frontend/i18n-runtime.js";
import {
  baseAliases,
  localeDir,
  localeEndonym,
  localeEntries,
} from "../../../src/generator/_frontend/locale-meta.js";
import { generateSystemFiles } from "../../_helpers/index.js";

/** Stand-in for `intl-messageformat` (a dependency of the GENERATED app, not of
 *  the toolchain): substitutes `{x}` and `{x, number}` through the locale it was
 *  built with, and counts constructions so the cache is observable. */
let formatterBuilds = 0;
class FakeIntlMessageFormat {
  constructor(
    private readonly message: string,
    private readonly locale: string,
  ) {
    formatterBuilds++;
  }
  format(values: Record<string, unknown>): string {
    return this.message.replace(/\{(\w+)(?:, number)?\}/g, (_w, k: string) =>
      typeof values[k] === "number"
        ? new Intl.NumberFormat(this.locale).format(values[k] as number)
        : String(values[k]),
    );
  }
}

interface FakeBrowser {
  search?: string;
  stored?: string;
  languages?: string[];
  language?: string;
}

interface Runtime {
  getLocale(): string;
  setLocale(tag: string): void;
  subscribe(listener: () => void): () => void;
  resolveLocale(candidates: string[]): string;
  matchLocale(candidates: string[]): string | undefined;
  t(key: string, d: string, values?: Record<string, unknown>): string;
  LOCALES: Array<{ tag: string; name: string; dir: string }>;
  env: {
    storage: Map<string, string>;
    doc: {
      documentElement: { lang: string; dir: string };
      cookie: string;
      querySelector: (selector: string) => null;
    };
    replaced: string[];
  };
}

/** Compile the emitted `i18n.ts` and run it against a faked browser. */
function load(
  locales: readonly string[],
  source: string,
  browser: FakeBrowser = {},
  catalogs: Record<string, Record<string, string>> = {},
): Runtime {
  const src = renderI18nModule(locales, source);
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const storage = new Map<string, string>();
  if (browser.stored !== undefined) storage.set("loom.locale", browser.stored);
  const replaced: string[] = [];
  const doc = { documentElement: { lang: "", dir: "" }, cookie: "", querySelector: () => null };
  const win = {
    location: {
      search: browser.search ?? "",
      href: `https://app.test/${browser.search ?? ""}`,
    },
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
    },
    history: {
      state: null,
      replaceState: (_s: unknown, _t: string, url: URL) => replaced.push(String(url)),
    },
  };
  const nav = { languages: browser.languages, language: browser.language };
  const mod = { exports: {} as Record<string, unknown> };
  const req = (id: string): unknown => {
    if (id === "intl-messageformat") return { IntlMessageFormat: FakeIntlMessageFormat };
    const m = /^\.\/locales\/(.+)\.json$/.exec(id);
    if (m) return catalogs[m[1]!] ?? {};
    throw new Error(`unexpected import ${id}`);
  };
  new Function("exports", "require", "module", "window", "navigator", "document", js)(
    mod.exports,
    req,
    mod,
    win,
    nav,
    doc,
  );
  return { ...(mod.exports as object), env: { storage, doc, replaced } } as unknown as Runtime;
}

describe("negotiation order — URL, stored choice, navigator.languages, source", () => {
  const shipped = ["de", "fr"];

  it("the URL wins over a stored choice and the browser", () => {
    const rt = load(shipped, "en", { search: "?lang=fr", stored: "de", languages: ["de"] });
    expect(rt.getLocale()).toBe("fr");
  });

  it("the stored choice wins over navigator.languages", () => {
    const rt = load(shipped, "en", { stored: "fr", languages: ["de"] });
    expect(rt.getLocale()).toBe("fr");
  });

  it("navigator.languages is read in order, not just the first entry", () => {
    const rt = load(shipped, "en", { languages: ["it", "fr", "de"], language: "it" });
    expect(rt.getLocale()).toBe("fr");
  });

  it("falls back to the source language when nothing matches", () => {
    const rt = load(shipped, "en", { search: "?lang=xx", stored: "yy", languages: ["it"] });
    expect(rt.getLocale()).toBe("en");
  });

  it("an unresolvable URL candidate does not hide a resolvable stored one", () => {
    const rt = load(shipped, "en", { search: "?lang=xx", stored: "fr" });
    expect(rt.getLocale()).toBe("fr");
  });

  it("the source language is the answer when it is not English", () => {
    const rt = load(["en"], "de", { languages: ["it"] });
    expect(rt.getLocale()).toBe("de");
  });
});

describe("exact tag first, then the base language", () => {
  it("de-AT resolves to de; an exact regional catalog beats its base", () => {
    expect(load(["de"], "en", { languages: ["de-AT"] }).getLocale()).toBe("de");
    expect(load(["de", "de-CH"], "en", { languages: ["de-CH"] }).getLocale()).toBe("de-CH");
    expect(load(["de", "de-CH"], "en", { languages: ["de-AT"] }).getLocale()).toBe("de");
  });

  it("the match is case-insensitive and tolerates an underscore", () => {
    expect(load(["pt-BR"], "en", { languages: ["pt_br"] }).getLocale()).toBe("pt-BR");
  });

  it("pt-BR + pt-PT with no pt.json: each tag resolves exactly, a bare pt resolves to neither", () => {
    const locales = ["pt-BR", "pt-PT"];
    const rt = load(locales, "en");
    expect(rt.matchLocale(["pt-BR"])).toBe("pt-BR");
    expect(rt.matchLocale(["pt-PT"])).toBe("pt-PT");
    expect(rt.matchLocale(["pt"])).toBeUndefined();
    expect(rt.resolveLocale(["pt"])).toBe("en");
  });

  it("pt-BR + pt-PT registers no duplicate key (TS1117) — every catalog key appears once", () => {
    const src = renderI18nModule(["pt-BR", "pt-PT"], "en");
    const block = /const catalogs: Record<string, Catalog> = \{([\s\S]*?)\n\};/.exec(src)![1]!;
    const keys = [...block.matchAll(/^\s+("?[\w-]+"?):/gm)].map((m) => m[1]);
    expect(keys).toEqual(['"en"', '"pt-BR"', '"pt-PT"'].map((k) => (k === '"en"' ? '"en"' : k)));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("a lone regional variant also answers to its base language", () => {
    expect(baseAliases("en", ["pt-BR"])).toEqual({ pt: "pt-BR" });
    expect(load(["pt-BR"], "en", { languages: ["pt"] }).getLocale()).toBe("pt-BR");
  });

  it("no alias when the base has its own catalog, two variants ship, or it is the source's base", () => {
    expect(baseAliases("en", ["pt", "pt-BR"])).toEqual({});
    expect(baseAliases("en", ["pt-BR", "pt-PT"])).toEqual({});
    expect(baseAliases("en", ["en-GB"])).toEqual({});
    // The source counts as a variant: pt-BR (source) + pt-PT is still ambiguous.
    expect(baseAliases("pt-BR", ["pt-PT"])).toEqual({});
  });
});

describe("the reactive store", () => {
  it("setLocale persists the choice (storage + cookie), notifies, and updates <html lang dir>", () => {
    const rt = load(["de", "ar"], "en", { languages: ["en"] });
    let calls = 0;
    const off = rt.subscribe(() => calls++);
    rt.setLocale("ar");
    expect(rt.getLocale()).toBe("ar");
    expect(calls).toBe(1);
    expect(rt.env.storage.get("loom.locale")).toBe("ar");
    expect(rt.env.doc.cookie).toContain("loom_locale=ar");
    expect(rt.env.doc.documentElement.lang).toBe("ar");
    expect(rt.env.doc.documentElement.dir).toBe("rtl");
    rt.setLocale("de");
    expect(rt.env.doc.documentElement.dir).toBe("ltr");
    off();
    rt.setLocale("ar");
    expect(calls).toBe(2);
  });

  it("setting the active locale again does not notify; an unknown tag is ignored", () => {
    const rt = load(["de"], "en");
    let calls = 0;
    rt.subscribe(() => calls++);
    rt.setLocale("en");
    rt.setLocale("xx");
    expect(calls).toBe(0);
    expect(rt.env.storage.has("loom.locale")).toBe(true);
    expect(rt.env.storage.get("loom.locale")).toBe("en");
  });

  it("rewrites a stale ?lang= so a reload keeps the new choice", () => {
    const rt = load(["de", "fr"], "en", { search: "?lang=de" });
    rt.setLocale("fr");
    expect(rt.env.replaced).toEqual(["https://app.test/?lang=fr"]);
  });

  it("t() reads the active locale and falls back per key to the default", () => {
    const rt = load(["de"], "en", { languages: ["en"] }, { de: { "k.a": "Hallo" } });
    expect(rt.t("k.a", "Hello")).toBe("Hello");
    rt.setLocale("de");
    expect(rt.t("k.a", "Hello")).toBe("Hallo");
    expect(rt.t("k.b", "Bye")).toBe("Bye");
  });

  it("formats ICU holes in the active locale", () => {
    const rt = load(["de"], "en", { languages: ["en"] });
    const message = "{n, number}";
    expect(rt.t("k", message, { n: 1234567.5 })).toBe("1,234,567.5");
    rt.setLocale("de");
    expect(rt.t("k", message, { n: 1234567.5 })).toBe("1.234.567,5");
  });

  it("caches one IntlMessageFormat per (locale, message)", () => {
    const rt = load(["de"], "en", { languages: ["en"] });
    formatterBuilds = 0;
    rt.t("k", "{n, number}", { n: 1 });
    rt.t("k", "{n, number}", { n: 2 });
    expect(formatterBuilds).toBe(1);
    rt.t("k", "{n} items", { n: 2 });
    expect(formatterBuilds).toBe(2);
    rt.setLocale("de");
    rt.t("k", "{n, number}", { n: 3 });
    expect(formatterBuilds).toBe(3);
  });
});

describe("locale names and direction are computed at generate time", () => {
  it("each locale is named in its own language", () => {
    expect(localeEndonym("de")).toBe("Deutsch");
    expect(localeEndonym("fr")).toBe("Français");
    expect(localeEndonym("es")).toBe("Español");
    expect(localeEndonym("ja")).toBe("日本語");
    expect(localeEndonym("pt-BR")).toBe("Português (Brasil)");
  });

  it("an unnameable tag falls back to itself", () => {
    expect(localeEndonym("zz-invalid-tag-!!")).toBe("zz-invalid-tag-!!");
  });

  it("right-to-left scripts and languages are rtl; the rest are ltr", () => {
    for (const tag of ["ar", "he", "fa", "ur", "ar-EG", "yi", "ps", "ku-Arab"]) {
      expect(localeDir(tag), tag).toBe("rtl");
    }
    for (const tag of ["en", "de", "ja", "pt-BR", "sd-Deva", "zh-Hant"]) {
      expect(localeDir(tag), tag).toBe("ltr");
    }
  });

  it("localeEntries lists the source first, then the rest sorted", () => {
    expect(localeEntries("en", ["fr", "de", "en"]).map((e) => e.tag)).toEqual(["en", "de", "fr"]);
  });

  it("the emitted LOCALES table carries them as plain strings", () => {
    const rt = load(["de", "fr", "ar"], "en");
    expect(rt.LOCALES).toEqual([
      { tag: "en", name: "English", dir: "ltr" },
      { tag: "ar", name: "العربية", dir: "rtl" },
      { tag: "de", name: "Deutsch", dir: "ltr" },
      { tag: "fr", name: "Français", dir: "ltr" },
    ]);
  });
});

// --- the generated React app -------------------------------------------------

const UI = `
    ui Web {
      api Ops: DemoApi
      page Home {
        route: "/"
        title: "Welcome"
        body: Stack { Heading { "All the documents" }, Text { "Second sentence" } }
      }
    }`;

const system = (ui: string, i18n = ""): string => `
  system Demo {${i18n}
    subdomain S {
      context C {
        aggregate Doc with crudish { name: string }
        repository Docs for Doc { }
      }
    }
    api DemoApi from S
    ${ui}
    storage loomDb { type: postgres }
    resource cState { for: C, kind: state, use: loomDb }
    deployable api { platform: node, contexts: [C], dataSources: [cState], serves: DemoApi, port: 3000 }
    deployable web { platform: react, targets: api, ui: Web { Ops: api }, design: mantine, port: 3001 }
  }
`;

const catalogsFor = (...locales: string[]): Map<string, Record<string, string>> =>
  new Map(locales.map((l) => [l, {}]));

const file = (files: Map<string, string>, suffix: string): string | undefined =>
  [...files].find(([p]) => p.endsWith(suffix))?.[1];

describe("React app — shell switcher", () => {
  it("mounts the switcher in the header and subscribes the root at 2+ locales", async () => {
    const files = await generateSystemFiles(system(UI), {
      translations: catalogsFor("de", "fr"),
    });
    const shell = file(files, "web/src/App.tsx") ?? file(files, "src/App.tsx")!;
    expect(shell).toContain('import { LocaleSwitcher, useLocale } from "./lib/locale-switcher";');
    expect(shell).toContain("<LocaleSwitcher />");
    expect(shell).toMatch(/export default function App\(\) \{\n {2}useLocale\(\);/);
    const mod = file(files, "src/lib/locale-switcher.tsx")!;
    expect(mod).toContain("useSyncExternalStore(subscribe, getLocale, getLocale)");
    expect(mod).toContain("onChange={(e) => setLocale(e.target.value)}");
  });

  it("is absent with the source language alone", async () => {
    const files = await generateSystemFiles(system(UI));
    const shell = file(files, "src/App.tsx")!;
    expect(shell).not.toContain("LocaleSwitcher");
    expect(shell).not.toContain("useLocale");
  });

  it("a translator tree holding only the source language is still one locale", async () => {
    const files = await generateSystemFiles(system(UI), { translations: catalogsFor("en") });
    expect(file(files, "src/App.tsx")).not.toContain("<LocaleSwitcher />");
  });

  it("sets <html lang dir> from the source language, rtl included", async () => {
    const ar = await generateSystemFiles(system(UI, '\n  i18n { source: "ar" }'));
    expect(file(ar, "index.html")).toContain('<html lang="ar" dir="rtl"');
    const en = await generateSystemFiles(system(UI));
    expect(file(en, "index.html")).toContain('<html lang="en" dir="ltr"');
  });

  it("an app with no strings keeps its index.html and emits no locale runtime", async () => {
    const off = `ui Web { api Ops: DemoApi page Home { route: "/" state { q: string = "" } body: Stack { Text { q } } } }`;
    const files = await generateSystemFiles(system(off));
    expect(file(files, "index.html")).toContain('<html lang="en">');
    expect(file(files, "src/lib/locale-switcher.tsx")).toBeUndefined();
    expect(file(files, "src/api/client.ts")).not.toContain("accept-language");
    expect(file(files, "src/lib/format.tsx")).toContain("toLocaleString(undefined");
  });
});

describe("React app — one locale for text, formatting and the API", () => {
  it("the API client sends Accept-Language: <active locale> on JSON and upload requests", async () => {
    const files = await generateSystemFiles(system(UI), { translations: catalogsFor("de") });
    const client = file(files, "src/api/client.ts")!;
    expect(client).toContain('import { getLocale } from "../i18n";');
    expect(client.match(/"accept-language": getLocale\(\)/g)).toHaveLength(2);
  });

  it("the pack format helpers take the active locale, not the browser default", async () => {
    const files = await generateSystemFiles(system(UI), { translations: catalogsFor("de") });
    const fmt = file(files, "src/lib/format.tsx")!;
    expect(fmt).toContain('import { getLocale } from "../i18n";');
    expect(fmt).toContain("toLocaleString(getLocale(),");
    expect(fmt).toContain("Intl.NumberFormat(getLocale(),");
    expect(fmt).not.toContain("(undefined,");
  });

  for (const design of ["mui", "chakra", "shadcn"]) {
    it(`${design}: shell switcher and locale-aware helpers`, async () => {
      const src = system(UI).replace("design: mantine", `design: ${design}`);
      const files = await generateSystemFiles(src, { translations: catalogsFor("de") });
      expect(file(files, "src/App.tsx")).toContain("<LocaleSwitcher />");
      expect(file(files, "src/lib/format.tsx")).toContain("getLocale()");
    });
  }
});

describe("LocaleSwitcher primitive", () => {
  const withSwitcher = `
    ui Web {
      api Ops: DemoApi
      page Home { route: "/" body: Stack { Heading { "Hello" }, LocaleSwitcher {} } }
    }`;

  it("renders the generated component and imports it", async () => {
    const files = await generateSystemFiles(system(withSwitcher), {
      translations: catalogsFor("de"),
    });
    const home = file(files, "src/pages/home.tsx")!;
    expect(home).toContain("<LocaleSwitcher />");
    expect(home).toMatch(/import \{ LocaleSwitcher \} from "\.\.\/lib\/locale-switcher";/);
  });

  it("ships the locale runtime even when it is the only i18n-relevant thing on the page", async () => {
    const only = `ui Web { api Ops: DemoApi page Home { route: "/" body: Stack { LocaleSwitcher {} } } }`;
    const files = await generateSystemFiles(system(only));
    expect(file(files, "src/i18n.ts")).toBeDefined();
    expect(file(files, "src/lib/locale-switcher.tsx")).toBeDefined();
  });
});

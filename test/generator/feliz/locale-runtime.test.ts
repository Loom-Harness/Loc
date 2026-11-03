// The runtime locale model of the generated Feliz app: the F# `I18n` module's
// negotiation (`?lang=`, the stored choice, the browser's languages, the source),
// the base-language aliases, the reactive switch (an Elmish message), the
// `LocaleSwitcher` primitive, the shell header, and `Accept-Language`.
//
// The F# is not executed here: these are text-level assertions over the emitted
// module (the React twin runs its emitted JS against a faked browser in
// `test/generator/_frontend/locale-runtime.test.ts`).  The behaviour itself is
// proved by `dotnet fable` + a real browser run, recorded on the PR.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const PAGES = `
    page Home { route: "/" title: "Welcome" body: Stack { Heading { "All the documents" }, Text { "Second sentence" } } }
    page About { route: "/about" body: Heading { "About" } }`;

const system = (pages = PAGES, i18n = ""): string => `
  system Demo {${i18n}
    subdomain S {
      context C {
        aggregate Doc with crudish { name: string }
        repository Docs for Doc { }
      }
    }
    api DemoApi from S
    ui Web {
      framework: feliz
      api Ops: DemoApi
      ${pages}
    }
    storage loomDb { type: postgres }
    resource cState { for: C, kind: state, use: loomDb }
    deployable api { platform: node, contexts: [C], dataSources: [cState], serves: DemoApi, port: 3000 }
    deployable web { platform: feliz, targets: api, ui: Web { Ops: api }, port: 3001 }
  }
`;

const catalogsFor = (...locales: string[]): Map<string, Record<string, string>> =>
  new Map(locales.map((l) => [l, {}]));

async function appFs(locales: readonly string[] = [], pages = PAGES, i18n = ""): Promise<string> {
  const files = await generateSystemFiles(system(pages, i18n), {
    translations: catalogsFor(...locales),
  });
  return [...files].find(([p]) => p.endsWith("src/App.fs"))![1];
}

/** The rows of the module's `tagIndex` (`"de", "de"` / alias `"pt", "pt-BR"`). */
function tagRows(fs: string): string[] {
  const block = /let private tagIndex: Map<string, string> =\n {8}Map\.ofList\n([\s\S]*?)\n\n/.exec(
    fs,
  )![1]!;
  return [...block.matchAll(/"([^"]+)", "([^"]+)"/g)].map((m) => `${m[1]}=${m[2]}`);
}

describe("negotiation order — URL, stored choice, browser languages, source", () => {
  it("builds the candidate list in that order and falls back to the source", async () => {
    const fs = await appFs(["de", "fr"]);
    const body = fs.slice(fs.indexOf("let private negotiate () : string ="));
    const negotiate = body.slice(0, body.indexOf("let private dirOf"));
    // The ORDER is the candidate list's: URL, stored choice, then the browser.
    const candidates = negotiate.slice(negotiate.indexOf("let candidates ="));
    const url = candidates.indexOf("[ url ]");
    const stored = candidates.indexOf("[ stored ]");
    const platform = candidates.indexOf("platformLanguages ()");
    expect(url).toBeGreaterThan(-1);
    expect(stored).toBeGreaterThan(url);
    expect(platform).toBeGreaterThan(stored);
    expect(negotiate).toContain("let url = urlLang ()");
    expect(negotiate).toContain("let stored = storedChoice ()");
    expect(negotiate).toContain("defaultArg (matchLocale candidates) sourceLocale");
    expect(fs).toContain('let sourceLocale: string = "en"');
  });

  it("reads ?lang=, the stored key, and every browser language (not just the first)", async () => {
    const fs = await appFs(["de"]);
    expect(fs).toContain(".get('lang')");
    expect(fs).toContain("getItem('loom.locale')");
    expect(fs).toContain("globalThis.navigator.languages");
    expect(fs).toContain("Array.from(");
  });

  it("the source language is the fallback when it is not English", async () => {
    const fs = await appFs(["en"], PAGES, '\n  i18n { source: "de" }');
    expect(fs).toContain('let sourceLocale: string = "de"');
    expect(fs).toContain('("de", "Deutsch", "ltr")');
  });
});

describe("exact tag first, then the base language", () => {
  it("matchLocale tries the exact tag, then its base; case-insensitive, underscore-tolerant", async () => {
    const fs = await appFs(["de", "de-CH"]);
    expect(fs).toContain("let matchLocale (candidates: string list) : string option =");
    expect(fs).toContain("candidate.Trim().ToLowerInvariant().Replace('_', '-')");
    const exact = fs.indexOf("match tagIndex.TryFind tag with");
    const base = fs.indexOf("tagIndex.TryFind ((tag.Split('-')).[0])");
    expect(exact).toBeGreaterThan(-1);
    expect(base).toBeGreaterThan(exact);
    // The exact regional catalog is its own row, ahead of any base lookup.
    expect(tagRows(fs)).toEqual(["en=en", "de=de", "de-ch=de-CH"]);
  });

  it("pt-BR + pt-PT with no pt catalog: each tag resolves exactly, a bare pt resolves to neither", async () => {
    const fs = await appFs(["pt-BR", "pt-PT"]);
    expect(tagRows(fs)).toEqual(["en=en", "pt-br=pt-BR", "pt-pt=pt-PT"]);
  });

  it("registers every catalog binding once (no duplicate Map entry)", async () => {
    const fs = await appFs(["pt-BR", "pt-PT"]);
    const block =
      /let private catalogs: Map<string, Map<string, string>> =\n {8}Map\.ofList\n([\s\S]*?)\n\n/.exec(
        fs,
      )![1]!;
    const keys = [...block.matchAll(/"([^"]+)", /g)].map((m) => m[1]);
    expect(keys).toEqual(["en", "pt-BR", "pt-PT"]);
  });

  it("a lone regional variant also answers to its base language", async () => {
    expect(tagRows(await appFs(["pt-BR"]))).toEqual(["en=en", "pt-br=pt-BR", "pt=pt-BR"]);
  });

  it("no alias when the base has its own catalog, or it is the source's base", async () => {
    expect(tagRows(await appFs(["pt", "pt-BR"]))).toEqual(["en=en", "pt=pt", "pt-br=pt-BR"]);
    expect(tagRows(await appFs(["en-GB"]))).toEqual(["en=en", "en-gb=en-GB"]);
  });
});

describe("the reactive store — an Elmish message", () => {
  it("setLocale persists (storage + cookie), updates <html lang dir> and notifies", async () => {
    const fs = await appFs(["de", "ar"]);
    expect(fs).toContain("setItem('loom.locale', $0)");
    expect(fs).toContain("'loom_locale=' + encodeURIComponent($0)");
    expect(fs).toContain("max-age=31536000; SameSite=Lax");
    expect(fs).toContain("d.documentElement.lang = $0; d.documentElement.dir = $1");
    expect(fs).toContain("u.searchParams.set('lang', $0)");
    expect(fs).toContain("let setLocale (tag: string) : unit =");
    expect(fs).toContain("for listener in listeners do");
    // A tag that names no shipped locale is ignored.
    expect(fs).toMatch(/match matchLocale \[ tag \] with\n\s+\| None -> \(\)/);
  });

  it("directions are computed at generate time (ar is rtl) and endonyms are baked in", async () => {
    const fs = await appFs(["de", "ar"]);
    expect(fs).toContain('("en", "English", "ltr")');
    expect(fs).toContain('("ar", "العربية", "rtl")');
    expect(fs).toContain('("de", "Deutsch", "ltr")');
  });

  it("the Model carries the active locale and a LocaleChanged message updates it", async () => {
    const fs = await appFs(["de", "fr"]);
    expect(fs).toMatch(/type Model =\n {2}\{\n {4}Locale: string/);
    expect(fs).toContain("  | LocaleChanged of string");
    expect(fs).toContain("      Locale = I18n.getLocale ()");
    expect(fs).toContain(
      "Cmd.ofEffect (fun dispatch -> I18n.onChange (fun tag -> dispatch (LocaleChanged tag)))",
    );
    expect(fs).toContain("| LocaleChanged tag -> { model with Locale = tag }, Cmd.none");
  });

  it("a single-language app has no Locale field, no message and no listener", async () => {
    const fs = await appFs([]);
    expect(fs).not.toContain("| LocaleChanged");
    expect(fs).not.toMatch(/\n {4}Locale: string/);
    expect(fs).not.toContain("I18n.onChange");
    expect(fs).toContain("let localeSwitcher () = Html.none");
  });

  it("caches one IntlMessageFormat per (locale, message)", async () => {
    const fs = await appFs(["de"]);
    expect(fs).toContain("Dictionary<string, obj>()");
    expect(fs).toContain('let cacheKey = locale + "|" + message');
    expect(fs).toContain("runFormat (formatterFor current message)");
  });

  it("translated catalogs are compiled in beside the source one", async () => {
    const files = await generateSystemFiles(system(), {
      translations: new Map([["de", {}]]),
    });
    const fs = [...files].find(([p]) => p.endsWith("src/App.fs"))![1];
    expect(fs).toContain("let private en: Map<string, string> =");
    expect(fs).toContain("let private loc_de: Map<string, string> =");
    expect(fs).toContain('"de", loc_de');
  });
});

describe("shell — the header carries the switcher at 2+ locales", () => {
  it("renders I18n.localeSwitcher () in the navbar", async () => {
    const fs = await appFs(["de", "fr"]);
    expect(fs).toContain(
      'Html.div [ prop.className "flex-none px-1"; prop.children [ I18n.localeSwitcher () ] ]',
    );
    expect(fs).toContain('prop.custom ("data-testid", "locale-switcher")');
    expect(fs).toContain("prop.onChange (fun (tag: string) -> setLocale tag)");
    // Each option is labelled with the locale's own name and carries lang + dir.
    expect(fs).toContain("prop.text name");
    expect(fs).toContain('prop.custom ("lang", tag)');
    expect(fs).toContain('prop.custom ("dir", dir)');
  });

  it("is absent with the source language alone, and a one-locale tree is still one locale", async () => {
    expect(await appFs([])).not.toContain("I18n.localeSwitcher ()");
    expect(await appFs(["en"])).not.toContain("I18n.localeSwitcher ()");
  });

  it("a single-page app still gets a header for the picker", async () => {
    const one = `page Home { route: "/" body: Heading { "Hello" } }
      page Item(id: string) { route: "/items/:id" body: Heading { "Item" } }`;
    const fs = await appFs(["de"], one);
    expect(fs).toContain("I18n.localeSwitcher ()");
  });
});

describe("LocaleSwitcher primitive", () => {
  const withSwitcher = `page Home { route: "/" body: Stack { Heading { "Hello" }, LocaleSwitcher {} } }`;

  it("renders the I18n module's picker in the page body", async () => {
    const fs = await appFs(["de"], withSwitcher);
    expect(fs).toMatch(/Html\.div \[[^\n]*\n[\s\S]*I18n\.localeSwitcher \(\)/);
    expect(fs).not.toContain("LocaleSwitcher: not yet supported");
  });

  it("ships the locale runtime even when it is the only i18n-relevant thing on the page", async () => {
    const only = `page Home { route: "/" body: Stack { LocaleSwitcher {} } }`;
    const fs = await appFs([], only);
    expect(fs).toContain("module I18n =");
    expect(fs).toContain("I18n.localeSwitcher ()");
  });
});

describe("one locale for text, formatting and the API", () => {
  it("every Fable.SimpleHttp request carries Accept-Language: <active locale>", async () => {
    const reads = `page Home { route: "/" body: QueryView { of: Ops.Doc.all, loading: Text { "Loading" }, error: Text { "Failed" }, empty: Text { "None" }, data: rows => Stack { For { each: rows, d => Card { d.name } } } } }`;
    const fs = await appFs(["de"], reads);
    expect(fs).toContain("module Http =");
    expect(fs).toContain(
      'Fable.SimpleHttp.Http.header (Headers.create "Accept-Language" (I18n.getLocale ()))',
    );
    // Evaluated when the request is built, so it follows a switch.
    expect(fs).toContain("let request (url: string) =");
    // The generated Api module keeps its ordinary spelling.
    expect(fs).toContain("Http.request");
  });

  it("the ICU formatter formats in the active locale, not the one the page loaded in", async () => {
    const fs = await appFs(["de"]);
    expect(fs).toContain("formatterFor current message");
    expect(fs).toContain("match catalogs.TryFind current");
  });
});

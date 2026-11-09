// Phoenix runtime locale negotiation.
//
// A Plug and a LiveView `on_mount` hook run ONE chain — `?lang=`, the
// `loom_locale` cookie, `Accept-Language` in q order, the source language — and
// apply it with `Gettext.put_locale` (plus the Cldr locale for an ICU app).
// The known-locale index, the base-alias table, the endonyms and the directions
// are generate-time data in the emitted `<App>Web.Locale` module.
//
// No Elixir runs here (`elixir-vanilla-build.yml` compiles the emitted project,
// fixture `vanilla-locales.ddd`); these tests pin the emitted source.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SYSTEM = (body = `Heading { "Storefront" }`): string => `
system Shop {
  subdomain S {
    context Sales {
      aggregate Order with crudish {
        code: string
        invariant orderCodeRequired: code.length > 0
      }
      repository Orders for Order { }
    }
  }
  api SalesApi from S
  storage pg { type: postgres }
  resource st { for: Sales, kind: state, use: pg }
  ui Web {
    framework: phoenixLiveView
    api Sales: SalesApi
    page Home {
      route: "/"
      body: ${body}
    }
  }
  deployable app {
    platform: elixir
    contexts: [Sales]
    dataSources: [st]
    serves: SalesApi
    ui: Web { Sales: app }
    port: 4000
  }
}
`;

const catalogs = (...tags: string[]): ReadonlyMap<string, Record<string, string>> =>
  new Map(tags.map((t) => [t, {}]));

const file = (files: Map<string, string>, suffix: string): string => {
  const hit = [...files].find(([p]) => p.endsWith(suffix));
  expect(hit, `no ${suffix} in: ${[...files.keys()].join(", ")}`).toBeDefined();
  return hit![1];
};

const has = (files: Map<string, string>, suffix: string): boolean =>
  [...files.keys()].some((p) => p.endsWith(suffix));

async function gen(tags: string[], body?: string): Promise<Map<string, string>> {
  return generateSystemFiles(SYSTEM(body), { translations: catalogs(...tags) });
}

describe("Phoenix locale matcher (generated Locale module)", () => {
  it("runs the chain URL, cookie, Accept-Language, source in that order", async () => {
    const locale = file(await gen(["de", "fr"]), "_web/locale.ex");
    expect(locale).toContain(
      "resolve(lang) || resolve(cookie) || from_accept_language(accept_language) || @source",
    );
    expect(locale).toContain("def negotiate(lang, cookie, accept_language) do");
  });

  it("tries the exact tag first, then the base language", async () => {
    const locale = file(await gen(["de", "fr"]), "_web/locale.ex");
    const exact = locale.indexOf("case Map.fetch(@index, tag) do");
    const base = locale.indexOf("Map.get(@index, base)");
    expect(exact).toBeGreaterThan(-1);
    expect(base).toBeGreaterThan(exact);
    expect(locale).toContain('base = tag |> String.split("-", parts: 2) |> hd()');
    // `fr_FR` and `fr-FR` are the same candidate.
    expect(locale).toContain('|> String.replace("_", "-")');
  });

  it("orders Accept-Language by q, drops q=0 and the wildcard", async () => {
    const locale = file(await gen(["de", "fr"]), "_web/locale.ex");
    expect(locale).toContain("Enum.sort_by(fn {_tag, q, index} -> {-q, index} end)");
    expect(locale).toContain('if tag in ["", "*"] or q <= 0, do: [], else: [{tag, q, index}]');
  });

  it("indexes shipped tags lowercased and registers no alias for unrelated bases", async () => {
    const locale = file(await gen(["de", "fr"]), "_web/locale.ex");
    expect(locale).toContain('@index %{"en" => "en", "de" => "de", "fr" => "fr"}');
    expect(locale).toContain('@source "en"');
  });

  it("registers a base alias only when exactly one regional variant ships", async () => {
    const one = file(await gen(["pt-BR"]), "_web/locale.ex");
    expect(one).toContain('"pt-br" => "pt-BR"');
    expect(one).toContain('"pt" => "pt-BR"');

    const two = file(await gen(["pt-BR", "pt-PT"]), "_web/locale.ex");
    expect(two).toContain('"pt-br" => "pt-BR"');
    expect(two).toContain('"pt-pt" => "pt-PT"');
    expect(two).not.toContain('"pt" =>');

    // A catalog named for the base itself wins; no alias on top of it.
    const base = file(await gen(["pt", "pt-BR"]), "_web/locale.ex");
    expect(base).toContain('"pt" => "pt"');
    expect(base).not.toContain('"pt" => "pt-BR"');
  });

  it("spells the gettext locale the way gettext names its directories", async () => {
    const files = await gen(["pt-BR"]);
    expect(file(files, "_web/locale.ex")).toContain(
      'def gettext_locale(tag), do: String.replace(tag, "-", "_")',
    );
    expect([...files.keys()]).toContain("app/priv/gettext/pt_BR/LC_MESSAGES/default.po");
  });

  it("applies the result to gettext, and to Cldr only for an ICU app", async () => {
    const plain = file(await gen(["de"]), "_web/locale.ex");
    expect(plain).toContain("Gettext.put_locale(AppWeb.Gettext, gettext_locale(tag))");
    expect(plain).not.toContain("Cldr.put_locale");

    // The ICU variant needs a bound hole: a page param.
    const icuFiles = await generateSystemFiles(
      SYSTEM("Text { `Status: {code}` }").replace(
        'page Home {\n      route: "/"',
        'page Home(code: string) {\n      route: "/:code"',
      ),
      { translations: catalogs("de", "fr") },
    );
    expect(file(icuFiles, "_web/locale.ex")).toContain("_ = App.Cldr.put_locale(tag)");
    const cldr = file(icuFiles, "lib/app/cldr.ex");
    expect(cldr).toContain('@shipped ["en", "de", "fr"]');
    // A shipped tag CLDR does not define would abort the Cldr compile, so only
    // the tags CLDR knows (and the source) reach `locales:`.
    expect(cldr).toContain("String.to_atom(&1) in Cldr.all_locale_names()");
    expect(cldr).toContain("locales: @known,");
  });
});

describe("Phoenix locale plug, on_mount hook and router wiring", () => {
  it("the plug negotiates from the URL, the cookie and the header and stores the result", async () => {
    const plug = file(await gen(["de", "fr"]), "_web/locale_plug.ex");
    expect(plug).toContain('conn.query_params["lang"]');
    expect(plug).toContain('conn.cookies["loom_locale"]');
    expect(plug).toContain('get_req_header("accept-language")');
    expect(plug).toContain("AppWeb.Locale.put(tag)");
    expect(plug).toContain('put_session("loom_locale", tag)');
    expect(plug).toContain("assign(:loom_locale, tag)");
    expect(plug).toContain("assign(:loom_dir, AppWeb.Locale.dir(tag))");
  });

  it("the on_mount hook puts the locale again in the LiveView process", async () => {
    const hook = file(await gen(["de", "fr"]), "_web/locale_hook.ex");
    expect(hook).toContain("def on_mount(:default, params, session, socket) do");
    expect(hook).toContain('AppWeb.Locale.negotiate(params["lang"], session["loom_locale"], nil)');
    expect(hook).toContain("AppWeb.Locale.put(tag)");
  });

  it("the router runs the plug after the session loads and the hook first in the live_session", async () => {
    const router = file(await gen(["de", "fr"]), "_web/router.ex");
    const fetchSession = router.indexOf("plug :fetch_session");
    const localePlug = router.indexOf("plug AppWeb.LocalePlug");
    const rootLayout = router.indexOf("plug :put_root_layout");
    expect(fetchSession).toBeGreaterThan(-1);
    expect(localePlug).toBeGreaterThan(fetchSession);
    expect(rootLayout).toBeGreaterThan(localePlug);
    expect(router).toContain("on_mount: [AppWeb.LocaleHook, AppWeb.Nav]");
  });

  it("ships none of it for a single-locale app", async () => {
    const files = await generateSystemFiles(SYSTEM());
    expect(has(files, "_web/locale_plug.ex")).toBe(false);
    expect(has(files, "_web/locale_hook.ex")).toBe(false);
    const router = file(files, "_web/router.ex");
    expect(router).not.toContain("LocalePlug");
    expect(router).toContain("on_mount: [AppWeb.Nav]");
    expect(file(files, "layouts/root.html.heex")).toContain('<html lang="en"');
    expect(file(files, "layouts/app.html.heex")).not.toContain("loom-locale-switcher");
  });
});

describe("Phoenix <html lang dir>", () => {
  it("reads lang and dir from the negotiated locale, defaulting to the source", async () => {
    const root = file(await gen(["de", "fr"]), "layouts/root.html.heex");
    expect(root).toContain(
      '<html lang={assigns[:loom_locale] || "en"} dir={assigns[:loom_dir] || "ltr"}',
    );
  });

  it("computes direction at generate time", async () => {
    const locale = file(await gen(["ar", "de"]), "_web/locale.ex");
    expect(locale).toContain('%{tag: "ar", name: "العربية", dir: "rtl"}');
    expect(locale).toContain('%{tag: "de", name: "Deutsch", dir: "ltr"}');
  });
});

describe("Phoenix LocaleSwitcher", () => {
  it("lists generate-time endonyms, not raw tags", async () => {
    const files = await gen(["de", "fr"], "LocaleSwitcher {}");
    const live = file(files, "live/home_live.ex");
    expect(live).toContain(">Deutsch</option>");
    expect(live).toContain(">Français</option>");
    expect(live).toContain(">English</option>");
    expect(live).not.toContain("known_locales");
    // Choosing one writes the cookie, then navigates under `?lang=`.
    expect(live).toContain("document.cookie='loom_locale='");
    expect(live).toContain("u.searchParams.set('lang', this.value)");
    expect(live).toContain('selected={AppWeb.Locale.current() == "de"}');
  });

  it("the app shell carries the switcher at two or more locales", async () => {
    const shell = file(await gen(["de", "fr"]), "layouts/app.html.heex");
    expect(shell).toContain(">Deutsch</option>");
    expect(shell).toContain("loom-locale-switcher");
  });
});

describe("Phoenix per-locale gettext trees", () => {
  it("emits a .po per translated locale carrying its translations", async () => {
    const files = await generateSystemFiles(SYSTEM(), {
      translations: new Map([["de", { "msg.unknown": "x" }]]),
    });
    const de = file(files, "priv/gettext/de/LC_MESSAGES/default.po");
    expect(de).toContain('"Language: de\\n"');
    expect(de).toContain("a translated catalog");
  });
});

describe("Phoenix request locale and error pages", () => {
  it("a request with no Accept-Language resolves to the source language, not a literal", async () => {
    const rc = file(await gen(["de", "fr"]), "/request_context.ex");
    expect(rc).toContain('@source_locale "en"');
    expect(rc).toContain(
      'AppWeb.Locale.from_accept_language(first_header(conn, "accept-language")) ||',
    );
    expect(rc).not.toContain('|| "en"');
    expect(rc).toContain("def locale, do: Logger.metadata()[:locale] || @source_locale");
  });

  it("error pages carry the negotiated lang and dir", async () => {
    const html = file(await gen(["de", "ar"]), "/controllers/error_html.ex");
    expect(html).toContain('<html lang="#{lang}" dir="#{dir}">');
    expect(html).toContain("conn.assigns[:loom_locale]");
    expect(html).toContain("AppWeb.Locale.from_accept_language(");
    expect(html).toContain("AppWeb.Locale.dir(tag)");
  });

  it("an app that ships no matcher renders its source language and direction", async () => {
    const html = file(await generateSystemFiles(SYSTEM("Stack { }")), "/controllers/error_html.ex");
    expect(html).toContain('defp locale(_assigns), do: {"en", "ltr"}');
    expect(html).not.toContain("Locale.from_accept_language");
  });
});

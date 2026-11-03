// The runtime locale model of the generated Flutter app: the Dart `lib/i18n.dart`
// negotiation (`?lang=` on web, the stored choice, the platform's locales, the
// source), the base-language aliases, the `ValueNotifier` switch, the
// `LocaleSwitcher` primitive, the app bar, the `MaterialApp` localization wiring
// and `Accept-Language`.
//
// The Dart is not compiled here: these are text-level assertions over the emitted
// files (the React twin runs its emitted JS against a faked browser in
// `test/generator/_frontend/locale-runtime.test.ts`).  The behaviour itself is
// proved by `flutter analyze` + `flutter build web` + a widget test that switches
// the locale, recorded on the PR.

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
      framework: flutter
      api Ops: DemoApi
      ${pages}
    }
    storage loomDb { type: postgres }
    resource cState { for: C, kind: state, use: loomDb }
    deployable api { platform: node, contexts: [C], dataSources: [cState], serves: DemoApi, port: 3000 }
    deployable web { platform: flutter, targets: api, ui: Web { Ops: api }, port: 3006 }
  }
`;

const catalogsFor = (...locales: string[]): Map<string, Record<string, string>> =>
  new Map(locales.map((l) => [l, {}]));

async function emit(
  locales: readonly string[] = [],
  pages = PAGES,
  i18n = "",
): Promise<Map<string, string>> {
  return generateSystemFiles(system(pages, i18n), { translations: catalogsFor(...locales) });
}

const file = (files: Map<string, string>, suffix: string): string =>
  [...files].find(([p]) => p.endsWith(suffix))![1];

/** The rows of the module's `_tagIndex` (`'de': 'de'` / alias `'pt': 'pt-BR'`). */
function tagRows(dart: string): string[] {
  const block = /const Map<String, String> _tagIndex = <String, String>\{\n([\s\S]*?)\n\};/.exec(
    dart,
  )![1]!;
  return [...block.matchAll(/'([^']+)': '([^']+)'/g)].map((m) => `${m[1]}=${m[2]}`);
}

async function i18nDart(locales: readonly string[] = [], i18n = ""): Promise<string> {
  return file(await emit(locales, PAGES, i18n), "lib/i18n.dart");
}

describe("negotiation order — URL (web only), stored choice, platform locales, source", () => {
  it("builds the candidate list in that order and falls back to the source", async () => {
    const dart = await i18nDart(["de", "fr"]);
    const negotiate = dart.slice(dart.indexOf("String _negotiate(String? stored) {"));
    const body = negotiate.slice(0, negotiate.indexOf("\n}\n"));
    const url = body.indexOf("Uri.base.queryParameters['lang']");
    const stored = body.indexOf("candidates.add(stored)");
    const platform = body.indexOf("ui.PlatformDispatcher.instance.locales");
    expect(url).toBeGreaterThan(-1);
    expect(stored).toBeGreaterThan(url);
    expect(platform).toBeGreaterThan(stored);
    expect(body).toContain("return matchLocale(candidates) ?? sourceLocale;");
    expect(dart).toContain("const String sourceLocale = 'en';");
  });

  it("the URL is read on web only — a native app has no address bar", async () => {
    const dart = await i18nDart(["de"]);
    expect(dart).toMatch(
      /if \(kIsWeb\) \{\n\s+final String\? lang = Uri\.base\.queryParameters\['lang'\];/,
    );
    expect(dart).toContain("import 'package:flutter/foundation.dart' show kIsWeb;");
  });

  it("every platform locale is a candidate, not just the first", async () => {
    const dart = await i18nDart(["de"]);
    expect(dart).toContain(
      "for (final ui.Locale platform in ui.PlatformDispatcher.instance.locales) {",
    );
    expect(dart).toContain("candidates.add(platform.toLanguageTag());");
  });

  it("the source language is the fallback when it is not English", async () => {
    const dart = await i18nDart(["en"], '\n  i18n { source: "de" }');
    expect(dart).toContain("const String sourceLocale = 'de';");
    expect(dart).toContain("LocaleInfo('de', 'Deutsch', TextDirection.ltr,");
  });
});

describe("exact tag first, then the base language", () => {
  it("matchLocale tries the exact tag, then its base; case-insensitive, underscore-tolerant", async () => {
    const dart = await i18nDart(["de", "de-CH"]);
    expect(dart).toContain("String? matchLocale(List<String> candidates) {");
    expect(dart).toContain("candidate.trim().toLowerCase().replaceAll('_', '-')");
    const exact = dart.indexOf("final String? exact = _tagIndex[tag];");
    const base = dart.indexOf("final String? base = _tagIndex[tag.split('-').first];");
    expect(exact).toBeGreaterThan(-1);
    expect(base).toBeGreaterThan(exact);
    expect(tagRows(dart)).toEqual(["en=en", "de=de", "de-ch=de-CH"]);
  });

  it("pt-BR + pt-PT with no pt catalog: each tag resolves exactly, a bare pt resolves to neither", async () => {
    expect(tagRows(await i18nDart(["pt-BR", "pt-PT"]))).toEqual([
      "en=en",
      "pt-br=pt-BR",
      "pt-pt=pt-PT",
    ]);
  });

  it("registers every catalog once (no duplicate map key)", async () => {
    const dart = await i18nDart(["pt-BR", "pt-PT"]);
    const block =
      /const Map<String, Map<String, String>> _catalogs = [^{]*\{\n([\s\S]*?)\n\};/.exec(dart)![1]!;
    const keys = [...block.matchAll(/^ {2}'([^']+)':/gm)].map((m) => m[1]);
    expect(keys).toEqual(["en", "pt-BR", "pt-PT"]);
    // …and each catalog binding is a legal, distinct lowerCamelCase identifier.
    expect(dart).toContain("const Map<String, String> _catPtBr = <String, String>{");
    expect(dart).toContain("const Map<String, String> _catPtPt = <String, String>{");
  });

  it("a lone regional variant also answers to its base language", async () => {
    expect(tagRows(await i18nDart(["pt-BR"]))).toEqual(["en=en", "pt-br=pt-BR", "pt=pt-BR"]);
  });

  it("no alias when the base has its own catalog, or it is the source's base", async () => {
    expect(tagRows(await i18nDart(["pt", "pt-BR"]))).toEqual(["en=en", "pt=pt", "pt-br=pt-BR"]);
    expect(tagRows(await i18nDart(["en-GB"]))).toEqual(["en=en", "en-gb=en-GB"]);
  });
});

describe("the reactive store — a ValueNotifier", () => {
  it("setLocale persists, points Intl.defaultLocale at the tag, notifies and rebuilds", async () => {
    const dart = await i18nDart(["de", "ar"]);
    expect(dart).toContain(
      "final ValueNotifier<String> localeNotifier = ValueNotifier<String>('en');",
    );
    expect(dart).toContain("void setLocale(String tag) {");
    expect(dart).toContain("unawaited(_persist(next));");
    expect(dart).toContain("Intl.defaultLocale = Intl.canonicalizedLocale(tag);");
    expect(dart).toContain("localeNotifier.value = tag;");
    expect(dart).toContain("_rebuildAll();");
    // A tag that names no shipped locale is ignored.
    expect(dart).toMatch(
      /final String\? next = matchLocale\(<String>\[tag\]\);\n\s+if \(next == null\) return;/,
    );
  });

  it("t() reads the ACTIVE locale on every call", async () => {
    const dart = await i18nDart(["de"]);
    expect(dart).toContain("String get locale => localeNotifier.value;");
    expect(dart).toContain("final String message = _catalogs[locale]?[key] ?? defaultMessage;");
  });

  it("the choice is stored with shared_preferences and restored by initLocale()", async () => {
    const files = await emit(["de"]);
    const dart = file(files, "lib/i18n.dart");
    expect(dart).toContain("const String _storageKey = 'loom.locale';");
    expect(dart).toContain(
      "stored = (await SharedPreferences.getInstance()).getString(_storageKey);",
    );
    expect(dart).toContain(
      "await (await SharedPreferences.getInstance()).setString(_storageKey, tag);",
    );
    expect(file(files, "pubspec.yaml")).toContain("shared_preferences: 2.5.6");
  });

  it("directions are computed at generate time (ar is rtl) and endonyms are baked in", async () => {
    const dart = await i18nDart(["de", "ar"]);
    expect(dart).toContain("LocaleInfo('en', 'English', TextDirection.ltr,");
    expect(dart).toContain("LocaleInfo('ar', 'العربية', TextDirection.rtl,");
    expect(dart).toContain("LocaleInfo('de', 'Deutsch', TextDirection.ltr,");
  });

  it("translated catalogs are compiled in beside the source one", async () => {
    const dart = await i18nDart(["de"]);
    expect(dart).toContain("const Map<String, String> _en = <String, String>{");
    expect(dart).toContain("const Map<String, String> _catDe = <String, String>{");
    expect(dart).toContain("'de': _catDe,");
  });

  it("a single-language app negotiates nothing, stores nothing and adds no dependency", async () => {
    const files = await emit([]);
    const dart = file(files, "lib/i18n.dart");
    expect(dart).not.toContain("initLocale");
    expect(dart).not.toContain("SharedPreferences");
    expect(dart).not.toContain("flutter_localizations");
    expect(dart).toContain("class LocaleSwitcher extends StatelessWidget");
    expect(dart).toContain("Widget build(BuildContext context) => const SizedBox.shrink();");
    const main = file(files, "lib/main.dart");
    expect(main).not.toContain("initLocale");
    expect(main).not.toContain("ValueListenableBuilder");
    const pubspec = file(files, "pubspec.yaml");
    expect(pubspec).toContain("intl: ^0.19.0");
    expect(pubspec).not.toContain("flutter_localizations");
  });
});

describe("formatting follows the active locale", () => {
  it("date symbols load for every shipped locale before the first frame", async () => {
    const files = await emit(["de", "fr"]);
    const dart = file(files, "lib/i18n.dart");
    expect(dart).toContain("import 'package:intl/date_symbol_data_local.dart';");
    expect(dart).toContain("await initializeDateFormatting(Intl.canonicalizedLocale(info.tag));");
    const main = file(files, "lib/main.dart");
    expect(main).toMatch(
      /WidgetsFlutterBinding\.ensureInitialized\(\);[\s\S]*await initLocale\(\);[\s\S]*runApp\(const App\(\)\);/,
    );
  });

  it("MaterialApp carries locale, supportedLocales, localizationsDelegates and the direction", async () => {
    const files = await emit(["de", "fr"]);
    const main = file(files, "lib/main.dart");
    expect(main).toContain(
      "ValueListenableBuilder<String>(valueListenable: localeNotifier, builder: (context, localeTag, child) => MaterialApp(",
    );
    expect(main).toContain("locale: localeFor(localeTag),");
    expect(main).toContain("supportedLocales: supportedLocales,");
    expect(main).toContain("localizationsDelegates: localizationsDelegates,");
    expect(main).toContain("Directionality(textDirection: localeDirection(localeTag),");
    const dart = file(files, "lib/i18n.dart");
    expect(dart).toContain("GlobalMaterialLocalizations.delegate,");
    expect(dart).toContain("import 'package:flutter_localizations/flutter_localizations.dart';");
  });

  it("flutter_localizations pins intl to the SDK's version, so the pubspec follows it", async () => {
    const pubspec = file(await emit(["de"]), "pubspec.yaml");
    expect(pubspec).toContain("flutter_localizations:\n    sdk: flutter");
    expect(pubspec).toContain("intl: any");
    expect(pubspec).not.toContain("intl: ^0.19.0");
  });
});

describe("shell — every app bar carries the switcher at 2+ locales", () => {
  it("mounts LocaleSwitcher as an AppBar action and imports the runtime", async () => {
    const files = await emit(["de", "fr"]);
    const home = file(files, "home_page.dart");
    expect(home).toContain("actions: const <Widget>[LocaleSwitcher()]");
    expect(home).toContain("import '../i18n.dart';");
    expect(file(files, "about_page.dart")).toContain("actions: const <Widget>[LocaleSwitcher()]");
  });

  it("the picker is a dropdown of endonyms listening to the notifier", async () => {
    const dart = file(await emit(["de", "fr"]), "lib/i18n.dart");
    expect(dart).toContain("class LocaleSwitcher extends StatelessWidget");
    expect(dart).toContain("key: const ValueKey<String>('locale-switcher'),");
    expect(dart).toContain("valueListenable: localeNotifier,");
    expect(dart).toContain("if (next != null) setLocale(next);");
    expect(dart).toContain(
      "child: Directionality(textDirection: info.dir, child: Text(info.name)),",
    );
  });

  it("is absent with the source language alone, and a one-locale tree is still one locale", async () => {
    expect(file(await emit([]), "home_page.dart")).not.toContain("LocaleSwitcher");
    expect(file(await emit(["en"]), "home_page.dart")).not.toContain("LocaleSwitcher");
  });
});

describe("LocaleSwitcher primitive", () => {
  const withSwitcher = `page Home { route: "/" body: Stack { Heading { "Hello" }, LocaleSwitcher {} } }`;

  it("renders the generated widget in the page body and imports the runtime", async () => {
    const files = await emit(["de"], withSwitcher);
    const home = file(files, "home_page.dart");
    expect(home).toContain("const LocaleSwitcher()");
    expect(home).toContain("import '../i18n.dart';");
    expect(home).not.toContain("not yet supported");
  });

  it("ships the locale runtime even when it is the only i18n-relevant thing on the page", async () => {
    const only = `page Home { route: "/" body: Stack { LocaleSwitcher {} } }`;
    const files = await emit([], only);
    expect(file(files, "lib/i18n.dart")).toContain("class LocaleSwitcher");
    expect(file(files, "home_page.dart")).toContain("import '../i18n.dart';");
  });
});

describe("Accept-Language", () => {
  const reads = `page Home { route: "/" body: QueryView { of: Ops.Doc.all, loading: Text { "Loading" }, error: Text { "Failed" }, empty: Text { "None" }, data: rows => Stack { For { each: rows, d => Card { d.name } } } } }`;

  it("every api call goes through a client that stamps the active locale", async () => {
    const files = await emit(["de"], reads);
    const client = file(files, "lib/api_client.dart");
    expect(client).toContain("class _LoomLocaleClient extends http.BaseClient");
    expect(client).toContain("request.headers['Accept-Language'] = activeLocale();");
    expect(client).toContain("final http.Client loomHttp = _LoomLocaleClient(http.Client());");
    expect(file(files, "lib/reads.dart")).toContain("import 'api_client.dart' as http;");
    // An auth: none app carries no credential — only the locale.
    expect(client).not.toContain("withCredentials");
    expect(client).not.toContain("loomApiClient");
  });

  it("an app with no strings keeps the bare http import", async () => {
    const off = `page Home { route: "/" state { q: string = "" } body: Stack { Text { q } } }`;
    const files = await emit([], off);
    expect([...files.keys()].some((k) => k.endsWith("lib/api_client.dart"))).toBe(false);
    expect([...files.keys()].some((k) => k.endsWith("lib/i18n.dart"))).toBe(false);
  });
});

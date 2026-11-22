// Census: ICU `plural` / `select` / `selectordinal` in a ui page reaches every
// target that renders pages — extracted into the source catalog verbatim,
// carried into each translated catalog, and rendered by a call that hands the
// hole's value to that target's ICU formatter.
//
// One row per page renderer, read off the registry: a new frontend framework
// (or a new LiveView-style fullstack host) fails the first test until it has a
// row here, i.e. until its runtime is shown to render brace-bodied ICU.
//
// The ru catalog is the interesting one: Russian needs one / few / many /
// other, so a target that only ever saw English's one / other would not
// notice a dropped branch.

import { describe, expect, it } from "vitest";
import { dartStringLit } from "../../src/generator/flutter/i18n.js";
import { allPlatforms } from "../../src/platform/registry.js";
import { generateSystemFiles } from "../_helpers/index.js";

const PLURAL = "You have {count, plural, one {# order} other {# orders}}";
const SELECT = "Status: {status, select, shipped {Shipped} other {Pending}}";
const ORDINAL = "Your {count, selectordinal, one {#st} two {#nd} few {#rd} other {#th}} order";

const KEYS = {
  plural: "Web.page.Home.text.io7xmj",
  select: "Web.page.Home.text.0lqlui",
  ordinal: "Web.page.Home.text.shhdcg",
} as const;

const RU: Record<string, string> = {
  [KEYS.plural]:
    "У вас {count, plural, one {# заказ} few {# заказа} many {# заказов} other {# заказа}}",
  [KEYS.select]: "Статус: {status, select, shipped {Отправлен} other {В обработке}}",
  [KEYS.ordinal]: "Ваш {count, selectordinal, other {#-й}} заказ",
};

const BODY = [`Text { \`${PLURAL}\` }`, `Text { \`${SELECT}\` }`, `Text { \`${ORDINAL}\` }`].join(
  ", ",
);

/** `renderer` is a web framework (a `web` bundle whose ui names it), `feliz`,
 *  `flutter`, or `elixir` (LiveView mounted on the backend). */
function system(renderer: string): string {
  const selfHosted = renderer === "feliz" || renderer === "flutter";
  const hosts =
    renderer === "elixir"
      ? `deployable api { platform: elixir contexts: [Sales] dataSources: [salesState] serves: SalesApi ui: Web { Sales: api } port: 3000 }`
      : `deployable api { platform: node contexts: [Sales] dataSources: [salesState] serves: SalesApi port: 3000 }
  deployable web { platform: ${selfHosted ? renderer : "web"} targets: api ui: Web { Sales: api } port: 3100 }`;
  const framework = renderer === "elixir" || selfHosted ? "" : `framework: ${renderer}`;
  return `
system Shop {
  subdomain Sales {
    context Sales {
      aggregate Order with crudish { status: string }
      repository Orders for Order { }
    }
  }
  api SalesApi from Sales
  ui Web {
    ${framework}
    api Sales: SalesApi
    page Home(count: int, status: string) { route: "/:count/:status" body: Stack { ${BODY} } }
  }
  storage primary { type: postgres }
  resource salesState { for: Sales, kind: state, use: primary }
  ${hosts}
}`;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Row {
  /** How a catalog message is spelled in the target's emitted source. */
  readonly lit: (message: string) => string;
  /** The source and ru catalogs' file paths, or the one file both live in. */
  readonly catalogs: { readonly en: RegExp; readonly ru: RegExp };
  /** A call rendering `key` that hands the formatter the hole named `hole`. */
  readonly call: (key: string, hole: string) => RegExp;
}

const json = (s: string) => JSON.stringify(s);
const jsCall = (key: string, hole: string) =>
  new RegExp(`t\\(${esc(json(key))}, "[^"]*", \\{ ${hole}: ${hole} \\}\\)`);

const ROWS: Record<string, Row> = {
  react: {
    lit: json,
    catalogs: { en: /web\/src\/locales\/en\.json$/, ru: /web\/src\/locales\/ru\.json$/ },
    call: jsCall,
  },
  vue: {
    lit: json,
    catalogs: { en: /web\/src\/locales\/en\.json$/, ru: /web\/src\/locales\/ru\.json$/ },
    call: jsCall,
  },
  svelte: {
    lit: json,
    catalogs: { en: /web\/src\/lib\/locales\/en\.json$/, ru: /web\/src\/lib\/locales\/ru\.json$/ },
    call: jsCall,
  },
  angular: {
    lit: json,
    catalogs: { en: /web\/src\/lib\/locales\/en\.json$/, ru: /web\/src\/lib\/locales\/ru\.json$/ },
    call: jsCall,
  },
  feliz: {
    lit: json,
    catalogs: { en: /web\/src\/App\.fs$/, ru: /web\/src\/App\.fs$/ },
    call: (key, hole) =>
      new RegExp(`I18n\\.tf ${esc(json(key))} "[^"]*" \\[ "${hole}", box \\(${hole}\\) \\]`),
  },
  flutter: {
    lit: dartStringLit,
    catalogs: { en: /web\/lib\/i18n\.dart$/, ru: /web\/lib\/i18n\.dart$/ },
    call: (key, hole) =>
      new RegExp(`t\\('${esc(key)}', '[^']*', <String, Object>\\{'${hole}': ${hole}\\}\\)`),
  },
  elixir: {
    lit: json,
    catalogs: {
      en: /priv\/gettext\/en\/LC_MESSAGES\/default\.po$/,
      ru: /priv\/gettext\/ru\/LC_MESSAGES\/default\.po$/,
    },
    call: (key, hole) =>
      new RegExp(`icu\\(pgettext\\(${esc(json(key))}, "[^"]*"\\), \\[${hole}: @${hole}\\]\\)`),
  },
};

/** Every page renderer: each framework a frontend platform renders, plus a
 *  fullstack host that runs its own page runtime (LiveView), by platform name. */
function pageRenderers(): string[] {
  const names = allPlatforms().flatMap((p): string[] => {
    if (p.isFrontend) return [...p.hostableFrameworks];
    return p.hostableFrameworks.has("phoenixLiveView") ? [p.name as string] : [];
  });
  return [...new Set(names)].sort();
}

function fileMatching(files: Map<string, string>, path: RegExp): string {
  const hits = [...files].filter(([p]) => path.test(p));
  if (hits.length !== 1) throw new Error(`expected one file matching ${path}, got ${hits.length}`);
  return hits[0]![1];
}

describe("ICU choice census", () => {
  it("has exactly one row per page renderer", () => {
    expect(Object.keys(ROWS).sort()).toEqual(pageRenderers());
  });

  for (const [renderer, row] of Object.entries(ROWS)) {
    it(`${renderer}: extracts, translates and renders plural / select / selectordinal`, async () => {
      const files = await generateSystemFiles(system(renderer), {
        translations: new Map([["ru", RU]]),
      });
      const en = fileMatching(files, row.catalogs.en);
      for (const message of [PLURAL, SELECT, ORDINAL]) expect(en).toContain(row.lit(message));
      const ru = fileMatching(files, row.catalogs.ru);
      for (const message of Object.values(RU)) expect(ru).toContain(row.lit(message));
      const sources = [...files.values()].join("\n");
      expect(sources).toMatch(row.call(KEYS.plural, "count"));
      expect(sources).toMatch(row.call(KEYS.select, "status"));
      expect(sources).toMatch(row.call(KEYS.ordinal, "count"));
    });
  }

  it("flutter resolves selectordinal by the locale's ordinal rules, not intl's cardinal ones", async () => {
    const files = await generateSystemFiles(system("flutter"), {
      translations: new Map([["ru", RU]]),
    });
    const dart = fileMatching(files, ROWS.flutter!.catalogs.en);
    expect(dart).toContain("_resolveFormats(_resolveOrdinals(message, values), values)");
    // English: st / nd / rd for 1 / 2 / 3, th for 11 / 12 / 13.
    expect(dart).toMatch(/ {2}'en': <String>\['', 'xotfxxxxxxxxxxxxxxxxxotf/);
    expect(dart).toContain("  'ru': <String>['', 'x'],");
  });

  it("flutter ships no ordinal pre-pass when no message needs one", async () => {
    const files = await generateSystemFiles(
      system("flutter").replace(`, Text { \`${ORDINAL}\` }`, ""),
    );
    const dart = fileMatching(files, ROWS.flutter!.catalogs.en);
    expect(dart).toContain("final _Icu icu = _resolveFormats(message, values);");
    expect(dart).not.toContain("_ordinalTables");
  });
});

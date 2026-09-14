// ---------------------------------------------------------------------------
// The generated frontend translation runtime (M-T1.11) — framework-AGNOSTIC,
// shared across every JS/TS frontend (React, Vue, Svelte, …).  It lives in the
// `_frontend/` shared seam (not `react/`) so a frontend generator imports it
// without a sibling-platform edge (pipeline-layering.test.ts).
//
// Emits two files into each app that has extractable user-visible text:
//
//   locales/en.json — the source-language catalog (key → English), the same
//     `{ key: message }` shape as `.loom/messages.en.json`, scoped to this
//     deployable's UI. Translators add `<locale>.json` siblings and PR them.
//   i18n.ts — the `t(key, default, values?)` lookup shim: returns the active
//     locale's string for `key` (falling back to the source-language default)
//     and locale-formats its ICU placeholders (`{name}`, `{total, number,
//     ::currency/USD}`, `{d, date, ::yMMMd}`) from `values` via
//     `intl-messageformat`.
//
// The lookup half stays a tiny `messages[key] ?? default` map — no react-intl
// provider, no design-pack template change. The formatting half is
// `intl-messageformat` (the standalone ICU engine react-intl itself
// builds on) so a `, number` / `, date` format suffix (M-T1.11) locale-formats
// at runtime. The `t(key, default, values?)` call sites the walker emits are
// unchanged. (Plural/select — brace-bodied ICU — are a later slice; the same
// engine already supports them, only the grammar/extractor gate them out.)
// ---------------------------------------------------------------------------

import type { UiIR } from "../../ir/types/loom-ir.js";
import { chromeMergedWhenEnabled } from "../_walker/i18n-chrome.js";
import { collectUiMessages } from "../_walker/i18n-extract.js";

/** Build the flat, key-sorted `{ key: message }` catalog for one UI.  Pack-chrome
 *  strings (`chrome.<name>`) ride in through `collectUiMessages` used-only, so a
 *  UI that renders a `Loader()` carries `chrome.loading` for translators.  The
 *  always-rendered app-shell chrome (`APP_SHELL_CHROME`) is merged only when the
 *  UI is already i18n-enabled by its authored strings — the same gate the shell
 *  emitters use — so a string-less app stays byte-identical (no runtime). */
export function buildUiCatalog(
  ui: UiIR,
  /** The active design pack's DECLARED chrome (`pack.<family>.<role>.<hash>` →
   *  English, from `pack.json`'s `chrome` map).  Merged under the SAME
   *  already-enabled gate as `chromeMergedWhenEnabled()`, which is what lets a
   *  caller pass it unconditionally — including the enablement probes
   *  (`heexI18nEnabled` and friends), which must not see a UI turn
   *  translatable just because its pack ships chrome. */
  packChrome: Record<string, string> = {},
): Record<string, string> {
  const byKey = new Map<string, string>();
  // Same key ⇒ same content hash ⇒ same message; collapses repeats.
  for (const { key, message } of collectUiMessages(ui)) byKey.set(key, message);
  if (byKey.size > 0) {
    for (const [key, message] of Object.entries(chromeMergedWhenEnabled())) byKey.set(key, message);
    for (const [key, message] of Object.entries(packChrome)) byKey.set(key, message);
  }
  const out: Record<string, string> = {};
  for (const key of [...byKey.keys()].sort()) out[key] = byKey.get(key)!;
  return out;
}

/** `src/locales/en.json` — the source-language catalog for this UI. */
export function renderLocaleCatalog(ui: UiIR, packChrome: Record<string, string> = {}): string {
  return `${JSON.stringify(buildUiCatalog(ui, packChrome), null, 2)}\n`;
}

/** Translated locale catalogs, keyed by locale tag (`de`, `pt-BR`), as read off
 *  the translator tree by `ddd i18n`'s `loadTranslations` and threaded through
 *  `generate system`.  Plain data: `src/system/` and `src/platform/` stay
 *  fs-free, the same arrangement `GenerateSystemOptions.sourceTexts` uses. */
export type TranslationCatalogs = ReadonlyMap<string, Record<string, string>>;

/** `src/locales/<locale>.json` for every translated locale on disk, keyed by
 *  locale tag — the siblings of `renderLocaleCatalog`'s `en.json`.
 *
 *  Each is SCOPED to this UI's own keys, exactly as `en.json` is: the
 *  translator tree is one catalog for the whole SYSTEM (every ui, plus the
 *  backends' `msg.<hash>` validation messages), and shipping all of it into
 *  every frontend bundle would put another deployable's strings in this app.
 *  Intersecting also means a key the source no longer emits cannot survive in
 *  a translated catalog while `en.json` has already dropped it.
 *
 *  A locale whose intersection is EMPTY is still returned.  The app must
 *  advertise exactly the locales the translator created — otherwise "I ran
 *  `ddd i18n init de` and the app still has no German" is the same disconnect
 *  this path exists to close, moved one step later — and an empty catalog is a
 *  correct one: every key falls back per key to the source-language default
 *  `t(key, default)` already carries. */
export function renderTranslatedCatalogs(
  ui: UiIR,
  translations: TranslationCatalogs | undefined,
  packChrome: Record<string, string> = {},
): Map<string, string> {
  const out = new Map<string, string>();
  if (!translations || translations.size === 0) return out;
  const keys = Object.keys(buildUiCatalog(ui, packChrome));
  if (keys.length === 0) return out;
  for (const locale of [...translations.keys()].sort()) {
    if (locale === "en") continue;
    const source = translations.get(locale) ?? {};
    const scoped: Record<string, string> = {};
    for (const key of keys) {
      const value = source[key];
      if (value !== undefined) scoped[key] = value;
    }
    out.set(locale, `${JSON.stringify(scoped, null, 2)}\n`);
  }
  return out;
}

/** A generated locale catalog's JS import identifier.  A BCP-47 tag carries
 *  characters (`-`) a JS identifier cannot, so `pt-BR` binds as `loc_pt_BR`;
 *  the registry KEY below stays the tag itself. */
function localeIdent(locale: string): string {
  return `loc_${locale.replace(/[^A-Za-z0-9_$]/g, "_")}`;
}

/** The `catalogs` registry entries for the translated locales, in emission
 *  order (`en` first, then the rest sorted).
 *
 *  A region-tagged locale is registered TWICE — under its exact tag
 *  (`"pt-BR"`) and under its base language (`pt`) — because `activeLocale()`
 *  probes `navigator.language`'s base language (`"pt-BR".split("-")[0]`).
 *  Without the alias a `pt-BR.json` the translator wrote would be emitted,
 *  imported, registered, and still never reachable — the same half-wired shape
 *  this whole path exists to remove.  The alias is skipped when the base
 *  language has its own file (`pt.json` AND `pt-BR.json`): that file wins, and
 *  nothing is silently shadowed. */
function catalogEntries(locales: readonly string[]): string[] {
  const out = [`en: en as Catalog`];
  for (const locale of locales) {
    out.push(`${JSON.stringify(locale)}: ${localeIdent(locale)} as Catalog`);
    const base = locale.split("-")[0] ?? locale;
    if (base !== locale && !locales.includes(base) && base !== "en") {
      out.push(`${JSON.stringify(base)}: ${localeIdent(locale)} as Catalog`);
    }
  }
  return out;
}

/** `src/i18n.ts` — the `t(key, default, values?)` lookup + ICU-format shim.
 *
 *  `locales` are the TRANSLATED catalogs `ddd i18n` produced that codegen
 *  emitted alongside `en.json`: each is imported and registered in `catalogs`,
 *  which is what makes `activeLocale()` able to resolve it.  The default — no
 *  translator tree on disk, every caller before this existed — emits the
 *  module BYTE-IDENTICALLY to the source-language-only form. */
export function renderI18nModule(locales: readonly string[] = []): string {
  const extra = [...new Set(locales)].filter((l) => l !== "en").sort();
  const imports = extra
    .map((l) => `import ${localeIdent(l)} from "./locales/${l}.json";\n`)
    .join("");
  return `// Generated translation runtime (Loom i18n).
// Source-language lookup with a per-key fallback and ICU message formatting via
// \`intl-messageformat\`. To add a locale, drop a
// \`src/locales/<locale>.json\` file, import it below, and register it in
// \`catalogs\`. The \`t(key, default, values)\` call sites are stable — a message
// may carry plain \`{name}\` holes or locale-formatted ones
// (\`{total, number, ::currency/USD}\`, \`{d, date, ::yMMMd}\`).
import { IntlMessageFormat } from "intl-messageformat";
import en from "./locales/en.json";
${imports}
type Catalog = Record<string, string>;

const catalogs: Record<string, Catalog> = { ${catalogEntries(extra).join(", ")} };

function activeLocale(): string {
  const nav = typeof navigator !== "undefined" ? navigator.language : "en";
  const lang = nav.split("-")[0] ?? "en";
  return catalogs[lang] ? lang : "en";
}

const locale = activeLocale();
const messages: Catalog = catalogs[locale] ?? catalogs.en ?? {};

/** Translate a message key, falling back to the source-language default, then
 *  ICU-format its placeholders from \`values\` in the active locale. A
 *  value-less message returns verbatim (no parse cost). */
export function t(
  key: string,
  defaultMessage: string,
  values?: Record<string, string | number | boolean | Date>,
): string {
  const message = messages[key] ?? defaultMessage;
  if (values === undefined) return message;
  return new IntlMessageFormat(message, locale).format(values) as string;
}
`;
}

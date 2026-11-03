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

import { DEFAULT_SOURCE_LOCALE, type UiIR } from "../../ir/types/loom-ir.js";
import { emissionSink } from "../../util/emission-sink.js";
import { chromeMergedWhenEnabled, type FormSentenceScope } from "../_walker/i18n-chrome.js";
import { collectUiMessages } from "../_walker/i18n-extract.js";
import { sourceText } from "../_walker/source-text.js";
import { baseAliases, localeEntries } from "./locale-meta.js";

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
  /** What the UI's forms render over, and which per-operation / per-item-type
   *  sentences (`chrome.operationSucceeded.<op>`, `chrome.addItem.<valueobject>`)
   *  the active pack reads.  Without it only the sentences readable off the UI
   *  itself (the `DestroyForm` ones) are catalogued. */
  scope?: FormSentenceScope,
): Record<string, string> {
  const byKey = new Map<string, string>();
  // Same key ⇒ same content hash ⇒ same message; collapses repeats.
  for (const { key, message } of collectUiMessages(ui)) byKey.set(key, message);
  if (byKey.size > 0) {
    for (const [key, message] of Object.entries(chromeMergedWhenEnabled(ui, scope)))
      byKey.set(key, message);
    for (const [key, message] of Object.entries(packChrome)) byKey.set(key, message);
  }
  const out: Record<string, string> = {};
  for (const key of [...byKey.keys()].sort()) out[key] = sourceText(key, byKey.get(key)!);
  return out;
}

/** `src/locales/<source>.json` — the source-language catalog for this UI. */
export function renderLocaleCatalog(
  ui: UiIR,
  packChrome: Record<string, string> = {},
  scope?: FormSentenceScope,
): string {
  return `${JSON.stringify(buildUiCatalog(ui, packChrome, scope), null, 2)}\n`;
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
  sourceLocale: string = DEFAULT_SOURCE_LOCALE,
  scope?: FormSentenceScope,
): Map<string, string> {
  const out = emissionSink("generator/_frontend/i18n-runtime");
  if (!translations || translations.size === 0) return out;
  const keys = Object.keys(buildUiCatalog(ui, packChrome, scope));
  if (keys.length === 0) return out;
  for (const locale of [...translations.keys()].sort()) {
    if (locale === sourceLocale) continue;
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

/** The JS binding of the source-language catalog: `en` for the default source
 *  (unchanged output), a derived identifier otherwise. */
function sourceIdent(source: string): string {
  return source === DEFAULT_SOURCE_LOCALE ? "en" : localeIdent(source);
}


/** `src/i18n.ts` — the locale model + `t(key, default, values?)` lookup and
 *  ICU-format shim.  Framework-AGNOSTIC: the locale lives in a module store
 *  (`getLocale` / `setLocale` / `subscribe`) that each frontend binds to its own
 *  reactivity (React `useSyncExternalStore`, a Vue `ref`, a Svelte store, an
 *  Angular signal), so the negotiation, persistence, `<html lang dir>` and
 *  formatter cache are written once.
 *
 *  `locales` are the TRANSLATED catalogs `ddd i18n` produced that codegen
 *  emitted alongside the source catalog: each is imported and registered, which
 *  is what makes the negotiation able to resolve it.  The negotiation order is
 *  `?lang=`, then the stored choice, then `navigator.languages`, then the
 *  source language; each candidate is tried as the exact tag and then as its
 *  base language.  A base alias (`pt` → `pt-BR`) exists only when exactly one
 *  regional variant ships (`baseAliases`), so `pt-BR.json` + `pt-PT.json` with
 *  no `pt.json` registers each tag once and never a duplicate `pt` key. */
export function renderI18nModule(
  locales: readonly string[] = [],
  source: string = DEFAULT_SOURCE_LOCALE,
): string {
  const entries = localeEntries(source, locales);
  const extra = entries.slice(1).map((e) => e.tag);
  const aliases = baseAliases(source, extra);
  const S = JSON.stringify(source);
  const src = sourceIdent(source);
  const imports = extra
    .map((l) => `import ${localeIdent(l)} from "./locales/${l}.json";\n`)
    .join("");
  const catalogLines = [
    `  ${JSON.stringify(source)}: ${src} as Catalog,`,
    ...extra.map((l) => `  ${JSON.stringify(l)}: ${localeIdent(l)} as Catalog,`),
  ].join("\n");
  const tagLines = [
    ...entries.map((e) => `  [${JSON.stringify(e.tag.toLowerCase())}, ${JSON.stringify(e.tag)}],`),
    ...Object.entries(aliases).map(([a, tag]) => `  [${JSON.stringify(a)}, ${JSON.stringify(tag)}],`),
  ].join("\n");
  const localeLines = entries
    .map(
      (e) =>
        `  { tag: ${JSON.stringify(e.tag)}, name: ${JSON.stringify(e.name)}, dir: ${JSON.stringify(e.dir)} },`,
    )
    .join("\n");
  return `// Generated translation runtime (Loom i18n).
// Locale negotiation + reactive-state store + source-language lookup with a
// per-key fallback + ICU message formatting via \`intl-messageformat\`.
// To add a locale, drop a \`src/locales/<locale>.json\` file, import it below,
// and register it in \`catalogs\` and \`tagIndex\`. The \`t(key, default, values)\`
// call sites are stable — a message may carry plain \`{name}\` holes or
// locale-formatted ones (\`{total, number, ::currency/USD}\`, \`{d, date, ::yMMMd}\`).
import { IntlMessageFormat } from "intl-messageformat";
import ${src} from "./locales/${source}.json";
${imports}
type Catalog = Record<string, string>;

/** A locale the app ships — its tag, its own name, and its direction. */
export interface LocaleInfo {
  tag: string;
  name: string;
  dir: "ltr" | "rtl";
}

export const SOURCE_LOCALE = ${S};

/** The shipped locales, source first. Names and directions are computed when the
 *  app is generated, so the switcher needs no runtime dependency. */
export const LOCALES: readonly LocaleInfo[] = [
${localeLines}
];

const catalogs: Record<string, Catalog> = {
${catalogLines}
};

/** Lower-cased tag (or unique base-language alias) → the registered tag. */
const tagIndex = new Map<string, string>([
${tagLines}
]);

export const LOCALE_STORAGE_KEY = "loom.locale";
export const LOCALE_COOKIE = "loom_locale";

/** The first candidate that names a shipped locale, trying each candidate as the
 *  exact tag and then as its base language; undefined when none does. */
export function matchLocale(candidates: readonly string[]): string | undefined {
  for (const candidate of candidates) {
    const tag = candidate.trim().toLowerCase().replace(/_/g, "-");
    if (tag === "") continue;
    const exact = tagIndex.get(tag);
    if (exact !== undefined) return exact;
    const base = tagIndex.get(tag.split("-")[0] ?? "");
    if (base !== undefined) return base;
  }
  return undefined;
}

/** {@link matchLocale}, falling back to the source language. */
export function resolveLocale(candidates: readonly string[]): string {
  return matchLocale(candidates) ?? SOURCE_LOCALE;
}

/** The locale this visit starts in: \`?lang=\`, the stored choice,
 *  \`navigator.languages\` in order, then the source language. */
export function negotiateLocale(): string {
  const candidates: string[] = [];
  try {
    const lang = new URLSearchParams(window.location.search).get("lang");
    if (lang) candidates.push(lang);
  } catch {
    // no window (SSR / tests): skip the URL
  }
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored) candidates.push(stored);
  } catch {
    // storage blocked or absent: skip the stored choice
  }
  if (typeof navigator !== "undefined") {
    candidates.push(...(navigator.languages ?? []));
    if (navigator.language) candidates.push(navigator.language);
  }
  return resolveLocale(candidates);
}

/** Keep \`<html lang dir>\` on the active locale. */
function applyDocument(tag: string): void {
  if (typeof document === "undefined") return;
  const info = LOCALES.find((l) => l.tag === tag);
  document.documentElement.lang = tag;
  document.documentElement.dir = info?.dir ?? "ltr";
}

let current = negotiateLocale();
applyDocument(current);
const listeners = new Set<() => void>();

/** The active locale — the one tag \`t()\`, the date/number formatters and the
 *  API client's \`Accept-Language\` all read. */
export function getLocale(): string {
  return current;
}

/** Subscribe to locale changes; returns the unsubscribe function. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Switch the active locale: persist the choice (\`localStorage\`, mirrored to the
 *  \`loom_locale\` cookie for server-rendered hosts), drop a stale \`?lang=\`
 *  from the URL, update \`<html lang dir>\` and notify subscribers.  A tag that
 *  names no shipped locale is ignored. */
export function setLocale(tag: string): void {
  const next = matchLocale([tag]);
  if (next === undefined) return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
  } catch {
    // storage blocked: the choice lasts for this visit only
  }
  if (typeof document !== "undefined") {
    document.cookie = \`\${LOCALE_COOKIE}=\${encodeURIComponent(next)}; path=/; max-age=31536000; SameSite=Lax\`;
  }
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has("lang")) {
      url.searchParams.set("lang", next);
      window.history.replaceState(window.history.state, "", url);
    }
  } catch {
    // no window: nothing to rewrite
  }
  if (next === current) return;
  current = next;
  applyDocument(next);
  for (const listener of [...listeners]) listener();
}

/** One parsed formatter per (locale, message) — parsing is the cost, formatting
 *  is cheap, and the same few messages render on every pass. */
const formatters = new Map<string, IntlMessageFormat>();

function formatterFor(locale: string, message: string): IntlMessageFormat {
  const cacheKey = locale + "\\u0000" + message;
  let format = formatters.get(cacheKey);
  if (format === undefined) {
    format = new IntlMessageFormat(message, locale);
    formatters.set(cacheKey, format);
  }
  return format;
}

type Values = Record<string, string | number | boolean | Date>;

/** A \`{x, date}\` / \`{x, time}\` hole formats a \`Date\`, but a wire date or
 *  datetime arrives as its ISO text.  A calendar date (\`YYYY-MM-DD\`) becomes
 *  LOCAL midnight of that day, so the formatter shows the day that was written
 *  in every zone — \`new Date("2026-01-01")\` is UTC midnight, which reads as
 *  December 31 west of UTC.  Any other text is an instant. */
function formatValues(message: string, values: Values): Values {
  const out: Values = { ...values };
  for (const [k, v] of Object.entries(values)) {
    if (typeof v !== "string") continue;
    if (!new RegExp("\\\\{\\\\s*" + k + "\\\\s*,\\\\s*(date|time)\\\\b").test(message)) continue;
    const day = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(v);
    out[k] = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(v);
  }
  return out;
}

/** Translate a message key in the ACTIVE locale, falling back to the
 *  source-language default, then ICU-format its placeholders from \`values\`. A
 *  value-less message returns verbatim (no parse cost). */
export function t(key: string, defaultMessage: string, values?: Values): string {
  const message = catalogs[current]?.[key] ?? defaultMessage;
  if (values === undefined) return message;
  return formatterFor(current, message).format(formatValues(message, values)) as string;
}
`;
}

// Generated translation runtime (Loom i18n).
// Locale negotiation + reactive-state store + source-language lookup with a
// per-key fallback + ICU message formatting via `intl-messageformat`.
// To add a locale, drop a `src/locales/<locale>.json` file, import it below,
// and register it in `catalogs` and `tagIndex`. The `t(key, default, values)`
// call sites are stable — a message may carry plain `{name}` holes or
// locale-formatted ones (`{total, number, ::currency/USD}`, `{d, date, ::yMMMd}`).
import { IntlMessageFormat } from "intl-messageformat";
import en from "./locales/en.json";

type Catalog = Record<string, string>;

/** A locale the app ships — its tag, its own name, and its direction. */
export interface LocaleInfo {
  tag: string;
  name: string;
  dir: "ltr" | "rtl";
}

export const SOURCE_LOCALE = "en";

/** The shipped locales, source first. Names and directions are computed when the
 *  app is generated, so the switcher needs no runtime dependency. */
export const LOCALES: readonly LocaleInfo[] = [
  { tag: "en", name: "English", dir: "ltr" },
];

const catalogs: Record<string, Catalog> = {
  "en": en as Catalog,
};

/** Lower-cased tag (or unique base-language alias) → the registered tag. */
const tagIndex = new Map<string, string>([
  ["en", "en"],
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

/** The locale this visit starts in: `?lang=`, the stored choice,
 *  `navigator.languages` in order, then the source language. */
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

/** Keep `<html lang dir>` on the active locale. */
function applyDocument(tag: string): void {
  if (typeof document === "undefined") return;
  const info = LOCALES.find((l) => l.tag === tag);
  document.documentElement.lang = tag;
  document.documentElement.dir = info?.dir ?? "ltr";
}

/** Re-spell the static `<title data-loom-title="<key>">` of `index.html` in the
 *  active locale, so the tab is translated before the first page mounts. */
function applyTitle(): void {
  if (typeof document === "undefined") return;
  const el = document.querySelector("title[data-loom-title]");
  const key = el?.getAttribute("data-loom-title");
  if (el && key) el.textContent = t(key, el.textContent ?? "");
}

let current = negotiateLocale();
applyDocument(current);
const listeners = new Set<() => void>();

/** The active locale — the one tag `t()`, the date/number formatters and the
 *  API client's `Accept-Language` all read. */
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

/** Switch the active locale: persist the choice (`localStorage`, mirrored to the
 *  `loom_locale` cookie for server-rendered hosts), drop a stale `?lang=`
 *  from the URL, update `<html lang dir>` and notify subscribers.  A tag that
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
    document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=31536000; SameSite=Lax`;
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
  applyTitle();
  for (const listener of [...listeners]) listener();
}

/** One parsed formatter per (locale, message) — parsing is the cost, formatting
 *  is cheap, and the same few messages render on every pass. */
const formatters = new Map<string, IntlMessageFormat>();

function formatterFor(locale: string, message: string): IntlMessageFormat {
  const cacheKey = locale + "\u0000" + message;
  let format = formatters.get(cacheKey);
  if (format === undefined) {
    format = new IntlMessageFormat(message, locale);
    formatters.set(cacheKey, format);
  }
  return format;
}

type Values = Record<string, string | number | boolean | Date>;

/** A `{x, date}` / `{x, time}` hole formats a `Date`, but a wire date or
 *  datetime arrives as its ISO text.  A calendar date (`YYYY-MM-DD`) becomes
 *  LOCAL midnight of that day, so the formatter shows the day that was written
 *  in every zone — `new Date("2026-01-01")` is UTC midnight, which reads as
 *  December 31 west of UTC.  Any other text is an instant. */
function formatValues(message: string, values: Values): Values {
  const out: Values = { ...values };
  for (const [k, v] of Object.entries(values)) {
    if (typeof v !== "string") continue;
    if (!new RegExp("\\{\\s*" + k + "\\s*,\\s*(date|time)\\b").test(message)) continue;
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    out[k] = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(v);
  }
  return out;
}

/** Translate a message key in the ACTIVE locale, falling back to the
 *  source-language default, then ICU-format its placeholders from `values`. A
 *  value-less message returns verbatim (no parse cost). */
export function t(key: string, defaultMessage: string, values?: Values): string {
  const message = catalogs[current]?.[key] ?? defaultMessage;
  if (values === undefined) return message;
  return formatterFor(current, message).format(formatValues(message, values)) as string;
}

/** The emphasis tags a rich-text message may carry, and the element each becomes. */
const RICH_TAGS: Record<string, string> = { b: "strong", i: "em", code: "code" };

/** Translate a RICH-TEXT message — one sentence whose emphasis is carried as
 *  `<b>` / `<i>` / `<code>` tags, so a locale can reorder the parts — and
 *  return it as HTML.  The tags become private marker characters before the ICU
 *  step (so they never reach the formatter, and a hole VALUE can never forge
 *  one), every other character is HTML-escaped, then the markers become
 *  `<strong>` / `<em>` / `<code>`.  Only those three elements can appear. */
export function tRich(key: string, defaultMessage: string, values?: Values): string {
  const message = (catalogs[current]?.[key] ?? defaultMessage).replace(
    /<(\/?)(b|i|code)>/g,
    "\uE000$1$2\uE001",
  );
  let text = message;
  if (values !== undefined) {
    const safe: Values = {};
    for (const [k, v] of Object.entries(values)) {
      safe[k] = typeof v === "string" ? v.replace(/[\uE000\uE001]/g, "") : v;
    }
    text = formatterFor(current, message).format(formatValues(message, safe)) as string;
  }
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\uE000(\/?)(b|i|code)\uE001/g, (_m, close: string, tag: string) => `<${close}${RICH_TAGS[tag]}>`);
}

applyTitle();

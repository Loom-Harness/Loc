// Generated translation runtime (Loom i18n).
// Source-language lookup with a per-key fallback and ICU message formatting via
// `intl-messageformat`. To add a locale, drop a
// `src/locales/<locale>.json` file, import it below, and register it in
// `catalogs`. The `t(key, default, values)` call sites are stable — a message
// may carry plain `{name}` holes or locale-formatted ones
// (`{total, number, ::currency/USD}`, `{d, date, ::yMMMd}`).
import { IntlMessageFormat } from "intl-messageformat";
import en from "./locales/en.json";

type Catalog = Record<string, string>;

const catalogs: Record<string, Catalog> = { en: en as Catalog };

function activeLocale(): string {
  const nav = typeof navigator !== "undefined" ? navigator.language : "en";
  const lang = nav.split("-")[0] ?? "en";
  return catalogs[lang] ? lang : "en";
}

const locale = activeLocale();
const messages: Catalog = catalogs[locale] ?? catalogs.en ?? {};

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

/** Translate a message key, falling back to the source-language default, then
 *  ICU-format its placeholders from `values` in the active locale. A
 *  value-less message returns verbatim (no parse cost). */
export function t(key: string, defaultMessage: string, values?: Values): string {
  const message = messages[key] ?? defaultMessage;
  if (values === undefined) return message;
  return new IntlMessageFormat(message, locale).format(formatValues(message, values)) as string;
}

// ---------------------------------------------------------------------------
// Generate-time locale metadata shared by every frontend's runtime locale model:
// the locale's own name (endonym), its writing direction, and which base-language
// aliases the negotiation registers.
//
// Everything here runs in the GENERATOR (Node's ICU), never in the emitted app,
// so a target needs no runtime dependency to label or direct a locale — the
// generated switcher and the `<html lang dir>` updater carry plain strings.
// ---------------------------------------------------------------------------

export type LocaleDir = "ltr" | "rtl";

/** One locale the app ships: the tag its catalog is registered under, the name
 *  it calls itself, and its direction. */
export interface LocaleEntry {
  tag: string;
  name: string;
  dir: LocaleDir;
}

/** Languages written right-to-left, by base language — the fallback when ICU
 *  cannot maximise a tag to a script. */
const RTL_LANGUAGES: ReadonlySet<string> = new Set([
  "ar",
  "ckb",
  "dv",
  "fa",
  "he",
  "iw",
  "ks",
  "ps",
  "sd",
  "ug",
  "ur",
  "yi",
]);

/** Right-to-left scripts (ISO 15924). */
const RTL_SCRIPTS: ReadonlySet<string> = new Set([
  "Adlm",
  "Arab",
  "Hebr",
  "Mand",
  "Nkoo",
  "Rohg",
  "Samr",
  "Syrc",
  "Thaa",
]);

/** The direction a locale reads in.  An explicit script subtag wins
 *  (`sd-Deva` is LTR, `ku-Arab` is RTL); otherwise ICU's likely script for the
 *  language; otherwise the static language set. */
export function localeDir(tag: string): LocaleDir {
  try {
    const locale = new Intl.Locale(tag);
    const script = locale.script ?? locale.maximize().script;
    if (script !== undefined) return RTL_SCRIPTS.has(script) ? "rtl" : "ltr";
    return RTL_LANGUAGES.has(locale.language) ? "rtl" : "ltr";
  } catch {
    const base = tag.split("-")[0]?.toLowerCase() ?? "";
    return RTL_LANGUAGES.has(base) ? "rtl" : "ltr";
  }
}

/** A locale's name in its own language (`de` → "Deutsch", `fr` → "Français",
 *  `pt-BR` → "Português (Brasil)").  The first letter is upper-cased with the
 *  locale's own casing rules so the list reads uniformly; ICU lower-cases
 *  language names in languages that do not capitalise them (French, Spanish).
 *  A tag ICU cannot name is returned as-is. */
export function localeEndonym(tag: string): string {
  let name: string | undefined;
  try {
    name = new Intl.DisplayNames([tag], { type: "language" }).of(tag);
  } catch {
    name = undefined;
  }
  if (name === undefined || name === "") return tag;
  const first = [...name][0] ?? "";
  try {
    return first.toLocaleUpperCase(tag) + name.slice(first.length);
  } catch {
    return first.toUpperCase() + name.slice(first.length);
  }
}

/** The locales an app ships: the source first, then the translated ones sorted,
 *  each with its endonym and direction. */
export function localeEntries(source: string, translated: readonly string[]): LocaleEntry[] {
  const rest = [...new Set(translated)].filter((l) => l !== source).sort();
  return [source, ...rest].map((tag) => ({
    tag,
    name: localeEndonym(tag),
    dir: localeDir(tag),
  }));
}

/** The base-language aliases the negotiation registers, as `alias → real tag`.
 *
 *  A base alias (`pt` → `pt-BR`) exists only when EXACTLY ONE regional variant
 *  of that base ships (source included) and no catalog is named for the base
 *  itself.  With `pt-BR` + `pt-PT` both present there is no honest answer for a
 *  bare `pt`, so none is registered — each tag resolves exactly and a bare `pt`
 *  falls through to the next negotiation candidate.  The source language's own
 *  base is never aliased (it resolves to the source anyway). */
export function baseAliases(source: string, translated: readonly string[]): Record<string, string> {
  const all = [source, ...[...new Set(translated)].filter((l) => l !== source)];
  const lower = new Set(all.map((l) => l.toLowerCase()));
  const variants = new Map<string, string[]>();
  for (const tag of all) {
    const base = (tag.split("-")[0] ?? tag).toLowerCase();
    if (base === tag.toLowerCase() || lower.has(base)) continue;
    variants.set(base, [...(variants.get(base) ?? []), tag]);
  }
  const sourceBase = (source.split("-")[0] ?? source).toLowerCase();
  const out: Record<string, string> = {};
  for (const [base, tags] of [...variants].sort(([a], [b]) => a.localeCompare(b))) {
    const only = tags[0];
    if (tags.length === 1 && only !== undefined && base !== sourceBase) out[base] = only;
  }
  return out;
}

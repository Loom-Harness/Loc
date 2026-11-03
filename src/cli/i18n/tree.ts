// ---------------------------------------------------------------------------
// The translator tree on disk (the fs half of `src/i18n/namespace.ts`).
//
//   <dir>/<locale>/<ns>.json        one locale's catalog, one file per namespace
//   <dir>/<source>/<ns>.json        OVERRIDES of the source language's own text
//   <dir>/.loom/source.lock/<ns>.json   the BASE snapshot, same shape
//
// Legacy flat layout (read for migration only):
//
//   <dir>/<locale>.json             every key in one file
//   <dir>/.loom/source.lock.json    the flat lock
//
// Every reader and writer of the tree lives here, so the layout has one
// definition besides the pure key mapping.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";
import {
  type Catalog,
  hasConflictMarkers,
  isTodo,
  normalizeLegacy,
  type ReviewEntry,
} from "../../i18n/merge.js";
import { joinCatalog, splitCatalog } from "../../i18n/namespace.js";
import { DEFAULT_SOURCE_LOCALE } from "../../ir/types/loom-ir.js";

export const LOCK_DIR_REL = path.join(".loom", "source.lock");
export const LOCK_FLAT_REL = path.join(".loom", "source.lock.json");

export interface DirOption {
  dir?: string;
}

/** Where the translator tree lives for a given model.
 *
 *  An explicit `--dir` wins; otherwise it is `locales/` NEXT TO THE `.ddd`
 *  FILE, not next to the shell's cwd.  Every `ddd i18n` subcommand is
 *  addressed by a model path, and resolving one of its two directories
 *  against the model and the other against the cwd is how `extract` came to
 *  write `./out/.loom/messages.en.json` for a project generated in place
 *  while its siblings read `./locales` — the same command line meaning two
 *  different projects depending on where it was typed. */
export function localesDir(file: string, options: DirOption): string {
  if (options.dir !== undefined) return path.resolve(options.dir);
  return path.join(path.dirname(path.resolve(file)), "locales");
}

/** A tree whose layout is inconsistent (a locale in both layouts). */
export class I18nLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "I18nLayoutError";
  }
}

function readCatalog<T = string>(file: string): Record<string, T> {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, T>;
}

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** Every `<ns>.json` under `dir`, as `ns -> file content`.  A missing dir is an
 *  empty map. */
export function readNamespaceDir<T = string>(dir: string): Map<string, Record<string, T>> {
  const out = new Map<string, Record<string, T>>();
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const ns = entry.name.slice(0, -".json".length);
    out.set(ns, readCatalog<T>(path.join(dir, entry.name)));
  }
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b)));
}

/** Make `dir` hold exactly the non-empty files in `files`: write each, and
 *  delete every other `<ns>.json` (an emptied namespace leaves no file). */
export function writeNamespaceDir<T = string>(
  dir: string,
  files: ReadonlyMap<string, Record<string, T>>,
  options: { keepEmpty?: boolean } = {},
): void {
  for (const [ns, catalog] of files) {
    if (options.keepEmpty || Object.keys(catalog).length > 0) {
      writeJson(path.join(dir, `${ns}.json`), catalog);
    }
  }
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const ns = entry.name.slice(0, -".json".length);
    const kept = files.get(ns);
    if (kept === undefined || (!options.keepEmpty && Object.keys(kept).length === 0)) {
      fs.rmSync(path.join(dir, entry.name));
    }
  }
  if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

// ---- Out-of-band state ----------------------------------------------------
//
//   <dir>/.loom/review/<locale>/<ns>.json   needs-review entries (ReviewEntry)
//   <dir>/.loom/stale/<locale>/<ns>.json    translations of source-deleted keys
//
// Same per-namespace shape and file-key spelling as the locale files, so a
// locale file stays a plain `{ key: translation }` map any translation tool
// can round-trip.  Absence of a key from the locale file IS the untranslated
// state; nothing is written for it.

const REVIEW_DIR_REL = path.join(".loom", "review");
const STALE_DIR_REL = path.join(".loom", "stale");

/** The locale directory content: the files the locale holds plus an empty
 *  `{}` file for every namespace the source emits, so a locale with nothing
 *  translated yet still exists on disk (an empty directory is not committed). */
function localeFiles(
  merged: ReadonlyMap<string, Catalog>,
  namespaces: Iterable<string>,
): Map<string, Catalog> {
  const out = new Map<string, Catalog>(merged);
  for (const ns of namespaces) if (!out.has(ns)) out.set(ns, {});
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b)));
}

/** Write one locale: its translations plus its review and stale sidecars. */
export function writeLocaleDir(
  dir: string,
  locale: string,
  files: ReadonlyMap<string, Catalog>,
  namespaces: Iterable<string>,
  state: {
    review: ReadonlyMap<string, Record<string, ReviewEntry>>;
    stale: ReadonlyMap<string, Catalog>;
  },
): void {
  writeNamespaceDir(path.join(dir, locale), localeFiles(files, namespaces), { keepEmpty: true });
  writeNamespaceDir(path.join(dir, REVIEW_DIR_REL, locale), state.review);
  writeNamespaceDir(path.join(dir, STALE_DIR_REL, locale), state.stale);
}

/** The locales under `dir`, by layout: a directory is the split layout, a
 *  top-level `*.json` is the legacy flat one.  The machine `.loom/` subtree is
 *  skipped. */
function discoverLocales(dir: string): { split: string[]; flat: string[] } {
  const split: string[] = [];
  const flat: string[] = [];
  if (!fs.existsSync(dir)) return { split, flat };
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) split.push(entry.name);
    else if (entry.isFile() && entry.name.endsWith(".json")) {
      flat.push(entry.name.slice(0, -".json".length));
    }
  }
  return { split: split.sort(), flat: flat.sort() };
}

/** Refuse a tree that holds a locale in both layouts. */
export function assertConsistentLayout(dir: string): void {
  const { split, flat } = discoverLocales(dir);
  const both = flat.filter((l) => split.includes(l));
  if (both.length > 0) {
    throw new I18nLayoutError(
      `Locale layout conflict: ${both
        .map((l) => `${rel(path.join(dir, `${l}.json`))} and ${rel(path.join(dir, l))}/`)
        .join(", ")} both exist. ` +
        "Merge them into locales/<locale>/<ns>.json by hand and delete the flat file, then re-run.",
    );
  }
  const lockFlat = path.join(dir, LOCK_FLAT_REL);
  const lockDir = path.join(dir, LOCK_DIR_REL);
  if (fs.existsSync(lockFlat) && fs.existsSync(lockDir)) {
    throw new I18nLayoutError(
      `Lock layout conflict: ${rel(lockFlat)} and ${rel(lockDir)}/ both exist. ` +
        "Delete the flat lock (the split one is authoritative) and re-run.",
    );
  }
}

function rel(p: string): string {
  return path.relative(process.cwd(), p) || p;
}

/** Rewrite a legacy flat key to its current spelling.
 *
 *  Authored keys used to start `page.` / `component.` / `menu.`; they now lead
 *  with the ui name.  A legacy key moves under every ui that still emits it
 *  (the same message hashes to the same key, so each copy is a valid
 *  translation), or under the sole ui of a one-ui system when the source no
 *  longer emits it.  Anything else keeps its spelling. */
function migrateLegacyKeys(flat: Catalog, uiNames: ReadonlySet<string>, current: Catalog): Catalog {
  const out: Catalog = {};
  for (const [key, value] of Object.entries(flat)) {
    if (!/^(page|component|menu)\./.test(key)) {
      out[key] = value;
      continue;
    }
    const targets = [...uiNames].filter((u) => `${u}.${key}` in current);
    const only = uiNames.size === 1 ? [...uiNames] : [];
    const chosen = targets.length > 0 ? targets : only;
    if (chosen.length === 0) out[key] = value;
    for (const ui of chosen) out[`${ui}.${key}`] = value;
  }
  return out;
}

/** Drop the entries a runtime must not ship: placeholders, conflict markers,
 *  `_stale.` shadows and non-strings. */
function finishedEntries(raw: Catalog): Catalog {
  const out: Catalog = {};
  for (const key of Object.keys(raw).sort()) {
    if (key.startsWith("_stale.")) continue;
    const value = raw[key];
    if (typeof value !== "string") continue;
    if (isTodo(value) || hasConflictMarkers(value)) continue;
    out[key] = value;
  }
  return out;
}

/** Read one locale directory as a flat runtime catalog, unfinished values
 *  dropped.  `undefined` when its JSON is not valid. */
function readLocaleFlat(localeDir: string): Catalog | undefined {
  try {
    return finishedEntries(joinCatalog(readNamespaceDir(localeDir)));
  } catch {
    // A hand-edited locale file that is not valid JSON must not take down a
    // `generate system` run that is otherwise about the domain model.  `ddd
    // i18n check` is the command that reports on the translator tree.
    return undefined;
  }
}

/** The source-language overrides (`<dir>/<source>/<ns>.json`) as a runtime
 *  key -> text map.  Empty when the directory is absent. */
export function loadSourceOverrides(
  file: string,
  options: DirOption & { source?: string } = {},
): Map<string, string> {
  const dir = localesDir(file, options);
  const source = options.source ?? DEFAULT_SOURCE_LOCALE;
  const localeDir = path.join(dir, source);
  if (!fs.existsSync(localeDir)) {
    // A tree not yet migrated to the split layout keeps its overrides in
    // `<source>.json`; honour them until `ddd i18n sync` moves them.
    try {
      return new Map(
        Object.entries(finishedEntries(readCatalog(path.join(dir, `${source}.json`)))),
      );
    } catch {
      return new Map();
    }
  }
  return new Map(Object.entries(readLocaleFlat(localeDir) ?? {}));
}

/** Every translated locale catalog the translator tree holds, for `generate
 *  system` to emit into the frontends (`<app>/src/locales/<locale>.json`).
 *
 *  Resolved through the SAME {@link localesDir} every `ddd i18n` subcommand
 *  uses, so `--locales <dir>` and the default (`locales/` next to the `.ddd`)
 *  behave identically on both sides.  A missing tree is the normal case and
 *  returns an empty map — codegen then emits exactly what it emitted before.
 *  The source language's own directory holds overrides, not a translation, and
 *  is read by {@link loadSourceOverrides} instead.
 *
 *  Values the translator has NOT finished are dropped rather than shipped:
 *  the generated runtime is `messages[key] ?? defaultMessage`, so a key whose
 *  value is still `TODO: Approve` — or carries unresolved conflict markers —
 *  would RENDER that text to the end user, while an ABSENT key falls back per
 *  key to the source-language default `t(key, default)` already carries.  The
 *  `_stale.<key>` shadows `--keep-stale` writes are dropped for the same
 *  reason: they name keys the source no longer emits.
 *
 *  A locale whose every value is still `TODO:` therefore ships an EMPTY
 *  catalog, and is still registered — the app must advertise exactly the
 *  locales the translator created, or "I ran `ddd i18n init de` and the app
 *  still has no German" is the same disconnect this fixes, moved one step. */
export function loadTranslations(
  file: string,
  options: DirOption & { source?: string } = {},
): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  const dir = localesDir(file, options);
  const source = options.source ?? DEFAULT_SOURCE_LOCALE;
  const { split, flat } = discoverLocales(dir);
  const legacy = flat.filter((l) => !split.includes(l) && l !== source);
  if (legacy.length > 0) {
    console.error(
      `warning: ${legacy.map((l) => `${l}.json`).join(", ")} in ${rel(dir)} use the flat locale layout and are not loaded; run \`ddd i18n sync\` to migrate them to locales/<locale>/<ns>.json.`,
    );
  }
  for (const locale of split) {
    if (locale === source) continue;
    const catalog = readLocaleFlat(path.join(dir, locale));
    if (catalog) out.set(locale, catalog);
  }
  return out;
}

/** The pieces of a tree a `ddd i18n` command works over, in the split layout
 *  regardless of what is on disk (a flat tree is migrated in memory). */
export interface Tree {
  /** Translator locales (the source language excluded), `ns -> catalog`. */
  locales: {
    locale: string;
    /** Finished translations, legacy in-band markers already lifted out. */
    files: Map<string, Catalog>;
    review: Map<string, Record<string, ReviewEntry>>;
    stale: Map<string, Catalog>;
    fromFlat: boolean;
    /** Values still in the in-band scheme (`TODO:`, conflict blocks, `_stale.`). */
    legacy: number;
  }[];
  /** The source language's overrides, `ns -> catalog`. */
  overrides: Map<string, Catalog>;
  overridesFromFlat: boolean;
  /** The lock (BASE), `ns -> catalog`. */
  base: Map<string, Catalog>;
  baseFromFlat: boolean;
  /** True when a file is still in the flat layout, i.e. `sync` has a layout
   *  migration to perform. */
  migrationPending: boolean;
  /** True when a locale file still carries in-band `TODO:` / conflict / `_stale.`
   *  values that `sync` will lift into the out-of-band state. */
  legacyPending: boolean;
}

export interface TreeContext {
  dir: string;
  source: string;
  /** Context + ui names: the namespaces a key can be filed under. */
  names: ReadonlySet<string>;
  uiNames: ReadonlySet<string>;
  /** The freshly extracted catalog, used to place legacy keys. */
  current: Catalog;
  /** Restrict `locales` to this one. */
  locale?: string;
}

/** Read the whole tree, migrating the legacy flat layout in memory. */
export function readTree(ctx: TreeContext): Tree {
  assertConsistentLayout(ctx.dir);
  const { split, flat } = discoverLocales(ctx.dir);
  const toFiles = (catalog: Catalog): Map<string, Catalog> =>
    splitCatalog(migrateLegacyKeys(catalog, ctx.uiNames, ctx.current), ctx.names);

  // Lift legacy in-band markers out of each file and fold them into the
  // out-of-band state already on disk.
  const lift = (
    locale: string,
    raw: Map<string, Catalog>,
    fromFlat: boolean,
  ): Tree["locales"][number] => {
    const files = new Map<string, Catalog>();
    const review = readNamespaceDir<ReviewEntry>(path.join(ctx.dir, REVIEW_DIR_REL, locale));
    const stale = readNamespaceDir<string>(path.join(ctx.dir, STALE_DIR_REL, locale));
    let legacy = 0;
    for (const [ns, catalog] of raw) {
      const lifted = normalizeLegacy(catalog);
      legacy += lifted.changed;
      files.set(ns, lifted.ours);
      if (Object.keys(lifted.review).length > 0) {
        review.set(ns, { ...review.get(ns), ...lifted.review });
      }
      if (Object.keys(lifted.stale).length > 0) {
        stale.set(ns, { ...stale.get(ns), ...lifted.stale });
      }
    }
    return { locale, files, review, stale, fromFlat, legacy };
  };

  const locales: Tree["locales"] = [];
  for (const locale of split) {
    if (locale === ctx.source) continue;
    if (ctx.locale && locale !== ctx.locale) continue;
    locales.push(lift(locale, readNamespaceDir(path.join(ctx.dir, locale)), false));
  }
  for (const locale of flat) {
    if (locale === ctx.source) continue;
    if (ctx.locale && locale !== ctx.locale) continue;
    locales.push(lift(locale, toFiles(readCatalog(path.join(ctx.dir, `${locale}.json`))), true));
  }
  locales.sort((a, b) => a.locale.localeCompare(b.locale));

  let overrides = readNamespaceDir(path.join(ctx.dir, ctx.source));
  let overridesFromFlat = false;
  const sourceFlat = path.join(ctx.dir, `${ctx.source}.json`);
  if (flat.includes(ctx.source)) {
    overrides = toFiles(finishedEntries(readCatalog(sourceFlat)));
    overridesFromFlat = true;
  }

  let base = readNamespaceDir(path.join(ctx.dir, LOCK_DIR_REL));
  let baseFromFlat = false;
  const lockFlat = path.join(ctx.dir, LOCK_FLAT_REL);
  if (fs.existsSync(lockFlat)) {
    base = toFiles(readCatalog(lockFlat));
    baseFromFlat = true;
  }

  return {
    locales,
    overrides,
    overridesFromFlat,
    base,
    baseFromFlat,
    migrationPending: locales.some((l) => l.fromFlat) || overridesFromFlat || baseFromFlat,
    legacyPending: locales.some((l) => l.legacy > 0),
  };
}

/** Remove the flat files a migration has replaced. */
export function removeFlatFiles(dir: string, tree: Tree, source: string): void {
  for (const l of tree.locales) {
    if (l.fromFlat) fs.rmSync(path.join(dir, `${l.locale}.json`));
  }
  if (tree.overridesFromFlat) fs.rmSync(path.join(dir, `${source}.json`));
  if (tree.baseFromFlat) fs.rmSync(path.join(dir, LOCK_FLAT_REL));
}

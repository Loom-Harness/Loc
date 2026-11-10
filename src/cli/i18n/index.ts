// ---------------------------------------------------------------------------
// `ddd i18n <subcommand>` — the translator-workflow CLI (M-T1.11, i18n.md).
// `git merge` for strings, backed by the pure three-way merge core
// (`src/i18n/merge.ts`) and the phase ①–⑥ extraction (`./extract.ts`).
//
//   ddd i18n extract <file> [-o out]        write <out>/.loom/messages.<source>.json
//   ddd i18n init    <file> <locale>        scaffold locales/<locale>/<ns>.json + lock
//   ddd i18n sync    <file> [--locale l]    three-way merge every locale; bump lock
//   ddd i18n status  <file>                 what sync would do; non-zero if pending
//   ddd i18n check   <file> [--strict]      CI gate: ICU/placeholders/plurals, untranslated, review
//   ddd i18n approve <file> [keys…]         clear needs-review flags
//   ddd i18n prune   <file>                 drop keys the source no longer emits
//   ddd i18n export  <file> --locale l      XLIFF / PO for a translation tool
//   ddd i18n import  <file> <exchange>      take a translated XLIFF / PO back
//
// File layout (i18n.md §"File layout"), one file per namespace:
//
//   <dir>/.loom/source.lock/<ns>.json      BASE — source snapshot at last sync
//   <dir>/<locale>/<ns>.json               OURS — the translator's files (human-owned)
//   <dir>/<source>/<ns>.json               OVERRIDES of the source language's own text
//   <dir>/.loom/review/<locale>/<ns>.json  needs-review state (out of band)
//   <dir>/.loom/stale/<locale>/<ns>.json   translations of source-deleted keys (--keep-stale)
//   <out>/.loom/messages.<source>.json     THEIRS — freshly extracted source catalog
//
// A locale file holds finished translations only: an UNTRANSLATED key is absent
// (never a `TODO:` value), and "the source moved under this translation" is a
// review entry in the sidecar (never a conflict block inside the value), so a
// translation tool reads every value in the file as a real translation.
//
// `<ns>` is `_chrome`, `_system`, a bounded-context name or a ui name; the key
// <-> file mapping is `src/i18n/namespace.ts`, the fs half is `./tree.ts`.  The
// merge core is per-key and runs once per namespace file.
//
// Codegen never writes under <dir>/; reconciliation here is a deliberate,
// commit-worthy checkpoint, so every write is explicit and reported.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";
import { describeIssue, type IcuIssue, validateTranslation } from "../../i18n/icu.js";
import {
  type Catalog,
  type MergeReport,
  mergeCatalog,
  type ReviewEntry,
  reportHasPending,
} from "../../i18n/merge.js";
import { joinCatalog, runtimeKeyOf, splitCatalog } from "../../i18n/namespace.js";
import { PSEUDO_LOCALE, pseudoCatalog } from "../../i18n/pseudo.js";
import {
  type AmbiguousRename,
  detectRenamesReport,
  followTypeMoves,
  type KeyMove,
  moveKeys,
  type RenameReport,
} from "../../i18n/renames.js";
import { extractProject } from "./extract.js";
import { type LocaleEntry, type LocaleFilter, openReviewKeys, openTree, relPath } from "./open.js";
import {
  assertConsistentLayout,
  type DirOption,
  LOCK_DIR_REL,
  LOCK_FLAT_REL,
  localesDir,
  removeFlatFiles,
  type Tree,
  writeJson,
  writeLocaleDir,
  writeNamespaceDir,
} from "./tree.js";

export { runI18nExport, runI18nImport } from "./exchange.js";
export type { LocaleFilter } from "./open.js";
export { I18nLayoutError, loadSourceOverrides, loadTranslations, localesDir } from "./tree.js";

/** `ddd i18n extract <file> [-o out]` — write the fresh source catalog.
 *
 *  `--out` defaults to the `.ddd` file's own directory (so the catalog lands
 *  in the project's `.loom/`, alongside every other `.loom/` artifact), not
 *  to `./out` — see `localesDir` for why the cwd is the wrong anchor here. */
export async function runI18nExtract(
  file: string,
  options: DirOption & { out?: string },
): Promise<void> {
  const { catalog, source } = await extractProject(file, options);
  const out =
    options.out !== undefined ? path.resolve(options.out) : path.dirname(path.resolve(file));
  const target = path.join(out, ".loom", `messages.${source}.json`);
  writeJson(target, catalog);
  console.log(`Extracted ${Object.keys(catalog).length} message(s) → ${relPath(target)}`);
}

const NO_STATE = { review: new Map<string, Record<string, ReviewEntry>>(), stale: new Map() };

/** `ddd i18n init <file> <locale>` — scaffold a locale's files + the lock.
 *
 *  A new locale starts EMPTY: every namespace gets a `{}` file and every key is
 *  untranslated by absence.  The pseudo-locale `en-XA` is the exception — it is
 *  generated from the source, so it starts full. */
export async function runI18nInit(file: string, locale: string, options: DirOption): Promise<void> {
  const { catalog, names, source } = await extractProject(file, options);
  const dir = localesDir(file, options);
  const localeDir = path.join(dir, locale);

  if (locale === source) {
    // The source language is the text the `.ddd` already carries; its directory
    // holds only the strings a translator chose to reword.
    console.error(
      `${locale} is the source language: ${relPath(localeDir)}/<ns>.json holds overrides of the source text, not translations (nothing scaffolded).`,
    );
    return;
  }

  if (fs.existsSync(localeDir) || fs.existsSync(path.join(dir, `${locale}.json`))) {
    console.error(`Locale already exists: ${relPath(localeDir)} (leaving it untouched)`);
  } else {
    const split = splitCatalog(catalog, names);
    const pseudo = locale === PSEUDO_LOCALE;
    const files = pseudo ? splitCatalog(pseudoCatalog(catalog), names) : new Map<string, Catalog>();
    writeLocaleDir(dir, locale, files, split.keys(), NO_STATE);
    console.log(
      pseudo
        ? `Created ${relPath(localeDir)}/ — pseudo-locale, ${Object.keys(catalog).length} key(s) generated from the source (\`sync\` keeps it current)`
        : `Created ${relPath(localeDir)}/ — ${Object.keys(catalog).length} key(s) to translate in ${split.size} file(s)`,
    );
  }

  // A flat lock still on disk is migrated by `sync`; writing a split one beside
  // it would put the tree in two layouts at once.
  const lockDir = path.join(dir, LOCK_DIR_REL);
  if (!fs.existsSync(lockDir) && !fs.existsSync(path.join(dir, LOCK_FLAT_REL))) {
    writeNamespaceDir(lockDir, splitCatalog(catalog, names));
    console.log(`Wrote lock ${relPath(lockDir)}/`);
  }
}

function summarize(locale: string, report: MergeReport, renamed = 0): string {
  const parts = [`+${report.added.length} new`, `${report.kept.length} kept`];
  if (renamed) parts.push(`${renamed} renamed`);
  if (report.untranslated.length) parts.push(`${report.untranslated.length} untranslated`);
  if (report.updated.length) parts.push(`${report.updated.length} placeholder rename`);
  if (report.carried.length) parts.push(`${report.carried.length} carried`);
  if (report.dropped.length) parts.push(`-${report.dropped.length} dropped`);
  if (report.conflicted.length) parts.push(`${report.conflicted.length} needs review`);
  return `  ${locale}: ${parts.join(", ")}`;
}

/** Name every design-pack family carry-over (merge case 5) under its locale.
 *
 *  A carry is NOT silent even though the written value is a clean translation:
 *  a string reviewed against one pack's UI can read differently in another's,
 *  so the reviewer is told which keys moved and where from.  The signal lives
 *  here and in the locale file's diff rather than inside the value — a marker
 *  inside the value would ship to end users through the generated `t()`
 *  runtime. */
function reportCarried(report: MergeReport): void {
  for (const { key, from } of report.carried) {
    console.log(`      carried: ${key}`);
    console.log(`            <- ${from} (design-pack family swap; same role, same message)`);
  }
}

/** A translation carried to a new identity key; `textChanged` when the English
 *  source moved too (the merge then flags the carried translation for review). */
interface AppliedMove extends KeyMove {
  textChanged: boolean;
}

/** Name every identity-key rename a locale's translations were carried across. */
function reportMoves(moved: readonly AppliedMove[]): void {
  for (const m of moved) {
    console.log(`      renamed: ${m.from}`);
    console.log(
      `            -> ${m.to} (${m.via === "declared" ? "migration block" : "inferred: one key out, one in, same text"})${m.textChanged ? " - source text changed, needs review" : ""}`,
    );
  }
}

/** Name every declared rename left unresolved because it could mean several contexts. */
function reportAmbiguous(ambiguous: readonly AmbiguousRename[]): void {
  for (const a of ambiguous) {
    console.log(
      `  ambiguous rename: ${a.from} -> ${a.to} matches ${a.contexts.join(", ")}; no translation carried. Qualify the migration step (Ctx.${a.from} -> Ctx.${a.to}).`,
    );
  }
}

/** The moves that land on a key present in `files`, as the `from -> to` map
 *  `moveKeys` takes; skips a move whose target already holds an entry. */
function movesInto(
  files: ReadonlyMap<string, Record<string, unknown>>,
  moves: readonly KeyMove[],
): Map<string, string> {
  const flat = joinCatalog(files as ReadonlyMap<string, Catalog>);
  return new Map(moves.filter((m) => m.from in flat && !(m.to in flat)).map((m) => [m.from, m.to]));
}

/** The identity-key renames between the lock and the fresh extraction, plus
 *  the moves of the optional keys that follow a renamed type. */
function detectMoves(opened: {
  tree: { base: ReadonlyMap<string, Catalog> };
  catalog: Catalog;
  renames: Parameters<typeof detectRenamesReport>[2];
  optional: ReadonlyMap<string, string>;
}): RenameReport {
  const report = detectRenamesReport(joinCatalog(opened.tree.base), opened.catalog, opened.renames);
  return {
    ...report,
    moves: [...report.moves, ...followTypeMoves(report.moves, opened.optional.keys())],
  };
}

/** Merge one locale namespace by namespace, reporting in runtime keys. */
function mergeLocale(
  baseIn: ReadonlyMap<string, Catalog>,
  entryIn: LocaleEntry,
  theirs: ReadonlyMap<string, Catalog>,
  options: {
    keepStale?: boolean;
    moves?: readonly KeyMove[];
    names?: ReadonlySet<string>;
    /** The optional keys (`ProjectCatalog.optional`): never in THEIRS, kept
     *  as they are wherever the translator wrote one. */
    optional?: ReadonlyMap<string, string>;
  },
): {
  merged: Map<string, Catalog>;
  review: Map<string, Record<string, ReviewEntry>>;
  stale: Map<string, Catalog>;
  report: MergeReport;
  moved: AppliedMove[];
  /** Parked (`--keep-stale`) translations re-keyed to a renamed element. */
  staleMoved: number;
} {
  // Re-key the translations whose model element was renamed or moved, in OURS,
  // BASE and the review state alike, so the per-key merge below sees one key.
  const ours = joinCatalog(entryIn.files);
  const baseFlat = joinCatalog(baseIn);
  const theirsFlat = joinCatalog(theirs);
  const moved: AppliedMove[] = (options.moves ?? [])
    .filter((m) => m.from in ours && !(m.to in ours))
    .map((m) => ({ ...m, textChanged: baseFlat[m.from] !== theirsFlat[m.to] }));
  let base = baseIn;
  let entry = entryIn;
  if (moved.length > 0 && options.names) {
    const map = new Map(moved.map((m) => [m.from, m.to]));
    base = moveKeys(baseIn, map, options.names);
    entry = {
      ...entryIn,
      files: moveKeys(entryIn.files, map, options.names),
      review: moveKeys(entryIn.review, map, options.names),
    };
  }
  // The parked translations follow their element too, or a restored key would
  // find nothing under its new name.
  const staleMap = movesInto(entry.stale, options.moves ?? []);
  if (staleMap.size > 0 && options.names) {
    entry = { ...entry, stale: moveKeys(entry.stale, staleMap, options.names) };
  }
  const merged = new Map<string, Catalog>();
  const review = new Map<string, Record<string, ReviewEntry>>();
  const stale = new Map<string, Catalog>();
  const report: MergeReport = {
    added: [],
    untranslated: [],
    kept: [],
    dropped: [],
    conflicted: [],
    updated: [],
    carried: [],
  };
  // An optional key is never in THEIRS, so the merge would read it as deleted:
  // set it aside and carry it through as written.
  const optionalOurs = new Map<string, Catalog>();
  const mergeable = new Map<string, Catalog>();
  for (const [ns, file] of entry.files) {
    const kept: Catalog = {};
    const own: Catalog = {};
    for (const [fileKey, value] of Object.entries(file)) {
      if (options.optional?.has(runtimeKeyOf(fileKey, ns))) kept[fileKey] = value;
      else own[fileKey] = value;
    }
    mergeable.set(ns, own);
    if (Object.keys(kept).length > 0) optionalOurs.set(ns, kept);
  }
  const namespaces = new Set([...base.keys(), ...entry.files.keys(), ...theirs.keys()]);
  for (const ns of [...namespaces].sort()) {
    const result = mergeCatalog(base.get(ns) ?? {}, mergeable.get(ns) ?? {}, theirs.get(ns) ?? {}, {
      keepStale: options.keepStale,
      review: entry.review.get(ns),
    });
    const carried = optionalOurs.get(ns) ?? {};
    for (const fileKey of Object.keys(carried)) report.kept.push(runtimeKeyOf(fileKey, ns));
    const all = { ...result.merged, ...carried };
    result.merged = Object.fromEntries(
      Object.keys(all)
        .sort()
        .map((k) => [k, all[k]!]),
    );
    if (Object.keys(result.merged).length > 0) merged.set(ns, result.merged);
    if (Object.keys(result.review).length > 0) review.set(ns, result.review);
    const parked = { ...entry.stale.get(ns), ...result.stale };
    if (Object.keys(parked).length > 0) stale.set(ns, parked);
    const key = (k: string) => runtimeKeyOf(k, ns);
    report.added.push(...result.report.added.map(key));
    report.untranslated.push(...result.report.untranslated.map(key));
    report.kept.push(...result.report.kept.map(key));
    report.dropped.push(...result.report.dropped.map(key));
    report.conflicted.push(...result.report.conflicted.map(key));
    report.updated.push(...result.report.updated.map(key));
    report.carried.push(
      ...result.report.carried.map((c) => ({ key: key(c.key), from: key(c.from) })),
    );
  }
  return { merged, review, stale, report, moved, staleMoved: staleMap.size };
}

function reportMigration(): void {
  console.log(
    "  layout: flat locales/<locale>.json files are rewritten to locales/<locale>/<ns>.json",
  );
}

function reportLegacy(tree: Tree): void {
  for (const l of tree.locales) {
    if (l.legacy > 0) {
      console.log(
        `  ${l.locale}: ${l.legacy} in-band marker(s) (TODO: / conflict block / _stale.) move to the out-of-band state`,
      );
    }
  }
}

/** The pseudo-locale is regenerated from the source on every sync. */
function pseudoFiles(source: Catalog, names: ReadonlySet<string>): Map<string, Catalog> {
  return splitCatalog(pseudoCatalog(source), names);
}

/** `ddd i18n sync <file>` — three-way merge every locale, then bump the lock. */
export async function runI18nSync(
  file: string,
  options: DirOption & LocaleFilter & { keepStale?: boolean },
): Promise<void> {
  let opened = await openTree(file, options);
  let { moves, ambiguous } = detectMoves(opened);

  // The source language's overrides are keyed like everything else: carry them
  // to the renamed key and extract again, so THEIRS (and the lock) hold the
  // override's text under its new key.
  const rekeyed = movesInto(opened.tree.overrides, moves);
  if (rekeyed.size > 0) {
    const overrideDir = path.join(opened.dir, opened.source);
    writeNamespaceDir(overrideDir, moveKeys(opened.tree.overrides, rekeyed, opened.names));
    if (opened.tree.overridesFromFlat) {
      fs.rmSync(path.join(opened.dir, `${opened.source}.json`));
    }
    console.log(`  ${opened.source} (source): ${rekeyed.size} override(s) re-keyed`);
    opened = await openTree(file, options);
    ({ moves, ambiguous } = detectMoves(opened));
  }
  const { dir, theirs, tree, source, catalog, names, optional } = opened;

  if (tree.locales.length === 0) {
    console.error(
      `No locale files under ${relPath(dir)}. Run \`ddd i18n init <file> <locale>\` first.`,
    );
    process.exit(1);
  }
  reportAmbiguous(ambiguous);

  if (tree.migrationPending) reportMigration();
  reportLegacy(tree);

  for (const entry of tree.locales) {
    const { locale, fromFlat } = entry;
    if (locale === PSEUDO_LOCALE) {
      writeLocaleDir(dir, locale, pseudoFiles(catalog, names), theirs.keys(), NO_STATE);
      if (fromFlat) fs.rmSync(path.join(dir, `${locale}.json`));
      console.log(`  ${locale}: pseudo-locale regenerated (${Object.keys(catalog).length} key(s))`);
      continue;
    }
    const { merged, review, stale, report, moved } = mergeLocale(tree.base, entry, theirs, {
      keepStale: options.keepStale,
      moves,
      names,
      optional,
    });
    writeLocaleDir(dir, locale, merged, theirs.keys(), { review, stale });
    if (fromFlat) fs.rmSync(path.join(dir, `${locale}.json`));
    console.log(summarize(locale, report, moved.length));
    reportMoves(moved);
    reportCarried(report);
  }

  // The source language's overrides migrate with the rest, but are never
  // merged: they ARE the text, not a translation of it.
  if (tree.overridesFromFlat) writeNamespaceDir(path.join(dir, source), tree.overrides);

  // The lock only advances once every locale has reconciled against the new
  // source — that's what makes BASE lag THEIRS for the next merge.
  writeNamespaceDir(path.join(dir, LOCK_DIR_REL), theirs);
  removeFlatFiles(dir, { ...tree, locales: [] }, source);
  console.log(`Updated lock → ${relPath(path.join(dir, LOCK_DIR_REL))}/`);
}

/** `ddd i18n status <file>` — dry-run of sync; non-zero if anything is pending. */
export async function runI18nStatus(
  file: string,
  options: DirOption & LocaleFilter,
): Promise<void> {
  const opened = await openTree(file, options);
  const { theirs, tree, catalog, names, source, optional } = opened;
  const { moves, ambiguous } = detectMoves(opened);

  if (tree.locales.length === 0) {
    console.log("No locale files — nothing to sync.");
    return;
  }

  let pending = false;
  reportAmbiguous(ambiguous);
  const overrideMoves = movesInto(tree.overrides, moves);
  if (overrideMoves.size > 0) {
    console.log(`  ${source} (source): ${overrideMoves.size} override(s) to re-key`);
    pending = true;
  }
  if (tree.migrationPending) {
    reportMigration();
    pending = true;
  }
  if (tree.legacyPending) {
    reportLegacy(tree);
    pending = true;
  }
  for (const entry of tree.locales) {
    if (entry.locale === PSEUDO_LOCALE) {
      const current = JSON.stringify(joinCatalog(entry.files));
      const fresh = JSON.stringify(joinCatalog(pseudoFiles(catalog, names)));
      const stale = current !== fresh;
      console.log(`  ${entry.locale}: pseudo-locale ${stale ? "out of date" : "current"}`);
      if (stale) pending = true;
      continue;
    }
    const { report, moved, staleMoved } = mergeLocale(tree.base, entry, theirs, {
      moves,
      names,
      optional,
    });
    console.log(summarize(entry.locale, report, moved.length));
    reportMoves(moved);
    reportCarried(report);
    if (staleMoved > 0) {
      console.log(`      ${staleMoved} parked translation(s) to re-key`);
    }
    if (reportHasPending(report) || moved.length > 0 || staleMoved > 0) pending = true;
  }
  if (pending) {
    console.error("\nPending changes — run `ddd i18n sync`.");
    process.exit(1);
  }
}

/** `ddd i18n check <file> [--strict]` — CI gate.  Per locale it reports
 *  translations with invalid ICU or a placeholder set / plural forms that do
 *  not match the source, untranslated keys, translations flagged for review,
 *  keys the source no longer emits and leftover in-band markers; plus source
 *  overrides the source no longer emits.  With `--strict`, any finding is a
 *  non-zero exit (so is a project with no locale files at all). */
export async function runI18nCheck(
  file: string,
  options: DirOption & LocaleFilter & { strict?: boolean },
): Promise<void> {
  const { catalog: source, tree, source: sourceLocale, optional } = await openTree(file, options);
  const overrides = joinCatalog(tree.overrides);
  const staleOverrides = Object.keys(overrides).filter((k) => !(k in source) && !optional.has(k));
  // The text an optional key's translation is checked against: its source
  // override, else the generic sentence it rewords.
  const optionalSource = (key: string): string | undefined => {
    const generic = optional.get(key);
    return generic === undefined ? undefined : (overrides[key] ?? source[generic]);
  };

  const sourceHasIssues = Object.values(source).some(
    (m) => validateTranslation(m, m, sourceLocale).length > 0,
  );
  if (tree.locales.length === 0 && staleOverrides.length === 0 && !sourceHasIssues) {
    console.log("No locale files to check.");
    // A tree with neither translations nor source overrides verifies nothing,
    // which a CI gate must not report as success.
    if (options.strict && tree.overrides.size === 0) {
      console.error("\nno locale files with --strict → failing (nothing was verified).");
      process.exit(1);
    }
    return;
  }

  let findings = 0;
  if (tree.migrationPending) {
    reportMigration();
    findings += 1;
  }
  if (staleOverrides.length > 0) {
    findings += staleOverrides.length;
    console.log(`  ${sourceLocale} (source): ${staleOverrides.length} stale override(s)`);
    for (const k of staleOverrides) console.log(`      stale override: ${k}`);
  }
  // The source catalog is judged against the source locale's own plural
  // categories and tag balance (a message is its own reference).
  const sourceInvalid: { key: string; issues: IcuIssue[] }[] = [];
  for (const key of Object.keys(source).sort()) {
    const issues = validateTranslation(source[key]!, source[key]!, sourceLocale);
    if (issues.length > 0) sourceInvalid.push({ key, issues });
  }
  if (sourceInvalid.length > 0) {
    findings += sourceInvalid.length;
    console.log(`  ${sourceLocale} (source): ${sourceInvalid.length} invalid`);
    for (const { key, issues } of sourceInvalid) {
      for (const issue of issues)
        console.log(`      invalid:      ${key}: ${describeIssue(issue)}`);
    }
  }
  // A source override of an optional key rewords its generic sentence, so it
  // keeps that sentence's placeholders (a type name is never one).
  const invalidOverrides: { key: string; issues: IcuIssue[] }[] = [];
  for (const key of Object.keys(overrides)) {
    const generic = optional.get(key);
    if (generic === undefined || source[generic] === undefined) continue;
    const issues = validateTranslation(source[generic]!, overrides[key]!, sourceLocale);
    if (issues.length > 0) invalidOverrides.push({ key, issues });
  }
  if (invalidOverrides.length > 0) {
    findings += invalidOverrides.length;
    console.log(`  ${sourceLocale} (source): ${invalidOverrides.length} invalid override(s)`);
    for (const { key, issues } of invalidOverrides) {
      for (const issue of issues)
        console.log(`      invalid:      ${key}: ${describeIssue(issue)}`);
    }
  }
  for (const entry of tree.locales) {
    const { locale } = entry;
    const catalog = joinCatalog(entry.files);
    const pseudo = locale === PSEUDO_LOCALE;
    const untranslated = pseudo ? [] : Object.keys(source).filter((k) => !(k in catalog));
    const review = openReviewKeys(entry).filter((k) => k in source);
    const obsolete = Object.keys(catalog).filter((k) => !(k in source) && !optional.has(k));
    const invalid: { key: string; issues: IcuIssue[] }[] = [];
    for (const key of Object.keys(catalog)) {
      const against = key in source ? source[key] : optionalSource(key);
      if (against === undefined) continue;
      const issues = validateTranslation(against, catalog[key]!, locale);
      if (issues.length > 0) invalid.push({ key, issues });
    }
    const count =
      untranslated.length + review.length + obsolete.length + invalid.length + entry.legacy;
    findings += count;
    if (count === 0) {
      console.log(`  ${locale}: ok`);
      continue;
    }
    const parts: string[] = [];
    if (invalid.length) parts.push(`${invalid.length} invalid`);
    if (untranslated.length) parts.push(`${untranslated.length} untranslated`);
    if (review.length) parts.push(`${review.length} needs review`);
    if (obsolete.length) parts.push(`${obsolete.length} obsolete`);
    if (entry.legacy) parts.push(`${entry.legacy} legacy marker(s) (run sync)`);
    console.log(`  ${locale}: ${parts.join(", ")}`);
    for (const { key, issues } of invalid) {
      for (const issue of issues)
        console.log(`      invalid:      ${key}: ${describeIssue(issue)}`);
    }
    for (const k of review) console.log(`      needs review: ${k}`);
    for (const k of untranslated) console.log(`      untranslated: ${k}`);
    for (const k of obsolete) console.log(`      obsolete:     ${k}`);
  }
  if (findings > 0 && options.strict) {
    console.error(`\n${findings} finding(s) with --strict → failing.`);
    process.exit(1);
  }
}

/** `ddd i18n approve <file> [keys…]` — the translator confirms flagged
 *  translations still read right against the new source: clears the
 *  needs-review flag (every open flag when no key is named). */
export async function runI18nApprove(
  file: string,
  keys: readonly string[],
  options: DirOption & LocaleFilter,
): Promise<void> {
  const { dir, theirs, tree } = await openTree(file, options);
  assertConsistentLayout(dir);
  let cleared = 0;
  for (const entry of tree.locales) {
    const open = new Set(openReviewKeys(entry));
    const targets = keys.length > 0 ? keys.filter((k) => open.has(k)) : [...open];
    if (targets.length === 0) continue;
    const drop = new Set(targets);
    const review = new Map<string, Record<string, ReviewEntry>>();
    for (const [ns, flags] of entry.review) {
      const kept: Record<string, ReviewEntry> = {};
      for (const [fileKey, flag] of Object.entries(flags)) {
        if (!drop.has(runtimeKeyOf(fileKey, ns))) kept[fileKey] = flag;
      }
      if (Object.keys(kept).length > 0) review.set(ns, kept);
    }
    writeLocaleDir(dir, entry.locale, entry.files, theirs.keys(), { review, stale: entry.stale });
    cleared += targets.length;
    console.log(`  ${entry.locale}: approved ${targets.length} translation(s)`);
  }
  if (cleared === 0) console.log("Nothing to approve.");
}

/** `ddd i18n prune <file>` — delete keys the source no longer emits (off by
 *  default; run deliberately).  Covers the translator locales and the source
 *  language's overrides. */
export async function runI18nPrune(file: string, options: DirOption & LocaleFilter): Promise<void> {
  const {
    dir,
    catalog: source,
    names,
    theirs,
    tree,
    source: sourceLocale,
    optional,
  } = await openTree(file, options);
  assertConsistentLayout(dir);

  const prune = (files: ReadonlyMap<string, Catalog>): { kept: Catalog; stale: number } => {
    const all = joinCatalog(files);
    const kept: Catalog = {};
    for (const key of Object.keys(all).sort()) {
      if (key in source || optional.has(key)) kept[key] = all[key]!;
    }
    return { kept, stale: Object.keys(all).length - Object.keys(kept).length };
  };

  for (const entry of tree.locales) {
    const { locale, files, fromFlat } = entry;
    const { kept, stale } = prune(files);
    if (stale === 0 && !fromFlat && entry.legacy === 0) {
      console.log(`  ${locale}: nothing to prune`);
      continue;
    }
    const keptFiles = splitCatalog(kept, names);
    const review = new Map<string, Record<string, ReviewEntry>>();
    for (const [ns, flags] of entry.review) {
      const live: Record<string, ReviewEntry> = {};
      for (const [fk, flag] of Object.entries(flags)) {
        if (runtimeKeyOf(fk, ns) in source) live[fk] = flag;
      }
      if (Object.keys(live).length > 0) review.set(ns, live);
    }
    writeLocaleDir(dir, locale, keptFiles, theirs.keys(), { review, stale: entry.stale });
    if (fromFlat) fs.rmSync(path.join(dir, `${locale}.json`));
    console.log(`  ${locale}: pruned ${stale} stale key(s)`);
  }
  if (!options.locale || options.locale === sourceLocale) {
    const { kept, stale } = prune(tree.overrides);
    if (stale > 0) {
      writeNamespaceDir(path.join(dir, sourceLocale), splitCatalog(kept, names));
      console.log(`  ${sourceLocale} (source): pruned ${stale} stale override(s)`);
    }
  }
}

// ---------------------------------------------------------------------------
// `ddd i18n <subcommand>` — the translator-workflow CLI (M-T1.11, i18n.md).
// `git merge` for strings, backed by the pure three-way merge core
// (`src/i18n/merge.ts`) and the phase ①–⑥ extraction (`./extract.ts`).
//
//   ddd i18n extract <file> [-o out]        write <out>/.loom/messages.<source>.json
//   ddd i18n init    <file> <locale>        scaffold locales/<locale>/<ns>.json + lock
//   ddd i18n sync    <file> [--locale l]    three-way merge every locale; bump lock
//   ddd i18n status  <file>                 what sync would do; non-zero if pending
//   ddd i18n check   <file> [--strict]      CI gate: TODO / conflicts / missing keys
//   ddd i18n prune   <file>                 drop keys the source no longer emits
//
// File layout (i18n.md §"File layout"), one file per namespace:
//
//   <dir>/.loom/source.lock/<ns>.json  BASE — source snapshot at last sync
//   <dir>/<locale>/<ns>.json           OURS — the translator's files (human-owned)
//   <dir>/<source>/<ns>.json           OVERRIDES of the source language's own text
//   <out>/.loom/messages.<source>.json THEIRS — freshly extracted source catalog
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
import {
  type Catalog,
  hasConflictMarkers,
  isTodo,
  type MergeReport,
  mergeCatalog,
  reportHasPending,
  TODO_PREFIX,
} from "../../i18n/merge.js";
import { joinCatalog, runtimeKeyOf, splitCatalog } from "../../i18n/namespace.js";
import { extractProject } from "./extract.js";
import {
  assertConsistentLayout,
  type DirOption,
  LOCK_DIR_REL,
  LOCK_FLAT_REL,
  localesDir,
  readTree,
  removeFlatFiles,
  writeJson,
  writeNamespaceDir,
} from "./tree.js";

export { I18nLayoutError, loadSourceOverrides, loadTranslations, localesDir } from "./tree.js";

interface LocaleFilter {
  locale?: string;
}

const relPath = (p: string): string => path.relative(process.cwd(), p) || p;

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

/** `ddd i18n init <file> <locale>` — scaffold a locale's files + the lock. */
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
    const seeded = new Map<string, Catalog>();
    for (const [ns, file] of splitCatalog(catalog, names)) {
      const todo: Catalog = {};
      for (const key of Object.keys(file)) todo[key] = `${TODO_PREFIX}${file[key]}`;
      seeded.set(ns, todo);
    }
    writeNamespaceDir(localeDir, seeded);
    console.log(
      `Created ${relPath(localeDir)}/ — ${Object.keys(catalog).length} key(s) to translate in ${seeded.size} file(s)`,
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

function summarize(locale: string, report: MergeReport): string {
  const parts = [`+${report.added.length} new`, `${report.kept.length} kept`];
  if (report.updated.length) parts.push(`${report.updated.length} placeholder rename`);
  if (report.carried.length) parts.push(`${report.carried.length} carried`);
  if (report.dropped.length) parts.push(`-${report.dropped.length} dropped`);
  if (report.conflicted.length) parts.push(`${report.conflicted.length} CONFLICT`);
  return `  ${locale}: ${parts.join(", ")}`;
}

/** Name every design-pack family carry-over (merge case 5) under its locale.
 *
 *  A carry is NOT silent even though the written value is a clean translation:
 *  a string reviewed against one pack's UI can read differently in another's,
 *  so the reviewer is told which keys moved and where from.  The signal lives
 *  here and in the locale file's diff rather than inside the value — marking
 *  the value would either lie about a human translation (`TODO: `) or ship a
 *  marker the generated `t()` runtime would render to an end user. */
function reportCarried(report: MergeReport): void {
  for (const { key, from } of report.carried) {
    console.log(`      carried: ${key}`);
    console.log(`            <- ${from} (design-pack family swap; same role, same message)`);
  }
}

/** Merge one locale namespace by namespace, reporting in runtime keys. */
function mergeLocale(
  base: ReadonlyMap<string, Catalog>,
  ours: ReadonlyMap<string, Catalog>,
  theirs: ReadonlyMap<string, Catalog>,
  options: { keepStale?: boolean },
): { merged: Map<string, Catalog>; report: MergeReport } {
  const merged = new Map<string, Catalog>();
  const report: MergeReport = {
    added: [],
    kept: [],
    dropped: [],
    conflicted: [],
    updated: [],
    carried: [],
  };
  const namespaces = new Set([...base.keys(), ...ours.keys(), ...theirs.keys()]);
  for (const ns of [...namespaces].sort()) {
    const result = mergeCatalog(base.get(ns) ?? {}, ours.get(ns) ?? {}, theirs.get(ns) ?? {}, {
      keepStale: options.keepStale,
    });
    if (Object.keys(result.merged).length > 0) merged.set(ns, result.merged);
    const key = (k: string) => runtimeKeyOf(k, ns);
    report.added.push(...result.report.added.map(key));
    report.kept.push(...result.report.kept.map(key));
    report.dropped.push(...result.report.dropped.map(key));
    report.conflicted.push(...result.report.conflicted.map(key));
    report.updated.push(...result.report.updated.map(key));
    report.carried.push(
      ...result.report.carried.map((c) => ({ key: key(c.key), from: key(c.from) })),
    );
  }
  return { merged, report };
}

/** The translator-tree command prologue: extract, then read the tree. */
async function openTree(file: string, options: DirOption & LocaleFilter) {
  const extraction = await extractProject(file, options);
  const dir = localesDir(file, options);
  const theirs = splitCatalog(extraction.catalog, extraction.names);
  const tree = readTree({
    dir,
    source: extraction.source,
    names: extraction.names,
    uiNames: extraction.uiNames,
    current: extraction.catalog,
    locale: options.locale,
  });
  return { ...extraction, dir, theirs, tree };
}

function reportMigration(): void {
  console.log(
    "  layout: flat locales/<locale>.json files are rewritten to locales/<locale>/<ns>.json",
  );
}

/** `ddd i18n sync <file>` — three-way merge every locale, then bump the lock. */
export async function runI18nSync(
  file: string,
  options: DirOption & LocaleFilter & { keepStale?: boolean },
): Promise<void> {
  const { dir, theirs, tree, source } = await openTree(file, options);

  if (tree.locales.length === 0) {
    console.error(
      `No locale files under ${relPath(dir)}. Run \`ddd i18n init <file> <locale>\` first.`,
    );
    process.exit(1);
  }

  if (tree.migrationPending) reportMigration();

  let conflicts = 0;
  for (const { locale, files, fromFlat } of tree.locales) {
    const { merged, report } = mergeLocale(tree.base, files, theirs, {
      keepStale: options.keepStale,
    });
    writeNamespaceDir(path.join(dir, locale), merged);
    if (fromFlat) fs.rmSync(path.join(dir, `${locale}.json`));
    conflicts += report.conflicted.length;
    console.log(summarize(locale, report));
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
  if (conflicts > 0) {
    console.error(`\n${conflicts} conflict(s) written — resolve the <<<<<<< markers, then commit.`);
    process.exit(1);
  }
}

/** `ddd i18n status <file>` — dry-run of sync; non-zero if anything is pending. */
export async function runI18nStatus(
  file: string,
  options: DirOption & LocaleFilter,
): Promise<void> {
  const { theirs, tree } = await openTree(file, options);

  if (tree.locales.length === 0) {
    console.log("No locale files — nothing to sync.");
    return;
  }

  let pending = false;
  if (tree.migrationPending) {
    reportMigration();
    pending = true;
  }
  for (const { locale, files } of tree.locales) {
    const { report } = mergeLocale(tree.base, files, theirs, {});
    console.log(summarize(locale, report));
    reportCarried(report);
    if (reportHasPending(report)) pending = true;
  }
  if (pending) {
    console.error("\nPending changes — run `ddd i18n sync`.");
    process.exit(1);
  }
}

/** `ddd i18n check <file> [--strict]` — CI gate for untranslated / conflicted
 *  / missing keys, and for source overrides the source no longer emits.  With
 *  `--strict`, any finding is a non-zero exit. */
export async function runI18nCheck(
  file: string,
  options: DirOption & LocaleFilter & { strict?: boolean },
): Promise<void> {
  const { catalog: source, tree, source: sourceLocale } = await openTree(file, options);
  const staleOverrides = Object.keys(joinCatalog(tree.overrides)).filter((k) => !(k in source));

  if (tree.locales.length === 0 && staleOverrides.length === 0) {
    console.log("No locale files to check.");
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
  for (const { locale, files } of tree.locales) {
    const catalog = joinCatalog(files);
    const todos = Object.entries(catalog)
      .filter(([, v]) => isTodo(v))
      .map(([k]) => k);
    const conflicts = Object.entries(catalog)
      .filter(([, v]) => hasConflictMarkers(v))
      .map(([k]) => k);
    const missing = Object.keys(source).filter((k) => !(k in catalog));
    const count = todos.length + conflicts.length + missing.length;
    findings += count;
    if (count === 0) {
      console.log(`  ${locale}: ok`);
      continue;
    }
    const parts: string[] = [];
    if (todos.length) parts.push(`${todos.length} TODO`);
    if (conflicts.length) parts.push(`${conflicts.length} conflict`);
    if (missing.length) parts.push(`${missing.length} missing`);
    console.log(`  ${locale}: ${parts.join(", ")}`);
    for (const k of conflicts) console.log(`      conflict: ${k}`);
    for (const k of missing) console.log(`      missing:  ${k}`);
  }
  if (findings > 0 && options.strict) {
    console.error(`\n${findings} finding(s) with --strict → failing.`);
    process.exit(1);
  }
}

/** `ddd i18n prune <file>` — delete keys the source no longer emits (off by
 *  default; run deliberately).  Covers the translator locales and the source
 *  language's overrides. */
export async function runI18nPrune(file: string, options: DirOption & LocaleFilter): Promise<void> {
  const { dir, catalog: source, names, tree, source: sourceLocale } = await openTree(file, options);
  assertConsistentLayout(dir);

  const prune = (files: ReadonlyMap<string, Catalog>): { kept: Catalog; stale: number } => {
    const all = joinCatalog(files);
    const kept: Catalog = {};
    for (const key of Object.keys(all).sort()) if (key in source) kept[key] = all[key]!;
    return { kept, stale: Object.keys(all).length - Object.keys(kept).length };
  };

  for (const { locale, files, fromFlat } of tree.locales) {
    const { kept, stale } = prune(files);
    if (stale === 0 && !fromFlat) {
      console.log(`  ${locale}: nothing to prune`);
      continue;
    }
    writeNamespaceDir(path.join(dir, locale), splitCatalog(kept, names));
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

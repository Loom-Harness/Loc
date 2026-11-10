// ---------------------------------------------------------------------------
// `ddd i18n export` / `ddd i18n import` — hand one locale to a translation
// tool as XLIFF 1.2 or gettext PO, and take the result back.
//
// Export lists EVERY source key of the locale with its state (`new` /
// `translated` / `needs-review`), translator context and, where the tree
// knows one, the previous source of a reworded or re-keyed string.  Import is
// the TMS's answer: each translated unit is validated like `check` would
// (ICU syntax, placeholders, plural forms) and written into the locale files;
// invalid units are rejected and reported, never written.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";
import {
  contextNotes,
  type ExchangeUnit,
  parsePo,
  parseXliff,
  renderPo,
  renderXliff,
} from "../../i18n/exchange.js";
import { describeIssue, validateTranslation } from "../../i18n/icu.js";
import type { Catalog, ReviewEntry } from "../../i18n/merge.js";
import { fileKeyOf, namespaceOf } from "../../i18n/namespace.js";
import { type LocaleFilter, openReviewKeys, openTree, relPath } from "./open.js";
import { type DirOption, writeLocaleDir } from "./tree.js";

export type ExchangeFormat = "xliff" | "po";

const EXT: Record<ExchangeFormat, string> = { xliff: "xlf", po: "po" };

function formatOf(file: string, explicit?: string): ExchangeFormat {
  if (explicit === "xliff" || explicit === "po") return explicit;
  if (explicit !== undefined) throw new Error(`Unknown exchange format "${explicit}" (xliff | po)`);
  const ext = path.extname(file).toLowerCase();
  if (ext === ".xlf" || ext === ".xliff") return "xliff";
  if (ext === ".po") return "po";
  throw new Error(`Cannot tell the format of ${file}: use --format xliff|po`);
}

/** `ddd i18n export <file> --locale l [--format xliff|po] [-o out]`. */
export async function runI18nExport(
  file: string,
  options: DirOption & LocaleFilter & { format?: string; out?: string },
): Promise<void> {
  const locale = options.locale;
  if (!locale) throw new Error("export needs --locale <locale>");
  const format = options.format === undefined ? "xliff" : formatOf("", options.format);
  const {
    catalog: source,
    names,
    tree,
    source: sourceLocale,
    dir,
    locations,
  } = await openTree(file, options);
  const entry = tree.locales.find((l) => l.locale === locale);
  if (!entry) {
    throw new Error(`No locale "${locale}" under ${relPath(dir)}. Run \`ddd i18n init\` first.`);
  }
  const target: Catalog = {};
  for (const [ns, files] of entry.files) {
    for (const [fk, v] of Object.entries(files)) {
      target[ns === "_chrome" ? fk : `${ns}.${fk}`] = v;
    }
  }
  const open = new Set(openReviewKeys(entry));

  const units: ExchangeUnit[] = [];
  for (const key of Object.keys(source).sort()) {
    const ns = namespaceOf(key, names);
    const flag: ReviewEntry | undefined = entry.review.get(ns)?.[fileKeyOf(key, ns)];
    const translated = target[key];
    const state = translated === undefined ? "new" : open.has(key) ? "needs-review" : "translated";
    units.push({
      key,
      namespace: ns,
      source: source[key]!,
      ...(translated !== undefined ? { target: translated } : {}),
      state,
      notes: contextNotes(key, ns, source[key]!),
      ...(locations.get(key) ? { locations: locations.get(key)! } : {}),
      ...(flag ? { previousSource: flag.previousSource } : {}),
      ...(flag?.previousTranslation !== undefined
        ? { previousTranslation: flag.previousTranslation }
        : {}),
    });
  }

  const text =
    format === "xliff"
      ? renderXliff(units, { sourceLocale, targetLocale: locale })
      : renderPo(units, { targetLocale: locale });
  const out =
    options.out !== undefined
      ? path.resolve(options.out)
      : path.join(dir, ".loom", "exchange", `${locale}.${EXT[format]}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
  const count = (s: string) => units.filter((u) => u.state === s).length;
  console.log(
    `Exported ${units.length} unit(s) for ${locale} (${count("new")} new, ${count("needs-review")} needs review, ${count("translated")} translated) → ${relPath(out)}`,
  );
}

/** `ddd i18n import <file> <exchange> [--locale l] [--format xliff|po]`. */
export async function runI18nImport(
  file: string,
  exchangeFile: string,
  options: DirOption & LocaleFilter & { format?: string },
): Promise<void> {
  const format = formatOf(exchangeFile, options.format);
  const text = fs.readFileSync(path.resolve(exchangeFile), "utf8");
  const parsed = format === "xliff" ? parseXliff(text) : parsePo(text);
  const locale = options.locale ?? parsed.locale;
  if (!locale) {
    throw new Error("The file names no target language: pass --locale <locale>.");
  }
  const {
    catalog: source,
    names,
    theirs,
    tree,
    dir,
  } = await openTree(file, { ...options, locale });
  const existing = tree.locales.find((l) => l.locale === locale);
  const files = new Map<string, Catalog>();
  const review = new Map<string, Record<string, ReviewEntry>>();
  const stale = new Map<string, Catalog>();
  for (const [ns, c] of existing?.files ?? []) files.set(ns, { ...c });
  for (const [ns, r] of existing?.review ?? []) review.set(ns, { ...r });
  for (const [ns, c] of existing?.stale ?? []) stale.set(ns, { ...c });

  let imported = 0;
  let unchanged = 0;
  let skipped = 0;
  const unknown: string[] = [];
  const rejected: string[] = [];
  for (const unit of parsed.units) {
    if (unit.state === "new" || unit.target === "") {
      skipped += 1;
      continue;
    }
    const src = source[unit.key];
    if (src === undefined) {
      unknown.push(unit.key);
      continue;
    }
    const issues = validateTranslation(src, unit.target, locale);
    if (issues.length > 0) {
      for (const issue of issues) rejected.push(`${unit.key}: ${describeIssue(issue)}`);
      continue;
    }
    const ns = namespaceOf(unit.key, names);
    const fk = fileKeyOf(unit.key, ns);
    const file0 = files.get(ns) ?? {};
    const flags = { ...review.get(ns) };
    if (file0[fk] === unit.target && (unit.state === "needs-review") === fk in flags) {
      unchanged += 1;
      continue;
    }
    file0[fk] = unit.target;
    files.set(ns, file0);
    if (unit.state === "needs-review") {
      flags[fk] = {
        translation: unit.target,
        previousSource: unit.previousSource ?? flags[fk]?.previousSource ?? src,
        source: src,
      };
    } else {
      delete flags[fk];
    }
    if (Object.keys(flags).length > 0) review.set(ns, flags);
    else review.delete(ns);
    imported += 1;
  }

  writeLocaleDir(dir, locale, files, theirs.keys(), { review, stale });
  console.log(
    `Imported ${imported} translation(s) into ${relPath(path.join(dir, locale))}/ (${unchanged} unchanged, ${skipped} untranslated in the file)`,
  );
  if (unknown.length > 0) {
    console.log(`  ${unknown.length} key(s) the source no longer emits were ignored`);
    for (const k of unknown) console.log(`      ignored: ${k}`);
  }
  if (rejected.length > 0) {
    console.error(`\n${rejected.length} translation problem(s) — those units were NOT imported:`);
    for (const r of rejected) console.error(`      rejected: ${r}`);
    process.exit(1);
  }
}

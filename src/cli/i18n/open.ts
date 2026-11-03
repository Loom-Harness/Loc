// ---------------------------------------------------------------------------
// Shared prologue of the `ddd i18n` subcommands: extract the source catalog,
// read the translator tree, and the small helpers every command reads it with.
// ---------------------------------------------------------------------------

import * as path from "node:path";
import { runtimeKeyOf, splitCatalog } from "../../i18n/namespace.js";
import { extractProject } from "./extract.js";
import { type DirOption, localesDir, readTree, type Tree } from "./tree.js";

export interface LocaleFilter {
  locale?: string;
}

export type LocaleEntry = Tree["locales"][number];

export const relPath = (p: string): string => path.relative(process.cwd(), p) || p;

/** The translator-tree command prologue: extract, then read the tree. */
export async function openTree(file: string, options: DirOption & LocaleFilter) {
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

/** Runtime keys of a locale's open needs-review flags: a flag is open while the
 *  value still equals the translation it was raised against. */
export function openReviewKeys(entry: LocaleEntry): string[] {
  const out: string[] = [];
  for (const [ns, flags] of entry.review) {
    const file = entry.files.get(ns) ?? {};
    for (const [fileKey, flag] of Object.entries(flags)) {
      if (flag.translation !== undefined && file[fileKey] === flag.translation) {
        out.push(runtimeKeyOf(fileKey, ns));
      }
    }
  }
  return out.sort();
}

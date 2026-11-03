// ---------------------------------------------------------------------------
// Source-catalog extraction for the `ddd i18n` CLI (M-T1.11, i18n.md).
//
// Runs pipeline phases ①–⑥ over a `.ddd` project (parse → lower → enrich) and
// returns the flat `{ key: message }` source catalog (runtime keys) — the THEIRS input to the
// three-way merge, and what `ddd i18n extract` writes to
// `<out>/.loom/messages.<source>.json`.  It stops short of per-backend codegen: the
// catalog is derived purely from the enriched IR (via `buildMessageCatalog`,
// the same builder phase ⑨ uses), so extraction is fast and backend-agnostic.
//
// Lives under `src/cli/i18n/` (imported BY `main.ts`, never the reverse) so the
// layering stays one-directional; it re-derives the small parse-project spine
// rather than reaching back into `main.ts`.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";
import { URI } from "langium";
import { NodeFileSystem } from "langium/node";
import { withSourceOverrides } from "../../generator/_walker/source-text.js";
import type { Catalog } from "../../i18n/merge.js";
import { namespaceNamesOf } from "../../i18n/namespace.js";
import type { DeclaredRenames } from "../../i18n/renames.js";
import { enrichLoomModel } from "../../ir/enrich/enrichments.js";
import { lowerProject } from "../../ir/lower/lower.js";
import { sourceLocaleOf } from "../../ir/types/loom-ir.js";
import { createDddServices } from "../../language/ddd-module.js";
import type { Model } from "../../language/generated/ast.js";
import { loadProject } from "../../language/project-loader.js";
import { buildMessageCatalog } from "../../system/i18n-catalog.js";
import { type DirOption, loadSourceOverrides } from "./tree.js";

/** What extraction learns about a project. */
export interface ProjectCatalog {
  /** The flat, key-sorted `{ runtime key: message }` source catalog, with the
   *  translator's source-language overrides applied. */
  catalog: Catalog;
  /** Context + ui names: the namespaces a key can be filed under. */
  names: Set<string>;
  /** The ui names alone. */
  uiNames: Set<string>;
  /** The declared source language (`i18n { source }`), `en` by default. */
  source: string;
  /** The renames and moves the project's `migration` blocks declare. */
  renames: DeclaredRenames;
}

/** Parse + lower + enrich the project rooted at `entryFile`, then merge every
 *  system's message catalog into one flat, key-sorted `{ key: message }`.
 *
 *  The source-language overrides under `<locales>/<source>/` are read and
 *  applied, so the catalog is the text the generated apps actually carry: an
 *  override edit moves THEIRS, and the next `sync` flags every translation of
 *  that string. */
export async function extractProject(
  entryFile: string,
  options: DirOption = {},
): Promise<ProjectCatalog> {
  const services = createDddServices(NodeFileSystem);
  const absolute = path.resolve(entryFile);
  if (!fs.existsSync(absolute)) {
    throw new Error(`File not found: ${absolute}`);
  }
  const { all } = await loadProject(URI.file(absolute), services.shared);
  const loom = enrichLoomModel(lowerProject(all.map((doc) => doc.parseResult.value as Model)));

  const source = loom.systems[0] ? sourceLocaleOf(loom.systems[0]) : sourceLocaleOf({});
  const overrides = loadSourceOverrides(entryFile, { ...options, source });
  const names = new Set<string>();
  const uiNames = new Set<string>();
  const merged: Catalog = {};
  withSourceOverrides(overrides, () => {
    for (const sys of loom.systems) {
      for (const name of namespaceNamesOf(sys)) names.add(name);
      for (const ui of sys.uis) uiNames.add(ui.name);
      for (const [key, message] of Object.entries(buildMessageCatalog(sys))) {
        merged[key] = message;
      }
    }
  });
  const catalog: Catalog = {};
  for (const key of Object.keys(merged).sort()) catalog[key] = merged[key]!;
  const renames: DeclaredRenames = {
    columns: loom.renameIntents.map((r) => ({
      context: r.context,
      aggregate: r.aggregate,
      from: r.from,
      to: r.to,
    })),
    tables: loom.tableRenameIntents.map((t) => ({
      from: t.from,
      to: t.to,
      fromContext: t.fromContext,
      toContext: t.toContext,
    })),
  };
  return { catalog, names, uiNames, source, renames };
}

/** The flat source catalog alone (see {@link extractProject}). */
export async function extractCatalog(entryFile: string, options: DirOption = {}): Promise<Catalog> {
  return (await extractProject(entryFile, options)).catalog;
}

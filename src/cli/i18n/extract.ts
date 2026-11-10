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
import { withSourceOverrides } from "../../generator/_i18n/source-text.js";
import type { Catalog } from "../../i18n/merge.js";
import { namespaceNamesOf } from "../../i18n/namespace.js";
import type { DeclaredRenames } from "../../i18n/renames.js";
import { enrichLoomModel } from "../../ir/enrich/enrichments.js";
import { lowerProject } from "../../ir/lower/lower.js";
import { sourceLocaleOf } from "../../ir/types/loom-ir.js";
import { createDddServices } from "../../language/ddd-module.js";
import type { Model } from "../../language/generated/ast.js";
import { loadProject } from "../../language/project-loader.js";
import { buildMessageCatalog, buildMessageSites } from "../../system/i18n-catalog.js";
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
  /** Where each key was written, as `.ddd` paths (relative to the entry file's
   *  directory) and 1-based lines.  A key no source construct wrote has none. */
  locations: Map<string, SourceLocation[]>;
}

/** A `.ddd` file and line. */
export interface SourceLocation {
  file: string;
  line: number;
}

/** 1-based line of a source offset; `undefined` when the file cannot be read. */
function lineAt(
  file: string,
  offset: number,
  cache: Map<string, string | undefined>,
): number | undefined {
  if (!cache.has(file)) {
    try {
      cache.set(file, fs.readFileSync(file, "utf8"));
    } catch {
      cache.set(file, undefined);
    }
  }
  const text = cache.get(file);
  if (text === undefined) return undefined;
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line += 1;
  return line;
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

  // One translator tree holds one source language: a project whose systems
  // declare different `i18n { source }` values has no single answer, and filing
  // the later system's keys under the first one's language would silently
  // mislabel them.
  const sources = new Map<string, string[]>();
  for (const sys of loom.systems) {
    const lang = sourceLocaleOf(sys);
    sources.set(lang, [...(sources.get(lang) ?? []), sys.name]);
  }
  if (sources.size > 1) {
    const detail = [...sources].map(([lang, systems]) => `${lang} (${systems.join(", ")})`);
    throw new Error(
      `Systems declare different i18n source languages: ${detail.join("; ")}. ` +
        "A translator tree has one source language: give every system the same `i18n { source }`, or run `ddd i18n` over each system's own file.",
    );
  }
  const source = loom.systems[0] ? sourceLocaleOf(loom.systems[0]) : sourceLocaleOf({});
  const overrides = loadSourceOverrides(entryFile, { ...options, source });
  const names = new Set<string>();
  const uiNames = new Set<string>();
  const merged: Catalog = {};
  const locations = new Map<string, SourceLocation[]>();
  const baseDir = path.dirname(absolute);
  const lineCache = new Map<string, string | undefined>();
  withSourceOverrides(overrides, () => {
    for (const sys of loom.systems) {
      for (const name of namespaceNamesOf(sys)) names.add(name);
      for (const ui of sys.uis) uiNames.add(ui.name);
      for (const [key, message] of Object.entries(buildMessageCatalog(sys))) {
        merged[key] = message;
      }
      for (const [key, refs] of buildMessageSites(sys)) {
        for (const ref of refs) {
          const file = path.resolve(ref.path);
          const line = lineAt(file, ref.span.start, lineCache);
          if (line === undefined) continue;
          const list = locations.get(key) ?? [];
          const loc = { file: path.relative(baseDir, file).split(path.sep).join("/"), line };
          if (!list.some((l) => l.file === loc.file && l.line === loc.line)) list.push(loc);
          locations.set(key, list);
        }
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
    enumValues: loom.enumValueRenameIntents.map((r) => ({
      context: r.context,
      enum: r.enum,
      from: r.from,
      to: r.to,
    })),
  };
  return { catalog, names, uiNames, source, renames, locations };
}

/** The flat source catalog alone (see {@link extractProject}). */
export async function extractCatalog(entryFile: string, options: DirOption = {}): Promise<Catalog> {
  return (await extractProject(entryFile, options)).catalog;
}

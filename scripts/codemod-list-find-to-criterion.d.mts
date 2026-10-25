// Types for the plain-JS `codemod-list-find-to-criterion.mjs`.
//
// The script is `.mjs` so it runs as a bare `node scripts/…`; its pure core is
// driven by `test/system/codemod-list-find-to-criterion.test.ts`, and without
// this file that test would be asserting over `any`.  Mirrors the module's
// real exports.

export interface MigratedSource {
  file: string;
  text: string;
  /** Number of edits applied (0 ⇒ `text` is the input unchanged). */
  changed: number;
}

/** Migrate several sources together — a `.ddd` file's call sites may name a
 *  find declared in another `.ddd` file.  `report` lists what the codemod
 *  cannot migrate (route reads, `requires` gates, filterless finds). */
export function migrateSources(sources: ReadonlyArray<{ file: string; text: string }>): {
  results: MigratedSource[];
  report: string[];
};

/** Single-source convenience over {@link migrateSources}. */
export function migrateSource(
  text: string,
  file?: string,
): { text: string; changed: number; report: string[] };

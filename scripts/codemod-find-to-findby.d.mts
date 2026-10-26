// Types for the plain-JS `codemod-find-to-findby.mjs`.
//
// The script is `.mjs` so it runs as a bare `node scripts/…`; its pure core is
// driven by `test/system/codemod-find-to-findby.test.ts`, and without this file
// that test would be asserting over `any`.  Mirrors the module's real exports.

export interface MigratedSource {
  file: string;
  text: string;
  /** Number of edits applied (0 ⇒ `text` is the input unchanged). */
  changed: number;
}

export interface MigrateOptions {
  /** Add `unique (<key>)` to the aggregate of a find whose key matches no
   *  declared tuple, and migrate it (the `--add-unique` flag). */
  addUnique?: boolean;
  /** Veto a find: return a reason to keep it declared (reported), e.g. a test
   *  that asserts on the fixture's find by name. */
  keep?: (file: string, repo: string, find: string) => string | undefined;
}

/** Migrate several sources together — a `.ddd` file's call sites may name a
 *  find declared in another `.ddd` file.  `report` lists every single-row find
 *  the codemod leaves for a human. */
export function migrateSources(
  sources: ReadonlyArray<{ file: string; text: string }>,
  opts?: MigrateOptions,
): { results: MigratedSource[]; report: string[] };

/** Single-source convenience over {@link migrateSources}. */
export function migrateSource(
  text: string,
  file?: string,
  opts?: MigrateOptions,
): { text: string; changed: number; report: string[] };

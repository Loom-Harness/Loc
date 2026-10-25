// Types for the plain-JS `codemod-find-gate-to-policy.mjs`.
//
// The script is `.mjs` so it runs as a bare `node scripts/…` with no build
// step; its pure core is driven by `test/system/codemod-find-gate-to-policy.test.ts`.
// Mirrors the module's real exports.

/** One `repository R for X { … }` block: its head offset, brace offsets,
 *  name and aggregate. */
export interface RepositoryBlock {
  start: number;
  open: number;
  close: number;
  name: string;
  aggregate: string;
}

/** Every `repository … for … { … }` block in `src` (comment- and string-aware). */
export function findRepositories(src: string): RepositoryBlock[];

/** Move every `find … requires G` into `policy { read X requires G }`.
 *  `changed` is the number of find gates moved (0 ⇒ `text` is `src`
 *  unchanged); `conflicts` names each repository whose finds carried
 *  different gates (merged into one, with a review comment). */
export function moveFindGates(src: string): {
  text: string;
  changed: number;
  conflicts: { repository: string; aggregate: string }[];
};

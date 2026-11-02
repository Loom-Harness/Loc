// Types for the plain-JS `codemod-repo-verbs.mjs` (D-REPO-VERBS).
//
// The script is `.mjs` so it runs as a bare `node scripts/…` with no build
// step; its pure core is driven by `test/system/codemod-repo-verbs.test.ts`,
// and without this file that test would be asserting over `any`.  Mirrors the
// module's real exports.

/** An old verb the codemod left in place (a retrieval literal with `loads:`). */
export interface RefusedCall {
  index: number;
  call: string;
}

/** Rewrite every retired repository verb in `src` to its replacement.
 *  `changed` counts the rewritten calls (`counts` by old verb); `refused`
 *  names the ones left in place.  No change ⇒ `text` is `src`. */
export function rewriteRepoVerbs(
  src: string,
  opts?: { markdown?: boolean },
): {
  text: string;
  changed: number;
  counts: Record<string, number>;
  refused: RefusedCall[];
};

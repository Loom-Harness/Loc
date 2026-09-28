// Types for the plain-JS `codemod-enforcement-opt.mjs` (M-T3.1's codemod).
//
// The script is `.mjs` so it runs as a bare `node scripts/…` with no build
// step; its pure core is driven by `test/system/codemod-enforcement-opt.test.ts`,
// and without this file that test would be asserting over `any`.  Mirrors the
// module's real exports.

/** One system-level `auth { … }` block: the offsets of its braces, and whether
 *  it already names an `enforcement:` at its own depth. */
export interface AuthBlock {
  open: number;
  close: number;
  hasEnforcement: boolean;
}

/** Every system-level `auth { … }` block in `src` (comment- and string-aware). */
export function findAuthBlocks(src: string): AuthBlock[];

/** Insert `enforcement: opt` into every `auth { … }` block that names no
 *  `enforcement:`.  `changed` is the number of blocks rewritten (0 ⇒ `text`
 *  is `src` unchanged). */
export function pinEnforcementOpt(src: string): { text: string; changed: number };

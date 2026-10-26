// Types for the plain-JS `codemod-workflow-create-record.mjs`.
//
// The script is `.mjs` so it runs as a bare `node scripts/…` with no build
// step; its pure core is driven by
// `test/system/codemod-workflow-create-record.test.ts`, and without this file
// that test would be asserting over `any`.  Mirrors the module's real exports.

/** A factory call the codemod left in place, and why. */
export interface RefusedFactoryCall {
  aggregate: string;
  call: string;
  reason: string;
}

/** Rewrite every positional / named / empty `Agg.create(…)` in a workflow or
 *  handler body to the record form `Agg.create({ … })`.  `changed` counts the
 *  rewritten calls; `refused` names the ones left in place (marked with a
 *  `// codemod-workflow-create-record: not rewritten — …` line).  Neither ⇒
 *  `text` is `src` unchanged. */
export function rewriteFactoryCalls(src: string): {
  text: string;
  changed: number;
  refused: RefusedFactoryCall[];
};

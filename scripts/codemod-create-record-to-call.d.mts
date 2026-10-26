// Types for the plain-JS `codemod-create-record-to-call.mjs`
// (D-CREATE-CALL-STYLE).
//
// The script is `.mjs` so it runs as a bare `node scripts/…` with no build
// step; its pure core is driven by
// `test/system/codemod-create-record-to-call.test.ts`, and without this file
// that test would be asserting over `any`.  Mirrors the module's real exports.

/** A record-form call the codemod left in place, and why. */
export interface RefusedCreate {
  aggregate: string;
  line: number;
  reason: string;
}

/** The aggregate names `src` declares (`aggregate <Name>`). */
export function declaredAggregates(src: string): Set<string>;

/** Rewrite every record-form factory call `Agg.create({ … })` in `src` whose
 *  receiver is one of `aggregates` (default: the aggregates `src` declares)
 *  into the named call form `Agg.create(x: a, …)`.  `changed` counts the
 *  rewritten calls; `refused` names the ones left in place (marked with a
 *  `// codemod-create-record-to-call: not rewritten — …` line).  Neither ⇒
 *  `text` is `src` unchanged. */
export function rewriteCreateRecords(
  src: string,
  aggregates?: { has(name: string): boolean },
): { text: string; changed: number; refused: RefusedCreate[] };

/** `rewriteCreateRecords` over every fenced ```ddd block of a Markdown
 *  document; with no names given, every capitalised receiver counts as an
 *  aggregate. */
export function rewriteMarkdown(
  src: string,
  aggregates?: { has(name: string): boolean },
): { text: string; changed: number; refused: RefusedCreate[] };

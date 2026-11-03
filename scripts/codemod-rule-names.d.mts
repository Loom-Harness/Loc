// Types for the plain-JS `codemod-rule-names.mjs` (#4450's codemod).  The
// script is `.mjs` so it runs as a bare `node scripts/…` with no build step;
// `test/system/codemod-rule-names.test.ts` drives its pure core.  Mirrors the
// module's real exports.

export const RULE_NAME_MAX_WORDS: number;

/** camelCase rule name derived from a message's text (mirror of
 *  `src/util/rule-name.ts`). */
export function deriveRuleName(text: string): string;

/** `name` made unique against `taken` by a numeric suffix, and recorded there. */
export function dedupeRuleName(name: string, taken: Set<string>): string;

/** One rule found in a `.ddd` source. */
export interface FoundRule {
  owner: string | null;
  ctx: string | null;
  declared: string | undefined;
  message: { start: number; end: number; text: string } | undefined;
}

/** Every `invariant` / `check` / `precondition` in `src`, in document order. */
export function findRules(src: string): FoundRule[];

/** One `locales/en/<ns>.json` entry the migration writes. */
export interface LocaleEntry {
  ns: string;
  key: string;
  text: string;
}

/** Name every messaged rule in `src` and drop its `message "…"` clause. */
export function migrateRuleMessages(src: string): {
  text: string;
  entries: LocaleEntry[];
  changed: number;
};

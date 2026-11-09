// Helpers shared by the diagnostic-message catalog's family files
// (`./<family>.ts`).  Import-free, like the catalog itself: it is consumed by
// the browser playground and every pipeline layer.

/** A catalog entry: a fixed string, or a builder over the values the message
 *  interpolates. */
export type MessageEntry = string | ((params: never) => string);

/** The six `*-deployable-missing-ui` codes (`react`/`svelte`/`vue`/`angular`/
 *  `feliz`/`flutter`) say the same thing about a different platform — but they
 *  stay SIX codes so the fix-hint registry can dispatch per platform
 *  (`src/language/fix-hints.ts`).
 *  One shared builder, six catalog entries: a key must resolve to exactly the
 *  code its call site attaches (`codeOfMessageKey`, gated by
 *  `test/system/diagnostic-catalog.test.ts`), so a single shared key would be a
 *  hole in that invariant — and a key is never computed at a call site. */
export const spaDeployableMissingUi =
  (label: string) =>
  (p: { name: unknown }): string =>
    `${label} deployable '${p.name}' must declare a 'ui:' binding — every page now flows through the page metamodel. Add 'ui: <UiName>' (use 'ui <UiName> { with scaffold(subdomains: [...]) }' for the bulk-CRUD case).`;

/** The " Did you mean 'x'?" tail an unknown-name diagnostic appends when the
 *  call site found a near miss (`nearestName`, `src/util/edit-distance.ts`).
 *  Empty when there is none, so a message reads the same as before it learned
 *  to suggest.  One builder so every site words the suggestion identically. */
export const didYouMean = (suggestion: unknown): string =>
  suggestion ? ` Did you mean '${suggestion}'?` : "";

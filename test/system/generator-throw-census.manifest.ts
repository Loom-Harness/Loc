// The claims register for `generator-throw-census.test.ts`. Read that file's
// header for what each claim shape means and how the ratchet works.
//
// KEYS are `<relFile>#<enclosingFunction>[$N]` (see
// `generator-throw-sites.ts`). `$N` numbers the Nth throw in the same
// function, so inserting a throw ABOVE an existing one in the same function
// renumbers the later ones. The census then names both, and the fix is to
// re-key them.

export type ThrowClassification =
  | { guardedBy: readonly string[]; note?: string }
  | { invariant: string }
  | { deferred: string; mission: string; reviewUntil: string };

export const CLASSIFICATIONS: Record<string, ThrowClassification> = {};

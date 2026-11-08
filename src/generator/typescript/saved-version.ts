// The in-memory half of a row-version-guarded save (`rowVersionGuarded`).
//
// Every TypeScript save shape (drizzle relational / embedded / document, and
// their MikroORM twins) writes `version: 1` on the insert branch and
// `version: expected + 1` on the guarded update.  The saved instance must then
// carry the version its row now holds — a handle read after its save
// (`a.version` later in a body, the audited `after` snapshot, the response) or
// saved a second time must not see the version it was loaded at.  The domain
// root exposes `_applyVersion` for exactly this (emit/aggregate.ts).
//
// The counter is recorded where each branch writes it and applied only once
// the write — and, for the transactional shapes, its whole transaction — has
// succeeded, so a rolled-back save leaves the instance untouched.  .NET and
// java advance their instance the same way.

/** Declared before the save's write block. */
export function savedVersionDecl(indent: string): string {
  return `${indent}let savedVersion = aggregate.version;`;
}

/** Recorded right after the insert branch's write. */
export function savedVersionOnInsert(indent: string): string {
  return `${indent}savedVersion = 1;`;
}

/** Recorded right after the guarded update's zero-rows check. */
export function savedVersionOnUpdate(indent: string): string {
  return `${indent}savedVersion = expected + 1;`;
}

/** Applied once the write (and its transaction) has succeeded. */
export function applySavedVersion(indent: string): string {
  return `${indent}aggregate._applyVersion(savedVersion);`;
}

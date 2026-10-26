// The not-found contract of a natural-key `getBy` read (D-REPO-KEY-LOOKUP).
//
// `Products.getBy(sku: s)` yields the row or answers the standard ProblemDetails
// 404 — never a null the body then dereferences.  Its repository method is the
// `synthesized` find enrichment derives with a bare-entity return
// (`ir/enrich/key-lookup-finds.ts`); every backend's repository emitter reads
// this predicate and raises its not-found error (`"not_found"`, the token every
// backend's find-absence 404 carries) on a miss.  `findBy` (`T?`) and the paged
// finds a queryHandler synthesises return absence and are not matched.

import type { FindIR } from "../types/loom-ir.js";

/** True when a find's repository method must raise not-found on a miss. */
export function findRaisesNotFound(find: Pick<FindIR, "synthesized" | "returnType">): boolean {
  return find.synthesized === true && find.returnType.kind === "entity";
}

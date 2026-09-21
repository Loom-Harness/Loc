// Canonical collection-op catalogue — the single source for both the
// membership check (`isCollectionOp`) and member enumeration
// (`membersOfType` in language/type-system.ts re-uses the signatures
// table).
//
// Pure data: zero language / AST dependencies, so this lives at a leaf
// under src/util/ and every layer (language, ir, generator, system)
// imports from here without back-edges into language/.

export interface CollectionOpSignature {
  name: string;
  /** Free-form display signature for completion-item details
   *  (e.g. `"(λ): bool"`).  Not parsed; purely informational. */
  signature: string;
}

// Cross-backend semantics contract for the EDGE cases (the collection-op twin
// of `src/util/intrinsics.ts`'s per-op edge notes — each op must behave the same
// from `.ddd` source on every target, and the edge is pinned HERE rather than
// rediscovered per backend):
//
//   - `first` is PARTIAL (**D-FIRST-ON-EMPTY**, RS-36): its declared type is a
//     non-optional `T`, so an EMPTY receiver FAILS on every target rather than
//     yielding a null typed as non-null.  The failure is the sanitized 500 RS-28
//     governs — the request was valid and the model's assumption was not — and
//     its message names `firstOrNull`.  node raises through an explicit guard
//     (`_expr/js-collection-ops.ts`) and elixir through `hd/1`; dotnet `.First()`,
//     java `.get(0)` and python `[0]` already raise natively.
//   - `firstOrNull` is the TOTAL form: `T?`, null/nil on empty, never raises.
//   - `min` / `max` / `avg` are likewise declared optional (`T?` / `decimal?`)
//     and yield the empty value rather than raising.
export const COLLECTION_OP_SIGNATURES: ReadonlyArray<CollectionOpSignature> = [
  { name: "count", signature: "int" },
  { name: "sum", signature: "(λ): decimal" },
  { name: "all", signature: "(λ): bool" },
  { name: "any", signature: "(λ): bool" },
  { name: "where", signature: "(λ): T[]" },
  { name: "first", signature: "T" },
  { name: "firstOrNull", signature: "T?" },
  { name: "contains", signature: "bool" },
  { name: "map", signature: "(λ): U[]" },
  { name: "sortBy", signature: "(λ, desc?: bool): T[]" },
  { name: "distinct", signature: "T[]" },
  { name: "take", signature: "(n: int): T[]" },
  { name: "skip", signature: "(n: int): T[]" },
  { name: "join", signature: "(sep: string): string" },
  { name: "min", signature: "(λ): T?" },
  { name: "max", signature: "(λ): T?" },
  { name: "avg", signature: "(λ): decimal?" },
];

const COLLECTION_OPS = new Set(COLLECTION_OP_SIGNATURES.map((o) => o.name));

export function isCollectionOp(name: string): boolean {
  return COLLECTION_OPS.has(name);
}

// The domain-side shape of a repository find.

import type { FindIR } from "../types/loom-ir.js";

/** A union find (`Agg or NotFound` / `Agg option` — validator-pinned to the
 *  absence shape, `loom.union-find-shape-unsupported`) reaches the domain
 *  repository as its optional twin: the same predicate as a single-row read
 *  returning `Agg?`.  The query handler or controller owns the union: it maps
 *  an absent row to the absent variant and projects a found row into the
 *  tagged wire record, so the domain layer never names the response-side
 *  union type.  Any other find is returned unchanged. */
export function domainFindShape(find: FindIR, aggName: string): FindIR {
  if (find.returnType.kind !== "union") return find;
  const success = find.returnType.variants.find(
    (v) => v.kind === "entity" && v.name === aggName,
  ) ?? { kind: "entity" as const, name: aggName, declKind: "aggregate" as const };
  return { ...find, returnType: { kind: "optional", inner: success } };
}

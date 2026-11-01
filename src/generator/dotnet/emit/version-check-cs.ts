// The C# face of the `checksVersion` fact (`src/ir/enrich/version-check.ts`).
//
// A repository whose row carries a guarded `version` counter exposes two
// `SaveAsync` overloads:
//
//   SaveAsync(aggregate, ct)                    — `handle`: the save is checked
//                                                 against the version this handle
//                                                 was loaded at;
//   SaveAsync(aggregate, expectedVersion, ct)   — `if-match`: checked against the
//                                                 version the caller names (the
//                                                 client's `If-Match`).
//
// Only an operation handler passes a version.  Nothing is ambient: a workflow or
// handler body that saves several rows never has one request-wide number applied
// to all of them.  The token stays last on both (CA1068); an aggregate with no
// guarded version has the first overload only.

import { rowVersionGuarded } from "../../../ir/enrich/version-check.js";
import type { AggregateIR } from "../../../ir/types/loom-ir.js";

/** The parameters after the aggregate on the repository's one real `SaveAsync`
 *  — the version-taking overload for a guarded aggregate. */
export function saveParamsCs(agg: AggregateIR): string {
  return rowVersionGuarded(agg)
    ? "int? expectedVersion, CancellationToken cancellationToken = default"
    : "CancellationToken cancellationToken = default";
}

/** The `handle` overload a guarded aggregate's repository adds beside the real
 *  save: it delegates with no named version.  Empty for an unguarded one. */
export function handleSaveOverloadLines(agg: AggregateIR, bclTask: string): string[] {
  if (!rowVersionGuarded(agg)) return [];
  return [
    `    public ${bclTask} SaveAsync(${agg.name} aggregate, CancellationToken cancellationToken = default)`,
    "        => SaveAsync(aggregate, null, cancellationToken);",
    "",
  ];
}

/** The interface declaration(s) of the save: the `handle` overload always, the
 *  version-taking one for a guarded aggregate. */
export function saveInterfaceLines(agg: AggregateIR, bclTask: string): string[] {
  return [
    `    ${bclTask} SaveAsync(${agg.name} aggregate, CancellationToken cancellationToken = default);`,
    ...(rowVersionGuarded(agg)
      ? [`    ${bclTask} SaveAsync(${agg.name} aggregate, ${saveParamsCs(agg)});`]
      : []),
  ];
}

/** The C# expression an `if-match` operation handler passes as the save's
 *  expected version: the client's `If-Match`, parsed once at the HTTP edge. */
export const IF_MATCH_EXPECTED_VERSION_CS = "RequestContext.Current?.ExpectedVersion";

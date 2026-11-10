// ---------------------------------------------------------------------------
// The in-app capability filter a `shape: document` read applies, shared by
// both .NET persistence adapters (EF and Dapper).
//
// A document aggregate persists as one jsonb blob, so its filter columns
// (`tenantId`, `isDeleted`) have no mapped column to put a
// predicate on: the filter runs over the rehydrated instance instead.  Each
// adapter hoists the full conjunction into a private static
// `_CapabilityVisible`; a read carrying an `ignoring` clause keeps only the
// filters the clause does not name.  Both adapters select through this one
// function so a widened document read means the same thing on either.
// ---------------------------------------------------------------------------

import type { EnrichedAggregateIR, ExprIR } from "../../../ir/types/loom-ir.js";
import { isDenyFilter } from "../../../ir/util/tenant-stance.js";
import { AMBIENT_CURRENT_USER, renderCsExpr } from "../render-expr.js";

/** One filter of a document read: its predicate and the capability that
 *  contributed it (absent for a filter no `ignoring` clause can name). */
export interface DocumentFilterTerm {
  predicate: ExprIR;
  capability?: string;
}

/** The read's `ignoring` clause. */
export interface DocumentReadBypass {
  bypassAll?: boolean;
  bypassCaps?: string[];
}

/** The in-app filter suffix a document read applies to its rehydrated rows.
 *  No clause → the shared `_CapabilityVisible` (every filter).  A bypass keeps
 *  only the filters it does not name — the selection rule of the relational
 *  path: `ignoring *` drops every bypassable filter, `ignoring A` drops the
 *  filters whose contributing capability is `A`, and a deny sentinel is never
 *  dropped.  `terms` is the full list `_CapabilityVisible` conjoins. */
export function documentFindCapFilter(
  agg: EnrichedAggregateIR,
  terms: readonly DocumentFilterTerm[],
  f: DocumentReadBypass,
): string {
  if (terms.length === 0) return "";
  const caps = new Set(f.bypassCaps ?? []);
  if (!f.bypassAll && caps.size === 0) return ".Where(_CapabilityVisible)";
  const kept = terms.filter((t) => {
    if (isDenyFilter(t.predicate) || t.capability === undefined) return true;
    if (f.bypassAll) return false;
    return !caps.has(t.capability);
  });
  if (kept.length === terms.length) return ".Where(_CapabilityVisible)";
  if (kept.length === 0) return "";
  const pred = kept
    .map(
      (t) =>
        `(${renderCsExpr(t.predicate, { thisName: "x", agg, currentUserExpr: AMBIENT_CURRENT_USER })})`,
    )
    .join(" && ");
  return `.Where(x => ${pred})`;
}

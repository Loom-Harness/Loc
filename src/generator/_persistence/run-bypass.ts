// The `ignoring` stance a retrieval runner bakes in.
//
// A widened list read (`Repo.all(<Criterion>) ignoring <Cap>` /
// `Repo.all(<Retrieval>) ignoring *`) runs a retrieval of its own, named for
// its stance (`widenedRetrievalName`), which enrichment derives with that
// stance on `RetrievalIR.bypassAll` / `bypassCaps`.  The shared retrieval every
// other caller runs carries none, so it keeps every filter.  A runner that
// cannot take the stance per call (a document blob filtered in the
// application, a Hibernate filter disabled around the query) reads it here.
// Deny and bare (capability-less) restrictions are never bypassed — the
// read-scope fact drops only what an `ignoring` clause names.

import type { ReadBypass } from "../../ir/enrich/read-scope.js";
import type { BoundedContextIR } from "../../ir/types/loom-ir.js";

/** The stance per retrieval of `aggName` in `ctx`, for every retrieval a
 *  widened read runs.  Empty when no read of `aggName` widens. */
export function runBypassesByRetrieval(
  ctx: Pick<BoundedContextIR, "retrievals">,
  aggName: string,
): Map<string, ReadBypass> {
  const out = new Map<string, ReadBypass>();
  for (const r of ctx.retrievals ?? []) {
    if (r.targetType.kind !== "entity" || r.targetType.name !== aggName) continue;
    if (r.bypassAll) out.set(r.name, { bypassAll: true });
    else if (r.bypassCaps?.length) out.set(r.name, { bypassCaps: [...r.bypassCaps] });
  }
  return out;
}

// The by-id read cache (`kind: cache`): say which aggregates under a cache
// resource are still read from the database, and why.  The decision itself is
// `src/ir/plan/cache.ts`; this check only reports it.

import { diagMessage } from "../../../diagnostics/messages.js";
import { cachePlanFor } from "../../plan/cache.js";
import type { SystemIR } from "../../types/loom-ir.js";
import type { LoomDiagnostic } from "./diagnostic.js";

export function validateCacheReads(sys: SystemIR, diags: LoomDiagnostic[]): void {
  for (const sd of sys.subdomains) {
    for (const ctx of sd.contexts) {
      for (const u of cachePlanFor(sys, ctx).uncached) {
        const agg = ctx.aggregates.find((a) => a.name === u.aggregate);
        diags.push({
          severity: "warning",
          code: "loom.cache-read-uncached",
          message: diagMessage(`loom.cache-read-uncached#${u.reason}`, {
            aggregate: u.aggregate,
            resource: u.resource,
          }),
          source: `${ctx.name}/aggregate ${u.aggregate}`,
          ...(agg?.origin ? { origin: agg.origin } : {}),
        });
      }
    }
  }
}

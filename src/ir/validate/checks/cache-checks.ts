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
        const origin = ctx.aggregates.find((a) => a.name === u.aggregate)?.origin;
        const source = `${ctx.name}/aggregate ${u.aggregate}`;
        if (u.reason === "event-sourced") {
          diags.push({
            severity: "warning",
            code: "loom.cache-read-uncached",
            message: diagMessage("loom.cache-read-uncached#event-sourced", {
              aggregate: u.aggregate,
              resource: u.resource,
            }),
            source,
            ...(origin ? { origin } : {}),
          });
        } else if (u.reason === "inheritance") {
          diags.push({
            severity: "warning",
            code: "loom.cache-read-uncached",
            message: diagMessage("loom.cache-read-uncached#inheritance", {
              aggregate: u.aggregate,
              resource: u.resource,
            }),
            source,
            ...(origin ? { origin } : {}),
          });
        } else {
          diags.push({
            severity: "warning",
            code: "loom.cache-read-uncached",
            message: diagMessage("loom.cache-read-uncached#scope-reads-other-rows", {
              aggregate: u.aggregate,
              resource: u.resource,
            }),
            source,
            ...(origin ? { origin } : {}),
          });
        }
      }
    }
  }
}

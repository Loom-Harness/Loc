// The by-id read cache (`kind: cache`): say which aggregates under a cache
// resource are still read from the database, and why, and refuse the
// topologies in which a write cannot evict the entries it makes stale.  The
// decisions are `src/ir/plan/cache.ts`; this check only reports them.

import { diagMessage } from "../../../diagnostics/messages.js";
import { cachePlanFor, cacheTopologyGaps } from "../../plan/cache.js";
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

export function validateCacheTopology(sys: SystemIR, diags: LoomDiagnostic[]): void {
  const { unevictedWriters, sharedInMemory } = cacheTopologyGaps(sys);
  for (const w of unevictedWriters) {
    diags.push({
      severity: "error",
      code: "loom.cache-writer-not-evicting",
      message: diagMessage("loom.cache-writer-not-evicting", {
        deployable: w.deployable,
        context: w.context,
        resource: w.resource,
        cachedBy: w.cachedBy.join("', '"),
      }),
      source: `deployable ${w.deployable}`,
    });
  }
  for (const s of sharedInMemory) {
    diags.push({
      severity: "error",
      code: "loom.cache-in-memory-shared",
      message: diagMessage("loom.cache-in-memory-shared", {
        resource: s.resource,
        deployables: s.deployables.join("', '"),
      }),
      source: `resource ${s.resource}`,
    });
  }
}

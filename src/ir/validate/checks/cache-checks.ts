// The by-id read cache (`kind: cache`): say which aggregates under a cache
// resource are still read from the database, and why.  The decision itself is
// `src/ir/plan/cache.ts`; this check only reports it.

import { diagMessage } from "../../../diagnostics/messages.js";
import { cachePlanFor, type UncachedRead } from "../../plan/cache.js";
import type { SystemIR } from "../../types/loom-ir.js";
import type { OriginRef } from "../../types/origin.js";
import type { LoomDiagnostic } from "./diagnostic.js";

export function validateCacheReads(sys: SystemIR, diags: LoomDiagnostic[]): void {
  for (const sd of sys.subdomains) {
    for (const ctx of sd.contexts) {
      for (const u of cachePlanFor(sys, ctx).uncached) {
        const origin = ctx.aggregates.find((a) => a.name === u.aggregate)?.origin;
        diags.push(uncachedDiagnostic(u, `${ctx.name}/aggregate ${u.aggregate}`, origin));
      }
    }
  }
}

function uncachedDiagnostic(
  u: UncachedRead,
  source: string,
  origin: OriginRef | undefined,
): LoomDiagnostic {
  const at = { source, ...(origin ? { origin } : {}) };
  switch (u.reason) {
    case "event-sourced":
      return {
        severity: "warning",
        code: "loom.cache-read-uncached",
        message: diagMessage("loom.cache-read-uncached#event-sourced", u),
        ...at,
      };
    case "inheritance":
      return {
        severity: "warning",
        code: "loom.cache-read-uncached",
        message: diagMessage("loom.cache-read-uncached#inheritance", u),
        ...at,
      };
    case "scope-reads-other-rows":
      return {
        severity: "warning",
        code: "loom.cache-read-uncached",
        message: diagMessage("loom.cache-read-uncached#scope-reads-other-rows", u),
        ...at,
      };
  }
}

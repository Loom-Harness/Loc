// The visibility taint's phase-⑦ arm — the `mask unless` sinks no gate can be
// inherited for (`src/ir/enrich/mask-taint.ts`).
//
// Every other sink inherits the mask in enrichment: a derived redacts with it,
// a find / handler read requires it, a write from a parameter is gated on it.
// A write whose value is computed from a body-local (or lands through a nested
// path) cannot be checked before the operation runs, so it is refused here
// rather than left as a silent overwrite of data the caller cannot read.

import { diagMessage } from "../../../diagnostics/messages.js";
import { maskWriteSinks } from "../../enrich/mask-taint.js";
import type { BoundedContextIR } from "../../types/loom-ir.js";
import type { LoomDiagnostic } from "./diagnostic.js";

export function validateMaskSinks(ctx: BoundedContextIR, diags: LoomDiagnostic[]): void {
  for (const agg of ctx.aggregates) {
    for (const sink of maskWriteSinks(agg)) {
      if (!sink.unhoistable) continue;
      diags.push({
        severity: "error",
        code: "loom.mask-sink-write",
        message: diagMessage("loom.mask-sink-write", {
          name: agg.name,
          op: sink.op.name,
          field: sink.field.name,
          why: sink.unhoistable,
        }),
        source: `${ctx.name}/${agg.name}.${sink.op.name}`,
        origin: sink.op.origin ?? sink.field.origin,
      });
    }
  }
}

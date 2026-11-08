// The visibility taint's phase-⑦ arm (`src/ir/enrich/mask-taint.ts`): the
// `mask unless` sinks no gate can be inherited for, refused rather than left as
// a silent leak.
//
//   - loom.field-mask-event-channel — a masked value emitted on an event a
//     channel publishes reaches every subscriber in the clear;
//   - loom.field-mask-unique-oracle — a `unique` key over a masked field makes
//     an ungated create answer 409 for a value that exists, an existence
//     oracle on the hidden value.  A create gated by the mask predicate itself
//     is not an oracle (the caller who cannot read it is refused first).

import { diagMessage } from "../../../diagnostics/messages.js";
import { conjoins, maskLaunderingEvents } from "../../enrich/mask-taint.js";
import type { BoundedContextIR } from "../../types/loom-ir.js";
import { canonicalCreate } from "../../util/canonical-lifecycle.js";
import { lifecycleGates } from "../../util/op-gates.js";
import type { LoomDiagnostic } from "./diagnostic.js";

export function validateMaskSinks(ctx: BoundedContextIR, diags: LoomDiagnostic[]): void {
  if (!ctx.aggregates.some((a) => a.fields.some((f) => f.maskUnless))) return;
  const laundering = maskLaunderingEvents(ctx);
  for (const ch of ctx.channels ?? []) {
    for (const event of ch.carries) {
      const via = laundering.get(event);
      if (via === undefined) continue;
      diags.push({
        severity: "error",
        code: "loom.field-mask-event-channel",
        message: diagMessage("loom.field-mask-event-channel", {
          event,
          channel: ch.name,
          field: via,
        }),
        source: `${ctx.name}/channel/${ch.name}`,
      });
    }
  }
  for (const agg of ctx.aggregates) {
    const masked = new Map(agg.fields.filter((f) => f.maskUnless).map((f) => [f.name, f] as const));
    if (masked.size === 0) continue;
    const createGates = lifecycleGates(canonicalCreate(agg));
    const reported = new Set<string>();
    for (const uk of agg.uniqueKeys ?? []) {
      for (const col of uk.columns) {
        const f = masked.get(col);
        if (!f || reported.has(col) || createGates.some((g) => conjoins(g.expr, f.maskUnless!)))
          continue;
        reported.add(col);
        diags.push({
          severity: "error",
          code: "loom.field-mask-unique-oracle",
          message: diagMessage("loom.field-mask-unique-oracle", { name: agg.name, field: col }),
          source: `${ctx.name}/${agg.name}.${col}`,
          origin: f.origin,
        });
      }
    }
  }
}

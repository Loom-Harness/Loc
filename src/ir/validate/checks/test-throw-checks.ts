// -------------------------------------------------------------------------
// A `toThrow` a target's unit tier cannot observe.
//
// Most backends run a domain unit test against the domain object itself: an
// operation that returns nothing checks the aggregate's invariants at its end
// and throws, so `expect(o.discount(5)).toThrow(invariant)` sees the
// rejection.  A target whose unit tier runs against a pure domain core instead
// (`TargetFacts.unitTestPureCore`) checks them through the changeset the
// persisting path validates with, which an operation of a document-shaped
// aggregate does not reach: its in-memory record is the stored document.
//
// A test that needs an invariant rejection from such an operation
// (`rejectionNeedsInvariant`: the `invariant` rung, or a bare `toThrow()` over
// an operation that cannot refuse before its invariants) is refused here,
// rather than emitted as a skipped test or crashing `generate`.  An aggregate
// with no invariant is not refused: there the assertion fails on every backend.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { factsFor } from "../../../platform/metadata.js";
import { rejectionNeedsInvariant, rejectionPlan } from "../../plan/test-rejection.js";
import type { EnrichedBoundedContextIR, EnrichedLoomModel, SystemIR } from "../../types/loom-ir.js";
import { isDocumentShaped, resolveDataSourceConfig } from "../../util/resolve-datasource.js";
import type { LoomDiagnostic } from "./diagnostic.js";

export function validateTestThrowShapes(loom: EnrichedLoomModel, diags: LoomDiagnostic[]): void {
  for (const sys of loom.systems) {
    const contexts = new Map(
      sys.subdomains.flatMap((m) => m.contexts).map((c) => [c.name, c] as const),
    );
    const seen = new Set<string>();
    for (const d of sys.deployables) {
      if (!factsFor(d.platform)?.unitTestPureCore) continue;
      for (const name of d.contextNames) {
        const ctx = contexts.get(name);
        if (!ctx || seen.has(ctx.name)) continue;
        seen.add(ctx.name);
        checkContext(ctx, sys, d.platform, diags);
      }
    }
  }
}

function checkContext(
  ctx: EnrichedBoundedContextIR,
  sys: SystemIR,
  platform: string,
  diags: LoomDiagnostic[],
): void {
  for (const agg of ctx.aggregates) {
    for (const test of agg.tests) {
      for (const s of test.statements) {
        if (s.kind !== "expect-throws") continue;
        const plan = rejectionPlan(s);
        const call = plan.call;
        if (call.kind !== "method-call" || call.isCollectionOp) continue;
        const receiver = call.receiverType;
        if (receiver.kind !== "entity") continue;
        const owner = ctx.aggregates.find((a) => a.name === receiver.name);
        const op = owner?.operations.find((o) => o.name === call.member);
        if (!owner || !op || owner.invariants.length === 0) continue;
        if (!rejectionNeedsInvariant(plan, op, owner)) continue;
        if (owner.persistedAs === "eventLog") continue;
        if (!isDocumentShaped(owner, resolveDataSourceConfig(owner, ctx, sys))) continue;
        const params = { test: test.name, aggregate: owner.name, operation: op.name, platform };
        diags.push({
          severity: "error",
          code: "loom.test-throw-unsupported",
          message: diagMessage("loom.test-throw-unsupported", params),
          source: `${ctx.name}/${agg.name}/${test.name}`,
          origin: s.origin ?? test.origin,
        });
      }
    }
  }
}

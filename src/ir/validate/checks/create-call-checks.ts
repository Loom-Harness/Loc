// ---------------------------------------------------------------------------
// `Agg.create({ … })` CALL-SITE checks (`loom.create-call-not-constructible`,
// `loom.create-call-missing-field`).
//
// Nothing validated the call site against the factory it calls.  Two shapes
// reached the emitted project and failed its OWN compiler:
//
// 1. THE AGGREGATE HAS NO `create` AT ALL.  An invariant that reaches outside
//    the create payload makes the aggregate non-constructible (`isConstructible`,
//    `src/ir/enrich/wire-projection.ts`) and every backend then CORRECTLY emits
//    no `static create(...)`.  The unit-test emitter and the workflow emitter
//    kept emitting the call:
//
//        aggregate Order {
//          currency: string
//          contains lines: Line[]
//          invariant lines.all(l => l.currency == currency)   // ← makes it non-constructible
//          test "an order can be built" { let o = Order.create({ currency: "EUR" }) }
//        }
//        workflow openOrder { create(currency: string) { let o = Order.create({ currency: currency }) } }
//
//        domain/order.test.ts(7,21):  TS2551: Property 'create' does not exist on
//                                     type 'typeof Order'. Did you mean '_create'?
//        http/workflows.ts(46,23):    (the same)
//
//    Deleting that one invariant makes it compile — the causality is exact, and
//    the author has no way to see it from the source.
//
// 2. A REQUIRED CREATE-INPUT FIELD IS OMITTED.  The factory input is the
//    field-derived create-input contract, not whatever the call site passes:
//
//        aggregate Part { sku: string  binCode: string  onHand: int
//          test "…" { let p = Part.create({ sku: "a", onHand: 1 }) } }
//
//        domain/part.test.ts(8,27): TS2345: Property 'binCode' is missing in type
//          '{ sku: string; onHand: number; }' but required in type
//          '{ sku: string; binCode: string; onHand: number; }'.
//
//    The concept already existed on the DECLARATION side
//    (`loom.create-params-not-wire`, which warns when a declared `create`'s
//    parameter list omits a required create-input field).  It was simply never
//    applied to a call site.
//
// WHY HERE AND NOT AT THE AST LAYER.  `checkFactoryCreateFields` already gates
// the call site's UNKNOWN and server-owned keys (src/language/validators/
// builder-call.ts) and re-derives the create-input set inline from `Property`
// access modifiers.  Neither question above can be answered that way:
// constructibility is an INVARIANT-SATISFIABILITY judgement over the lowered
// expression, and "required" folds in optionality, explicit defaults AND the
// language-defined implicit `bool` default.  Both live in
// `src/ir/enrich/wire-projection.ts`, which `src/language/` may not import
// (the one-directional pipeline).  Running here lets the gate call
// `isConstructible` / `buildCreateInput` — the SAME functions the emitters
// gate on — so the check cannot drift away from what is emitted.
//
// The trade the IR layer makes is location: an `LoomDiagnostic` carries no CST
// range (src/api/report.ts stamps every IR diagnostic rangeless), so the
// message names the aggregate and the call's declaration site instead of a
// line.
// ---------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { buildCreateInput, isConstructible } from "../../enrich/wire-projection.js";
import type { AggregateIR, ExprIR, LoomModel } from "../../types/loom-ir.js";
import { allContexts } from "../../types/loom-ir.js";
import { forEachModelExpr } from "../../util/model-exprs.js";
import { walkExprDeep } from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";

/** The `Agg.create({ … })` shape, as lowering leaves it: a `method-call` whose
 *  receiver is the (unresolvable-in-this-scope, hence `refKind: "unknown"`)
 *  aggregate name and whose single argument is an object literal.
 *
 *  A POSITIONAL `create(a, b)` is a different, author-declared arg surface
 *  owned by the domain-call-argument gate, so only the record form is read —
 *  the same restriction `checkFactoryCreateFields` states. */
interface CreateCall {
  aggName: string;
  fields: readonly string[];
}

function asCreateCall(e: ExprIR): CreateCall | undefined {
  if (e.kind !== "method-call" || e.member !== "create") return undefined;
  if (e.receiver.kind !== "ref") return undefined;
  if (e.args.length !== 1) return undefined;
  const arg = e.args[0];
  if (arg?.kind !== "object") return undefined;
  return { aggName: e.receiver.name, fields: arg.fields.map((f) => f.name) };
}

/** Aggregates by name, model-wide, but only where the name is UNAMBIGUOUS.
 *  A name declared by two contexts cannot be resolved from the call's bare
 *  receiver, and guessing would risk gating a call against the wrong
 *  aggregate — so an ambiguous name is dropped and the call is not checked. */
function unambiguousAggregates(loom: LoomModel): ReadonlyMap<string, AggregateIR> {
  const byName = new Map<string, AggregateIR>();
  const ambiguous = new Set<string>();
  for (const ctx of allContexts(loom)) {
    for (const agg of ctx.aggregates) {
      if (byName.has(agg.name)) ambiguous.add(agg.name);
      else byName.set(agg.name, agg);
    }
  }
  for (const n of ambiguous) byName.delete(n);
  return byName;
}

export function validateCreateCallSites(loom: LoomModel, diags: LoomDiagnostic[]): void {
  const aggregates = unambiguousAggregates(loom);
  if (aggregates.size === 0) return;
  // One diagnostic per (aggregate, source) pair: a workflow body that builds the
  // same aggregate twice has one defect to fix, not two identical reports.
  const seen = new Set<string>();

  forEachModelExpr(loom, ({ expr, source }) => {
    walkExprDeep(expr, (e) => {
      const call = asCreateCall(e);
      if (!call) return;
      const agg = aggregates.get(call.aggName);
      if (!agg) return;

      // --- 1. no factory exists ------------------------------------------
      if (!isConstructible(agg)) {
        // Name the invariant that blocks it — that is the line the author has
        // to change, and the one the emitted `tsc` error cannot point at.
        const blocking = agg.invariants.map((inv) => inv.source).filter((s) => s.length > 0);
        const key = `nc|${agg.name}|${source}`;
        if (seen.has(key)) return;
        seen.add(key);
        diags.push({
          severity: "error",
          code: "loom.create-call-not-constructible",
          message: diagMessage("loom.create-call-not-constructible", {
            agg: agg.name,
            blocking:
              blocking.length > 0
                ? `  Its invariant${blocking.length === 1 ? "" : "s"} ${blocking
                    .map((s) => `\`${s}\``)
                    .join(
                      ", ",
                    )} reach${blocking.length === 1 ? "es" : ""} outside the create input.`
                : "",
          }),
          source,
        });
        return;
      }

      // --- 2. a required create-input field is missing ---------------------
      // `createInput` is the enriched projection; `buildCreateInput` is the same
      // derivation, kept as the fallback for a programmatically-built IR.
      const input = agg.createInput ?? buildCreateInput(agg);
      const supplied = new Set(call.fields);
      const missing = input
        .filter((c) => c.requiredInput && !supplied.has(c.field.name))
        .map((c) => c.field.name);
      if (missing.length === 0) return;
      const key = `mf|${agg.name}|${source}|${missing.join(",")}`;
      if (seen.has(key)) return;
      seen.add(key);
      diags.push({
        severity: "error",
        code: "loom.create-call-missing-field",
        message: diagMessage("loom.create-call-missing-field", {
          agg: agg.name,
          missing: missing.map((n) => `\`${n}\``).join(", "),
          plural: missing.length === 1 ? "is" : "are",
          input: input.map((c) => `\`${c.field.name}\``).join(", "),
        }),
        source,
      });
    });
  });
}

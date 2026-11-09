// ---------------------------------------------------------------------------
// The BACKEND validation-message catalog.
//
// A NAMED `invariant` / field `check` / `precondition` reaches the wire with its
// identity key `<Ctx>.<Owner>.rule.<name>` on `errors[].code` and its
// source-language text on `errors[].message`.  The SERVER resolves the code
// against a catalog too, so a `fr` request gets French from the same backend
// rather than forcing every client to ship its own copy of every rule's text.
//
// This module is the ONE place that decides WHICH messages a backend ships and
// WHAT key each one has.  All five backends build their catalog from
// `collectWireValidationMessages`, so the five catalogs are the same set of
// entries with the same keys — the cross-backend parity the wire `code`
// promises (`test/generator/i18n/backend-message-catalog.test.ts` pins it), and
// the same keys `.loom/messages.en.json` carries for translators.
//
// SCOPE — BOTH rungs.  A named rule surfaces in two places: the wire validator
// (422 `errors[]`) and the domain floor (the `DomainError` / `DomainException`
// a tripped rule throws inside the aggregate).  The five wire-validator
// emitters (`zod-refine.ts`, `dotnet/validator-emit.ts`,
// `java/emit/validator.ts`, `python/emit/wire-constraints.ts`,
// `elixir/vanilla/changeset-invariant-emit.ts`) attach the code at the wire;
// the domain floor carries the same code through the thrown error
// (`domain-floor.ts`), so each backend's 422 serializer resolves it on either
// rung.  The catalog therefore holds every named rule either rung can surface:
//
//   * every named aggregate `invariant` / field `check`;
//   * every named operation `precondition`;
//   * every named value-object `invariant`;
//   * every named workflow / command- / query-handler `precondition`.
//
// The text is read through `namedRuleText`, so a `locales/en/<Ctx>.json`
// override reaches the catalog exactly as it reaches the inline wire text.
// ---------------------------------------------------------------------------

import type {
  AggregateIR,
  BoundedContextIR,
  InvariantIR,
  OperationIR,
  ValueObjectIR,
} from "../../ir/types/loom-ir.js";
import { ruleParams } from "../../ir/util/rule-params.js";
import { workflowPreconditionMessages } from "./domain-floor.js";
import { namedRuleText } from "./rule-text.js";

/** One catalog entry — the stable wire `code` and its source-language text. */
export interface ValidationMessage {
  /** The rule's identity key — identical to the `errors[].code` the
   *  validators attach. */
  readonly code: string;
  /** The source-language text, the fallback a missing translation resolves to. */
  readonly text: string;
  /** The identifiers the rule reads (`ruleParams`) — the placeholders its
   *  message may use, whose values the wire `params` carries. */
  readonly params: readonly string[];
}

interface Entry {
  readonly text: string;
  readonly params: readonly string[];
}

/** Lift an operation's `precondition` statements to invariants — the same
 *  normalisation every wire-validator emitter does before classifying. */
function preconditionsAsInvariants(op: OperationIR): InvariantIR[] {
  const out: InvariantIR[] = [];
  for (const s of op.statements) {
    if (s.kind === "precondition") out.push({ expr: s.expr, source: s.source, message: s.message });
  }
  return out;
}

/** Record every named rule in `invariants` into `into`.  No wire
 *  classification: every one of them can surface at the domain floor, which
 *  carries its code. */
function take(invariants: readonly InvariantIR[], into: Map<string, Entry>): void {
  for (const inv of invariants) {
    if (!inv.message) continue;
    into.set(inv.message.key, { text: namedRuleText(inv.message), params: ruleParams(inv) });
  }
}

function takeAggregate(agg: AggregateIR, into: Map<string, Entry>): void {
  take(agg.invariants, into);
  for (const op of agg.operations) take(preconditionsAsInvariants(op), into);
}

function takeValueObject(vo: ValueObjectIR, into: Map<string, Entry>): void {
  take(vo.invariants, into);
}

/** Every named rule's message `contexts` can surface — on the wire rung or at
 *  the domain floor — keyed by its identity key and sorted
 *  by key so the emitted catalog is byte-stable across runs.  (The name predates
 *  the domain-floor half; every consumer wants both rungs.) */
export function collectWireValidationMessages(
  contexts: readonly BoundedContextIR[],
): ValidationMessage[] {
  const byCode = new Map<string, Entry>();
  for (const ctx of contexts) {
    for (const agg of ctx.aggregates) takeAggregate(agg, byCode);
    for (const vo of ctx.valueObjects) takeValueObject(vo, byCode);
    // A named workflow / handler precondition throws the same coded
    // domain-floor error.
    for (const p of workflowPreconditionMessages(ctx))
      byCode.set(p.message.key, { text: namedRuleText(p.message), params: ruleParams(p) });
  }
  return [...byCode.keys()].sort().map((code) => ({ code, ...byCode.get(code)! }));
}

/** True when `contexts` carry any named rule — the single
 *  gate every backend takes for its catalog + lookup emission.  False ⇒ the
 *  generated project is byte-identical to pre-catalog output. */
export function hasWireValidationMessages(contexts: readonly BoundedContextIR[]): boolean {
  return collectWireValidationMessages(contexts).length > 0;
}

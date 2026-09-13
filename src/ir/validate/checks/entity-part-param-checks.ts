// -------------------------------------------------------------------------
// Entity-part-typed action parameters (#2864 D6, decision D-2 of the
// freight-audit fleet plan; mission M-T5.34).
//
// `operation replaceLines(newLines: Line[])`, where `Line` is an `entity` part
// of the same aggregate, parses and validates clean and then has no wire
// materialization on ANY backend:
//
//   node     `z.array(z.unknown())` + `body.newLines.map((e: any) => e)`
//            — compiles, but there is no wire contract, and `save()` then reads
//              `child.id` / `child.parentId` as `undefined`
//   dotnet   `List<LineResponse>` -> `ReplaceLinesCommand(List<Line>)`  CS0029
//   java     `List<LineResponse>` -> `replaceLines(List<Line>)`         javac
//   python   `list(body.newLines)` of `LineResponse` -> `list[Line]`
//
// The value-object equivalent IS emitted correctly (`z.array(LineSchema)` +
// `new Line(e.sku, e.qty)`), so the materialization step simply has no entity
// arm.  D-2 rules that it stays that way: materializing an entity part handed
// in by a client means answering a question the DSL has never answered — do
// the supplied parts REPLACE the collection (new ids, history orphaned) or
// MERGE by id?  That belongs in a proposal, not in a guess inside an emitter.
//
// SCOPE, each boundary verified against the emitters rather than assumed:
//
//   * PUBLIC actions only.  A `private` operation is never routed — it emits
//     the domain method and no request record at all — so it has no wire
//     boundary to break.
//   * `operations` and `destroys`, NOT `creates`.  A declared create's
//     parameter list is not the request contract: the create input is derived
//     from the aggregate's FIELDS, and a containment field there already emits
//     `<Part>Response` correctly.  (That create/parameter-list divergence is
//     its own finding, owned by #2861.)
//   * Entity PARTS only, matched by name against the aggregate's own parts.  A
//     `payload` / `command` / `query` also lowers to an `entity` TypeIR, and
//     #2886 emits wire types for those — they need no ruling and must not be
//     caught here.  A workflow cannot name a part at all (the scope provider
//     restricts bare-name type refs to the declaring aggregate), so workflow
//     parameters are out of scope by construction.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import type { BoundedContextIR, OperationIR, TypeIR } from "../../types/loom-ir.js";
import type { LoomDiagnostic } from "./diagnostic.js";

/** The entity name a parameter type bottoms out in, looking through the
 *  collection / optional wrappers a part type can legally wear, plus whether
 *  that wrapper was a collection (which changes the advice wording). */
function entityTypeOf(t: TypeIR): { name: string; collection: boolean } | undefined {
  if (t.kind === "entity") return { name: t.name, collection: false };
  if (t.kind === "array") {
    const inner = entityTypeOf(t.element);
    return inner && { name: inner.name, collection: true };
  }
  if (t.kind === "optional") {
    const inner = entityTypeOf(t.inner);
    return inner && { ...inner };
  }
  return undefined;
}

export function validateEntityPartParams(ctx: BoundedContextIR, diags: LoomDiagnostic[]): void {
  for (const agg of ctx.aggregates) {
    const partNames = new Set(agg.parts.map((p) => p.name));
    if (partNames.size === 0) continue;
    const actions: OperationIR[] = [...(agg.operations ?? []), ...(agg.destroys ?? [])];
    for (const op of actions) {
      if (op.visibility !== "public") continue;
      for (const param of op.params) {
        const hit = entityTypeOf(param.type);
        if (!hit || !partNames.has(hit.name)) continue;
        diags.push({
          severity: "error",
          code: "loom.entity-part-param-unsupported",
          message: diagMessage("loom.entity-part-param-unsupported", {
            name: agg.name,
            opName: op.name,
            param: `${param.name}: ${hit.collection ? `${hit.name}[]` : hit.name}`,
            part: hit.name,
            collection: hit.collection,
          }),
          source: `${ctx.name}/${agg.name}`,
        });
      }
    }
  }
}

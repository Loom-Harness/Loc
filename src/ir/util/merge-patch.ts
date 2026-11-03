// -------------------------------------------------------------------------
// The merge-patch UPDATE (RS-47) — which operation's request body is a JSON
// Merge Patch (RFC 7396), and which of its members a wire rule reads.
//
// An aggregate's `update` operation whose body does nothing but assign each
// parameter to the same-named field (`update(title, note) { title := title
// note := note }` — what `with crudish` synthesises) is a request to SET
// fields, so its body follows RFC 7396 on every backend:
//
//   - a key the body leaves out keeps the stored value;
//   - `null` clears an optional (`T?`) field, and is refused as
//     `"<field> is required"` (422) on a required one;
//   - any other value sets the field.
//
// The handler loads the row (it always did — the operation runs on the loaded
// aggregate), passes the stored value for every absent key, and calls the
// operation unchanged, so its gates, invariants, stamps and version check run
// exactly as for a full body.
//
// Recognised from the operation's shape, not from the macro that wrote it, so
// a `crudish` update keeps its contract after `unfold` turns it into source,
// and a hand-written `update` of the same shape means the same thing.  Every
// other operation is a command: positional parameters, every required one
// required.
//
// Pure, platform-neutral, browser-safe — every backend and the published
// contract read the same answer.
// -------------------------------------------------------------------------

import type { AggregateIR, ExprIR, InvariantIR, OperationIR, TypeIR } from "../types/loom-ir.js";
import { walkExprDeep } from "./walk.js";

/** One member of a merge-patch update body. */
export interface MergePatchField {
  /** The parameter name — also the wire key and the field it assigns. */
  name: string;
  type: TypeIR;
  /** `null` clears the field (a `T?` field); otherwise `null` is refused. */
  nullable: boolean;
}

/** True when `op`'s request body is a JSON Merge Patch — see the header. */
export function isMergePatchUpdate(op: OperationIR): boolean {
  return mergePatchFields(op) !== null;
}

/** True when the aggregate's `update` takes a merge patch — a backend whose
 *  update seam is per-aggregate rather than per-operation reads this. */
export function aggregateHasMergePatchUpdate(agg: Pick<AggregateIR, "operations">): boolean {
  return (agg.operations ?? []).some((op) => isMergePatchUpdate(op));
}

/** The members of a merge-patch update body, in parameter order; `null` when
 *  `op` is not one. */
export function mergePatchFields(op: OperationIR): readonly MergePatchField[] | null {
  if (op.name !== "update") return null;
  if ((op.kind ?? "mutate") !== "mutate" || op.canonical) return null;
  if (op.returnType || op.extern) return null;
  if (op.params.length === 0) return null;
  if (op.params.some((p) => p.default !== undefined)) return null;
  const params = new Set(op.params.map((p) => p.name));
  const assigned = new Set<string>();
  for (const s of op.statements) {
    if (s.kind === "requires") continue;
    if (s.kind !== "assign") return null;
    const [field, ...rest] = s.target.segments;
    if (field === undefined || rest.length > 0) return null;
    const v = s.value;
    if (v.kind !== "ref" || v.refKind !== "param" || v.name !== field) return null;
    if (!params.has(field) || assigned.has(field)) return null;
    assigned.add(field);
  }
  if (assigned.size !== params.size) return null;
  return op.params.map((p) => ({
    name: p.name,
    type: p.type,
    nullable: p.type.kind === "optional",
  }));
}

/** The request members a wire rule reads, in first-read order — the keys a
 *  merge-patch body must carry for the rule to be judged at the schema stage.
 *  A patch that leaves any of them out defers the rule to the domain floor,
 *  which judges the MERGED state (`ruleStage` in `src/ir/enrich/wire-policy.ts`). */
export function ruleMembers(rule: InvariantIR, available: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const visit = (e: ExprIR): void => {
    if (e.kind !== "ref") return;
    if (e.refKind !== "this-prop" && e.refKind !== "param" && e.refKind !== "this-vo-prop") return;
    if (available.has(e.name) && !out.includes(e.name)) out.push(e.name);
  };
  walkExprDeep(rule.expr, visit);
  walkExprDeep(rule.guard, visit);
  return out;
}

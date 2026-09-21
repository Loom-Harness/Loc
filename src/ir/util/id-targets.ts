// Which aggregates/entities a type graph names the STRONG ID of — the one
// question every emitter has to answer before it can write an `ids` import.
//
// WHY THIS IS SHARED.  A generated module that spells `<Name>Id` and does not
// import it is a hard failure on every typed backend (`TS2503` / `TS2304` on
// node, `ruff F821` + a request-time `NameError` on python, `CS0246` on .NET,
// `cannot find symbol` on java) — and the way that keeps happening is a
// per-emitter copy of this walk that one field shape slips past.  Freight audit
// D3 / M-T6.64 found the class in three python repository emitters at once
// (relational, `shape: document`, `shape: embedded`), each carrying its own
// inline copy of the same two-arm `optional`/`array` unwrap, and each blind to
// the same thing: an id reached THROUGH a value object rather than through a
// field of the aggregate itself.
//
// So the recursion lives here once, covering every `TypeIR` arm that can carry
// a sub-type, and a new arm is added in one place rather than four.
//
// This answers WHICH ids, not whether to import them: every caller still
// intersects the result with what its rendered body actually spells, so a wider
// answer here can only ever add a candidate that the caller's own scan drops.

import type { FieldIR, TypeIR, ValueObjectIR } from "../types/loom-ir.js";

/** Accumulate every aggregate/entity target name whose strong id `t` reaches.
 *  Mirrors the recursion in `renderTypeWith` (`generator/_type/target.ts`) over
 *  the arms that carry a sub-type, so `X id`, `X id?`, `X id[]`, a generic
 *  argument and a union variant all count. */
export function collectIdTargets(t: TypeIR, into: Set<string>): void {
  switch (t.kind) {
    case "id":
      into.add(t.targetName);
      return;
    case "array":
      collectIdTargets(t.element, into);
      return;
    case "optional":
      collectIdTargets(t.inner, into);
      return;
    case "genericInstance":
      collectIdTargets(t.arg, into);
      return;
    case "union":
      for (const v of t.variants) collectIdTargets(v, into);
      return;
    default:
      // primitive | enum | valueobject | entity | slot | action | none — a
      // `valueobject` names its own class, not the ids INSIDE it; a caller that
      // renders a VO's fields (a repository hydrating one from its flattened
      // columns) wants `valueObjectIdTargets` as well.
      return;
  }
}

/** Sorted, deduped strong-id targets named by a set of field types. */
export function fieldIdTargets(fields: readonly FieldIR[]): string[] {
  const out = new Set<string>();
  for (const f of fields) collectIdTargets(f.type, out);
  return [...out].sort();
}

/**
 * Sorted, deduped strong-id targets reachable through a VALUE OBJECT's fields.
 *
 * A repository rebuilding a value object from its flattened columns renders the
 * brand inside the VO constructor — `Berth(ShipId(row.berth_ship), …)` — while
 * the aggregate's own field is typed `Berth`. So a scan over the aggregate's
 * fields alone never proposes `ShipId`, and the module names it unimported.
 *
 * Every value object in the context is walked rather than only those one
 * aggregate holds: the result is a CANDIDATE list its caller then filters
 * against the rendered body, so being generous here costs nothing and being
 * precise would mean re-deriving the containment graph in every caller.
 */
export function valueObjectIdTargets(valueObjects: readonly ValueObjectIR[]): string[] {
  const out = new Set<string>();
  for (const vo of valueObjects) for (const f of vo.fields) collectIdTargets(f.type, out);
  return [...out].sort();
}

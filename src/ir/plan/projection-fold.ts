// The fold plan: what one `on(e: Event) { … }` handler of a materialized
// projection does to its row, as ordered steps every backend renders.
//
// The semantics are decided here, once:
//
//   - The key column is immutable.  A `:=` to the projection's key field is
//     refused at validation (`loom.projection-key-assign`), so it never
//     reaches a step.
//   - A collection `+=` appends one element; a collection `-=` removes EVERY
//     equal element, so repeating the removal changes nothing.
//   - Steps apply in order, and each step reads the row as the earlier steps
//     left it.  A backend that builds its write in one batch threads the row
//     through the steps rather than reading the pre-fold row.

import type { ExprIR, ProjectionIR, ProjectionOnIR, StmtIR, TypeIR } from "../types/loom-ir.js";

/** One step of a fold, against the row (`this`). */
export type FoldStep =
  /** `let name = expr` — a local the later steps read. */
  | { kind: "let"; name: string; expr: ExprIR; type: TypeIR }
  /** `field := value` on a non-key column. */
  | { kind: "set"; field: string; value: ExprIR; type: TypeIR }
  /** `field += value` / `field -= value` on a scalar column. */
  | { kind: "accumulate"; field: string; op: "+" | "-"; value: ExprIR; type: TypeIR }
  /** `field += value` on a collection column: append one element. */
  | { kind: "append"; field: string; value: ExprIR; elementType: TypeIR }
  /** `field -= value` on a collection column: remove every equal element. */
  | { kind: "remove-all"; field: string; value: ExprIR; elementType: TypeIR };

/** The ordered steps of fold handler `h` on projection `p`.  Throws on a
 *  statement a fold cannot hold — `loom.projection-fold-impure` and
 *  `loom.projection-key-assign` refuse those before any backend runs, so
 *  reaching one is a validator gap. */
export function foldSteps(p: ProjectionIR, h: ProjectionOnIR): FoldStep[] {
  return h.statements.map((st) => foldStep(st, p, h));
}

/** True when fold statement `st` assigns projection `p`'s key field. */
export function assignsFoldKey(p: ProjectionIR, st: StmtIR): boolean {
  return (
    st.kind === "assign" &&
    p.correlationField !== undefined &&
    st.target.segments.length === 1 &&
    st.target.segments[0] === p.correlationField
  );
}

function foldStep(st: StmtIR, p: ProjectionIR, h: ProjectionOnIR): FoldStep {
  switch (st.kind) {
    case "let":
      return { kind: "let", name: st.name, expr: st.expr, type: st.type };
    case "assign": {
      const field = lastSegment(st.target.segments);
      if (assignsFoldKey(p, st)) {
        throw new Error(
          `projection fold: '${p.name}' on(${h.param}: ${h.event}) assigns its key ` +
            `field '${field}' — 'loom.projection-key-assign' should have rejected this.`,
        );
      }
      return { kind: "set", field, value: st.value, type: st.targetType };
    }
    case "add": {
      const field = lastSegment(st.target.segments);
      return st.collection
        ? { kind: "append", field, value: st.value, elementType: st.elementType }
        : { kind: "accumulate", field, op: "+", value: st.value, type: st.elementType };
    }
    case "remove": {
      const field = lastSegment(st.target.segments);
      return st.collection
        ? { kind: "remove-all", field, value: st.value, elementType: st.elementType }
        : { kind: "accumulate", field, op: "-", value: st.value, type: st.elementType };
    }
    case "expression":
    case "return":
    case "precondition":
    case "requires":
    case "emit":
    case "call":
    case "variant-match":
    case "if":
      throw new Error(
        `projection fold: unsupported fold statement '${st.kind}' in projection ` +
          `'${p.name}' on(${h.param}: ${h.event}) — a fold applies pure assignments, ` +
          `collection mutations and let bindings only; 'loom.projection-fold-impure' ` +
          `should have rejected this.`,
      );
    default: {
      const _exhaustive: never = st;
      return _exhaustive;
    }
  }
}

function lastSegment(segments: readonly string[]): string {
  return segments[segments.length - 1]!;
}

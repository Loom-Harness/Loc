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
//   - A fresh row starts from `foldRowSeeds`: a field with a declared default
//     starts at it; a required field whose type has a neutral zero (a number,
//     money, bool, string, collection) starts at that zero; everything else
//     starts null until a fold writes it.

import type {
  BoundedContextIR,
  ExprIR,
  FieldIR,
  ProjectionIR,
  ProjectionOnIR,
  StmtIR,
  TypeIR,
} from "../types/loom-ir.js";
import { isMaterializedProjection } from "../types/loom-ir.js";

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

/** The neutral zero of a column type: `0` for an integer, `0` in the decimal
 *  or money representation, `false`, the empty string, the empty list. */
export type FoldRowZero = "int" | "decimal" | "money" | "bool" | "string" | "list";

/** What one non-key column of a freshly allocated row starts at. */
export type FoldRowSeed =
  | { field: FieldIR; kind: "default"; expr: ExprIR }
  | { field: FieldIR; kind: "zero"; zero: FoldRowZero };

/** The non-key columns a fresh row of `p` starts with a value in, in
 *  declaration order.  A column absent here starts null. */
export function foldRowSeeds(p: ProjectionIR): FoldRowSeed[] {
  const out: FoldRowSeed[] = [];
  for (const field of p.stateFields) {
    if (field.name === p.correlationField) continue;
    if (field.default) {
      out.push({ field, kind: "default", expr: field.default });
      continue;
    }
    if (field.optional) continue;
    const zero = neutralZero(field.type);
    if (zero) out.push({ field, kind: "zero", zero });
  }
  return out;
}

function neutralZero(t: TypeIR): FoldRowZero | undefined {
  if (t.kind === "array") return "list";
  if (t.kind !== "primitive") return undefined;
  switch (t.name) {
    case "int":
    case "long":
      return "int";
    case "decimal":
      return "decimal";
    case "money":
      return "money";
    case "bool":
      return "bool";
    case "string":
      return "string";
    default:
      return undefined;
  }
}

/** The fold inbox table: one row per `(projection, event_id)` a fold applied.
 *  A fold delivered with an event id inserts its row in the transaction that
 *  saves the projection row, and skips the event when the row already exists,
 *  so a redelivered event changes the read model once. */
export const FOLD_INBOX_TABLE = "__loom_fold_inbox";

/** The fold's inbox claim: inserts `(projection, event_id)` and affects no row
 *  when the event was already claimed.  `projection` / `eventId` are the
 *  backend's parameter placeholders.  `received_at` is written explicitly so
 *  the claim needs no column default (MikroORM owns its schema and declares
 *  none).  `returning` adds `returning event_id` for drivers that report the
 *  claim through a result set rather than an affected-row count. */
export function foldInboxClaimSql(projection: string, eventId: string, returning: boolean): string {
  return `insert into ${FOLD_INBOX_TABLE} (projection, event_id, received_at) values (${projection}, ${eventId}, now()) on conflict do nothing${returning ? " returning event_id" : ""}`;
}

/** True when `ctx`'s folds dedupe through the inbox: some materialized
 *  projection folds there, and the deployable delivers events durably
 *  (`durable` — the same answer the saga `last_event_id` column hangs on), so
 *  an event can arrive twice with the same id. */
export function foldsDedupe(ctx: BoundedContextIR, durable: boolean): boolean {
  return (
    durable && ctx.projections.some((p) => isMaterializedProjection(p) && p.handlers.length > 0)
  );
}

/** The relay's retention purge of the fold inbox: deletes claims received
 *  before `cutoff` (the backend's placeholder or literal).  It runs beside the
 *  outbox purge on the same window, so a claim outlives every redelivery of
 *  its event. */
export function foldInboxPurgeSql(cutoff: string): string {
  return `delete from ${FOLD_INBOX_TABLE} where received_at < ${cutoff}`;
}

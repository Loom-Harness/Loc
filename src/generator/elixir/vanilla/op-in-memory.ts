// Which operations the Phoenix context can split into an in-memory apply step
// and a separate save (`save-plan.ts`), and the names of the two functions.

import type { AggregateIR, OperationIR } from "../../../ir/types/loom-ir.js";
import { opHasProvSite } from "../../../ir/util/prov-id.js";
import { snake } from "../../../util/naming.js";
import { opBodyStmtsDeep } from "../domain/predicates.js";
import { CRUD_RESERVED_NAMES } from "./context-emit.js";
import { isEventSourced } from "./eventsourced-emit.js";
import { isOpTree } from "./op-tree.js";
import { opEmitsEvent, opRewritesRelation, opWrittenFields } from "./operation-returns-emit.js";
import { refCollFields } from "./ref-collection-emit.js";

/** Can `op` run on an in-memory handle and leave its write to `__save_<agg>`?
 *  Its apply step answers the changed struct (and a returning op's value);
 *  the save writes what its persist tail would, runs what it stages
 *  (`opStagesForSave`) and diffs a rewritten relation against the stored row
 *  (`opSavesFromStored`).  An extern op's apply step runs its hook; the save
 *  then writes every column, as its own tail does.  A CRUD-named
 *  op (`update`, …) is rendered by the repository-backed CRUD functions, which
 *  have no apply half, so it persists on its own. */
export function opAppliesInMemory(
  op: OperationIR,
  agg: AggregateIR,
  /** The aggregate persists as one document: its returning ops have no apply
   *  step. */
  isDoc = false,
): boolean {
  if (CRUD_RESERVED_NAMES.has(op.name)) return false;
  if (agg.isAbstract || agg.extendsAggregate || isEventSourced(agg)) return false;
  if (op.returnType && (isDoc || !returningOpAppliesInMemory(op, agg))) return false;
  return true;
}

/** Does `op` rewrite a relation-backed field or a reference collection?  Its
 *  apply step then leaves the new value on the struct (a reference collection
 *  as the rows it resolves to), and the save diffs it against the stored row:
 *  the handle already carries the change, so a diff against it would find
 *  nothing removed. */
export function opSavesFromStored(op: OperationIR, agg: AggregateIR): boolean {
  if (opRewritesRelation(op, agg)) return true;
  const refColls = new Set(refCollFields(agg).map((r) => snake(r.field.name)));
  return opWrittenFields(op, agg).some((f) => refColls.has(f));
}

/** Can a returning op answer its value from an apply step?  Only when no
 *  `return` hands the result of a sibling operation's own persisting call
 *  through, and its body rewrites no relation.  Work its persist tail does
 *  after the write (`opStagesForSave`) is staged for the save, as for a void
 *  op, when its body does not branch per path. */
export function returningOpAppliesInMemory(op: OperationIR, agg: AggregateIR): boolean {
  if (opSavesFromStored(op, agg)) return false;
  // Work an apply step stages is built at its one answer, so a body that
  // branches per path persists on its own.
  if (opStagesForSave(op) && isOpTree(op.statements)) return false;
  return !opBodyStmtsDeep(op.statements).some(
    (s) =>
      s.kind === "return" && s.value.kind === "call" && s.value.callKind === "private-operation",
  );
}

/** Does `op`'s persist tail do more after the write than the write itself —
 *  dispatch its events, record its audit row, flush its provenance?  Its apply
 *  half then stages that work, and the save that writes the handle runs it in
 *  the save's transaction, the events once that transaction commits — as the
 *  other backends dispatch an aggregate's raised events and record its audit
 *  rows when they save it.  The apply half takes and answers the handle's
 *  staged list (`stagedName`). */
export function opStagesForSave(op: OperationIR): boolean {
  // An extern op's hook replaces its body, and its persist tail writes the
  // row alone.
  if (op.extern === true) return false;
  return opEmitsEvent(op) || op.audited === true || opHasProvSite(op);
}

/** The binding that carries what a handle's apply steps staged for its save,
 *  beside the handle itself. */
export function stagedName(handle: string): string {
  return `${handle}_after_save`;
}

/** The context function that runs `op`'s guards and body without writing. */
export function applyFnName(opName: string, aggName: string): string {
  return `__apply_${snake(opName)}_${snake(aggName)}`;
}

/** The context function that writes a handle a body changed in memory. */
export function saveFnName(aggName: string): string {
  return `__save_${snake(aggName)}`;
}

/** Persist `changeset`, then run `staged` (oldest first) with the written
 *  row, all in one transaction; `PostCommit` holds the effects that wait for
 *  the commit and drops them on a rollback. */
export function stagedSaveTransaction(appModule: string, repoMod: string, indent: string): string {
  return [
    `${appModule}.PostCommit.transaction(fn ->`,
    `  ${appModule}.Repo.transaction(fn ->`,
    `    case ${repoMod}.persist_change(changeset) do`,
    `      {:ok, saved} ->`,
    `        staged |> Enum.reverse() |> Enum.each(& &1.(saved))`,
    `        saved`,
    ``,
    `      {:error, reason} ->`,
    `        ${appModule}.Repo.rollback(reason)`,
    `    end`,
    `  end)`,
    `end)`,
  ]
    .map((l) => (l === "" ? l : `${indent}${l}`))
    .join("\n");
}

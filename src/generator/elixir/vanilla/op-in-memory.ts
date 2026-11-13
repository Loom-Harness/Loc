// Which operations the Phoenix context can split into an in-memory apply step
// and a separate save (`save-plan.ts`), and the names of the two functions.

import type { AggregateIR, OperationIR } from "../../../ir/types/loom-ir.js";
import { opHasProvSite } from "../../../ir/util/prov-id.js";
import { snake } from "../../../util/naming.js";
import { isEventSourced } from "./eventsourced-emit.js";
import { opEmitsEvent, opRewritesRelation, opWrittenFields } from "./operation-returns-emit.js";
import { refCollFields } from "./ref-collection-emit.js";

/** Can `op` run on an in-memory handle and leave its write to `__save_<agg>`?
 *  Only when its persist tail writes nothing but the columns it assigned: no
 *  event, audit row, provenance flush, relation or reference-collection
 *  rewrite, answered value or extern hook. */
export function opAppliesInMemory(op: OperationIR, agg: AggregateIR): boolean {
  if (agg.isAbstract || agg.extendsAggregate || isEventSourced(agg)) return false;
  if (op.returnType || op.extern === true || op.audited === true) return false;
  if (opEmitsEvent(op) || opHasProvSite(op) || opRewritesRelation(op, agg)) return false;
  const refColls = new Set(refCollFields(agg).map((r) => snake(r.field.name)));
  return !opWrittenFields(op, agg).some((f) => refColls.has(f));
}

/** The context function that runs `op`'s guards and body without writing. */
export function applyFnName(opName: string, aggName: string): string {
  return `__apply_${snake(opName)}_${snake(aggName)}`;
}

/** The context function that writes a handle a body changed in memory. */
export function saveFnName(aggName: string): string {
  return `__save_${snake(aggName)}`;
}

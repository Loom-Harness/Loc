// Which workflows a context persists, and how: the sets every backend's
// persistence, dispatch and instance-read emitters iterate, and the migration
// builder turns into tables.  They must agree everywhere — a backend that
// builds a state entity for a workflow the migrations gave no table (or the
// reverse) fails at boot, not at compile time.

import type { WorkflowIR } from "../types/loom-ir.js";

/** True when the workflow persists as a mutable state row (the saga state
 *  table): it has a correlation field and is not event-sourced.  An
 *  event-sourced workflow folds its `<ctx>_events` stream instead, and a
 *  workflow without a correlation field keeps no state at all. */
export function hasStateRow(wf: Pick<WorkflowIR, "correlationField" | "eventSourced">): boolean {
  return !!wf.correlationField && !wf.eventSourced;
}

/** The workflows that persist as a mutable state row (`hasStateRow`). */
export function stateRowWorkflows(workflows: readonly WorkflowIR[]): WorkflowIR[] {
  return workflows.filter(hasStateRow);
}

/** The event-sourced workflows: each folds its stream of the context's
 *  `<ctx>_events` log, keyed by `stream_type = <workflow name>`. */
export function eventSourcedWorkflows(workflows: readonly WorkflowIR[]): WorkflowIR[] {
  return workflows.filter((wf) => !!wf.eventSourced);
}

/** The observable workflows: those with an instance wire shape, which expose
 *  the read-only instance list and by-id routes. */
export function observableWorkflows(workflows: readonly WorkflowIR[]): WorkflowIR[] {
  return workflows.filter((wf) => !!wf.instanceWireShape);
}

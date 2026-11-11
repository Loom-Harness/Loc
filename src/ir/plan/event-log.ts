// The per-context event log: one `<ctx>_events` table holds every
// event-sourced aggregate's and every event-sourced workflow's stream,
// discriminated by `stream_type`.  The migration that creates it, every
// backend's append and fold, and the instance reads must agree on the table,
// the discriminator and the events a stream folds — a backend that spelled any
// of them differently would append rows another backend (or its own reader)
// never folds.

import { snake } from "../../util/naming.js";
import type { ApplyIR, WorkflowIR } from "../types/loom-ir.js";

/** The context's event-log table, unqualified (`<ctx>_events`). */
export function eventLogTable(ctxName: string): string {
  return `${snake(ctxName)}_events`;
}

/** The `stream_type` value an event-sourced workflow's rows carry: the
 *  workflow's declared name, as an event-sourced aggregate's carry its own. */
export function workflowStreamType(wf: Pick<WorkflowIR, "name">): string {
  return wf.name;
}

/** The event types a stream folds — the events its appliers consume, each
 *  once, in applier order.  The same for an event-sourced aggregate and an
 *  event-sourced workflow. */
export function foldedEventNames(source: { appliers?: readonly ApplyIR[] }): string[] {
  return [...new Set((source.appliers ?? []).map((a) => a.event))];
}

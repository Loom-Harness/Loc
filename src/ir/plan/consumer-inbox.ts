// The consumer inbox: how a durably delivered event is applied once.
//
// A durable delivery (the outbox relay, or a broker consumer of a
// `retention: work | log` channel) carries the envelope id, and the delivery
// is at-least-once: the same id can arrive twice, on one replica or on two at
// the same time.  Every consumer that applies it — a projection fold, or the
// handler of a state-based workflow (a saga reactor, an event-triggered
// `create` starter, a stateless `on` reactor) — claims `(consumer, event_id)`
// in the inbox table in the SAME transaction as its effects:
//
//   insert … on conflict do nothing
//
// A claim that inserts no row means the event was already applied, so the
// handler does nothing.  Two concurrent deliveries of one id serialise on the
// unique key: the second claim waits for the first transaction and then finds
// its row.  A handler that fails rolls its claim back with its effects, so the
// redelivery applies again.  A frame with no event id (inline dispatch of an
// ephemeral event) is never redelivered and applies without a claim.
//
// Every backend renders the claim from `inboxClaimSql` with the key from
// `foldInboxKey` / `workflowInboxKey`; none decides the gate itself.

import type { BoundedContextIR, WorkflowIR } from "../types/loom-ir.js";
import { FOLD_INBOX_TABLE, foldInboxClaimSql, foldsDedupe } from "./projection-fold.js";

/** The inbox table every consumer claims in. */
export const INBOX_TABLE = FOLD_INBOX_TABLE;

/** The inbox claim, see `foldInboxClaimSql`: one spelling for folds and
 *  workflow handlers. */
export const inboxClaimSql = foldInboxClaimSql;

/** The inbox key of projection `projection`'s fold. */
export function foldInboxKey(projection: string): string {
  return projection;
}

/** The inbox key of workflow `workflow`'s event handlers.  The `workflow:`
 *  prefix keeps it apart from a projection of the same name. */
export function workflowInboxKey(workflow: string): string {
  return `workflow:${workflow}`;
}

/** True when `wf`'s event handlers claim in the inbox: the deployable delivers
 *  durably (`durable` — `ChannelPlan.receivesDurable` or
 *  `contextReceivesDurable`) and the workflow is state-based.  An
 *  event-sourced workflow appends to its own stream and claims nothing. */
export function workflowClaims(wf: WorkflowIR, durable: boolean): boolean {
  return durable && !wf.eventSourced && consumesEvents(wf);
}

/** True when some workflow of `ctx` claims in the inbox. */
export function workflowsDedupe(ctx: BoundedContextIR, durable: boolean): boolean {
  return ctx.workflows.some((wf) => workflowClaims(wf, durable));
}

/** True when some consumer of `ctx` claims in the inbox — a fold
 *  (`foldsDedupe`) or a workflow handler (`workflowsDedupe`).  The table, and
 *  its retention purge, exist on this answer. */
export function inboxDedupes(ctx: BoundedContextIR, durable: boolean): boolean {
  return foldsDedupe(ctx, durable) || workflowsDedupe(ctx, durable);
}

function consumesEvents(wf: WorkflowIR): boolean {
  return wf.subscriptions.length > 0 || wf.creates.some((c) => c.triggerKind === "event");
}

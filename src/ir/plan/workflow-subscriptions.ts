// The body an event subscription runs, and when an event-sourced workflow's
// starter and reactor share one event.
//
// A workflow subscribes to an event either with an event-triggered `create`
// (the starter) or with an `on` reactor.  When an event-sourced workflow
// declares BOTH for the same event, every backend renders one handler that
// folds the stream once: the starter's logic when the stream is empty, the
// reactor's when it exists.  Two independent handlers would both append, and
// the event would fold twice.

import type { EventSubscriptionIR, ExprIR, WorkflowIR, WorkflowStmtIR } from "../types/loom-ir.js";

/** What one subscription runs: the matching `on` reactor's or event-triggered
 *  `create`'s statements, exit saves and correlation. */
export interface SubscriptionHandler {
  statements: WorkflowStmtIR[];
  saves: { name: string; aggName: string; repoName: string }[];
  correlation: ExprIR | undefined;
}

/** The handler `sub` runs on `wf`, or `undefined` when the workflow declares
 *  no matching reactor / starter. */
export function subscriptionHandler(
  wf: WorkflowIR,
  sub: Pick<EventSubscriptionIR, "trigger" | "event" | "param">,
): SubscriptionHandler | undefined {
  if (sub.trigger === "on") {
    const on = (wf.subscriptions ?? []).find((o) => o.event === sub.event && o.param === sub.param);
    return on
      ? { statements: on.statements, saves: on.savesAtExit, correlation: on.correlation }
      : undefined;
  }
  const cr = (wf.creates ?? []).find(
    (c) => c.eventRef === sub.event && c.eventBinding === sub.param,
  );
  return cr
    ? { statements: cr.statements, saves: cr.savesAtExit, correlation: cr.correlation }
    : undefined;
}

/** True when the event-sourced `wf` both starts on `event` (an event-triggered
 *  `create`) and reacts to it (an `on`), so its one handler folds the stream
 *  once: the starter no-ops when the stream already exists. */
export function esStarterSharesEvent(wf: WorkflowIR, event: string): boolean {
  return (
    !!wf.eventSourced &&
    (wf.subscriptions ?? []).some((o) => o.event === event) &&
    (wf.creates ?? []).some(
      (c) => c.triggerKind === "event" && c.eventRef === event && !!c.eventBinding,
    )
  );
}

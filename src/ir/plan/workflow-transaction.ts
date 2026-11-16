// Whether a workflow's command body runs in one transaction, and the isolation
// level that transaction pins.
//
// A body runs in one transaction exactly when the workflow is declared
// `transactional`: the keyword is the only way a workflow gets one, so every
// boundary is visible in the source.  Two shapes need the whole body to roll
// back together — a `create` that answers an expected failure (`T or E`: an
// error answer rolls the command back) and a body that re-checks a held row's
// write scope (a row outside the scope fails the command after it may already
// have changed others) — and a workflow with either shape that does not say
// `transactional` is refused (`loom.workflow-implicit-transaction`).
//
// The isolation level is the workflow's own `transactional(<level>)`, else
// its context's state dataSource `isolationLevel:`.
//
// A workflow-level `emit` of a DURABLE event type (one a `retention: log |
// work` channel carries) is owed exactly when the workflow's writes commit.
// When the body runs in a transaction, its outbox row is therefore written by
// that transaction, before the commit, and only the rest of the workflow's
// events are dispatched after it.  Written after the commit instead, a crash
// in between loses an event whose writes already committed.

import type { BoundedContextIR, IsolationLevel, SystemIR, WorkflowIR } from "../types/loom-ir.js";
import { durableEventTypes } from "../util/channels.js";
import { resolveWorkflowIsolation } from "../util/resolve-datasource.js";
import { workflowEmits } from "../util/walk.js";
import { commandCreateEntryResult } from "../util/workflow-command-route.js";
import { bodyWriteScopeGuards, writeScopeContext } from "../util/write-scope-guards.js";

/** True when the workflow's command body runs in one transaction.  This is
 *  the transaction boundary every backend keeps: any other workflow commits
 *  each save on its own, so a failure keeps the rows saved before it. */
export function workflowRunsInTransaction(
  wf: WorkflowIR,
  _ctx: BoundedContextIR | undefined,
): boolean {
  return !!wf.transactional;
}

/** Why the workflow's body must roll back as a whole, or `undefined` when it
 *  need not: it answers an expected failure (`T or E`), or it re-checks a held
 *  row's write scope.  Such a workflow must be declared `transactional`.
 *  Without `ctx` (no owning context known) a write-scope re-check cannot be
 *  seen. */
export function workflowRequiresTransaction(
  wf: WorkflowIR,
  ctx: BoundedContextIR | undefined,
): "entry-result" | "write-scope-recheck" | undefined {
  if (commandCreateEntryResult(wf) !== undefined) return "entry-result";
  if (
    ctx !== undefined &&
    bodyWriteScopeGuards(wf.statements, writeScopeContext(wf.statements, ctx)).length > 0
  )
    return "write-scope-recheck";
  return undefined;
}

/** The isolation level the workflow's transaction pins, or `undefined` for the
 *  connection default.  `ctx` is the workflow's OWNING context (a merged
 *  multi-context deployable's context is not); without `ctx` and `sys` only
 *  the workflow's own level is known. */
export function workflowIsolation(
  wf: WorkflowIR,
  ctx: BoundedContextIR | undefined,
  sys: SystemIR | undefined,
): IsolationLevel | undefined {
  if (!wf.transactional) return undefined;
  return sys && ctx ? resolveWorkflowIsolation(wf, ctx, sys) : wf.isolation;
}

/** True when the workflow's command body runs in a transaction AND emits a
 *  durable event type, so the transaction must capture those events' outbox
 *  rows before it commits. */
export function workflowCapturesDurableEmits(wf: WorkflowIR, ctx: BoundedContextIR): boolean {
  if (!workflowRunsInTransaction(wf, ctx)) return false;
  const durable = durableEventTypes(ctx);
  return workflowEmits(wf.statements).some((st) => durable.has(st.eventName));
}

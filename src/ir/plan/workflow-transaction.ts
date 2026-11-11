// Whether a workflow's command body runs in one transaction, and the isolation
// level that transaction pins.
//
// A body runs in one transaction when the workflow is declared `transactional`,
// when its `create` answers an expected failure (`T or E` — an error answer
// rolls the whole command back), or when it re-checks a held row's write scope
// (a row outside the scope fails the command and rolls back what it already
// changed).
//
// Only a DECLARED `transactional` workflow pins an isolation level — its own
// `transactional(<level>)`, else its context's state dataSource
// `isolationLevel:`.  The implicit transaction above keeps the connection
// default, as does a backend that runs every request in a transaction anyway:
// the dataSource default is a property of the workflows that ask for a
// transaction, the same rule `loom.isolation-requires-transactional` enforces
// for the explicit form.

import type { BoundedContextIR, IsolationLevel, SystemIR, WorkflowIR } from "../types/loom-ir.js";
import { resolveWorkflowIsolation } from "../util/resolve-datasource.js";
import { commandCreateEntryResult } from "../util/workflow-command-route.js";
import { bodyWriteScopeGuards, writeScopeContext } from "../util/write-scope-guards.js";

/** True when the workflow's command body runs in one transaction. */
export function workflowRunsInTransaction(wf: WorkflowIR, ctx: BoundedContextIR): boolean {
  return (
    !!wf.transactional ||
    commandCreateEntryResult(wf) !== undefined ||
    bodyWriteScopeGuards(wf.statements, writeScopeContext(wf.statements, ctx)).length > 0
  );
}

/** The isolation level the workflow's transaction pins, or `undefined` for the
 *  connection default.  `ctx` is the workflow's OWNING context (a merged
 *  multi-context deployable's context is not); without `sys` only the
 *  workflow's own level is known. */
export function workflowIsolation(
  wf: WorkflowIR,
  ctx: BoundedContextIR,
  sys: SystemIR | undefined,
): IsolationLevel | undefined {
  if (!wf.transactional) return undefined;
  return sys ? resolveWorkflowIsolation(wf, ctx, sys) : wf.isolation;
}

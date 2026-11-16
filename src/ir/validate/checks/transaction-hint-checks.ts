// Advisories that make a transaction boundary visible where the author cannot
// see it from the source.  All are informational: the model is legal, and they
// print under the `Suggestions:` channel (`ADVISORY_CODES`).
//
//   loom.effect-in-transaction — a call that causes an outside effect (a
//     stored object, a queued job, a sent mail, a POST or any other non-GET
//     call to another service) runs inside a database transaction: a command
//     handler's body, a `transactional` workflow's command `create`, or a
//     reaction (`on` reactor, event-triggered `create`), which always runs in
//     one.  The effect is not undone if the transaction rolls back.  A read
//     is never flagged.
//
//   loom.effect-in-query — a query handler makes such a call.  A query is a
//     read: every caller that reads it repeats the effect.
//
//   loom.workflow-partial-commit — a non-transactional workflow that can
//     commit part of its work and then fail (a writing loop, or a writing
//     branch followed by more work).  The points come from the plan
//     (`workflowPartialCommits`).
//
// Two codes, not one, because the fix differs: an effect in a transaction
// moves to a reactor that runs after the commit; an effect in a query moves to
// a command.

import { diagMessage } from "../../../diagnostics/messages.js";
import {
  resourceCalls,
  workflowPartialCommits,
  workflowTransactionBodies,
} from "../../plan/index.js";
import { findVerb } from "../../resource-verbs.js";
import type { BoundedContextIR } from "../../types/loom-ir.js";
import type { LoomDiagnostic } from "./diagnostic.js";

/** Each resource call in the body that causes an outside effect, spelled as
 *  the author wrote it, without repeats: raw resource verbs first, then typed
 *  calls on another Loom service. */
function effectCalls(statements: Parameters<typeof resourceCalls>[0]): string[] {
  const { resourceOps, remoteApiOps } = resourceCalls(statements);
  const calls = [
    ...resourceOps
      .filter((op) => findVerb(op.resourceKind, op.verb)?.effect)
      .map((op) => `${op.resourceName}.${op.verb}(…)`),
    ...remoteApiOps
      .filter((op) => op.method.toUpperCase() !== "GET")
      .map((op) => `${op.resourceName} ${op.method.toUpperCase()} ${op.path}`),
  ];
  return [...new Set(calls)];
}

export function validateTransactionHints(ctx: BoundedContextIR, diags: LoomDiagnostic[]): void {
  for (const h of ctx.commandHandlers) {
    for (const call of effectCalls(h.statements)) {
      diags.push({
        severity: "warning",
        code: "loom.effect-in-transaction",
        message: diagMessage("loom.effect-in-transaction#command", {
          where: `commandHandler '${h.name}'`,
          call,
        }),
        source: `${ctx.name}/${h.name}`,
      });
    }
  }
  for (const h of ctx.queryHandlers) {
    for (const call of effectCalls(h.statements)) {
      diags.push({
        severity: "warning",
        code: "loom.effect-in-query",
        message: diagMessage("loom.effect-in-query", { name: h.name, call }),
        source: `${ctx.name}/${h.name}`,
      });
    }
  }
  for (const wf of ctx.workflows) {
    for (const body of workflowTransactionBodies(wf)) {
      const where = `workflow '${wf.name}' ${body.label}`;
      for (const call of effectCalls(body.statements)) {
        diags.push({
          severity: "warning",
          code: "loom.effect-in-transaction",
          message: body.reaction
            ? diagMessage("loom.effect-in-transaction#reaction", { where, call })
            : diagMessage("loom.effect-in-transaction#command", { where, call }),
          source: `${ctx.name}/${wf.name}`,
          origin: wf.origin,
        });
      }
    }
  }
  for (const wf of ctx.workflows) {
    const points = workflowPartialCommits(wf);
    if (points.length === 0) continue;
    diags.push({
      severity: "warning",
      code: "loom.workflow-partial-commit",
      message: diagMessage("loom.workflow-partial-commit", {
        name: wf.name,
        points: points
          .map(
            (p) => `a ${p.kind === "loop" ? "loop" : "branch"} saving ${p.aggregates.join(", ")}`,
          )
          .join("; "),
      }),
      source: `${ctx.name}/${wf.name}`,
      origin: wf.origin,
    });
  }
}

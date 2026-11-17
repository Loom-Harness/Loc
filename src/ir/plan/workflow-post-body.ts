// What a workflow's command route does after its body's statements, and in
// which order.
//
// The order is a decision every backend has to keep the same way, because each
// step's effect depends on the steps before it:
//
//   1. exit-saves             the bindings the body changed in memory are saved
//                             (`savesAtExit`), except a created aggregate the
//                             body already saved ahead of a loop or branch
//                             that writes rows against it
//                             (`parentFirstSaves`).
//   2. audit-flush            the audit rows staged by inline `audited`
//                             operation calls are written, after the saves
//                             they describe.
//   3. state-row-save         the workflow's own correlation row is saved, so a
//                             later `on` reactor for the same key routes to it.
//   4. provenance-flush       the lineage the saved aggregates accumulated is
//                             written, after the saves that produced it.
//   5. durable-capture        the outbox rows of the workflow's durable `emit`s
//                             are written inside the transaction, before the
//                             commit.
//   6. result                 the declared result is read while the body's
//                             bindings are in scope.
//   7. commit                 the transaction commits, or rolls back when the
//                             result is an expected-failure `error` answer.
//   8. aggregate-events-flush the operations' events, buffered while the
//                             transaction was open, are dispatched once it has
//                             committed — skipped when it rolled back.
//   9. entry-error-answer     an `error` answer returns here: a rolled-back
//                             command announces nothing.
//  10. emit-dispatch          the workflow's own (non-durable) `emit`s are
//                             dispatched last, after every write is durable.
//
// A step is listed only when it applies, so an envelope never asks "does this
// workflow need X" itself: it renders the list through its leaf table
// (`src/generator/_workflow/post-body.ts`) and owns only the spelling.  A
// backend whose framework performs a step implicitly (Spring's AFTER_COMMIT
// listeners, a repository whose save flushes provenance) renders that step's
// leaf as nothing; it never reorders or re-derives the list.

import type { BoundedContextIR, WorkflowIR } from "../types/loom-ir.js";
import { opHasProvSite } from "../util/prov-id.js";
import { workflowEmits } from "../util/walk.js";
import { commandCreateEntryResult, commandCreateResult } from "../util/workflow-command-route.js";
import { commandCreateCorrelationParam } from "../util/workflow-own-state.js";
import { callsAuditedOp } from "./workflow-needs.js";
import { parentFirstSaves } from "./workflow-parent-saves.js";
import type { SaveEntry } from "./workflow-saves.js";
import { workflowCapturesDurableEmits, workflowRunsInTransaction } from "./workflow-transaction.js";

/** One step of a workflow command route's post-body, in route order.  `entry`
 *  is true when the route answers an expected-failure result (`T or E`), whose
 *  `error` arm rolls the command back. */
export type PostBodyStep =
  | { readonly kind: "exit-saves"; readonly saves: readonly SaveEntry[] }
  | { readonly kind: "audit-flush" }
  | { readonly kind: "state-row-save" }
  | { readonly kind: "provenance-flush"; readonly saves: readonly SaveEntry[] }
  | { readonly kind: "durable-capture" }
  | { readonly kind: "result"; readonly entry: boolean }
  | { readonly kind: "commit"; readonly entry: boolean }
  | { readonly kind: "aggregate-events-flush"; readonly entry: boolean }
  | { readonly kind: "entry-error-answer" }
  | { readonly kind: "emit-dispatch" };

export type PostBodyStepKind = PostBodyStep["kind"];

/** Every step kind, in route order. */
export const POST_BODY_ORDER: readonly PostBodyStepKind[] = [
  "exit-saves",
  "audit-flush",
  "state-row-save",
  "provenance-flush",
  "durable-capture",
  "result",
  "commit",
  "aggregate-events-flush",
  "entry-error-answer",
  "emit-dispatch",
];

/** The exit saves whose aggregate accumulates provenance lineage: an
 *  aggregate has lineage to drain iff one of its operations has a provenanced
 *  write-site. */
export function provenancedExitSaves(wf: WorkflowIR, ctx: BoundedContextIR): SaveEntry[] {
  return wf.savesAtExit.filter((s) => {
    const agg = ctx.aggregates.find((a) => a.name === s.aggName);
    return !!agg && agg.operations.some((o) => opHasProvSite(o));
  });
}

/** The steps the workflow's command route runs after its body, in the order
 *  every backend runs them.  `ctx` is the workflow's owning context. */
export function workflowPostBody(wf: WorkflowIR, ctx: BoundedContextIR): PostBodyStep[] {
  const inTx = workflowRunsInTransaction(wf, ctx);
  const entry = commandCreateEntryResult(wf) !== undefined;
  const steps: PostBodyStep[] = [];
  const exitSaves = parentFirstSaves(wf.statements, wf.savesAtExit).remaining;
  if (exitSaves.length > 0) steps.push({ kind: "exit-saves", saves: exitSaves });
  if (callsAuditedOp(ctx, wf.statements)) steps.push({ kind: "audit-flush" });
  if (commandCreateCorrelationParam(wf)) steps.push({ kind: "state-row-save" });
  const prov = provenancedExitSaves(wf, ctx);
  if (prov.length > 0) steps.push({ kind: "provenance-flush", saves: prov });
  if (workflowCapturesDurableEmits(wf, ctx)) steps.push({ kind: "durable-capture" });
  if (commandCreateResult(wf)) steps.push({ kind: "result", entry });
  if (inTx) steps.push({ kind: "commit", entry });
  if (inTx) steps.push({ kind: "aggregate-events-flush", entry });
  if (entry) steps.push({ kind: "entry-error-answer" });
  if (workflowEmits(wf.statements).length > 0) steps.push({ kind: "emit-dispatch" });
  return steps;
}

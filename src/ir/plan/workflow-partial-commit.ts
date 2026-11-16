// Where a non-transactional workflow can commit part of its work and then
// fail.  Saves are derived (`workflow-saves.ts`): a straight-line body saves at
// its exit, after every guard has run, so a failing guard leaves nothing.  Two
// shapes commit earlier:
//
//   - a loop that writes saves at the end of each iteration, so a later
//     iteration's failure keeps the rows the earlier ones saved;
//   - a branch that writes saves at the end of the branch, so a failure in any
//     work that follows it (a later statement, or the exit saves) keeps what
//     the branch saved.
//
// A writing branch that is the body's last step, with no exit save after it,
// commits last: nothing runs after it that could fail, so it is not a partial
// commit.  A `transactional` workflow rolls back as a whole and has none, and
// so does a workflow with no command entry point: an event-triggered starter
// or a reactor always runs in one transaction.

import type { WorkflowIR, WorkflowStmtIR } from "../types/loom-ir.js";
import { emitsCommandRoute } from "../util/workflow-command-route.js";
import { nestedSaveScopes } from "./workflow-saves.js";

/** One place a workflow can commit before a later step fails. */
export interface PartialCommit {
  readonly kind: "loop" | "branch";
  /** The aggregates the loop iteration or branch saves, in source order. */
  readonly aggregates: readonly string[];
}

/** The points where the workflow's command body can commit part of its work,
 *  in source order; empty for a `transactional` workflow, for one with no
 *  command entry point, and for a body that saves only at its exit. */
export function workflowPartialCommits(wf: WorkflowIR): PartialCommit[] {
  if (wf.transactional || !emitsCommandRoute(wf)) return [];
  const out: PartialCommit[] = [];
  const visit = (list: readonly WorkflowStmtIR[], workAfter: boolean): void => {
    list.forEach((st, i) => {
      const rest = workAfter || i < list.length - 1;
      for (const scope of nestedSaveScopes(st)) {
        const aggregates = [...new Set(scope.saves.map((s) => s.aggName))];
        if (aggregates.length > 0 && (scope.kind === "iteration" || rest)) {
          out.push({ kind: scope.kind === "iteration" ? "loop" : "branch", aggregates });
        }
        // Inside a loop, the next iteration is work after every statement.
        visit(scope.body, scope.kind === "iteration" || rest);
      }
    });
  };
  visit(wf.statements, wf.savesAtExit.length > 0);
  return out;
}

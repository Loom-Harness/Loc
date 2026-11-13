// ---------------------------------------------------------------------------
// Where a workflow form goes once its run succeeds.
//
// A workflow whose `create` declares a reference result (`create(…): Run id`)
// answers its start route with that id (`commandCreateResult`, the contract
// every backend's command route follows).  The form then opens the record it
// created; a workflow with no such result lands on the workflows index.
// ---------------------------------------------------------------------------

import type { WorkflowIR } from "../../ir/types/loom-ir.js";
import { commandCreateResult } from "../../ir/util/workflow-command-route.js";
import { routeSegmentFor } from "../../util/storage-names.js";

/** The route segment of the aggregate a successful run created, when the
 *  workflow's start route answers with its id. */
export function workflowResultSegment(wf: WorkflowIR): string | undefined {
  const t = commandCreateResult(wf)?.type;
  return t?.kind === "id" ? routeSegmentFor(t.targetName) : undefined;
}

// What a workflow's command route answers when its create returns the workflow
// itself (`create(…): <Wf> { …; return this }`): the instance state projected
// through `instanceWireShape`, not a scalar.  Every backend's route, its
// response type and the validators that refuse an unaddressable `return this`
// ask the same question, so it is answered once here.

import type { TypeIR, WorkflowIR } from "../types/loom-ir.js";
import { commandCreateResult } from "../util/workflow-command-route.js";

/** True when `t` names the workflow itself — the `return this` result type. */
export function isWorkflowSelfType(wf: Pick<WorkflowIR, "name">, t: TypeIR | undefined): boolean {
  return t?.kind === "entity" && t.name === wf.name;
}

/** True when the workflow's command route answers the workflow itself. */
export function commandCreateReturnsSelf(wf: WorkflowIR): boolean {
  return isWorkflowSelfType(wf, commandCreateResult(wf)?.type);
}

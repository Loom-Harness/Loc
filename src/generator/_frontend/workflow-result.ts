// ---------------------------------------------------------------------------
// Where a workflow form goes once its run succeeds.
//
// A workflow whose `create` declares a reference result (`create(…): Run id`)
// answers its start route with that id (`commandCreateResult`, the contract
// every backend's command route follows).  The form then opens the record it
// created; a workflow with no such result lands on the workflows index.  The
// rule lives at IR level so the Frontend Contract ships the same answer.
// ---------------------------------------------------------------------------

export { workflowResultSegment } from "../../ir/util/workflow-command-route.js";

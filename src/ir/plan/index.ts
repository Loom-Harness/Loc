// `src/ir/plan/` — derived views over the enriched IR.
//
// A plan is a backend-neutral fact about the model that more than one
// consumer needs: the IR validators (phase ⑦) and the per-platform
// generators (phase ⑧).  This directory is a library of pure functions, not
// a pipeline phase; the compiler still runs ten phases.
//
// Rules every module here keeps:
//
//   - Computed on demand.  A plan is a pure function of IR nodes.  It is
//     never written back onto an IR node or cached on one ("Derive, don't
//     stamp").  Callers ask for it where they need it.
//   - Platform-neutral.  A plan never branches on a backend, frontend or
//     framework name.  A fact that differs per target belongs to that
//     target's emitter or its platform descriptor, not here.
//   - Downstream of enrichment.  A module here imports only `ir/types/`,
//     `ir/util/`, `ir/enrich/`, `src/util/` and its siblings in `ir/plan/`.
//     It never imports `generator/`, `platform/`, `system/` or `language/`,
//     and `ir/lower/` / `ir/enrich/` never import it.
//   - One implementation per fact.  A generator that needs a fact this
//     layer provides imports it instead of recomputing it.
//
// `test/platform/pipeline-layering.test.ts` enforces the import rules.

export { hasDurableEvents } from "./context-events.js";
export { eventLogTable, foldedEventNames, workflowStreamType } from "./event-log.js";
export {
  canOpLadder,
  GATE_ORDER,
  type GateCheck,
  type GateStep,
  gateRank,
  gateReadsParam,
  gateReadsRow,
  operationLadder,
} from "./gate-ladder.js";
export { lookupOp } from "./operation-lookup.js";
export {
  assignsFoldKey,
  type FoldRowSeed,
  type FoldRowZero,
  type FoldStep,
  foldRowSeeds,
  foldRowUnseeded,
  foldSteps,
} from "./projection-fold.js";
export {
  admittedReferences,
  type ContainStep,
  type RefScope,
  refScopeOf,
  type ScopedReference,
  scopedReferences,
} from "./ref-scope.js";
export { domainFindShape } from "./repo-find-shape.js";
export { routedPolymorphicRead } from "./repo-polymorphic.js";
export { clientSortTieBreak, singleReadOrder } from "./repo-read.js";
export { type RepoNeed, reposNeeded } from "./repos-needed.js";
export {
  domainServiceReadPorts,
  type ReadPort,
  serviceOpReadPorts,
  serviceReadPorts,
  servicesCalled,
  withReadPortRepos,
} from "./service-read-ports.js";
export { requiredStateFields, type StateZero, stateZero } from "./state-zero.js";
export { valueObjectBorne, valueObjectParams } from "./value-object-params.js";
export {
  type RemoteApiOpRef,
  type ResourceCalls,
  type ResourceOpRef,
  resourceCalls,
} from "./workflow-calls.js";
export { dereferencedLoads } from "./workflow-loads.js";
export { namesBound, namesUsed, refsRead } from "./workflow-names.js";
export {
  auditedOpCallAggregates,
  callsAuditedOp,
  handlerNeedsCurrentUser,
  workflowNeedsCurrentUser,
} from "./workflow-needs.js";
export { commandCreateReturnsSelf, isWorkflowSelfType } from "./workflow-result.js";
export {
  liveLetNames,
  nestedSaveScopes,
  nestedSaves,
  type SaveEntry,
  type SaveScope,
} from "./workflow-saves.js";
export {
  eventSourcedWorkflows,
  hasStateRow,
  observableWorkflows,
  stateRowWorkflows,
} from "./workflow-sets.js";
export {
  esStarterSharesEvent,
  type SubscriptionHandler,
  subscriptionHandler,
} from "./workflow-subscriptions.js";
export {
  workflowCapturesDurableEmits,
  workflowIsolation,
  workflowRunsInTransaction,
} from "./workflow-transaction.js";

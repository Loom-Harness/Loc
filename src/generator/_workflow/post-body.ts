import { POST_BODY_ORDER, type PostBodyStep, type PostBodyStepKind } from "../../ir/plan/index.js";

// ---------------------------------------------------------------------------
// The post-body leaf seam: a workflow command route's steps after its body
// statements (`workflowPostBody`, `src/ir/plan/workflow-post-body.ts`),
// rendered through one leaf per step kind.
//
// The plan owns which steps run and in which order; a backend's envelope owns
// only how a step is spelled.  A backend whose framework performs a step
// implicitly renders that step's leaf as nothing — it never reorders, skips
// or adds a step on its own.  A new step kind is a required member of every
// backend's leaf table, so it fails to type-check there and nowhere else.
// ---------------------------------------------------------------------------

type StepOf<K extends PostBodyStepKind> = Extract<PostBodyStep, { kind: K }>;

/** A step kind's leaf-method name: `exit-saves` → `exitSaves`. */
type LeafName<K extends string> = K extends `${infer Head}-${infer Rest}`
  ? `${Head}${Capitalize<LeafName<Rest>>}`
  : K;

/** One leaf per post-body step kind, each returning the step's lines. */
export type PostBodyLeaves = {
  readonly [K in PostBodyStepKind as LeafName<K>]: (step: StepOf<K>) => string[];
};

/** The leaf a step renders through. */
function leafFor(step: PostBodyStep, leaves: PostBodyLeaves): string[] {
  switch (step.kind) {
    case "exit-saves":
      return leaves.exitSaves(step);
    case "audit-flush":
      return leaves.auditFlush(step);
    case "state-row-save":
      return leaves.stateRowSave(step);
    case "provenance-flush":
      return leaves.provenanceFlush(step);
    case "durable-capture":
      return leaves.durableCapture(step);
    case "result":
      return leaves.result(step);
    case "commit":
      return leaves.commit(step);
    case "aggregate-events-flush":
      return leaves.aggregateEventsFlush(step);
    case "entry-error-answer":
      return leaves.entryErrorAnswer(step);
    case "emit-dispatch":
      return leaves.emitDispatch(step);
    default: {
      const _exhaustive: never = step;
      return _exhaustive;
    }
  }
}

/** The lines of `steps`, in plan order, each spelled by its leaf. */
export function renderPostBody(steps: readonly PostBodyStep[], leaves: PostBodyLeaves): string[] {
  return steps.flatMap((s) => leafFor(s, leaves));
}

/** `steps` split where step `kind` sits in route order: the steps that run
 *  before it, and the steps from its position on (whether or not `kind`
 *  itself is listed).  An envelope wraps a run of steps in a construct of its
 *  own (a transaction callback, an execution frame) at a plan boundary
 *  instead of re-listing the steps on either side of it. */
export function splitPostBody(
  steps: readonly PostBodyStep[],
  kind: PostBodyStepKind,
): [PostBodyStep[], PostBodyStep[]] {
  const at = POST_BODY_ORDER.indexOf(kind);
  const before = steps.filter((s) => POST_BODY_ORDER.indexOf(s.kind) < at);
  return [before, steps.slice(before.length)];
}

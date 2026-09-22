// -------------------------------------------------------------------------
// The `test e2e` WORKFLOW ACCESSOR — `api.<wf>.run(…)` / `.instances()` /
// `.instance(key)` (M-T5.36 §1, finding F5).
//
// A `test e2e` body could reach aggregates and folded projections, and nothing
// else.  The transactional orchestration tier — where multi-aggregate
// consistency bugs live — had no runtime test path at all from the DSL:
//
//     $ node bin/cli.js parse workflow-create-state.ddd
//     loom.e2e-unknown-aggregate …: e2e: unknown aggregate 'api.fulfillment'
//       on this deployable. Available aggregates: orders.
//
// …which is not merely a refusal but a MISLEADING one: it names a workflow an
// unknown *aggregate*, so the reading is "typo" rather than "this tier is
// unreachable".  Both halves are fixed here — the three verbs resolve, and the
// residual unknown-slug message names the deployable's workflows too.
//
// NO BACKEND NEEDED A NEW ROUTE.  All five already mount the command POST and
// the two instance reads; python states it plainest
// (`APIRouter(prefix="/workflows")`, `src/generator/python/workflows-builder.ts`),
// and hono / dotnet / java / elixir agree.  This was a test-DSL REACH problem,
// which is why the whole feature is a resolver plus one emitter arm.
//
// The lookup lives here, at IR level, because THREE call sites must agree about
// it or the compiler contradicts itself: the name-resolution check
// (`test-checks.ts`, phase ④), the route-contract check (`e2e-route-checks.ts`,
// phase ⑦) and the emitter (`system/e2e-render.ts`, phase ⑧).  A second copy of
// the match is exactly how a validator and an emitter drift apart — the
// `api.workflows.<name>` split brain (a validator arm with no renderer arm,
// which crashed `generate system` on a source `parse` had just certified) is
// the cautionary case, and `routed-handler.ts` is the precedent for the fix.
// -------------------------------------------------------------------------

import { lowerFirst, snake } from "../../util/naming.js";
import type { BoundedContextIR, WorkflowIR } from "../types/loom-ir.js";

/** The three verbs a workflow answers in a `test e2e` body.
 *
 *  `.instance(key)` rather than `.byKey(key)`, which is what a folded
 *  projection's single-row read is called.  The plural `.instances()` has to
 *  exist anyway, and `byKey`/`instances` sitting next to each other reads worse
 *  than the pair — and a saga instance is not a read-model row (design §1,
 *  decision 7). */
export const E2E_WORKFLOW_VERBS: readonly string[] = ["run", "instances", "instance"];

/** Resolve `<slug>` in `api.<slug>.<verb>(…)` to a workflow of one of the
 *  deployable's hosted contexts.
 *
 *  Accepts both spellings the reserved `api.workflows.<name>` arm already
 *  accepts (`lowerFirst` and `snake`), so `api.scheduleVisit.run(…)` and
 *  `api.schedule_visit.run(…)` name the same workflow. */
export function findWorkflowBySlug(
  slug: string,
  contexts: readonly BoundedContextIR[],
): WorkflowIR | undefined {
  for (const c of contexts) {
    for (const w of c.workflows) {
      if (lowerFirst(w.name) === slug || snake(w.name) === slug) return w;
    }
  }
  return undefined;
}

/** The URL segment the backends mount a workflow's routes under — `POST
 *  /api/workflows/<slug>`, `GET /api/workflows/<slug>/instances[/{id}]`.
 *  `snake(wf.name)` on every backend. */
export function workflowRouteSlug(wf: WorkflowIR): string {
  return snake(wf.name);
}

/** Every workflow slug an e2e body of THESE contexts may spell, for the
 *  "unknown slug" message — so a user who wrote `api.fulfilment.run(…)` is told
 *  `fulfillment` exists rather than that no aggregate does. */
export function workflowSlugHints(contexts: readonly BoundedContextIR[]): string[] {
  return [...new Set(contexts.flatMap((c) => c.workflows.map((w) => lowerFirst(w.name))))].sort();
}

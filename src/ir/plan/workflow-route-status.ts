// The non-2xx statuses a workflow's command route declares.
//
// The set is the shared `errorStatuses("workflow")` table — 403 only when the
// body is guarded, the not-found rung only when the body can answer it, each
// rung resolved through the context's `httpStatus` map — plus, for an
// expected-failure result (`T or E`), the status each `error` arm answers at
// (its `httpStatus` override, else its stdlib default).  The runtime answers
// those same statuses, so a backend that resolved the set any other way would
// publish an OpenAPI document its own server contradicts.

import type { BoundedContextIR, WorkflowIR } from "../types/loom-ir.js";
import { workflowCanAnswerNotFound, workflowIsGuarded } from "../types/queries.js";
import { errorStatuses } from "../util/openapi-errors.js";
import { errorVariantResponse, wireStatusResolver } from "../util/wire-policy.js";
import { commandCreateEntryResult, commandCreateResult } from "../util/workflow-command-route.js";

/** The rung resolver every route of `ctx` threads into `errorStatuses`. */
export function routeStatusResolver(
  ctx: Pick<BoundedContextIR, "structuralErrorStatuses">,
): (name: string) => number {
  return wireStatusResolver(ctx.structuralErrorStatuses);
}

/** The statuses the workflow's expected-failure result answers its `error`
 *  arms at, ascending and de-duplicated; empty without an expected-failure
 *  result. */
export function workflowEntryErrorStatuses(wf: WorkflowIR, ctx: BoundedContextIR): number[] {
  const result = commandCreateResult(wf);
  if (!commandCreateEntryResult(wf) || result?.type.kind !== "union") return [];
  const variants = result.type.variants;
  const errorName = (v: (typeof variants)[number]): string | undefined =>
    v.kind === "entity" && v.declKind === "error" ? v.name : undefined;
  // An all-error union has no success body to split from, so its arms answer
  // inside the 200 like any other union.
  if (variants.every((v) => errorName(v) !== undefined)) return [];
  const statuses = variants.flatMap((v) => {
    const name = errorName(v);
    return name === undefined ? [] : [errorVariantResponse(name, ctx.errorStatusOverrides).status];
  });
  return [...new Set(statuses)].sort((a, b) => a - b);
}

/** Every non-2xx status the workflow's command route declares, ascending and
 *  de-duplicated. */
export function workflowRouteErrorStatuses(wf: WorkflowIR, ctx: BoundedContextIR): number[] {
  const base = errorStatuses("workflow", workflowIsGuarded(wf), routeStatusResolver(ctx), {
    readsAggregate: workflowCanAnswerNotFound(wf, ctx),
  });
  return [...new Set([...base, ...workflowEntryErrorStatuses(wf, ctx)])].sort((a, b) => a - b);
}

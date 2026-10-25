/** The paged-run body shape — the one `paged` queryHandler body every backend
 *  emits (paged-queryHandler):
 *
 *    queryHandler H(...): <Agg> paged { let r = Repo.run(<Criterion | Retrieval>(args)); return r }
 *
 *  i.e. the returned value is a plain `let`-ref bound to a TOP-LEVEL `repo-run`
 *  statement — over a criterion (`synthCriterion`: `Repo.run(<Criterion>)` /
 *  `Repo.findAll(<Criterion>)`) or a named `retrieval` (`Repo.run(<Retrieval>)`,
 *  whose `sort:` becomes the page's default order).  Shared by the enrich pass
 *  (which synthesises the paged FIND for this shape), the phase-⑦ refusal
 *  `loom.paged-query-handler-shape` (which rejects every other body up front)
 *  and the five `explicit-handlers` emitters, so the gate, the synthesis and
 *  the emitters can't disagree about the shape.  Lives in `ir/util/` because
 *  enrich, validate and generator consumers all read it. */

import { pagedSortDefault } from "../stdlib/generics.js";
import {
  type BoundedContextIR,
  exprUsesCurrentUser,
  type QueryHandlerIR,
  type WorkflowStmtIR,
} from "../types/loom-ir.js";

export type PagedRunStmt = Extract<WorkflowStmtIR, { kind: "repo-run" }>;

/** The `repo-run` statement a paged queryHandler's `return` names, when the body
 *  has the supported shape; `undefined` otherwise. */
export function pagedRunStmt(
  h: Pick<QueryHandlerIR, "statements" | "returnValue">,
): PagedRunStmt | undefined {
  const retName = h.returnValue?.kind === "ref" ? h.returnValue.name : undefined;
  if (retName === undefined) return undefined;
  return h.statements.find((s): s is PagedRunStmt => s.kind === "repo-run" && s.name === retName);
}

/** `pagedRunStmt` for an emitter, which runs after phase ⑦ refused every other
 *  shape (`loom.paged-query-handler-shape`) — so a miss is an internal error. */
export function requirePagedRunStmt(
  h: Pick<QueryHandlerIR, "name" | "statements" | "returnValue">,
  ctxName: string,
): PagedRunStmt {
  const run = pagedRunStmt(h);
  if (!run) {
    throw new Error(
      `internal: paged queryHandler '${h.name}' in '${ctxName}' does not match the ` +
        "supported `let r = Repo.run(<Criterion | Retrieval>(args)); return r` shape. Please file a bug.",
    );
  }
  return run;
}

/** The `sort` query value a paged-run handler's route defaults to — the
 *  synthesized paged find's `pagedSortDefault` (`""` when the run is over a
 *  retrieval that declares a `sort:`, so its order is the unsorted request's;
 *  `"id"` otherwise). */
export function pagedRunSortDefault(
  h: Pick<QueryHandlerIR, "name" | "statements" | "returnValue">,
  ctx: Pick<BoundedContextIR, "repositories">,
): string {
  const run = pagedRunStmt(h);
  const find = run
    ? ctx.repositories
        .find((r) => r.aggregateName === run.aggName)
        ?.finds.find((f) => f.name === pagedRunFindName(run))
    : undefined;
  return find ? pagedSortDefault(find) : "id";
}

/** The `requires` gates a paged-run handler's body opens with — rendered by
 *  every backend's paged route BEFORE the run, a 403 on failure.  A body
 *  statement is the handler's only gate surface (a handler carries no header
 *  `requires`), and `scaffoldPaged(requires: <Policy>)` splices exactly one. */
export function pagedRunGates(
  h: Pick<QueryHandlerIR, "statements">,
): Extract<WorkflowStmtIR, { kind: "requires" }>[] {
  return h.statements.filter(
    (s): s is Extract<WorkflowStmtIR, { kind: "requires" }> => s.kind === "requires",
  );
}

/** True when a paged-run body holds only what the paged emitters render — its
 *  `requires` gates and the run.  Anything else would be dropped silently. */
export function pagedRunBodyIsPure(h: Pick<QueryHandlerIR, "statements" | "returnValue">): boolean {
  const run = pagedRunStmt(h);
  return h.statements.every((s) => s.kind === "requires" || s === run);
}

/** True when a paged-run handler's gates read `currentUser` — the paged route
 *  must then bind the actor before the read. */
export function pagedRunGatesUseCurrentUser(h: Pick<QueryHandlerIR, "statements">): boolean {
  return pagedRunGates(h).some((g) => exprUsesCurrentUser(g.expr));
}

/** The paged FIND a paged-run handler calls — the repository method enrich
 *  synthesizes for it.  A criterion run already names it (`findAllBy<Criterion>`,
 *  shared with `Repo.findAll(<Criterion>)`); a retrieval run gets
 *  `page<Retrieval>`, beside the unpaged `run<Retrieval>` the retrieval itself
 *  emits. */
export function pagedRunFindName(run: PagedRunStmt): string {
  return run.synthCriterion ? run.retrievalName : `page${run.retrievalName}`;
}

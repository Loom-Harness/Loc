/** The paged-run body shape — the one `paged` queryHandler body every backend
 *  emits (paged-queryHandler):
 *
 *    queryHandler H(...): <Agg> paged { let r = Repo.run(<Criterion>(args)); return r }
 *
 *  i.e. the returned value is a plain `let`-ref bound to a TOP-LEVEL `repo-run`
 *  statement carrying a `synthCriterion` (`Repo.run(<Criterion>)` /
 *  `Repo.findAll(<Criterion>)`).  Shared by the enrich pass (which synthesises
 *  the paged FIND for this shape) and the phase-⑦ refusal
 *  `loom.paged-query-handler-shape` (which rejects every other body up front),
 *  so the gate and the synthesis can't disagree about what the five
 *  `explicit-handlers` emitters accept.  Lives in `ir/util/` because both an
 *  enrich and a validate consumer read it. */

import type { QueryHandlerIR, WorkflowStmtIR } from "../types/loom-ir.js";

export type PagedRunStmt = Extract<WorkflowStmtIR, { kind: "repo-run" }>;

/** The `repo-run` statement a paged queryHandler's `return` names, when the body
 *  has the supported shape; `undefined` otherwise. */
export function pagedRunStmt(
  h: Pick<QueryHandlerIR, "statements" | "returnValue">,
): PagedRunStmt | undefined {
  const retName = h.returnValue?.kind === "ref" ? h.returnValue.name : undefined;
  if (retName === undefined) return undefined;
  return h.statements.find(
    (s): s is PagedRunStmt => s.kind === "repo-run" && !!s.synthCriterion && s.name === retName,
  );
}

/** The `repo-run` over a NAMED retrieval (`Repo.run(<Retrieval>(args))`, no
 *  `synthCriterion`) that the handler's `return` names — the most common
 *  near-miss of the paged-run shape, reported with a retrieval-specific hint. */
export function pagedRetrievalRunStmt(
  h: Pick<QueryHandlerIR, "statements" | "returnValue">,
): PagedRunStmt | undefined {
  const retName = h.returnValue?.kind === "ref" ? h.returnValue.name : undefined;
  if (retName === undefined) return undefined;
  return h.statements.find(
    (s): s is PagedRunStmt => s.kind === "repo-run" && !s.synthCriterion && s.name === retName,
  );
}

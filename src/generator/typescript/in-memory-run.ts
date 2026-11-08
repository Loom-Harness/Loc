// The `run<Retrieval>` repository method for a carrier whose state is not
// queryable columns — the `shape: document` blob and the `persistedAs:
// eventLog` fold — on both node persistence adapters (drizzle and MikroORM).
//
// A criterion read (`Repo.all(C(…))`, `Repo.find(C(…))`, `Repo.run(R(…))`)
// calls `run<Retrieval>` whatever the aggregate's saving shape, so every
// repository must define it.  The relational runner pushes the `where`, `sort`
// and page into SQL (`repository-find-builder.ts` `runMethod`); these carriers
// have nothing to push into, so the runner evaluates the same contract over
// the loaded instances: the capability conjunct first, then the retrieval's
// `where`, then the `sort:` terms, then the call-site `offset`/`limit`.  The
// load is ordered by id and `Array.prototype.sort` is stable, so ties keep the
// id order the relational `ORDER BY …, id` tie-break gives.
//
// Only the LOAD differs between the two adapters and the two carriers; the
// caller supplies it as lines that bind every candidate instance to `all`.

import type {
  EnrichedAggregateIR,
  EnrichedBoundedContextIR,
  RetrievalIR,
} from "../../ir/types/loom-ir.js";
import { exprUsesCurrentUser } from "../../ir/types/loom-ir.js";
import { lines } from "../../util/code-builder.js";
import { escapeTsIdent, upperFirst } from "../../util/naming.js";
import { renderHonoStoreLogCall } from "../_obs/render-hono.js";
import { findParamBindings, pagedLocalNames } from "./paged-locals.js";
import { renderTsExpr } from "./render-expr.js";
import {
  aggregateRetrievals,
  inMemoryFieldCompare,
  tsParamType,
} from "./repository-document-builder.js";

/** The runner's own names — its call-site `page` parameter and every local
 *  its body or its load declares — named off the retrieval's params so a
 *  param called `all`, `rows` or `page` cannot be redeclared. */
function runLocals(params: readonly { name: string }[]): RunLocals {
  return pagedLocalNames(
    ["page", "all", "rows", "em", "result", "start", "paged"] as const,
    findParamBindings(params),
  );
}

/** The names a `run<Retrieval>` load binds (`all`) or declares on the way
 *  (`rows`, `em`). */
export type RunLocals = Record<
  "page" | "all" | "rows" | "em" | "result" | "start" | "paged",
  string
>;

/** `async run<Retrieval>(…params, page?)` filtering in memory.
 *
 *  `loadLines(names)` binds every candidate instance to the local named
 *  `names.all`, declaring any other local under its name in `names`.
 *  `capability` is the carrier's in-app read-filter conjunct over `x` (already
 *  narrowed by the call sites' `ignoring` clauses), or null.  A capability or
 *  criterion that names `currentUser` reads the ambient principal — the call
 *  site passes none, exactly as for the relational runner. */
export function inMemoryRunMethod(
  agg: EnrichedAggregateIR,
  retrieval: RetrievalIR,
  opts: {
    loadLines: (names: RunLocals) => readonly string[];
    capability?: string | null;
  },
): string {
  const methodName = `run${upperFirst(retrieval.name)}`;
  const L = runLocals(retrieval.params);
  const params = [
    ...retrieval.params.map((p) => `${escapeTsIdent(p.name)}: ${tsParamType(p.type)}`),
    `${L.page}?: { offset?: number; limit?: number }`,
  ].join(", ");
  const conds = [opts.capability, renderTsExpr(retrieval.where, { thisName: "x" })]
    .filter((c): c is string => c != null && c !== "")
    .map((c) => `(${c})`);
  const bindPrincipal =
    /\bcurrentUser\./.test(opts.capability ?? "") || exprUsesCurrentUser(retrieval.where);
  // One comparator over every `sort:` term, each negated for `desc`; the
  // first non-zero term decides.  Only the first path segment is a column
  // (nested paths are gated by validateRetrievals, as on the SQL runner).
  const compare = retrieval.sort
    .map((t) => {
      const cmp = `(${inMemoryFieldCompare(agg, t.path[0]!.name)})`;
      return t.direction === "desc" ? `-${cmp}` : cmp;
    })
    .join(" || ");
  return lines(
    `  async ${methodName}(${params}): Promise<${agg.name}[]> {`,
    bindPrincipal && `    const currentUser = requireCurrentUser();`,
    ...opts.loadLines(L),
    `    const ${L.result} = ${L.all}.filter((x) => ${conds.join(" && ")});`,
    compare !== "" && `    ${L.result}.sort((a, b) => ${compare});`,
    `    const ${L.start} = ${L.page}?.offset ?? 0;`,
    `    const ${L.paged} = ${L.page}?.limit === undefined ? ${L.result}.slice(${L.start}) : ${L.result}.slice(${L.start}, ${L.start} + ${L.page}.limit);`,
    `    ${renderHonoStoreLogCall("findExecuted", `aggregate: "${agg.name}", find: "${methodName}", rows: ${L.paged}.length`)}`,
    `    return ${L.paged};`,
    `  }`,
  );
}

/** One `run<Retrieval>` per context retrieval over a `persistedAs: eventLog`
 *  aggregate, on either adapter.  A stream has no state columns, so the runner
 *  filters the folded aggregates — the same `_loadAll()` fold the declared
 *  finds read (ordered by stream id).  A tenant-scoped stream's tenancy is
 *  already applied by that load (its default stream scope), so there is no
 *  conjunct to re-apply. */
export function eventLogRunMethods(
  agg: EnrichedAggregateIR,
  ctx: EnrichedBoundedContextIR,
): string[] {
  return aggregateRetrievals(agg, ctx).map((r) =>
    inMemoryRunMethod(agg, r, {
      loadLines: ({ all }) => [`    const ${all} = await this._loadAll();`],
    }),
  );
}

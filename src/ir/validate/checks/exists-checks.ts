// `exists <Agg> as <row> where …` — the existential quantifier (#3346).
//
//   loom.exists-outside-query         the quantifier sits in a position that is
//                                     not compiled into a query (an operation
//                                     body, a `requires` gate, a derived, a
//                                     page …); `#projection` for a projection
//                                     `where`, which has its own renderers
//   loom.exists-cross-context         the quantified aggregate is not declared in
//                                     the enclosing context (an EXISTS reads the
//                                     same database as the row it filters)
//   loom.exists-unsupported#self      the quantified aggregate IS the filtered
//                                     row's aggregate
//   loom.exists-unsupported#storage   either side is not a plain relational state
//                                     table (event-sourced, document/embedded
//                                     shape, an inheritance hierarchy)
//
// Every backend renders the quantifier as a correlated `EXISTS (SELECT 1 FROM
// <table> WHERE …)` subquery, so it is a QUERY predicate: the sites below are the
// ones a backend compiles into SQL.  A criterion body is admitted because a
// criterion is inlined at its use site, and that use site is checked here too —
// the same criterion inlined into an operation `when` guard is refused there.

import { diagMessage } from "../../../diagnostics/messages.js";
import type {
  AggregateIR,
  BoundedContextIR,
  EnrichedLoomModel,
  ExprIR,
} from "../../types/loom-ir.js";
import { allContexts } from "../../types/loom-ir.js";
import { forEachModelExpr } from "../../util/model-exprs.js";
import { walkExprDeep } from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";

type ExistsIR = Extract<ExprIR, { kind: "exists" }>;

/** The expression sites a backend compiles into a query predicate. */
const QUERY_SITES: ReadonlySet<string> = new Set([
  "AggregateIR.contextFilters",
  "AggregateIR.contextFilterRefs",
  "AggregateIR.writeScopeFilter",
  "PolicyRowRuleIR.where",
  "CriterionIR.body",
  "FindIR.filter",
  "FindIR.criterionRef",
  "RetrievalIR.where",
  "RetrievalIR.criterionRef",
]);

/** Query sites whose renderers carry no EXISTS arm. */
const PROJECTION_SITES: ReadonlySet<string> = new Set([
  "ProjectionQueryIR.filter",
  "ProjectionQueryIR.criterionRef",
]);

/** Why `agg` cannot take part in an EXISTS subquery, or undefined when it can. */
function storageObstacle(agg: AggregateIR, role: string): string | undefined {
  if (agg.persistedAs === "eventLog") return `${role} '${agg.name}' is event-sourced`;
  if (agg.savingShape && agg.savingShape !== "relational")
    return `${role} '${agg.name}' is stored with 'shape: ${agg.savingShape}'`;
  if (agg.isAbstract || agg.extendsAggregate)
    return `${role} '${agg.name}' is part of an inheritance hierarchy`;
  return undefined;
}

function existsNodes(e: ExprIR | undefined): ExistsIR[] {
  const out: ExistsIR[] = [];
  walkExprDeep(e, (x) => {
    if (x.kind === "exists") out.push(x);
  });
  return out;
}

export function validateExistsQuantifiers(loom: EnrichedLoomModel, diags: LoomDiagnostic[]): void {
  // 1. Position — every reachable expression, with the site it hangs off.
  forEachModelExpr(loom, ({ expr, source, site }) => {
    if (expr.kind !== "exists") return;
    if (QUERY_SITES.has(site)) return;
    const projection = PROJECTION_SITES.has(site);
    diags.push({
      severity: "error",
      code: "loom.exists-outside-query",
      message: projection
        ? diagMessage("loom.exists-outside-query#projection", { aggregate: expr.aggregate, source })
        : diagMessage("loom.exists-outside-query", { aggregate: expr.aggregate, source }),
      source,
      origin: expr.origin,
    });
  });

  // 2. The quantified aggregate, against the context and the filtered row.
  for (const ctx of allContexts(loom)) checkContext(ctx, diags);
}

function checkContext(ctx: BoundedContextIR, diags: LoomDiagnostic[]): void {
  const byName = new Map(ctx.aggregates.map((a) => [a.name, a]));
  const reported = new WeakSet<ExistsIR>();
  const check = (e: ExprIR | undefined, host: AggregateIR | undefined, source: string): void => {
    for (const x of existsNodes(e)) {
      if (reported.has(x)) continue;
      const target = byName.get(x.aggregate);
      if (!target) {
        reported.add(x);
        diags.push({
          severity: "error",
          code: "loom.exists-cross-context",
          message: diagMessage("loom.exists-cross-context", {
            aggregate: x.aggregate,
            context: ctx.name,
            source,
          }),
          source,
          origin: x.origin,
        });
        continue;
      }
      if (host && host.name === target.name) {
        reported.add(x);
        diags.push({
          severity: "error",
          code: "loom.exists-unsupported",
          message: diagMessage("loom.exists-unsupported#self", { aggregate: x.aggregate, source }),
          source,
          origin: x.origin,
        });
        continue;
      }
      const why =
        storageObstacle(target, "the quantified aggregate") ??
        (host ? storageObstacle(host, "the filtered aggregate") : undefined);
      if (why) {
        reported.add(x);
        diags.push({
          severity: "error",
          code: "loom.exists-unsupported",
          message: diagMessage("loom.exists-unsupported#storage", {
            aggregate: x.aggregate,
            source,
            why,
          }),
          source,
          origin: x.origin,
        });
      }
    }
  };
  for (const agg of ctx.aggregates) {
    for (const f of agg.contextFilters ?? []) check(f, agg, `${ctx.name}/${agg.name}`);
    check(agg.writeScopeFilter, agg, `${ctx.name}/${agg.name}`);
  }
  const hostOf = (t: { kind: string; name?: string }): AggregateIR | undefined =>
    t.kind === "entity" && t.name ? byName.get(t.name) : undefined;
  for (const c of ctx.criteria ?? []) check(c.body, hostOf(c.targetType), `${ctx.name}/${c.name}`);
  for (const r of ctx.retrievals ?? [])
    check(r.where, hostOf(r.targetType), `${ctx.name}/${r.name}`);
  for (const repo of ctx.repositories) {
    const host = byName.get(repo.aggregateName);
    for (const f of repo.finds) check(f.filter, host, `${ctx.name}/${repo.name}.${f.name}`);
  }
}

// Phase ⑥ — `policy { read X requires <expr> }` reaches every read of X.
//
// The policy rule is the ONE place an author says who may read an aggregate.
// Every backend already renders a read's gate from `FindIR.requires` — the list
// route, each find's route, the audit history read (copied from `all` by
// `ensureHistoryFind`) and the by-id route (taken from `all` by
// `byIdRouteFind`, `read-gates.ts`).  So the rule lowers into that carrier and
// no emitter learns a new field: this pass puts the gate on every
// author-declared find of X and on the compiler-injected list read `all`.
//
// Runs AFTER `ensureFindAll` (the injected `all` must exist to carry the gate)
// and BEFORE `ensureHistoryFind` (history copies `all`'s gate) and
// `applyDefaultDenyReads` (which stamps the deny gate only on an `all` that
// still has none).  Compiler-synthesised finds (the paged-run helpers a
// `queryHandler` mints) are not reads of their own — the handler's route and
// its own `requires` are the exposure — so they are left alone.

import type {
  CommandHandlerIR,
  PolicyReadGateIR,
  QueryHandlerIR,
  RepositoryIR,
  WorkflowStmtIR,
} from "../types/loom-ir.js";
import { walkWorkflowStmtsDeep } from "../util/walk.js";

export function applyPolicyReadGates(
  repos: RepositoryIR[],
  gates: PolicyReadGateIR[] | undefined,
): RepositoryIR[] {
  if (!gates || gates.length === 0) return repos;
  // First rule wins; a second rule for the same aggregate is
  // `loom.policy-duplicate-target` in phase ⑦.
  const byAggregate = new Map<string, PolicyReadGateIR>();
  for (const g of gates) if (!byAggregate.has(g.aggregate)) byAggregate.set(g.aggregate, g);
  return repos.map((r) => {
    const rule = byAggregate.get(r.aggregateName);
    if (!rule) return r;
    return {
      ...r,
      finds: r.finds.map((f) =>
        f.synthesized ? f : { ...f, requires: structuredClone(rule.gate) },
      ),
    };
  });
}

// ── Hand-written handlers ───────────────────────────────────────────────────
//
// A `queryHandler` / `commandHandler` is its own route and reads through the
// repository directly, so none of the find-carried gates above reach it.  The
// same `policy { read X requires … }` line must still decide who may read X
// through it — otherwise an author-routed read answers any principal while the
// derived `GET /<aggs>/{id}` for the same aggregate answers 403.
//
// The gate is `currentUser`-only (`loom.policy-read-gate-not-current-user`), so
// it never depends on a handler param and is evaluated once, ahead of the
// body, as a leading `requires` — the statement every backend already renders
// as a 403 (`ForbiddenError` / `Forbidden`).  One gate per distinct gated
// aggregate the body reads, in first-read order.  A leading `requires` that is
// already structurally this gate (an authored copy of it) is not repeated, so
// the pass is idempotent.

/** The aggregates a handler body reads through its repository — `get` / `find`
 *  / `getBy` / `findBy` / `all`, at any nesting depth, in first-read order.
 *  An `if let` that only narrows an in-scope optional (`bound`) reads nothing. */
export function handlerReadAggregates(statements: WorkflowStmtIR[]): string[] {
  const out: string[] = [];
  const note = (agg: string): void => {
    if (!out.includes(agg)) out.push(agg);
  };
  for (const st of statements) {
    walkWorkflowStmtsDeep(st, (n) => {
      if (n.kind === "repo-let" || n.kind === "repo-run") note(n.aggName);
      else if (n.kind === "if-let" && n.op !== "bound") note(n.aggName);
    });
  }
  return out;
}

const withoutOrigin = (k: string, v: unknown): unknown => (k === "origin" ? undefined : v);
const sameExpr = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a, withoutOrigin) === JSON.stringify(b, withoutOrigin);

function withReadGates<H extends QueryHandlerIR | CommandHandlerIR>(
  h: H,
  byAggregate: Map<string, PolicyReadGateIR>,
): H {
  if (h.extern) return h;
  const leading: WorkflowStmtIR[] = [];
  for (const st of h.statements) {
    if (st.kind !== "requires") break;
    leading.push(st);
  }
  const gates: WorkflowStmtIR[] = [];
  for (const agg of handlerReadAggregates(h.statements)) {
    const rule = byAggregate.get(agg);
    if (!rule) continue;
    if (leading.some((st) => st.kind === "requires" && sameExpr(st.expr, rule.gate))) continue;
    gates.push({
      kind: "requires",
      expr: structuredClone(rule.gate),
      source: rule.source,
      readGateOf: agg,
    });
  }
  return gates.length === 0 ? h : { ...h, statements: [...gates, ...h.statements] };
}

/** Put the aggregate's `policy { read X requires … }` gate ahead of every
 *  hand-written handler whose body reads X. */
export function applyHandlerReadGates<H extends QueryHandlerIR | CommandHandlerIR>(
  handlers: H[],
  gates: PolicyReadGateIR[] | undefined,
): H[] {
  if (!gates || gates.length === 0) return handlers;
  const byAggregate = new Map<string, PolicyReadGateIR>();
  for (const g of gates) if (!byAggregate.has(g.aggregate)) byAggregate.set(g.aggregate, g);
  return handlers.map((h) => withReadGates(h, byAggregate));
}

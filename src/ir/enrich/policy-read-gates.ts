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
  ExprIR,
  PolicyReadGateIR,
  ProjectionIR,
  QueryHandlerIR,
  RepositoryIR,
  WorkflowIR,
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
 *  / `getBy` / `findBy` / `all` / `history` (a row's trail is a read of that
 *  row), at any nesting depth, in first-read order.
 *  An `if let` that only narrows an in-scope optional (`bound`) reads nothing. */
export function handlerReadAggregates(statements: WorkflowStmtIR[]): string[] {
  const out: string[] = [];
  const note = (agg: string): void => {
    if (!out.includes(agg)) out.push(agg);
  };
  for (const st of statements) {
    walkWorkflowStmtsDeep(st, (n) => {
      switch (n.kind) {
        case "repo-let":
        case "repo-run":
        case "history-let":
          note(n.aggName);
          break;
        case "if-let":
          if (n.op !== "bound") note(n.aggName);
          break;
        // The kinds that read no row through a repository (a `for` iterable and
        // the nested bodies are visited by the deep walk).
        case "precondition":
        case "requires":
        case "emit":
        case "factory-let":
        case "expr-let":
        case "instance-let":
        case "projection-let":
        case "assign":
        case "op-call":
        case "repo-delete":
        case "resource-call":
        case "domain-service-call":
        case "not-found":
        case "for-each":
        case "if":
        case "variant-match":
        case "send":
        case "step":
          break;
        default: {
          const _exhaustive: never = n;
          void _exhaustive;
        }
      }
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

/** Put a workflow's instance read gate (`workflow W requires <expr>`, the gate
 *  its instance routes check) ahead of every hand-written query handler that
 *  reads W's instances (`W.instances()` / `W.instance(k)`) — the same leading
 *  `requires` shape as the policy read gate above, evaluated once, before the
 *  read. */
export function applyHandlerInstanceReadGates<H extends QueryHandlerIR | CommandHandlerIR>(
  handlers: H[],
  workflows: readonly WorkflowIR[],
): H[] {
  return prependReadGates(
    handlers,
    new Map(workflows.filter((w) => w.instanceReadGate).map((w) => [w.name, w.instanceReadGate!])),
    (n) => (n.kind === "instance-let" ? n.workflowName : undefined),
    (wf) => `workflow ${wf} requires`,
  );
}

/** Put a projection's read gate (`projection P requires <expr>`, the gate its
 *  read routes check) ahead of every hand-written query handler that reads P's
 *  rows (`P.all()` / `P.get(k)`), in the same leading `requires` shape. */
export function applyHandlerProjectionReadGates<H extends QueryHandlerIR | CommandHandlerIR>(
  handlers: H[],
  projections: readonly ProjectionIR[],
): H[] {
  return prependReadGates(
    handlers,
    new Map(projections.filter((p) => p.query?.requires).map((p) => [p.name, p.query!.requires!])),
    (n) => (n.kind === "projection-let" ? n.projectionName : undefined),
    (p) => `projection ${p} requires`,
  );
}

/** Prepend, per declaration a handler body reads (`readOf` names it), that
 *  declaration's gate as a leading `requires` — once per declaration, and not
 *  when an identical leading `requires` is already there. */
function prependReadGates<H extends QueryHandlerIR | CommandHandlerIR>(
  handlers: H[],
  gateOf: ReadonlyMap<string, ExprIR>,
  readOf: (n: WorkflowStmtIR) => string | undefined,
  source: (name: string) => string,
): H[] {
  if (gateOf.size === 0) return handlers;
  return handlers.map((h) => {
    if (h.extern) return h;
    const read: string[] = [];
    for (const st of h.statements)
      walkWorkflowStmtsDeep(st, (n) => {
        const name = readOf(n);
        if (name !== undefined && !read.includes(name)) read.push(name);
      });
    const leading = h.statements.filter((_st, i) =>
      h.statements.slice(0, i + 1).every((x) => x.kind === "requires"),
    );
    const gates: WorkflowStmtIR[] = [];
    for (const name of read) {
      const gate = gateOf.get(name);
      if (!gate) continue;
      if (leading.some((st) => st.kind === "requires" && sameExpr(st.expr, gate))) continue;
      gates.push({
        kind: "requires",
        expr: structuredClone(gate),
        source: source(name),
        readGateOf: name,
      });
    }
    return gates.length === 0 ? h : { ...h, statements: [...gates, ...h.statements] };
  });
}

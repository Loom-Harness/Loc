// The save semantics of a workflow, handler or reactor body on Phoenix.
//
// Every backend runs an aggregate operation called from such a body on the
// in-memory handle and saves each changed handle ONCE, at the save points the
// IR lowers: the body's exit (`savesAtExit`) and the end of each loop
// iteration, `if let` branch and `match` arm (`nestedSaveScopes`).  One save is
// one version bump (RS-20), so two calls on one handle, or a loop that bumps
// one row per iteration, still move its version by one.
//
// The Phoenix context splits an operation that can run that way into
// `__apply_<op>_<agg>/2` — its guards and body over the struct, no write — and
// the per-aggregate `__save_<agg>/2`, the one write.  The public
// `<op>_<agg>/2` (the REST and LiveView entry) keeps its own persist tail.
//
// An operation whose persist tail does more than write its columns — it emits
// an event, records an audit row, flushes provenance, rewrites a relation or a
// reference collection, answers a value, or delegates to an extern hook — has
// no apply step, so a handle it touches keeps the per-call persist.  So does a
// handle an `if let` branch or a `match` arm changes without saving it there:
// a branch is an expression in Elixir, and the struct it changed would not
// reach the outer save.  A handle mutated through a `mutating` domain service
// persists through that service's inlined calls.

import { lookupOp, nestedSaveScopes, type SaveEntry } from "../../../ir/plan/index.js";
import type { BoundedContextIR, WorkflowStmtIR } from "../../../ir/types/loom-ir.js";
import { walkWorkflowStmtsDeep } from "../../../ir/util/walk.js";
import { opAppliesInMemory } from "./op-in-memory.js";

export { applyFnName, opAppliesInMemory, saveFnName } from "./op-in-memory.js";

/** How one body saves: the op-calls that run in memory, the save entries that
 *  write those handles, and among them the rows the body inserted itself. */
export interface ElixirSavePlan {
  /** Op-call statements rendered as `__apply_<op>_<agg>` calls. */
  readonly applyCalls: ReadonlySet<WorkflowStmtIR>;
  /** Save entries rendered as `__save_<agg>` calls at their save point. */
  readonly saves: ReadonlySet<SaveEntry>;
  /** The names those saves write: a handle a loop threads out stays bound
   *  for its save. */
  readonly savedNames: ReadonlySet<string>;
  /** Saves of a row the body's own `create` inserted: that insert was the
   *  row's save, so this write keeps its version. */
  readonly inserted: ReadonlySet<SaveEntry>;
}

export const NO_SAVE_PLAN: ElixirSavePlan = {
  applyCalls: new Set(),
  saves: new Set(),
  savedNames: new Set(),
  inserted: new Set(),
};

/** The save plan of a body whose exit saves are `exitSaves`.  Each save list
 *  the IR lowered is read where it sits; none is recomputed. */
export function elixirSavePlan(
  statements: readonly WorkflowStmtIR[],
  exitSaves: readonly SaveEntry[],
  ctx: BoundedContextIR | undefined,
): ElixirSavePlan {
  if (!ctx) return NO_SAVE_PLAN;
  const applyCalls = new Set<WorkflowStmtIR>();
  const saves = new Set<SaveEntry>();
  const inserted = new Set<SaveEntry>();
  const planScope = (body: readonly WorkflowStmtIR[], scopeSaves: readonly SaveEntry[]): void => {
    for (const save of scopeSaves) {
      const calls = inMemoryCalls(save.name, body, ctx);
      if (!calls) continue;
      for (const c of calls) applyCalls.add(c);
      saves.add(save);
      if (body.some((s) => s.kind === "factory-let" && s.name === save.name)) inserted.add(save);
    }
  };
  planScope(statements, exitSaves);
  for (const top of statements) {
    walkWorkflowStmtsDeep(top, (st) => {
      for (const scope of nestedSaveScopes(st)) planScope(scope.body, scope.saves);
    });
  }
  return { applyCalls, saves, savedNames: new Set([...saves].map((s) => s.name)), inserted };
}

/** The op-calls on `name` in `body` when every one of them can run in memory
 *  and none sits in a branch of `body`; undefined otherwise, or when there is
 *  none (nothing to save). */
function inMemoryCalls(
  name: string,
  body: readonly WorkflowStmtIR[],
  ctx: BoundedContextIR,
): WorkflowStmtIR[] | undefined {
  const calls: WorkflowStmtIR[] = [];
  let inMemory = true;
  const callsOn = (st: WorkflowStmtIR): boolean => st.kind === "op-call" && st.target === name;
  for (const top of body) {
    walkWorkflowStmtsDeep(top, (st) => {
      if (st.kind === "op-call" && st.target === name) {
        const agg = ctx.aggregates.find((a) => a.name === st.aggName);
        const op = lookupOp(ctx, st.aggName, st.op);
        if (agg && op && opAppliesInMemory(op, agg)) calls.push(st);
        else inMemory = false;
      }
      if (st.kind === "domain-service-call" && namesRefd(st).has(name)) inMemory = false;
      for (const scope of nestedSaveScopes(st)) {
        if (scope.kind !== "branch") continue;
        for (const inner of scope.body) {
          walkWorkflowStmtsDeep(inner, (s) => {
            if (callsOn(s)) inMemory = false;
          });
        }
      }
    });
  }
  return inMemory && calls.length > 0 ? calls : undefined;
}

/** The names a domain-service call passes as bare arguments. */
function namesRefd(st: Extract<WorkflowStmtIR, { kind: "domain-service-call" }>): Set<string> {
  const args = st.call.kind === "call" ? st.call.args : [];
  return new Set(args.flatMap((a) => (a.kind === "ref" ? [a.name] : [])));
}

/** The operations a context's bodies run in memory, per aggregate, and the
 *  aggregates they save — what the context module must define
 *  (`__apply_<op>_<agg>` / `__save_<agg>`).  Reads every body the Phoenix
 *  emitters lower: each workflow create and reactor, and each command
 *  handler. */
export function contextInMemoryOps(ctx: BoundedContextIR): {
  ops: ReadonlyMap<string, ReadonlySet<string>>;
  saved: ReadonlySet<string>;
} {
  const ops = new Map<string, Set<string>>();
  const saved = new Set<string>();
  const bodies: { statements: readonly WorkflowStmtIR[]; saves: readonly SaveEntry[] }[] = [
    ...ctx.workflows.flatMap((wf) => [
      { statements: wf.statements ?? [], saves: wf.savesAtExit ?? [] },
      ...(wf.creates ?? []).map((c) => ({ statements: c.statements, saves: c.savesAtExit })),
      ...(wf.subscriptions ?? []).map((o) => ({ statements: o.statements, saves: o.savesAtExit })),
    ]),
    ...(ctx.commandHandlers ?? []).map((h) => ({ statements: h.statements, saves: h.savesAtExit })),
  ];
  for (const { statements, saves } of bodies) {
    const plan = elixirSavePlan(statements, saves, ctx);
    for (const c of plan.applyCalls) {
      if (c.kind !== "op-call") continue;
      const set = ops.get(c.aggName) ?? new Set<string>();
      set.add(c.op);
      ops.set(c.aggName, set);
    }
    for (const s of plan.saves) saved.add(s.aggName);
  }
  return { ops, saved };
}

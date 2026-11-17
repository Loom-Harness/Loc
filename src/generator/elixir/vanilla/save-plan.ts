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
// An operation whose persist tail dispatches events, records an audit row or
// flushes provenance stages that work in its apply step; the handle carries
// the staged list beside it (`stagedName`) and its save runs the list in the
// save's transaction.  A returning operation's apply step answers the changed
// struct beside its value; an extern operation's runs its hook.  An operation
// that rewrites a relation or a reference collection leaves the new value on
// the handle in its apply step, and its save diffs that value against the
// stored row.  A returning operation that rewrites a relation, stages work or
// hands a sibling operation's result through has no apply step; a handle such
// an operation touches keeps the per-call persist, as does a call whose
// result a `match` dispatches on.  A handle an
// `if let` branch or a `match` arm changes is threaded out of the branch to
// the save after it, as a loop threads its accumulator.  A `mutating` domain
// service call is the op-calls it inlines: each runs in memory when every one
// of them can.

import { lookupOp, nestedSaveScopes, type SaveEntry } from "../../../ir/plan/index.js";
import type {
  AggregateIR,
  BoundedContextIR,
  SystemIR,
  WorkflowStmtIR,
} from "../../../ir/types/loom-ir.js";
import { walkWorkflowStmtsDeep } from "../../../ir/util/walk.js";
import { type ServiceCallMutation, serviceCallMutations } from "../domain-service-emit.js";
import { isVanillaDocAgg } from "./document-emit.js";
import { opAppliesInMemory, opStagesForSave } from "./op-in-memory.js";

export {
  applyFnName,
  opAppliesInMemory,
  opStagesForSave,
  saveFnName,
  stagedName,
} from "./op-in-memory.js";

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
  /** Saves of a handle an apply step staged work on (`opStagesForSave`): the
   *  scope binds the handle's staged list empty at its start, and the save
   *  passes it. */
  readonly staged: ReadonlySet<SaveEntry>;
  /** The handles those saves write: their staged list rides beside them
   *  wherever they are threaded. */
  readonly stagedNames: ReadonlySet<string>;
}

export const NO_SAVE_PLAN: ElixirSavePlan = {
  applyCalls: new Set(),
  saves: new Set(),
  savedNames: new Set(),
  inserted: new Set(),
  staged: new Set(),
  stagedNames: new Set(),
};

/** The save plan of a body whose exit saves are `exitSaves`.  Each save list
 *  the IR lowered is read where it sits; none is recomputed. */
export function elixirSavePlan(
  statements: readonly WorkflowStmtIR[],
  exitSaves: readonly SaveEntry[],
  ctx: BoundedContextIR | undefined,
  /** The system, so a document-shaped aggregate is told apart; every caller
   *  of one context passes the same one, as `contextInMemoryOps` does. */
  sys?: SystemIR,
): ElixirSavePlan {
  if (!ctx) return NO_SAVE_PLAN;
  // A service call that mutates several handles runs in memory only when every
  // one of them is saved in memory: one it would leave unsaved keeps the call
  // inlined as persisting calls, and the plan is made again without it.
  const blocked = new Set<WorkflowStmtIR>();
  for (;;) {
    const plan = planOnce(statements, exitSaves, ctx, sys, blocked);
    const unsaved = [...plan.applyCalls].filter(
      (c) =>
        c.kind === "domain-service-call" &&
        serviceMutations(c, ctx).some((m) => !plan.savedNames.has(m.target)),
    );
    if (unsaved.length === 0) return plan;
    for (const c of unsaved) blocked.add(c);
  }
}

function planOnce(
  statements: readonly WorkflowStmtIR[],
  exitSaves: readonly SaveEntry[],
  ctx: BoundedContextIR,
  sys: SystemIR | undefined,
  blocked: ReadonlySet<WorkflowStmtIR>,
): ElixirSavePlan {
  const applyCalls = new Set<WorkflowStmtIR>();
  const saves = new Set<SaveEntry>();
  const inserted = new Set<SaveEntry>();
  const staged = new Set<SaveEntry>();
  const planScope = (body: readonly WorkflowStmtIR[], scopeSaves: readonly SaveEntry[]): void => {
    for (const save of scopeSaves) {
      const calls = inMemoryCalls(save.name, body, ctx, sys, blocked);
      if (!calls) continue;
      for (const c of calls) applyCalls.add(c);
      saves.add(save);
      if (calls.some((c) => stagesForSave(c, ctx, save.name))) staged.add(save);
      if (body.some((s) => s.kind === "factory-let" && s.name === save.name)) inserted.add(save);
    }
  };
  planScope(statements, exitSaves);
  for (const top of statements) {
    walkWorkflowStmtsDeep(top, (st) => {
      for (const scope of nestedSaveScopes(st)) planScope(scope.body, scope.saves);
    });
  }
  return {
    applyCalls,
    saves,
    savedNames: new Set([...saves].map((s) => s.name)),
    inserted,
    staged,
    stagedNames: new Set([...staged].map((s) => s.name)),
  };
}

/** Does this call's apply step stage work for its save — an op-call's op, or
 *  one of the ops a service call runs on `name`? */
export function stagesForSave(
  st: WorkflowStmtIR,
  ctx: BoundedContextIR | undefined,
  name?: string,
): boolean {
  if (!ctx) return false;
  if (st.kind === "domain-service-call") {
    return serviceMutations(st, ctx).some(
      (m) => m.target === name && m.calledOp !== undefined && opStagesForSave(m.calledOp),
    );
  }
  if (st.kind !== "op-call") return false;
  const op = lookupOp(ctx, st.aggName, st.op);
  return op !== undefined && opStagesForSave(op);
}

/** The mutations a `mutating` service call makes, as the Elixir inliner
 *  expands it (`serviceCallMutations`); empty for any other statement. */
export function serviceMutations(st: WorkflowStmtIR, ctx: BoundedContextIR): ServiceCallMutation[] {
  if (st.kind !== "domain-service-call") return [];
  const svc = (ctx.domainServices ?? []).find((s) => s.name === st.service);
  const op = svc?.operations.find((o) => o.name === st.op);
  if (!op) return [];
  return serviceCallMutations(op, st.call.kind === "call" ? st.call.args : [], ctx);
}

/** The op-calls on `name` in `body` when every one of them can run in memory
 *  and none sits in a branch of `body` that saves `name` itself; undefined
 *  otherwise, or when there is none (nothing to save). */
function inMemoryCalls(
  name: string,
  body: readonly WorkflowStmtIR[],
  ctx: BoundedContextIR,
  sys: SystemIR | undefined,
  blocked: ReadonlySet<WorkflowStmtIR>,
): WorkflowStmtIR[] | undefined {
  const calls: WorkflowStmtIR[] = [];
  let inMemory = true;
  const callsOn = (st: WorkflowStmtIR): boolean => st.kind === "op-call" && st.target === name;
  for (const top of body) {
    walkWorkflowStmtsDeep(top, (st) => {
      if (st.kind === "op-call" && st.target === name) {
        const agg = ctx.aggregates.find((a) => a.name === st.aggName);
        const op = lookupOp(ctx, st.aggName, st.op);
        if (agg && op && opAppliesInMemory(op, agg, isDoc(agg, ctx, sys)) && !guardedResult(st)) {
          calls.push(st);
        } else inMemory = false;
      }
      // A service call that mutates `name` runs its ops in memory when every
      // op it runs can.
      const muts = serviceMutations(st, ctx);
      if (muts.some((m) => m.target === name)) {
        const applies = muts.every((m) => {
          const agg = ctx.aggregates.find((a) => a.name === m.aggName);
          return (
            agg !== undefined &&
            m.calledOp !== undefined &&
            opAppliesInMemory(m.calledOp, agg, isDoc(agg, ctx, sys))
          );
        });
        if (applies && !blocked.has(st)) calls.push(st);
        else inMemory = false;
      }
      // A branch that saves the handle itself (an `if` branch saves what it
      // changes) owns those calls; one that does not (an `if let` branch, a
      // `match` arm) threads the changed handle out to this scope's save.
      for (const scope of nestedSaveScopes(st)) {
        if (scope.kind !== "branch" || !scope.saves.some((sv) => sv.name === name)) continue;
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

/** `let r = a.op(…)` over an op with an error variant: the `match` over `r`
 *  commits the call only in its non-error arms, which save the handle
 *  there, so the call persists on its own. */
function guardedResult(st: Extract<WorkflowStmtIR, { kind: "op-call" }>): boolean {
  return (st.result?.errorVariants.length ?? 0) > 0;
}

function isDoc(agg: AggregateIR, ctx: BoundedContextIR, sys: SystemIR | undefined): boolean {
  return isVanillaDocAgg(agg, ctx, sys);
}

/** The operations a context's bodies run in memory, per aggregate, and the
 *  aggregates they save — what the context module must define
 *  (`__apply_<op>_<agg>` / `__save_<agg>`).  Reads every body the Phoenix
 *  emitters lower: each workflow create and reactor, and each command
 *  handler. */
export function contextInMemoryOps(
  ctx: BoundedContextIR,
  sys?: SystemIR,
): {
  ops: ReadonlyMap<string, ReadonlySet<string>>;
  saved: ReadonlySet<string>;
  /** The aggregates some save passes a staged list to. */
  staged: ReadonlySet<string>;
} {
  const ops = new Map<string, Set<string>>();
  const saved = new Set<string>();
  const staged = new Set<string>();
  const bodies: { statements: readonly WorkflowStmtIR[]; saves: readonly SaveEntry[] }[] = [
    ...ctx.workflows.flatMap((wf) => [
      { statements: wf.statements ?? [], saves: wf.savesAtExit ?? [] },
      ...(wf.creates ?? []).map((c) => ({ statements: c.statements, saves: c.savesAtExit })),
      ...(wf.subscriptions ?? []).map((o) => ({ statements: o.statements, saves: o.savesAtExit })),
    ]),
    ...(ctx.commandHandlers ?? []).map((h) => ({ statements: h.statements, saves: h.savesAtExit })),
  ];
  for (const { statements, saves } of bodies) {
    const plan = elixirSavePlan(statements, saves, ctx, sys);
    const add = (aggName: string, op: string): void => {
      const set = ops.get(aggName) ?? new Set<string>();
      set.add(op);
      ops.set(aggName, set);
    };
    for (const c of plan.applyCalls) {
      if (c.kind === "op-call") add(c.aggName, c.op);
      for (const m of serviceMutations(c, ctx)) add(m.aggName, m.member);
    }
    for (const s of plan.saves) saved.add(s.aggName);
    for (const s of plan.staged) staged.add(s.aggName);
  }
  return { ops, saved, staged };
}

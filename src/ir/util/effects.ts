// Derive a body's effects (`ir/types/effect-ir.ts`) from its lowered
// statements.
//
// One exhaustive dispatch over `WorkflowStmtIR` decides each statement's
// structural effect; the expressions a statement holds contribute the `call`s,
// the expression-position reads and the own-state reads found anywhere inside
// them.  Nested `for-each` / `if-let` bodies recurse with their scope pushed,
// and each scope ends with the saves its statement carries — so the list reads
// in program order, a loop body's effects before the loop's per-iteration
// saves, a body's effects before its exit saves and its return.
//
// With a `SaveResolver` the derivation also sees the callee's DECLARED effects,
// whatever statement shape the call sits in: a `mutating` domain-service call
// mutates the aggregates passed for the parameters it mutates, and a call to an
// aggregate operation on a bound local mutates that local, bound result or not.
// Without one (a test pinning the structural effects only) those calls
// contribute their `call` effect alone.
//
// Pure and platform-neutral: a validator, a test, or an emitter that needs to
// know "what does this body do" reads the list instead of re-deriving it from
// statement shapes.

import type { CallTargetIR, EffectIR, EffectScopeIR } from "../types/effect-ir.js";
import type { ExprIR, WorkflowStmtIR } from "../types/loom-ir.js";
import { mutatedParamNames, type SaveResolver } from "./domain-service-tier.js";
import { walkExprDeep, walkWorkflowStmtOwnExprsDeep } from "./walk.js";

type SaveIR = { name: string; aggName: string; repoName: string };

/** Any lowered body with exit saves: a workflow create / on, or a
 *  command / query handler. */
export interface EffectBodyIR {
  readonly statements: readonly WorkflowStmtIR[];
  readonly savesAtExit: readonly SaveIR[];
  readonly returnValue?: ExprIR;
}

interface Cx {
  readonly out: EffectIR[];
  readonly resolver?: SaveResolver;
}

/** Every effect of `body`, in program order.  `resolver` is required (pass
 *  `undefined` deliberately) because without it the callees' declared
 *  mutations are invisible, which reads exactly like "the body mutates less". */
export function bodyEffects(body: EffectBodyIR, resolver: SaveResolver | undefined): EffectIR[] {
  const cx: Cx = { out: [], resolver };
  const top: readonly EffectScopeIR[] = [];
  for (const st of body.statements) collectStmtEffects(st, top, cx);
  pushSaves(body.savesAtExit, top, cx);
  if (body.returnValue) {
    collectExprEffects(body.returnValue, top, cx);
    cx.out.push({ kind: "return", value: body.returnValue, scope: top });
  }
  return cx.out;
}

/** The effects of one statement (and everything nested in it), appended to
 *  `cx.out` under `scope`. */
function collectStmtEffects(st: WorkflowStmtIR, scope: readonly EffectScopeIR[], cx: Cx): void {
  const out = cx.out;
  walkWorkflowStmtOwnExprsDeep(st, (e) => pushExprEffect(e, scope, cx));
  switch (st.kind) {
    // Guards, pure bindings and the call statements (whose `call` effect the
    // expression scan above already produced) add no structural effect.
    case "precondition":
    case "not-found":
    case "requires":
    case "expr-let":
    case "resource-call":
    case "domain-service-call":
      return;
    case "emit":
      out.push({ kind: "emit", eventName: st.eventName, scope });
      return;
    case "factory-let":
      out.push({ kind: "create", aggName: st.aggName, binds: st.name, scope });
      return;
    case "repo-let":
      // `let x = Repo.delete(o)` binds a removal, not a read.
      if (st.op === "remove") {
        const entity = st.args[0];
        if (entity) {
          out.push({
            kind: "delete",
            repoName: st.repoName,
            aggName: st.aggName,
            entity,
            scope,
          });
        }
        return;
      }
      out.push({
        kind: "load",
        op: st.op,
        repoName: st.repoName,
        aggName: st.aggName,
        binds: st.name,
        scope,
      });
      return;
    case "repo-run":
      out.push({
        kind: "load",
        op: st.op,
        repoName: st.repoName,
        aggName: st.aggName,
        binds: st.name,
        scope,
      });
      return;
    case "op-call":
      out.push({
        kind: "mutate",
        target: { kind: "aggregate", name: st.target, aggName: st.aggName, op: st.op },
        scope,
      });
      return;
    case "repo-delete":
      out.push({
        kind: "delete",
        repoName: st.repoName,
        aggName: st.aggName,
        entity: st.entity,
        scope,
      });
      return;
    case "assign":
      out.push({ kind: "mutate", target: { kind: "state", field: st.target.segments[0]! }, scope });
      return;
    case "for-each": {
      const inner = [...scope, { kind: "iteration", var: st.var } as const];
      for (const s of st.body) collectStmtEffects(s, inner, cx);
      pushSaves(st.savesPerIteration, inner, cx);
      return;
    }
    case "if-let": {
      out.push({
        kind: "load",
        op: st.op,
        repoName: st.repoName,
        aggName: st.aggName,
        binds: st.var,
        scope,
      });
      const thenScope = [...scope, { kind: "branch", arm: "then", var: st.var } as const];
      for (const s of st.thenBody) collectStmtEffects(s, thenScope, cx);
      pushSaves(st.savesInThen, thenScope, cx);
      const elseScope = [...scope, { kind: "branch", arm: "else", var: st.var } as const];
      for (const s of st.elseBody ?? []) collectStmtEffects(s, elseScope, cx);
      pushSaves(st.savesInElse, elseScope, cx);
      return;
    }
    default: {
      const _exhaustive: never = st;
      void _exhaustive;
    }
  }
}

function collectExprEffects(root: ExprIR, scope: readonly EffectScopeIR[], cx: Cx): void {
  walkExprDeep(root, (e) => pushExprEffect(e, scope, cx));
}

/** The effect a single expression node performs, if any: a read of own state,
 *  a call out of the body (and the mutations its callee declares), a call to
 *  an aggregate operation on a bound local, or a repository read in expression
 *  position. */
function pushExprEffect(e: ExprIR, scope: readonly EffectScopeIR[], cx: Cx): void {
  const out = cx.out;
  if (e.kind === "ref") {
    if (e.refKind === "this-prop" || e.refKind === "this-derived") {
      out.push({ kind: "read-state", field: e.name, scope });
    }
    return;
  }
  if (e.kind === "method-call") {
    pushLocalOpMutation(e, scope, cx);
    return;
  }
  if (e.kind !== "call") return;
  const target = callTarget(e);
  if (target) {
    out.push({ kind: "call", target, scope });
    if (target.kind === "domain-service") pushServiceMutations(e, target, scope, cx);
    return;
  }
  if (e.callKind === "repo-read" && e.repoRead) {
    out.push({
      kind: "load",
      op: e.repoRead.op,
      repoName: e.repoRead.repo,
      aggName: e.repoRead.aggregate,
      scope,
    });
  }
}

/** `a.withdraw(x)` in expression position (`let r = a.withdraw(x)`), where `a`
 *  is a bound local and `withdraw` an operation of its aggregate: the same
 *  mutation an `op-call` statement records. */
function pushLocalOpMutation(
  e: Extract<ExprIR, { kind: "method-call" }>,
  scope: readonly EffectScopeIR[],
  cx: Cx,
): void {
  if (!cx.resolver) return;
  const recv = e.receiver;
  if (recv.kind !== "ref" || recv.refKind !== "let") return;
  const t = e.receiverType;
  if (t?.kind !== "entity") return;
  if (!cx.resolver.resolveAggOp(t.name, e.member)) return;
  cx.out.push({
    kind: "mutate",
    target: { kind: "aggregate", name: recv.name, aggName: t.name, op: e.member },
    scope,
  });
}

/** The aggregates a `mutating` domain-service call mutates: the argument passed
 *  for each parameter the operation calls a mutating aggregate operation on. */
function pushServiceMutations(
  e: Extract<ExprIR, { kind: "call" }>,
  target: Extract<CallTargetIR, { kind: "domain-service" }>,
  scope: readonly EffectScopeIR[],
  cx: Cx,
): void {
  const op = cx.resolver?.resolveServiceOp(target.service, target.op);
  if (!op || !cx.resolver) return;
  const mutated = mutatedParamNames(op, cx.resolver.resolveAggOp);
  op.params.forEach((p, i) => {
    if (!mutated.has(p.name) || p.type.kind !== "entity") return;
    const arg = e.args[i];
    cx.out.push({
      kind: "mutate",
      target: {
        kind: "aggregate",
        name: arg?.kind === "ref" ? arg.name : "",
        aggName: p.type.name,
        op: target.op,
        service: target.service,
      },
      scope,
    });
  });
}

function callTarget(e: Extract<ExprIR, { kind: "call" }>): CallTargetIR | undefined {
  if (e.callKind === "domain-service" && e.serviceRef) {
    return { kind: "domain-service", service: e.serviceRef.service, op: e.serviceRef.op };
  }
  if (e.callKind === "resource-op" && e.resourceOp) {
    return { kind: "resource", resource: e.resourceOp.resourceName, verb: e.resourceOp.verb };
  }
  if (e.callKind === "remote-api-op" && e.remoteApiOp) {
    return {
      kind: "remote-api",
      resource: e.remoteApiOp.resourceName,
      api: e.remoteApiOp.apiName,
      operationId: e.remoteApiOp.operationId,
    };
  }
  return undefined;
}

function pushSaves(saves: readonly SaveIR[], scope: readonly EffectScopeIR[], cx: Cx): void {
  for (const s of saves) {
    cx.out.push({ kind: "persist", name: s.name, aggName: s.aggName, repoName: s.repoName, scope });
  }
}

// Derive a body's effects (`ir/types/effect-ir.ts`) from its lowered
// statements.
//
// One exhaustive dispatch over `WorkflowStmtIR` decides each statement's
// structural effect; the expressions a statement holds contribute the `call`s
// (and expression-position reads) found anywhere inside them.  Nested
// `for-each` / `if-let` bodies recurse with their scope pushed, and each scope
// ends with the saves its statement carries — so the list reads in program
// order, a loop body's effects before the loop's per-iteration saves, a body's
// effects before its exit saves and its return.
//
// Pure and platform-neutral: a validator, a test, or an emitter that needs to
// know "what does this body do" reads the list instead of re-deriving it from
// statement shapes.

import type { CallTargetIR, EffectIR, EffectScopeIR } from "../types/effect-ir.js";
import type { ExprIR, WorkflowStmtIR } from "../types/loom-ir.js";
import { walkExprDeep, walkWorkflowStmtOwnExprsDeep } from "./walk.js";

type SaveIR = { name: string; aggName: string; repoName: string };

/** Any lowered body with exit saves: a workflow create / on, or a
 *  command / query handler. */
export interface EffectBodyIR {
  readonly statements: readonly WorkflowStmtIR[];
  readonly savesAtExit: readonly SaveIR[];
  readonly returnValue?: ExprIR;
}

/** Every effect of `body`, in program order. */
export function bodyEffects(body: EffectBodyIR): EffectIR[] {
  const out: EffectIR[] = [];
  const top: readonly EffectScopeIR[] = [];
  for (const st of body.statements) collectStmtEffects(st, top, out);
  pushSaves(body.savesAtExit, top, out);
  if (body.returnValue) {
    collectExprEffects(body.returnValue, top, out);
    out.push({ kind: "return", value: body.returnValue, scope: top });
  }
  return out;
}

/** The effects of one statement (and everything nested in it), appended to
 *  `out` under `scope`. */
function collectStmtEffects(
  st: WorkflowStmtIR,
  scope: readonly EffectScopeIR[],
  out: EffectIR[],
): void {
  walkWorkflowStmtOwnExprsDeep(st, (e) => pushExprEffect(e, scope, out));
  switch (st.kind) {
    // Guards, pure bindings and the call statements (whose `call` effect the
    // expression scan above already produced) add no structural effect.
    case "precondition":
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
      for (const s of st.body) collectStmtEffects(s, inner, out);
      pushSaves(st.savesPerIteration, inner, out);
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
      for (const s of st.thenBody) collectStmtEffects(s, thenScope, out);
      pushSaves(st.savesInThen, thenScope, out);
      const elseScope = [...scope, { kind: "branch", arm: "else", var: st.var } as const];
      for (const s of st.elseBody ?? []) collectStmtEffects(s, elseScope, out);
      pushSaves(st.savesInElse, elseScope, out);
      return;
    }
    default: {
      const _exhaustive: never = st;
      void _exhaustive;
    }
  }
}

function collectExprEffects(root: ExprIR, scope: readonly EffectScopeIR[], out: EffectIR[]): void {
  walkExprDeep(root, (e) => pushExprEffect(e, scope, out));
}

/** The effect a single expression node performs, if any: a call out of the
 *  body, or a repository read in expression position. */
function pushExprEffect(e: ExprIR, scope: readonly EffectScopeIR[], out: EffectIR[]): void {
  if (e.kind !== "call") return;
  const target = callTarget(e);
  if (target) {
    out.push({ kind: "call", target, scope });
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

function pushSaves(
  saves: readonly SaveIR[],
  scope: readonly EffectScopeIR[],
  out: EffectIR[],
): void {
  for (const s of saves) {
    out.push({ kind: "persist", name: s.name, aggName: s.aggName, repoName: s.repoName, scope });
  }
}

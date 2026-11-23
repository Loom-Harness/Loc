// Lowering a workflow `send <Record> { … }` (⑤b leaf, imported by
// `lower-workflow.ts`).
//
// The record resolves in its declaring context: the one the send names
// (`send Billing.ChargeAccount { … }`), else the sending workflow's own.  The
// field values lower against the record's declared field types.  A
// `let r = send …` binds the result of the record's handler: a command / query
// handler's declared return type, or for a command a workflow `create` catches,
// that `create`'s declared result, else the started instance's id (`<Workflow>
// id`).  Which handler catches the record is the command bus's decision
// (`handlersOf`, `src/ir/plan/command-bus.ts`); a record with none or several
// is refused there (`loom.workflow-send-handler`), so the result is typed only
// when exactly one declaration catches it.

import type {
  BoundedContext,
  PayloadDecl,
  SendRhs,
  TypeRef,
} from "../../language/generated/ast.js";
import {
  isCommandHandler,
  isPayloadDecl,
  isQueryHandler,
  isWorkflow,
} from "../../language/generated/ast.js";
import { variantTag } from "../stdlib/unions.js";
import type { CallResultBindingIR, ExprIR, TypeIR } from "../types/loom-ir.js";
import { isErrorVariantTag, lowerExpr, lowerExprInContext } from "./lower-expr.js";
import { type Env, lowerType } from "./lower-types.js";

/** The context that declares the sent record. */
export function sendContext(stmt: SendRhs, env: Env): BoundedContext | undefined {
  return stmt.target.context?.ref ?? env.ctx;
}

function recordDecl(ctx: BoundedContext | undefined, name: string): PayloadDecl | undefined {
  return ctx?.members.find(
    (m): m is PayloadDecl =>
      isPayloadDecl(m) && m.name === name && (m.kind === "command" || m.kind === "query"),
  );
}

/** The field values, each lowered against the record's declared field type. */
export function lowerSendFields(stmt: SendRhs, env: Env): { name: string; value: ExprIR }[] {
  const decl = recordDecl(sendContext(stmt, env), stmt.target.record);
  const typeOf = new Map<string, TypeIR>();
  for (const f of decl?.fields ?? []) typeOf.set(f.name, lowerType(f.type, env));
  return stmt.fields.map((f) => {
    const target = typeOf.get(f.name);
    return {
      name: f.name,
      value: target ? lowerExprInContext(f.value, target, env) : lowerExpr(f.value, env),
    };
  });
}

/** The result a `let r = send …` binds, or `undefined` when the record has no
 *  single handler or the handler declares no result. */
function handlerResultType(stmt: SendRhs, env: Env): TypeIR | undefined {
  const ctx = sendContext(stmt, env);
  const record = stmt.target.record;
  const catches = (params: readonly { type: TypeRef }[]): boolean => {
    if (params.length !== 1) return false;
    const t = lowerType(params[0]!.type, env);
    return t.kind === "entity" && t.name === record;
  };
  const results: (TypeIR | undefined)[] = [];
  for (const m of ctx?.members ?? []) {
    if ((isCommandHandler(m) || isQueryHandler(m)) && catches(m.params)) {
      results.push(m.returnType ? lowerType(m.returnType, env) : undefined);
    } else if (isWorkflow(m)) {
      for (const c of m.members) {
        if (c.$type !== "WorkflowCreateDecl" || !catches(c.params)) continue;
        results.push(
          c.returnType ? lowerType(c.returnType, env) : { kind: "id", targetName: m.name },
        );
      }
    }
  }
  return results.length === 1 ? results[0] : undefined;
}

/** The result a `let r = send …` binds (`binder` is the `let`'s name and its
 *  declared type, if any).  An unresolved result types as the declared type,
 *  else `none`; the validator names why. */
export function lowerSendResult(
  rhs: SendRhs,
  binder: { name: string; type?: TypeRef } | undefined,
  env: Env,
): CallResultBindingIR | undefined {
  if (!binder) return undefined;
  const type: TypeIR = binder.type
    ? lowerType(binder.type, env)
    : (handlerResultType(rhs, env) ?? { kind: "none" });
  const errorVariants =
    type.kind === "union"
      ? type.variants.map(variantTag).filter((tag) => isErrorVariantTag(tag, env))
      : [];
  return { name: binder.name, type, errorVariants };
}

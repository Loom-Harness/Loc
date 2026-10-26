// -------------------------------------------------------------------------
// Optional bindings in workflow and handler bodies.
//
// `let c = Customers.find(ByEmail(e))`, `let o = Orders.findById(id)`,
// `let p = Products.findBy(sku: s)` and a `let` over a declared `find …: T?`
// bind `T?`.  Each backend binds the nullable value as is (`Order | null`,
// `Order?`, `None`, `nil`), so the binding is usable only through a null test
// (`c == null`, `c ?? d`) or an `if let` that narrows it.
//
// A member READ of the binding (`o.qty`) is a postfix chain and is refused at
// phase ④ (`loom.nullable-receiver`, `language/validators/nullable-receiver.ts`).
// The two statement forms that dereference a binding do not pass through an
// expression the typing pass sees: an op-call statement (`o.touch()`) and a
// repository delete (`Orders.delete(o)`).  Both would render as a bare call on
// a possibly-null value — TS18047 on node, CS8602 on .NET, a
// NullPointerException on java, an AttributeError on python, a nil match error
// on elixir.  This check refuses them under the same code.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import type { BoundedContextIR, TypeIR, WorkflowIR, WorkflowStmtIR } from "../../types/loom-ir.js";
import type { LoomDiagnostic } from "./diagnostic.js";

/** An `if let` the lowerer could match to no optional read nor optional
 *  binding: it falls back to a `select-one` with no criterion. */
export function isBadIfLetSource(st: Extract<WorkflowStmtIR, { kind: "if-let" }>): boolean {
  return st.op === "select-one" && !st.synthCriterion.name;
}

function isOptional(t: TypeIR): boolean {
  return t.kind === "optional";
}

/** Walk one body, tracking which names hold an un-narrowed optional value.
 *  Each nested body gets its own copy, so a branch's bindings never leak. */
function checkBody(
  stmts: readonly WorkflowStmtIR[],
  scope: Set<string>,
  report: (name: string, use: string) => void,
): void {
  for (const st of stmts) {
    switch (st.kind) {
      case "repo-let":
        if (isOptional(st.returnType)) scope.add(st.name);
        else scope.delete(st.name);
        break;
      case "expr-let":
        if (isOptional(st.type)) scope.add(st.name);
        else scope.delete(st.name);
        break;
      case "factory-let":
        scope.delete(st.name);
        break;
      case "repo-run":
        scope.delete(st.name);
        break;
      case "op-call":
        if (scope.has(st.target)) report(st.target, `.${st.op}()`);
        break;
      case "repo-delete":
        if (st.entity.kind === "ref" && scope.has(st.entity.name)) {
          report(st.entity.name, `${st.repoName}.delete(${st.entity.name})`);
        }
        break;
      case "for-each": {
        const inner = new Set(scope);
        inner.delete(st.var);
        checkBody(st.body, inner, report);
        break;
      }
      case "if-let": {
        // `var` is the narrowed, non-null row in the then-branch only.
        const thenScope = new Set(scope);
        thenScope.delete(st.var);
        checkBody(st.thenBody, thenScope, report);
        checkBody(st.elseBody ?? [], new Set(scope), report);
        break;
      }
      case "precondition":
      case "requires":
      case "emit":
      case "assign":
      case "resource-call":
      case "domain-service-call":
        break;
      default: {
        const _exhaustive: never = st;
        void _exhaustive;
      }
    }
  }
}

function workflowBodies(wf: WorkflowIR): readonly WorkflowStmtIR[][] {
  return [
    ...(wf.creates ?? []).map((c) => c.statements),
    ...(wf.subscriptions ?? []).map((s) => s.statements),
  ];
}

/** Per-context: an op-call or a repository delete on an optional binding that
 *  no `if let` narrowed (`loom.nullable-receiver`). */
export function validateOptionalBindings(ctx: BoundedContextIR, diags: LoomDiagnostic[]): void {
  const bodies: { where: string; stmts: readonly WorkflowStmtIR[] }[] = [
    ...ctx.workflows.flatMap((wf) =>
      workflowBodies(wf).map((stmts) => ({ where: wf.name, stmts })),
    ),
    ...(ctx.commandHandlers ?? []).map((h) => ({ where: h.name, stmts: h.statements })),
    ...(ctx.queryHandlers ?? []).map((h) => ({ where: h.name, stmts: h.statements })),
  ];
  for (const { where, stmts } of bodies) {
    const seen = new Set<string>();
    checkBody(stmts, new Set(), (name, use) => {
      const key = `${name}|${use}`;
      if (seen.has(key)) return;
      seen.add(key);
      diags.push({
        severity: "error",
        code: "loom.nullable-receiver",
        message: diagMessage("loom.nullable-receiver#statement", { where, name, use }),
        source: `${ctx.name}/${where}`,
        origin: ctx.origin,
      });
    });
  }
}

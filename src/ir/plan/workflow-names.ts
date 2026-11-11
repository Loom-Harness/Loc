// The names a body reads and binds.  Backends that reject an unused local
// (`ruff` F841, `mix compile --warnings-as-errors`) bind only what is read, and
// one that declares its locals up front (Java) needs every name the body binds.
// A reader that missed a statement kind dropped a binding the emitted code still
// named (an undefined variable), and one that missed a read kept a binding the
// linter rejects.

import type { ExprIR, RefKind, WorkflowStmtIR } from "../types/loom-ir.js";
import { walkExprDeep, walkWorkflowStmtExprsDeep, walkWorkflowStmtsDeep } from "../util/walk.js";

/** The names of every `ref` read in `statements` (and in `extra` expressions,
 *  such as a create's result value), at any depth — only refs of `refKind`
 *  when one is given. */
export function refsRead(
  statements: readonly WorkflowStmtIR[],
  extra: readonly (ExprIR | undefined)[] = [],
  refKind?: RefKind,
): Set<string> {
  const out = new Set<string>();
  const visit = (e: ExprIR): void => {
    if (e.kind === "ref" && (refKind === undefined || e.refKind === refKind)) out.add(e.name);
  };
  for (const st of statements) walkWorkflowStmtExprsDeep(st, visit);
  for (const e of extra) walkExprDeep(e, visit);
  return out;
}

/** Every name `statements` use: each `ref` read (`refsRead`) plus each
 *  `op-call` receiver, which names the bound aggregate outside any expression
 *  (`order.confirm()` carries `target: "order"`). */
export function namesUsed(
  statements: readonly WorkflowStmtIR[],
  extra: readonly (ExprIR | undefined)[] = [],
): Set<string> {
  const out = refsRead(statements, extra);
  for (const st of statements) {
    walkWorkflowStmtsDeep(st, (s) => {
      if (s.kind === "op-call") out.add(s.target);
    });
  }
  return out;
}

/** Every name a body binds as a local — `let` (expr / repo / factory / run),
 *  `for-each` and `if-let` variables, and the present arm of a `T?` match — in
 *  first-seen order.  Exhaustive over `WorkflowStmtIR`, so a new binding kind
 *  is a compile error here. */
export function namesBound(bodies: readonly (readonly WorkflowStmtIR[])[]): string[] {
  const out = new Set<string>();
  for (const body of bodies) {
    for (const top of body) {
      walkWorkflowStmtsDeep(top, (s) => {
        switch (s.kind) {
          case "factory-let":
          case "repo-let":
          case "repo-run":
          case "expr-let":
            out.add(s.name);
            break;
          case "for-each":
          case "if-let":
            out.add(s.var);
            break;
          // A tagged arm's binding is a pattern variable, not a local.
          case "variant-match":
            if (s.subjectShape === "absence") {
              for (const arm of s.arms) if (arm.binding) out.add(arm.binding);
            }
            break;
          case "repo-delete":
          case "op-call":
          case "precondition":
          case "requires":
          case "emit":
          case "assign":
          case "resource-call":
          case "domain-service-call":
          case "not-found":
            break;
          default: {
            const _exhaustive: never = s;
            void _exhaustive;
          }
        }
      });
    }
  }
  return [...out];
}

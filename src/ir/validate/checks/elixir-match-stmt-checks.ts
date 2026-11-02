// ---------------------------------------------------------------------------
// `loom.elixir-match-stmt-unsupported` — the statement `match` on Phoenix.
//
// A `match` whose arms run statements is legal in an aggregate operation /
// `create` / `destroy`, a domain-service operation, a workflow `create` / `on`
// and a `commandHandler` / `queryHandler` body.  Node, .NET, Java and Python
// render it through the shared statement spines (`_stmt/target.ts`,
// `_workflow/stmt-target.ts`).  The vanilla Phoenix emitters do not render it
// yet: an operation body there threads a rebound `record` through a
// value-producing expression (the `if` statement's `record = if … do … end`),
// and a workflow body is a `with`-chain, so the statement needs its own `case`
// form on both — a real design, not a leaf.
//
// Until that lands, a statement `match` in a body an Elixir deployable hosts is
// refused here rather than reaching the emitters, whose `variant-match` arms
// throw.  When the Phoenix rendering ships, this check narrows to the
// sub-shapes it still cannot render (the `loom.elixir-if-stmt-unsupported`
// pattern: a `return` or a guard inside an arm, an event-sourced body) or is
// deleted, together with those throws.
// ---------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import type { EnrichedLoomModel, StmtIR, WorkflowStmtIR } from "../../types/loom-ir.js";
import { walkStmtsDeep, walkWorkflowStmtsDeep } from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";

function stmtBodyMatches(stmts: readonly StmtIR[]): boolean {
  let found = false;
  for (const s of stmts) {
    walkStmtsDeep(s, (n) => {
      if (n.kind === "variant-match") found = true;
    });
  }
  return found;
}

function workflowBodyMatches(stmts: readonly WorkflowStmtIR[]): boolean {
  let found = false;
  for (const s of stmts) {
    walkWorkflowStmtsDeep(s, (n) => {
      if (n.kind === "variant-match") found = true;
    });
  }
  return found;
}

export function validateElixirMatchStatements(
  loom: EnrichedLoomModel,
  diags: LoomDiagnostic[],
): void {
  for (const sys of loom.systems) {
    // context name → the elixir deployable that emits it (first one wins; the
    // message names a concrete deployable so the author can find it).
    const elixirHost = new Map<string, string>();
    for (const dep of sys.deployables) {
      if (dep.platform !== "elixir") continue;
      for (const cn of dep.contextNames) if (!elixirHost.has(cn)) elixirHost.set(cn, dep.name);
    }
    if (elixirHost.size === 0) continue;
    for (const mod of sys.subdomains) {
      for (const ctx of mod.contexts) {
        const depName = elixirHost.get(ctx.name);
        if (!depName) continue;
        const push = (where: string): void => {
          diags.push({
            severity: "error",
            code: "loom.elixir-match-stmt-unsupported",
            message: diagMessage("loom.elixir-match-stmt-unsupported", { where, name: depName }),
            source: `${ctx.name}/${where}`,
          });
        };
        for (const agg of ctx.aggregates) {
          for (const op of agg.operations) {
            if (stmtBodyMatches(op.statements)) push(`operation '${agg.name}.${op.name}'`);
          }
          for (const c of agg.creates ?? []) {
            if (stmtBodyMatches(c.statements)) push(`create '${agg.name}.${c.name}'`);
          }
          for (const d of agg.destroys ?? []) {
            if (stmtBodyMatches(d.statements)) push(`destroy '${agg.name}.${d.name}'`);
          }
        }
        for (const svc of ctx.domainServices) {
          for (const op of svc.operations) {
            if (stmtBodyMatches(op.body)) push(`domainService operation '${svc.name}.${op.name}'`);
          }
        }
        for (const wf of ctx.workflows) {
          const bodies = [
            ...(wf.creates ?? []).map((c) => c.statements),
            ...(wf.subscriptions ?? []).map((s) => s.statements),
          ];
          if (bodies.some(workflowBodyMatches)) push(`workflow '${wf.name}'`);
        }
        for (const h of ctx.commandHandlers ?? []) {
          if (workflowBodyMatches(h.statements)) push(`commandHandler '${h.name}'`);
        }
        for (const h of ctx.queryHandlers ?? []) {
          if (workflowBodyMatches(h.statements)) push(`queryHandler '${h.name}'`);
        }
      }
    }
  }
}

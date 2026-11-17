// ---------------------------------------------------------------------------
// Where a repository history read may stand (docs/audit.md).
//
// `let h = Orders.history(id)` binds one row's audit trail.  It answers a
// read, so it belongs to a `queryHandler` body, bound with `let`: that is the
// one place every backend renders it, through the same three steps as the
// derived history route (the read gate, reachability through the entity read,
// the masked-field drop).  Anywhere else — a command handler, a workflow, a
// domain service, a bare expression — no backend has a form for it.
//
//   loom.history-read-placement — the read stands outside a queryHandler
//       `let`.
//   loom.history-not-audited    — the aggregate keeps no trail: it has no
//       audited command, or its response record leaves no field to diff.
// ---------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import type { BoundedContextIR, WorkflowStmtIR } from "../../types/loom-ir.js";
import { forEachContextExpr } from "../../util/model-exprs.js";
import { walkWorkflowStmtsDeep } from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";

export function validateHistoryReads(ctx: BoundedContextIR, diags: LoomDiagnostic[]): void {
  const misplaced = (where: string, origin: LoomDiagnostic["origin"]) =>
    diags.push({
      severity: "error",
      code: "loom.history-read-placement",
      message: diagMessage("loom.history-read-placement", { where }),
      source: `${ctx.name}/${where}`,
      origin: origin ?? ctx.origin,
    });
  const each = (body: readonly WorkflowStmtIR[], visit: (s: WorkflowStmtIR) => void) => {
    for (const top of body) walkWorkflowStmtsDeep(top, visit);
  };

  // An `AuditEntry[]` return needs the entry record, which a backend emits
  // beside the history route of an audited aggregate in this context.
  const audited = ctx.repositories.some((r) => r.historyFind);
  for (const h of ctx.queryHandlers ?? []) {
    const rt = h.returnType;
    if (
      !audited &&
      rt?.kind === "array" &&
      rt.element.kind === "primitive" &&
      rt.element.name === "AuditEntry"
    )
      diags.push({
        severity: "error",
        code: "loom.audit-entry-position",
        message: diagMessage("loom.audit-entry-position#unaudited", {
          handler: h.name,
          context: ctx.name,
        }),
        source: `${ctx.name}/${h.name}`,
        origin: ctx.origin,
      });
  }
  for (const h of ctx.queryHandlers ?? []) {
    each(h.statements, (s) => {
      if (s.kind !== "history-let") return;
      const repo = ctx.repositories.find((r) => r.name === s.repoName);
      if (repo?.historyFind) return;
      diags.push({
        severity: "error",
        code: "loom.history-not-audited",
        message: diagMessage("loom.history-not-audited", {
          handler: h.name,
          repoName: s.repoName,
          aggName: s.aggName,
        }),
        source: `${ctx.name}/${h.name}`,
        origin: s.origin ?? ctx.origin,
      });
    });
  }
  for (const h of ctx.commandHandlers ?? []) {
    each(h.statements, (s) => {
      if (s.kind === "history-let") misplaced(`commandHandler '${h.name}'`, s.origin ?? ctx.origin);
    });
  }
  for (const wf of ctx.workflows ?? []) {
    const bodies = [
      ...wf.creates.map((c) => c.statements),
      ...wf.subscriptions.map((o) => o.statements),
    ];
    for (const body of bodies) {
      each(body, (s) => {
        if (s.kind === "history-let") misplaced(`workflow '${wf.name}'`, s.origin ?? wf.origin);
      });
    }
  }
  // An expression read (`return Orders.history(id)`, a domain-service body, a
  // guard): history binds only through a `let`.
  forEachContextExpr(ctx, ({ expr, source }) => {
    if (expr.kind !== "call" || expr.callKind !== "repo-read" || expr.repoRead?.op !== "history")
      return;
    diags.push({
      severity: "error",
      code: "loom.history-read-placement",
      message: diagMessage("loom.history-read-placement", { where: source }),
      source,
      origin: expr.origin ?? ctx.origin,
    });
  });
}

// -------------------------------------------------------------------------
// Reactor principal checks (ruling D1, `docs/decisions.md`
// D-REACTOR-SYSTEM-PRINCIPAL).
//
// An event reactor — a workflow's event-triggered `create(e) by …` starter or
// an `on(e)` subscription — has no request principal.  It runs as the SYSTEM
// principal: `currentUser.isSystem` is true, every claim is empty, and the
// tenant is the triggering event's.  Gates are evaluated against it normally,
// so two things become statically knowable, and both are reported here:
//
//   1. `loom.reactor-gate-unsatisfiable` (warning) — a reactor reaches a
//      `requires` gate (its own, or the hoisted gate of an operation it calls)
//      that reads `currentUser` and never mentions `currentUser.isSystem`.
//      With every claim empty that gate cannot pass, so the reactor 403s at
//      runtime on every event.  The fix is a disjunct:
//      `requires currentUser.isSystem || …`.
//
//   2. `loom.timer-tenant-read` (error) — a reactor on a TIMER tick reads a
//      `tenantOwned` aggregate without opting out of the tenant filter.  A
//      tick has no tenant, so the read's tenant filter matches nothing; the
//      read must say it is deliberately cross-tenant (`ignoring tenantOwned`
//      on the declared `find` / inline `Repo.run`).
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import {
  type BoundedContextIR,
  type ExprIR,
  exprUsesCurrentUser,
  type SystemIR,
  type WorkflowStmtIR,
} from "../../types/loom-ir.js";
import { operationGates } from "../../util/op-gates.js";
import { exprMentionsIsSystem, reactorBodies } from "../../util/system-principal.js";
import { hasTenantOwned, TENANT_OWNED_CAPABILITY } from "../../util/tenant-stance.js";
import { walkWorkflowStmtsDeep } from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";

/** A gate the system principal can never satisfy: it reads the principal and
 *  never admits `isSystem`. */
function gateExcludesSystem(e: ExprIR): boolean {
  return exprUsesCurrentUser(e) && !exprMentionsIsSystem(e);
}

/** Visit every statement of a reactor body, at any depth. */
function eachStmt(statements: readonly WorkflowStmtIR[], visit: (s: WorkflowStmtIR) => void) {
  for (const top of statements) walkWorkflowStmtsDeep(top, visit);
}

export function validateReactorGates(ctx: BoundedContextIR, diags: LoomDiagnostic[]): void {
  for (const wf of ctx.workflows ?? []) {
    for (const body of reactorBodies(wf)) {
      const reported = new Set<string>();
      const report = (where: string, source: string): void => {
        if (reported.has(where)) return;
        reported.add(where);
        diags.push({
          severity: "warning",
          code: "loom.reactor-gate-unsatisfiable",
          message: diagMessage("loom.reactor-gate-unsatisfiable", {
            reactor: body.label,
            event: body.event,
            where,
            gate: source,
          }),
          source: `${ctx.name}/${wf.name}`,
        });
      };
      eachStmt(body.statements, (s) => {
        if (s.kind === "requires") {
          if (gateExcludesSystem(s.expr)) report(`its own \`requires\``, s.source);
          return;
        }
        if (s.kind !== "op-call") return;
        const op = ctx.aggregates
          .find((a) => a.name === s.aggName)
          ?.operations.find((o) => o.name === s.op);
        for (const g of op ? operationGates(op) : []) {
          if (gateExcludesSystem(g.expr)) report(`${s.aggName}.${s.op}()`, g.source);
        }
      });
    }
  }
}

/** Does a workflow read of `aggName` via `method` opt out of the tenant
 *  filter?  Only a declared `find` / inline `Repo.run` carries an `ignoring`
 *  clause; `getById` and the auto-reads cannot. */
function readIgnoresTenant(
  ctx: BoundedContextIR,
  s: Extract<WorkflowStmtIR, { kind: "repo-let" | "repo-run" }>,
): boolean {
  if (s.kind === "repo-run") {
    return !!s.bypassAll || (s.bypassCaps ?? []).includes(TENANT_OWNED_CAPABILITY);
  }
  const find = ctx.repositories
    .find((r) => r.name === s.repoName)
    ?.finds.find((f) => f.name === s.method);
  return !!find && (!!find.bypassAll || (find.bypassCaps ?? []).includes(TENANT_OWNED_CAPABILITY));
}

export function validateTimerTenantReads(sys: SystemIR, diags: LoomDiagnostic[]): void {
  const timers = sys.timerSources ?? [];
  if (timers.length === 0 || !sys.tenancy) return;
  for (const sub of sys.subdomains) {
    for (const ctx of sub.contexts) {
      const ticks = new Map(
        timers.filter((t) => t.context === ctx.name).map((t) => [t.event, t.name] as const),
      );
      if (ticks.size === 0) continue;
      for (const wf of ctx.workflows ?? []) {
        for (const body of reactorBodies(wf)) {
          const timer = ticks.get(body.event);
          if (!timer) continue;
          eachStmt(body.statements, (s) => {
            if (s.kind !== "repo-let" && s.kind !== "repo-run") return;
            const agg = ctx.aggregates.find((a) => a.name === s.aggName);
            if (!agg || !hasTenantOwned(agg) || readIgnoresTenant(ctx, s)) return;
            diags.push({
              severity: "error",
              code: "loom.timer-tenant-read",
              message: diagMessage("loom.timer-tenant-read", {
                reactor: body.label,
                timer,
                agg: agg.name,
                read: `${s.repoName}.${s.kind === "repo-run" ? `run(${s.retrievalName})` : `${s.method}(…)`}`,
              }),
              source: `${ctx.name}/${wf.name}`,
            });
          });
        }
      }
    }
  }
}

// -------------------------------------------------------------------------
// `loom.unused-let` — a `let` in a workflow / handler / domain-service body
// that nothing reads.
//
// An unread binding is at best noise and at worst a half-finished body: the
// author loaded something meaning to use it.  Every backend still emits it,
// and a strict target lints it (python's ruff F841 on `tech = await
// technicians.get_by_id(...)`).  A WARNING: the body still means what it says.
//
// Three bindings are used without being read, so they are not flagged:
//
//   * a `get` / `getBy` read (`let t = Technicians.get(id)`).  The read raises
//     404 when the row is missing, so the binding is an EXISTENCE CHECK —
//     dropping it would change behaviour.  A `find` / `findBy` / `all` read
//     answers absence as a value instead, so its unread binding does nothing
//     and IS flagged;
//   * a binding the body SAVES — at exit, or at the end of the branch / loop
//     iteration that created or mutated it (`let o = Order.create(…)` is
//     written by the save the body emits, not by a read).  The saves lists
//     (`savesAtExit`, `savesInThen` / `savesInElse` / `savesInArm` /
//     `savesPerIteration`) name exactly those bindings;
//   * a binding an operation call mutates (`o.place()` reads `o` by name, not
//     through an expression).
//
// Uses are collected over every expression the body reaches, through
// `walk.ts` (nested `if let` / `for` / `match` bodies and lambda blocks
// included), plus the name-addressed slots no expression carries: an
// operation call's target and an assignment's root.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { refsRead } from "../../plan/index.js";
import type { BoundedContextIR, ExprIR, StmtIR, WorkflowStmtIR } from "../../types/loom-ir.js";
import {
  walkExprDeep,
  walkStmtExprsDeep,
  walkStmtsDeep,
  walkWorkflowStmtsDeep,
} from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";

type Saves = readonly { name: string }[];

/** The two ruled exclusions.  Both are on in the shipped gate; the knobs exist
 *  so a test can show each one is load-bearing on a shipped model. */
export interface UnusedLetExclusions {
  /** A `get` / `getBy` read's binding is an existence check. */
  existenceReads: boolean;
  /** A binding the body saves is used by the save. */
  saves: boolean;
}

const RULED: UnusedLetExclusions = { existenceReads: true, saves: true };

interface LetSite {
  name: string;
  origin?: LoomDiagnostic["origin"];
}

/** A repository read that raises not-found on a miss — its binding is an
 *  existence check. */
function isExistenceRead(e: ExprIR, ex: UnusedLetExclusions): boolean {
  if (!ex.existenceReads) return false;
  if (e.kind !== "call" || e.callKind !== "repo-read") return false;
  const op = e.repoRead?.op;
  return op === "load" || op === "load-by-key";
}

function refNames(e: ExprIR, into: Set<string>): void {
  walkExprDeep(e, (x) => {
    if (x.kind === "ref") into.add(x.name);
  });
}

/** The unread `let`s of a workflow-statement body (a workflow `create` / `on`,
 *  a command or query handler). */
function unreadWorkflowLets(
  statements: readonly WorkflowStmtIR[],
  savesAtExit: Saves,
  tail: readonly (ExprIR | undefined)[],
  ex: UnusedLetExclusions,
): LetSite[] {
  const lets: LetSite[] = [];
  const used = new Set<string>();
  const saved = (saves: Saves): void => {
    if (ex.saves) for (const x of saves) used.add(x.name);
  };
  saved(savesAtExit);
  for (const e of tail) if (e) refNames(e, used);
  for (const n of refsRead(statements)) used.add(n);
  for (const top of statements) {
    walkWorkflowStmtsDeep(top, (s) => {
      switch (s.kind) {
        case "factory-let":
        case "repo-run":
          lets.push({ name: s.name, origin: s.origin });
          break;
        case "repo-let":
          if (!ex.existenceReads || (s.op !== "load" && s.op !== "load-by-key"))
            lets.push({ name: s.name, origin: s.origin });
          break;
        case "expr-let":
          if (!isExistenceRead(s.expr, ex)) lets.push({ name: s.name, origin: s.origin });
          break;
        case "op-call":
          used.add(s.target);
          if (s.result) lets.push({ name: s.result.name, origin: s.origin });
          break;
        case "assign":
          if (s.target.segments[0]) used.add(s.target.segments[0]);
          break;
        case "for-each":
          saved(s.savesPerIteration);
          break;
        case "if-let":
          saved(s.savesInThen);
          saved(s.savesInElse);
          break;
        case "variant-match":
          for (const arm of s.arms) saved(arm.savesInArm);
          saved(s.savesInElse);
          break;
        case "precondition":
        case "requires":
        case "emit":
        case "repo-delete":
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
  return lets.filter((l) => !used.has(l.name));
}

/** The unread `let`s of an operation-statement body (a domain-service
 *  operation). */
function unreadStmtLets(body: readonly StmtIR[], ex: UnusedLetExclusions): LetSite[] {
  const lets: LetSite[] = [];
  const used = new Set<string>();
  for (const top of body) {
    walkStmtExprsDeep(top, (e) => {
      if (e.kind === "ref") used.add(e.name);
    });
    walkStmtsDeep(top, (s) => {
      if (s.kind === "let" && !isExistenceRead(s.expr, ex))
        lets.push({ name: s.name, origin: s.origin });
      if ((s.kind === "assign" || s.kind === "add" || s.kind === "remove") && s.target.segments[0])
        used.add(s.target.segments[0]);
    });
  }
  return lets.filter((l) => !used.has(l.name));
}

export function validateUnusedLets(
  ctx: BoundedContextIR,
  diags: LoomDiagnostic[],
  ex: UnusedLetExclusions = RULED,
): void {
  const report = (lets: LetSite[], owner: string): void => {
    for (const l of lets) {
      diags.push({
        severity: "warning",
        code: "loom.unused-let",
        message: diagMessage("loom.unused-let", { name: l.name, owner }),
        source: `${ctx.name}/${owner}`,
        ...(l.origin ? { origin: l.origin } : {}),
      });
    }
  };
  for (const wf of ctx.workflows) {
    for (const cr of wf.creates) {
      report(
        unreadWorkflowLets(cr.statements, cr.savesAtExit, [cr.returnValue, cr.correlation], ex),
        `workflow ${wf.name} create${cr.name ? ` ${cr.name}` : ""}`,
      );
    }
    for (const on of wf.subscriptions ?? []) {
      report(
        unreadWorkflowLets(on.statements, on.savesAtExit, [on.correlation], ex),
        `workflow ${wf.name} on ${on.event}`,
      );
    }
  }
  for (const h of ctx.commandHandlers ?? []) {
    report(
      unreadWorkflowLets(h.statements, h.savesAtExit, [h.returnValue], ex),
      `commandHandler ${h.name}`,
    );
  }
  for (const h of ctx.queryHandlers ?? []) {
    report(
      unreadWorkflowLets(h.statements, h.savesAtExit, [h.returnValue], ex),
      `queryHandler ${h.name}`,
    );
  }
  for (const svc of ctx.domainServices) {
    for (const op of svc.operations) {
      report(unreadStmtLets(op.body, ex), `domainService ${svc.name}.${op.name}`);
    }
  }
}

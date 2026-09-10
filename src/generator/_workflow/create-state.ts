// ---------------------------------------------------------------------------
// The command-side twin of the reactor's correlation routing (F58 / M-T6.60).
//
// A workflow with an id-shaped state field is a SAGA: every backend emits a
// persisted correlation row for it (a Drizzle/EF/JPA/SQLAlchemy/Ecto table
// keyed by that field) and every backend's EVENT-triggered handler already
// loads-or-allocates that row, binds the body's `this.<stateField>` to it
// (`thisName: "state"`) and saves it at exit.
//
// The COMMAND-triggered `create` skipped all three: it rendered the body with
// the default `this` receiver — which is unbound in a Hono arrow function, a
// .NET/Java handler class with no such member, a module-level python `async
// def`, and an Elixir `with`-chain — and never created the row, so a later `on`
// reactor for the same key logged `event_unrouted` forever.
//
// The routing key on the event side is the `by <expr>` value, else the event
// field whose NAME matches the correlation field (the omitted-`by` rule).  The
// command side has no `by` clause, so the name-match rule is the whole rule:
// the create param called `<correlationField>` carries the key.  A workflow
// whose command create does not supply the key has no addressable instance and
// stays on the pre-existing (unbound) path — that gap is a validator ruling,
// not an emitter decision, and is tracked separately.
// ---------------------------------------------------------------------------

import type { ExprIR, ParamIR, WorkflowIR, WorkflowStmtIR } from "../../ir/types/loom-ir.js";
import { walkWorkflowStmtExprsDeep, walkWorkflowStmtsDeep } from "../../ir/util/walk.js";
import { emitsCommandRoute } from "../../ir/util/workflow-command-route.js";

/** The create param that supplies this workflow's correlation key, or
 *  `undefined` when the command route has no persisted instance to address:
 *  the workflow is stateless (no correlation field), event-sourced (its state
 *  is folded from a stream, never a mutable row), its facade is
 *  event-triggered (no command route at all), or no param name-matches the
 *  correlation field. */
export function commandCreateCorrelationParam(wf: WorkflowIR): ParamIR | undefined {
  if (wf.eventSourced) return undefined;
  const corr = wf.correlationField;
  if (!corr) return undefined;
  if (!emitsCommandRoute(wf)) return undefined;
  return wf.params.find((p) => p.name === corr);
}

/** True when a workflow body reads or writes its OWN state — an `assign`
 *  statement, or any expression naming a `this-prop` / `this-derived` on the
 *  workflow instance.  Backends that must decide whether to BIND the loaded row
 *  (an unused binding is a hard error under Elixir's `-Werror`) key off this;
 *  the row is still allocated either way, so a later `on` reactor routes. */
export function workflowBodyUsesOwnState(statements: readonly WorkflowStmtIR[]): boolean {
  let found = false;
  const seeExpr = (e: ExprIR): void => {
    if (found) return;
    if (e.kind === "ref" && (e.refKind === "this-prop" || e.refKind === "this-derived")) {
      found = true;
    }
  };
  for (const st of statements) {
    if (found) break;
    // Nested `for-each` / `if-let` bodies count too — the shared deep walkers
    // own that recursion (`ir/util/walk.ts`).
    walkWorkflowStmtsDeep(st, (inner) => {
      if (inner.kind === "assign") found = true;
    });
    if (found) break;
    walkWorkflowStmtExprsDeep(st, seeExpr);
  }
  return found;
}

/** True when a workflow body WRITES its own state (`field := …`, including the
 *  compound forms, at any nesting depth).  Narrower than
 *  {@link workflowBodyUsesOwnState}: a body that only READS state needs the row
 *  BOUND but has nothing to write back. */
export function workflowBodyWritesOwnState(statements: readonly WorkflowStmtIR[]): boolean {
  let found = false;
  for (const st of statements) {
    if (found) break;
    walkWorkflowStmtsDeep(st, (inner) => {
      if (inner.kind === "assign") found = true;
    });
  }
  return found;
}

// -------------------------------------------------------------------------
// Workflow SAGA-STATE addressability — one rule, two consumers.
//
// A workflow's `Property` members are saga state: they live in a persisted
// correlation row keyed by the workflow's one id-shaped state field, and every
// backend renders a member body that touches them against that LOADED row
// (`thisName: "state"`).  So one question decides both halves of the pipeline —
// "does this command create name the row it addresses?":
//
//   * phase ⑧ (`generator/_workflow/create-state.ts` + the five workflow
//     emitters) loads-or-allocates that row and binds the body to it;
//   * phase ⑦ (`ir/validate/checks/workflow-checks.ts`) REFUSES the shapes the
//     answer is "no" for, so they stop compiling to an unbound receiver
//     (F58 / M-T6.62).
//
// The two must be exact complements — a shape the validator admits and the
// emitter cannot address is the original bug — so the rule lives once, here,
// at IR level.  It has to be IR-level rather than beside its generator consumer
// because the validator cannot import DOWN-pipeline from `generator/` (the same
// reason `workflow-command-route.ts` sits here).  Pure, platform-neutral,
// browser-safe.
// -------------------------------------------------------------------------
import type { CreateIR, ExprIR, ParamIR, WorkflowIR, WorkflowStmtIR } from "../types/loom-ir.js";
import { walkWorkflowStmtExprsDeep, walkWorkflowStmtsDeep } from "./walk.js";
import { emitsCommandRoute } from "./workflow-command-route.js";

/** True when a workflow body reads or writes its OWN state — an `assign`
 *  statement, or any expression naming a `this-prop` / `this-derived` on the
 *  workflow instance. */
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

/** The primary (facade) create — the one the HTTP command route renders. */
export function facadeCreate(wf: WorkflowIR): CreateIR | undefined {
  return wf.creates.find((c) => c.name === null && c.triggerKind === "command") ?? wf.creates[0];
}

/**
 * The create param that supplies this workflow's correlation key, or
 * `undefined` when the command route has no persisted instance to address.
 *
 * The event side routes by `by <expr>`, else by the event field whose NAME
 * matches the correlation field (the omitted-`by` rule).  A command create has
 * no `by` clause at all — a `by` on a create is what MAKES it event-triggered
 * (`lowerWorkflowCreate`) — so the key comes from a parameter, in one of two
 * spellings, both of which name a value already in hand before the body runs:
 *
 *   create(orderId: Order id) { … }                    the param IS the field
 *   create start(order: Order id) { orderId := order } assigned from a param
 *
 * `undefined` means one of: stateless (no correlation field), event-sourced
 * (state folded from a stream, never a mutable row), an event-triggered facade
 * (no command route), or NEITHER spelling — which phase ⑦ refuses with
 * `loom.workflow-create-correlation-unsupplied`.
 */
export function commandCreateCorrelationParam(wf: WorkflowIR): ParamIR | undefined {
  if (wf.eventSourced) return undefined;
  const corr = wf.correlationField;
  if (!corr) return undefined;
  if (!emitsCommandRoute(wf)) return undefined;
  const named = wf.params.find((p) => p.name === corr);
  if (named) return named;
  return correlationAssignedFromParam(wf, corr);
}

/** The second spelling, and the one every hand-written starter uses: the create
 *  takes a differently-named param and ASSIGNS the correlation field from it.
 *
 *  TWO narrowings, both because the row is loaded-or-allocated BEFORE the first
 *  statement runs and the key must therefore be certain by then:
 *
 *    * the RHS must be a bare PARAM REFERENCE.  A computed key
 *      (`orderId := Ids.derive(x)`) is not hoistable in general.
 *    * the assignment must be a TOP-LEVEL statement of the create body, so it
 *      is unconditional.  A `<corr> :=` inside an `if` / `if-let` / `for-each`
 *      branch may never run, and a key that is only sometimes set is not an
 *      address — it is the same "no instance" case wearing a branch.
 *
 *  Both narrowings REFUSE (`loom.workflow-create-correlation-unsupplied`)
 *  rather than emit unbound, which is the point.
 *
 *  This spelling was the residue #2850's name-match-only rule left behind: it
 *  miscompiled on node / .NET / java / elixir (an unbound `this` / `state`) and
 *  dropped SILENTLY on python (the write landed in a request-scoped
 *  `SimpleNamespace`, the saga row was never inserted, and
 *  `/workflows/<wf>/instances` answered empty forever).  It is the exact shape
 *  `test/generator/workflow-instance-gate.test.ts` drives on all five. */
function correlationAssignedFromParam(wf: WorkflowIR, corr: string): ParamIR | undefined {
  const facade = facadeCreate(wf);
  if (!facade || facade.triggerKind !== "command") return undefined;
  for (const st of facade.statements) {
    if (st.kind !== "assign") continue;
    if (st.target.segments.length !== 1 || st.target.segments[0] !== corr) continue;
    const v = st.value;
    if (v.kind !== "ref" || v.refKind !== "param") continue;
    const key = facade.params.find((p) => p.name === v.name);
    if (key) return key;
  }
  return undefined;
}

// -------------------------------------------------------------------------
// Shared "does this workflow expose an HTTP command route?" predicate.
//
// A workflow exposes a POST command surface when its facade — the primary
// unnamed command-triggered create, else the first create — is
// command-triggered.  A workflow whose facade is event-triggered
// (`create(e: Event)`) is a reactor / saga started by an event and invoked
// only by the in-process dispatcher, never by an HTTP call, so it has no
// command route.  A create-less workflow keeps an empty route.
//
// It lives at IR level (`ir/util/`) so every backend imports it DOWN the
// pipeline — the Hono, .NET, and Python workflow emitters each carried a
// byte-identical copy of this rule (the `page-kind.ts` precedent).  Pure,
// platform-neutral, browser-safe.
// -------------------------------------------------------------------------
import type {
  CreateIR,
  EnrichedBoundedContextIR,
  ExprIR,
  TypeIR,
  WorkflowIR,
} from "../types/loom-ir.js";

/** The create the command route serves — the primary unnamed command-triggered
 *  create, else the first create (the `WorkflowIR.params`/`statements` facade).
 *  File-local twin of `workflow-own-state.ts`'s exported `facadeCreate`, which
 *  imports THIS module (so it cannot be imported back without a cycle). */
function routedCreate(wf: WorkflowIR): CreateIR | undefined {
  return wf.creates.find((c) => c.name === null && c.triggerKind === "command") ?? wf.creates[0];
}

/** True when the workflow has an HTTP command surface (a POST route). */
export function emitsCommandRoute(wf: WorkflowIR): boolean {
  const facade = routedCreate(wf);
  return !facade || facade.triggerKind === "command";
}

/** The declared result of the workflow's command route — `create(…): T { …
 *  return <expr> }` on the create the route serves.  When present the route
 *  answers 200 with `value` as its JSON body; absent ⇒ the unchanged 204.  Every
 *  backend's workflow-route emitter reads this one predicate, so "does this
 *  route return a body" cannot drift between them. */
export function commandCreateResult(wf: WorkflowIR): { type: TypeIR; value: ExprIR } | undefined {
  if (!emitsCommandRoute(wf)) return undefined;
  const c = routedCreate(wf);
  return c?.returnType && c.returnValue ? { type: c.returnType, value: c.returnValue } : undefined;
}

/** The command-route-bearing workflows of a context (filter helper). */
export function commandWorkflowsOf(ctx: EnrichedBoundedContextIR): WorkflowIR[] {
  return ctx.workflows.filter(emitsCommandRoute);
}

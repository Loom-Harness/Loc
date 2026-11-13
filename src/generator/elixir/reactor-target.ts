// The reactor / event-triggered starter body on the shared workflow
// `pipeline` spine (`_workflow/stmt-target.ts`): the reactor flavour of the
// Elixir workflow target, and the assembly of a lowered body into one block.
// Shared by the saga-row handler (`dispatch-emit.ts`) and the event-sourced
// handler (`vanilla/workflow-eventsourced-emit.ts`).

import type { SaveEntry } from "../../ir/plan/index.js";
import type { EnrichedBoundedContextIR, ExprIR, WorkflowStmtIR } from "../../ir/types/loom-ir.js";
import type { OriginRef } from "../../ir/types/origin.js";
import { workflowBodyUsesOwnState } from "../../ir/util/workflow-own-state.js";
import { snake, upperFirst } from "../../util/naming.js";
import {
  lowerWorkflowPipeline,
  type PipelineStep,
  type WorkflowPipelineTarget,
} from "../_workflow/stmt-target.js";
import type { ElixirChannelsCfg } from "./channels-emit.js";
import { internalCreateFn, internalDeleteFn } from "./lifecycle-seam.js";
import { type RenderCtx, renderExpr } from "./render-expr.js";
import { denialTerm } from "./vanilla/denial.js";
import { emitsRestDelete } from "./vanilla/rest-surface.js";
import { type ElixirSavePlan, NO_SAVE_PLAN } from "./vanilla/save-plan.js";
import {
  assembleChain,
  assembledStepText,
  elixirWorkflowTarget,
  saveSteps,
  tupleBind,
} from "./vanilla/workflow-execution-emit.js";

export interface RenderBodyResult {
  /** 0-indented Elixir lines (the caller indents the block to its position). */
  lines: string[];
  /** One `fragment()` anchor per lowered step: the text it renders to inside
   *  the chain, paired with its statement's origin. */
  regions: { text: string; origin: OriginRef | undefined }[];
}

/** A reactor / starter body as one block.  It runs in source order — a guard
 *  after a write sees that write's binding — and is one transaction with the
 *  handler's saga row: the first failure (a guard, a not-found, an operation's
 *  `{:error, _}`) is thrown, so `Repo.transaction` rolls the whole reaction
 *  back and the dispatcher that called it logs or retries it (workflow.md
 *  § Reactor failures), exactly as the other backends' raise does. */
export function renderReactorBody(
  statements: readonly WorkflowStmtIR[],
  target: WorkflowPipelineTarget,
  /** The body's exit saves and the plan that decides which it writes
   *  (`save-plan.ts`); a body with none omits it. */
  exit?: { saves: readonly SaveEntry[]; plan: ElixirSavePlan; contextModule: string },
): RenderBodyResult {
  const chunks = lowerWorkflowPipeline(statements, target);
  const all = [
    ...chunks.flat(),
    ...(exit ? saveSteps(exit.saves, exit.plan, exit.contextModule) : []),
  ];
  const regions = chunks.flatMap((steps, i) =>
    steps.map((step) => ({
      text: assembledStepText(all, step),
      origin: statements[i]!.origin,
    })),
  );
  return {
    lines: assembleChain(all, ":ok", (err) => `throw(${err})`),
    regions,
  };
}

/** The reactor flavour of the Elixir workflow target: the command target's
 *  chain, with the leaves a reactor spells differently.  A reactor has no
 *  request principal (reads take no actor, a create takes the ungated seam),
 *  its `emit` re-enters the context `Dispatcher` (or the broker tee) so
 *  choreography chains keep fanning out, and its own-state `:=` persists the
 *  saga row. */
export function reactorTarget(
  ctx: EnrichedBoundedContextIR,
  renderCtx: RenderCtx,
  contextModule: string,
  channels?: ElixirChannelsCfg,
  plan: ElixirSavePlan = NO_SAVE_PLAN,
): WorkflowPipelineTarget {
  const base = elixirWorkflowTarget(contextModule, renderCtx, ctx, plan);
  const expr = (e: ExprIR): string => renderExpr(e, renderCtx);
  const fieldsOf = (fields: readonly { name: string; value: ExprIR }[]): string =>
    fields.map((f) => `${snake(f.name)}: ${expr(f.value)}`).join(", ");
  const appModule = contextModule.split(".").slice(0, -1).join(".");
  // A guard fails the chain with the shared denial term (`denialTerm`) — the
  // tagged 2-tuple every other producer answers.
  const guard = (
    st: Extract<WorkflowStmtIR, { kind: "precondition" | "requires" }>,
  ): PipelineStep[] => [
    {
      kind: "clause",
      text: `:ok <- (if ${expr(st.expr)}, do: :ok, else: {:error, ${denialTerm(st)}})`,
    },
  ];
  let emitted = 0;
  return {
    ...base,
    precondition: guard,
    requires: guard,

    // The IN-PROCESS create: an event dispatcher has no request principal, so
    // it takes the ungated seam (see `./lifecycle-seam.ts`).
    factoryLet: (st, scope) => {
      const { pattern, bindName } = tupleBind(st.name, scope);
      const fn = internalCreateFn(
        st.aggName,
        ctx.aggregates.find((a) => a.name === st.aggName),
      );
      return [
        {
          kind: "clause",
          text: `{:ok, ${pattern}} <- ${contextModule}.${fn}(%{${fieldsOf(st.fields)}})`,
          ...(bindName ? { bindName } : {}),
        },
      ];
    },

    // A re-emit dispatches once the chain succeeded.  The event is built where
    // the source states it: when a later statement may rebind what it reads
    // (an own-state `:=`, an operation's rebound handle), it is bound first and
    // dispatched after, so it carries the values of its own position.
    emit: (st, scope) => {
      const struct = `%${contextModule}.Events.${upperFirst(st.eventName)}{${fieldsOf(st.fields)}}`;
      const dispatch = (ev: string): string =>
        channels
          ? `${channels.appModule}.Channels.dispatch(${ev}, ${contextModule}.Dispatcher)`
          : `${contextModule}.Dispatcher.dispatch(${ev})`;
      if (!scope.rest.some((s) => s.kind === "assign" || s.kind === "op-call")) {
        return [{ kind: "effect", text: dispatch(struct) }];
      }
      const name = `emitted_${++emitted}`;
      return [
        { kind: "let", pattern: name, expr: struct },
        { kind: "effect", text: dispatch(name) },
      ];
    },

    // `field := value` — the saga state is a plain Ecto schema: persist the
    // write in place and rebind `state` when a later statement reads it.
    assign: (st, scope) => [
      {
        kind: "let",
        pattern: workflowBodyUsesOwnState(scope.rest) ? "state" : "_state",
        expr: `${appModule}.Repo.update!(Ecto.Changeset.change(state, %{${snake(st.target.segments[0]!)}: ${expr(st.value)}}))`,
      },
    ],

    // The in-process delete entry exists only when the aggregate has a delete
    // surface (`emitsRestDelete`); without one, `Repo.delete/1` — what the
    // repository's `delete/1` does, with the same return shape.
    repoDelete: (st) => {
      const agg = ctx.aggregates.find((a) => a.name === st.aggName);
      const entity = expr(st.entity);
      const call =
        agg && emitsRestDelete(agg)
          ? `${contextModule}.${internalDeleteFn(st.aggName, agg)}(${entity})`
          : `${appModule}.Repo.delete(${entity})`;
      return [{ kind: "clause", text: `{:ok, _} <- ${call}` }];
    },
  };
}

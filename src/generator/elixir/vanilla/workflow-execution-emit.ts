// ---------------------------------------------------------------------------
// Vanilla workflow execution emit — `lib/<app>/<ctx>/workflows/<wf>.ex` +
// `lib/<app>_web/controllers/workflows_controller.ex`
// (vanilla-foundation-tdd-plan.md).
//
// Workflows are plain Elixir modules.  A workflow becomes a module with
// `run/1` returning `{:ok, _} | {:error, _}`; `transactional`
// workflows wrap their body in `Repo.transaction/1`.  Cross-aggregate
// operation calls (`<aggregate>.<op>(args)` in the workflow body)
// route through the per-context named-operation functions emitted
// by `context-emit.ts`.
//
// Body lowering by WorkflowStmtIR kind:
//   factory-let  → `{:ok, <name>} <- Context.create_<agg>(%{...})`
//   op-call      → `{:ok, _}      <- Context.<op>_<agg>(target, %{...})`
//   precondition → `:ok <- (if <cond>, do: :ok, else: {:error, :precondition_failed})`
//   requires     → `:ok <- (if <cond>, do: :ok, else: {:error, :forbidden})`
//   expr-let     → `<name> <- (<expr>)` (always succeeds; binds `name`)
//   repo-let     → `{:ok, <name>} <- Context.get_<agg>(id)` (getById)
//                  OR `{:ok, <name>} <- Context.<find>_<agg>(args...)`
//                  (custom find via the per-find defdelegate emitted by
//                  `context-emit.ts` → `repository-emit.ts:renderFindFn`)
//   emit         → `Phoenix.PubSub.broadcast(App.PubSub, "events",
//                  %App.Ctx.Events.<Name>{...})` — rendered INSIDE the
//                  with-chain's do-branch so a failed precondition / op
//                  short-circuits and the broadcast is skipped.  The
//                  `Events.<Name>` struct module is emitted by the
//                  orchestrator's `emitVanillaEventModules` hook.
//   resource-call → `_ = <App>.Resources.<Type>.<res>_<verb>(args)` — bare
//                   side-effect call, rendered INSIDE the with-chain's
//                   do-branch like `emit`.  The adapter helper modules are
//                   emitted by the orchestrator's `emitPhoenixResourceFiles`
//                   reuse.
//   repo-run     → `{:ok, <name>} <- Context.run_<ret>_<agg>(args..., limit:, offset:)`
//                   against the per-context retrieval defdelegate (the vanilla
//                   retrieval `run/N` returns `{:ok, [_]}`).  Pagination opts
//                   ride as a trailing keyword list.
//   for-each     → `{:ok, _} <- Enum.reduce_while(xs, {:ok, nil}, fn x, _acc ->
//                                  case Context.<op>_<agg>(x, %{}) do ... end
//                                end)` — first body-op failure halts the reduce
//                   and bubbles `{:error, _}` up the with-chain.  A single
//                   op-call keeps the flat `case` shape; a broader body
//                   (op-call + factory-let / emit / expr-let / guards) lowers
//                   through a per-iteration `with`-chain whose first failed
//                   clause halts the reduce.
//   if-let       → `{:ok, _} <- (var = case ...run_<ret>...; if var != nil
//                   do <thenBody> else <elseBody> end)`.  Both branches lower
//                   the full statement set (op-call / factory-let / emit /
//                   expr-let; a guard-bearing branch wraps in a `with`-chain
//                   so a failed `precondition` / `requires` threads `{:error,
//                   tag}` up the outer with-chain).
//
// The switch over `lowerStatement` is exhaustive over the IR union — there is
// no `default:` / `# TODO` fallthrough.  Adding a kind to `WorkflowStmtIR`
// fails the TypeScript compile until a matching arm is added here AND in
// `collectWorkflowStmtParamRefs`.
//
// Param surfacing: a workflow body that references a declared
// create-param (`create(initialTitle: string) { … initialTitle … }`)
// gets a leading destructure of exactly the referenced params off the
// `run/1` map — `%{"initialTitle" => initial_title} = params` — so the
// bare-local rendering of a `param` ref resolves.  Only referenced params
// are bound: an unused binding would trip `--warnings-as-errors`.
//
// The KEY is the declared param name verbatim; only the BOUND LOCAL is
// snake_cased.  `params` is Phoenix's decoded JSON map, so its keys are the
// camelCase wire names every other backend also accepts.  Destructuring the
// snake_cased key instead (`"initial_title"`) raises `MatchError` at runtime on
// any multi-word param, on a workflow that compiles perfectly — `mix compile`
// cannot see it, only a booted request can.
// ---------------------------------------------------------------------------

import {
  lookupOp,
  namesUsed,
  refsRead,
  requiredStateFields,
  workflowIsolation,
  workflowNeedsCurrentUser,
  workflowRunsInTransaction,
} from "../../../ir/plan/index.js";
import {
  type AggregateIR,
  type BoundedContextIR,
  type ExprIR,
  type IsolationLevel,
  type OperationIR,
  operationUsesCurrentUser,
  type SystemIR,
  type WorkflowIR,
  type WorkflowStmtIR,
  workflowEmitsCommandRoute,
  workflowUsesCurrentUser,
} from "../../../ir/types/loom-ir.js";
import type { OriginRef } from "../../../ir/types/origin.js";
import { aggregatesNeedConcurrency } from "../../../ir/util/aggregate-flags.js";
import { classifyDomainServiceTier } from "../../../ir/util/domain-service-tier.js";
import { enumPool, valueObjectPool } from "../../../ir/util/reachable-types.js";
import { walkWorkflowStmtsDeep } from "../../../ir/util/walk.js";
import { commandCreateResult } from "../../../ir/util/workflow-command-route.js";
import {
  bodyWriteScopeGuards,
  writeScopeContext,
  writeScopeGuards,
} from "../../../ir/util/write-scope-guards.js";
import { elixirLocal, escapeElixirIdent, snake, upperFirst } from "../../../util/naming.js";
import { FIND_ABSENT_DETAIL } from "../../../util/repository-contract.js";
import { renderPhoenixLogCall } from "../../_obs/render-phoenix.js";
import { lineCount, type SourceMapRecorder } from "../../_trace/sourcemap.js";
import {
  commandCreateCorrelationParam,
  workflowBodyUsesOwnState,
  workflowBodyWritesOwnState,
} from "../../_workflow/create-state.js";
import {
  lastBindingSlot,
  lowerWorkflowPipeline,
  type PipelineBody,
  type PipelineScope,
  type PipelineStep,
  type WorkflowPipelineTarget,
} from "../../_workflow/stmt-target.js";
import type { ApiRoute } from "../api-emit.js";
import { inlineMutatingServiceCall } from "../domain-service-emit.js";
import { elixirFindFacadeFn } from "../find-facade-name.js";
import { internalCreateFn, internalDeleteFn } from "../lifecycle-seam.js";
import { optionalReadLookup, type RenderCtx, renderExpr } from "../render-expr.js";
import { stateDefault, stateDefaultDecls } from "../state-default.js";
import {
  exFieldCode,
  exLit,
  exSentence,
  exValuePrefix,
  strictIngressFields,
} from "../wire-policy-ex.js";
import { aggregateUsesPrincipalContextFilter, customFindReadsActor } from "./capability-filter.js";
import { voHasConstraints } from "./changeset-validators.js";
import { exMoneyGrammarRegex } from "./codec-spelling-ex.js";
import {
  contextsHaveWireDenials,
  denialOverrides,
  notFoundStmtClause,
  notFoundStmtTerm,
  respondErrorTail,
  workflowDenialTerm,
} from "./denial.js";
import { renderFunctionBodyLines } from "./function-emit.js";
import { armsCoverUnion, elixirUnionScrutinee, elixirVariantPattern } from "./match-stmt-emit.js";
import {
  renderRequiredParamsPlug,
  renderStrictParamsPlug,
  requiredWireParams,
} from "./problem-details-emit.js";
import { skipFiltersOption } from "./read-scope-emit.js";
import { retrievalReadsActor } from "./retrieval-emit.js";
import { stampUsesPrincipal } from "./stamp-emit.js";
import { valueObjectCastCall } from "./value-object-type-emit.js";

/** Does this read pass the request actor?  Only where the body binds
 *  `current_user` (`repoRunActor`) and the read consumes it: a criterion
 *  read's retrieval with a principal filter or a `currentUser` where, or a
 *  repository find whose bypass-applied capability filter still scopes by the
 *  actor (`… ignoring softDeletable` on a `tenantOwned` aggregate). */
function readPassesActor(
  retrievalName: string | undefined,
  renderCtx: RenderCtx,
  ctx: BoundedContextIR | undefined,
  find?: { aggName: string; method: string | undefined },
): boolean {
  if (!renderCtx.repoRunActor || !ctx) return false;
  if (retrievalName) return retrievalReadsActor(retrievalName, ctx);
  return !!find?.method && customFindReadsActor(ctx, find.aggName, find.method);
}

/** Does a body run a read that consumes the request actor — a criterion read
 *  (`Repo.all(<C>)`, or the single-row `Repo.find(<C>)` as a `let` or `if
 *  let`) whose retrieval reads it (a principal filter such as `tenantOwned` on
 *  its target, or a `currentUser` criterion), or a declared / widened find that
 *  still scopes by it?  Then the body binds `current_user` and each such read
 *  forwards it; without it the read fails closed to no rows.  Shared by the
 *  workflow and the explicit-handler emitters, so both thread the actor alike. */
export function bodyReadsActor(
  bodies: readonly (readonly WorkflowStmtIR[])[],
  ctx: BoundedContextIR,
): boolean {
  const reads = (name: string | undefined): boolean => !!name && retrievalReadsActor(name, ctx);
  const findReads = (aggName: string, method: string | undefined): boolean =>
    !!method && customFindReadsActor(ctx, aggName, method);
  let found = false;
  for (const body of bodies) {
    for (const top of body) {
      walkWorkflowStmtsDeep(top, (st) => {
        if (st.kind === "repo-run" && reads(st.retrievalName)) found = true;
        if (
          st.kind === "repo-let" &&
          st.returnType.kind === "optional" &&
          (st.retrievalName ? reads(st.retrievalName) : findReads(st.aggName, st.method))
        )
          found = true;
        if (
          st.kind === "if-let" &&
          st.op !== "bound" &&
          (st.retrievalName ? reads(st.retrievalName) : findReads(st.aggName, st.findMethod))
        )
          found = true;
      });
    }
  }
  return found;
}

/** The aggregate a workflow step targets, for the lifecycle-seam decision (which
 *  context function an IN-PROCESS caller may use).  `undefined` when the step
 *  names an aggregate in another context — then the seam falls back to the plain
 *  name, which is what a cross-context create already emits today. */
function aggOf(ctx: BoundedContextIR | undefined, aggName: string): AggregateIR | undefined {
  return ctx?.aggregates.find((a) => a.name === aggName);
}

/** True when a workflow `factory-let` creating `aggName` must hand the
 *  principal to the create seam: the aggregate's lifecycle stamps read
 *  `currentUser` (`auditable`'s `createdBy`/`updatedBy`, a `tenantOwned`
 *  `tenantId`), so the repository insert writes them from the threaded
 *  `current_user` exactly as the REST controller's create does.  Without it the
 *  stamped columns persist nil and a NOT NULL audit column rejects the insert. */
function factoryStampsActor(ctx: BoundedContextIR | undefined, aggName: string): boolean {
  const agg = aggOf(ctx, aggName);
  return !!agg && stampUsesPrincipal(agg);
}

/** A workflow `factory-let` as its context create call — the in-process
 *  (`internalCreateFn`) entry, carrying the workflow's `current_user` when the
 *  aggregate stamps the principal.  `fields` is the rendered `key: value` list. */
function factoryCreateCall(
  aggName: string,
  fields: string,
  contextModule: string,
  ctx: BoundedContextIR | undefined,
): string {
  const actor = factoryStampsActor(ctx, aggName) ? ", current_user" : "";
  return `${contextModule}.${internalCreateFn(aggName, aggOf(ctx, aggName))}(%{${fields}}${actor})`;
}

export interface VanillaWorkflowExecResult {
  routes: ApiRoute[];
  /** This context's command-triggered workflows (those that emit a POST
   *  `/workflows/<name>` route).  Collected project-wide by the orchestrator so
   *  the single deployable-level `WorkflowsController` can aggregate every hosted
   *  context's actions — the HTTP surface is per-DEPLOYABLE, not per-context, so
   *  a deployable serving N contexts must emit ONE controller (writing one
   *  `workflows_controller.ex` per context to a fixed path clobbers all but the
   *  last).  Empty when the context has no command workflows. */
  commandWorkflows: WorkflowIR[];
}

export function emitVanillaWorkflowExecution(
  _appName: string,
  appModule: string,
  ctx: BoundedContextIR,
  out: Map<string, string>,
  resourceModules: Map<string, string> = new Map(),
  sys?: SystemIR,
  sourcemap?: SourceMapRecorder,
): VanillaWorkflowExecResult {
  if (ctx.workflows.length === 0) return { routes: [], commandWorkflows: [] };

  const ctxModule = upperFirst(ctx.name);
  const ctxSnake = snake(ctx.name);
  const appSnake = appModule.replace(/([A-Z])/g, (_, c, i) => (i ? "_" : "") + c.toLowerCase());
  const routes: ApiRoute[] = [];

  const commandWorkflows = ctx.workflows.filter(workflowEmitsCommandRoute);
  if (commandWorkflows.length === 0) return { routes: [], commandWorkflows: [] };

  // Per-workflow `run/1` modules are context-namespaced
  // (`<App>.<Ctx>.Workflows.<Wf>`), so they never collide across contexts.  The
  // single `WorkflowsController` that fronts them is a DEPLOYABLE-level artifact,
  // though — emitted ONCE by the orchestrator (`emitVanillaWorkflowsController`)
  // over every hosted context's `commandWorkflows`, so a multi-context deployable
  // gets one controller with all actions rather than per-context overwrites.
  for (const wf of commandWorkflows) {
    const wfSnake = snake(wf.name);
    const path = `lib/${appSnake}/${ctxSnake}/workflows/${wfSnake}.ex`;
    const { content, statementRegions } = renderWorkflowModule(
      appModule,
      ctxModule,
      wf,
      resourceModules,
      ctx,
      sys,
      !!sourcemap,
    );
    out.set(path, content);
    const construct = `${ctx.name}.${wf.name}`;
    sourcemap?.file(path, content, wf.origin, construct);
    // M13 — one independent `fragment()` anchor per top-level statement (see
    // `WorkflowModuleResult.statementRegions`); `undefined` origins were
    // already filtered out by `renderWorkflowModule`.
    for (const r of statementRegions) {
      sourcemap?.fragment(path, content, r.text, [
        { rel: [1, lineCount(r.text)], origin: r.origin, construct },
      ]);
    }
  }

  for (const wf of commandWorkflows) {
    routes.push({
      method: "post",
      path: `/workflows/${snake(wf.name)}`,
      controller: "WorkflowsController",
      action: `:${snake(wf.name)}`,
    });
  }

  return { routes, commandWorkflows };
}

/** One context's command workflows, paired with the context (for resolving the
 *  per-workflow module FQ name + the `currentUser` threading decision). */
export interface WorkflowControllerGroup {
  ctx: BoundedContextIR;
  workflows: WorkflowIR[];
}

/** Emit the single deployable-level `WorkflowsController` aggregating the command
 *  workflows of every context the deployable hosts.  Called ONCE by the
 *  orchestrator after the per-context loop (the sibling of
 *  `emitVanillaViewsController`).  No-op when no context has a command workflow. */
export function emitVanillaWorkflowsController(
  appName: string,
  appModule: string,
  groups: WorkflowControllerGroup[],
  out: Map<string, string>,
): void {
  const nonEmpty = groups.filter((g) => g.workflows.length > 0);
  if (nonEmpty.length === 0) return;
  out.set(
    `lib/${appName}_web/controllers/workflows_controller.ex`,
    renderWorkflowsController(appModule, nonEmpty),
  );
}

// ---------------------------------------------------------------------------
// Body lowering — the Elixir target of the shared `pipeline` spine
// (`_workflow/stmt-target.ts`).  The spine dispatches each statement kind
// and recurses into nested bodies; this target spells each kind as pipeline
// steps and assembles a step list into a `with` chain.
// ---------------------------------------------------------------------------

export interface BodyLine {
  /** `with-clause` lines stack into the `with ... do ... end` chain.
   *  `emit` lines render INSIDE the `do`-branch before the success result,
   *  so they fire only when the with-chain succeeds (a rolled-back
   *  transaction skips them).  `stmt` runs as a leading statement before the
   *  `with`. */
  kind: "with-clause" | "emit" | "stmt";
  text: string;
  /** Bind name for `with-clause` lines — used to pick the final result
   *  of `run/1` (last bound name, or `:ok` if no binds). */
  bindName?: string;
  /** The source `WorkflowStmtIR` this line was lowered from.  A nested body
   *  lowers inside its statement's own line, which keeps only the OUTER
   *  statement's origin; a statement that expands to several clauses stamps
   *  each with the same origin. */
  origin?: OriginRef;
}

/** How the CALLER closes the with-chain — which decides whether any statement's
 *  bind is load-bearing as the result. */
export interface LowerBodyOptions {
  /** Expressions evaluated after the list — see `PipelineScope.trailing`. */
  trailing?: readonly ExprIR[];
  /** `true` when the caller renders its OWN result expression instead of
   *  `assembleBody`'s `{:ok, <lastBind>}` — then no statement's bind is the
   *  result slot and every unread bind is discardable.  The explicit
   *  `commandHandler` / `queryHandler` path and a `create(…): T` workflow set
   *  this. */
  ownResult?: boolean;
}

export function lowerStatements(
  stmts: WorkflowStmtIR[],
  contextModule: string,
  renderCtx: RenderCtx,
  ctx?: BoundedContextIR,
  opts: LowerBodyOptions = {},
): BodyLine[] {
  const { trailing = [], ownResult = false } = opts;
  const chunks = lowerWorkflowPipeline(
    stmts,
    elixirWorkflowTarget(contextModule, renderCtx, ctx),
    ownResult ? { trailing } : { trailing, resultSlot: lastBindingSlot(stmts) },
  );
  return chunks.flatMap((steps, i) =>
    steps.map((step) => ({ ...chainLine(step), origin: stmts[i]!.origin })),
  );
}

/** A pipeline step as a top-level body line. */
function chainLine(step: PipelineStep): BodyLine {
  switch (step.kind) {
    case "clause":
      return { kind: "with-clause", text: step.text, bindName: step.bindName };
    case "let":
      return {
        kind: "with-clause",
        text: `${step.pattern} <- (${step.expr})`,
        bindName: step.bindName,
      };
    case "effect":
      return { kind: "emit", text: step.text };
    case "fail":
      return { kind: "with-clause", text: step.clause };
  }
}

/** A step as a link of a `with` chain; an effect is not a link. */
function chainLink(step: Exclude<PipelineStep, { kind: "effect" }>): string {
  switch (step.kind) {
    case "clause":
      return step.text;
    case "let":
      return `${step.pattern} <- (${step.expr})`;
    case "fail":
      return step.clause;
  }
}

/** Does `assembleChain` render these steps as a `with` chain?  Only when a
 *  fallible link precedes the body's end; otherwise its bindings render as
 *  plain sequential `pattern = expr` lines. */
function isChained(steps: readonly PipelineStep[]): boolean {
  const body = steps.at(-1)?.kind === "fail" ? steps.slice(0, -1) : steps;
  return body.some((step) => step.kind === "clause" || step.kind === "fail");
}

/** The text one step renders to inside `assembleChain`'s output for `steps`
 *  — the anchor a source map looks up. */
export function assembledStepText(steps: readonly PipelineStep[], step: PipelineStep): string {
  if (step.kind === "effect") return step.text;
  if (step.kind === "let" && !isChained(steps)) return `${step.pattern} = ${step.expr}`;
  return chainLink(step);
}

/** A nested body (a loop iteration, an `if let` branch, a `match` arm) as
 *  the lines of one block.  The block answers `ok` when every step succeeds;
 *  the first failing link's error, passed through `wrapErr`, otherwise.  A
 *  body that ends in `notFound` answers that failure directly.  A body with
 *  no fallible link renders as plain sequential bindings. */
export function assembleChain(
  steps: readonly PipelineStep[],
  ok: string,
  wrapErr: (err: string) => string = (err) => err,
): string[] {
  const last = steps.at(-1);
  const result = last?.kind === "fail" ? wrapErr(`{:error, ${last.term}}`) : ok;
  const body = last?.kind === "fail" ? steps.slice(0, -1) : steps;
  const links: string[] = [];
  const effects: string[] = [];
  const flat: string[] = [];
  for (const step of body) {
    if (step.kind === "effect") {
      effects.push(step.text);
      flat.push(step.text);
    } else {
      links.push(chainLink(step));
      if (step.kind === "let") flat.push(`${step.pattern} = ${step.expr}`);
    }
  }
  // One entry per physical line, so the caller's indent nests a multi-line
  // link (a nested loop or branch) under the block it sits in.
  const physical = (lines: string[]): string[] => lines.flatMap((l) => l.split("\n"));
  if (!isChained(steps)) return physical([...flat, result]);
  return physical([
    `with ${links.join(",\n     ")} do`,
    ...effects.map((l) => `  ${l}`),
    `  ${result}`,
    `else`,
    `  err -> ${wrapErr("err")}`,
    `end`,
  ]);
}

/** `:ok <- (if <cond>, do: :ok, else: {:error, <denial>})` — a guard whose
 *  failure tag flows through the chain to the dispatcher (422 / 403). */
function guardClause(
  st: Extract<WorkflowStmtIR, { kind: "precondition" | "requires" }>,
  renderCtx: RenderCtx,
): PipelineStep {
  return {
    kind: "clause",
    text: `:ok <- (if ${renderExpr(st.expr, renderCtx)}, do: :ok, else: {:error, ${workflowDenialTerm(st, (e) => renderExpr(e, renderCtx))}})`,
  };
}

/** The Elixir spelling of every workflow statement kind. */
export function elixirWorkflowTarget(
  contextModule: string,
  renderCtx: RenderCtx,
  ctx?: BoundedContextIR,
): WorkflowPipelineTarget {
  const expr = (e: ExprIR): string => renderExpr(e, renderCtx);
  const fieldsOf = (fields: readonly { name: string; value: ExprIR }[]): string =>
    fields.map((f) => `${snake(f.name)}: ${expr(f.value)}`).join(", ");
  const broadcast = (eventName: string, fields: string): string =>
    `${contextModule.split(".")[0]!}.PostCommit.broadcast(%${contextModule}.Events.${upperFirst(eventName)}{${fields}})`;
  return {
    precondition: (st) => [guardClause(st, renderCtx)],
    requires: (st) => [guardClause(st, renderCtx)],

    // `notFound` fails the chain with the tagged not-found term, answered by
    // the dispatcher's `{:not_found, detail}` arm.
    notFound: (st) => [
      { kind: "fail", clause: notFoundStmtClause(st), term: notFoundStmtTerm(st) },
    ],

    // `let order = Order.create(…)` → `{:ok, order} <- Context.create_order(%{…})`.
    // The `:ok` match gates the chain even when the new aggregate is unread.
    factoryLet: (st, scope) => {
      const { pattern, bindName } = tupleBind(st.name, scope);
      return [
        {
          kind: "clause",
          text: `{:ok, ${pattern}} <- ${factoryCreateCall(st.aggName, fieldsOf(st.fields), contextModule, ctx)}`,
          ...(bindName ? { bindName } : {}),
        },
      ];
    },

    // `order.confirm(args)` → `{:ok, _} <- Context.confirm_order(order, %{…})`.
    // The call PERSISTS (each context op is its own save on Elixir), so a void
    // op's handle is rebound to the saved record it returns when a later read
    // needs it: that record carries the version the write moved it to, and a
    // second op on the stale handle would be a self-inflicted conflict.  A
    // handle a loop body carries is read again by the next iteration, so it is
    // rebound too, and the loop threads it out (`forEach`).  A returning op's
    // `{:ok, value}` is its result, so its handle stays.
    opCall: (st, scope) => {
      const call = opCallSource(st, renderCtx, contextModule, ctx);
      const op = ctx ? lookupOp(ctx, st.aggName, st.op) : undefined;
      const rebind =
        op !== undefined &&
        !op.returnType &&
        (scope.carried.has(st.target) || bindUsedLater(st.target, scope.rest, scope.trailing));
      const handle = escapeElixirIdent(snake(st.target));
      return [
        {
          kind: "clause",
          text: `{:ok, ${rebind ? handle : "_"}} <- ${call}`,
          ...(rebind ? { bindName: handle } : {}),
        },
      ];
    },

    // `let foo = <expr>` — a binding that always succeeds.  It never fills the
    // result slot, so discarding an unread one cannot change what the chain
    // answers.
    exprLet: (st, scope) => [
      {
        kind: "let",
        pattern: bindUsedLater(st.name, scope.rest, scope.trailing)
          ? escapeElixirIdent(snake(st.name))
          : `_${snake(st.name)}`,
        expr: expr(st.expr),
      },
    ],

    // `field := value` — rebind the immutable workflow `state` struct.
    // (Event-triggered correlation sagas persist the row in `dispatch-emit.ts`.)
    assign: (st) => [
      {
        kind: "let",
        pattern: "state",
        expr: `%{state | ${snake(st.target.segments[0]!)}: ${expr(st.value)}}`,
        bindName: "state",
      },
    ],

    // `let w = Wallets.getById(id)` → `{:ok, w} <- Context.get_wallet(id)`; a
    // custom find routes to its per-find context delegate.  An OPTIONAL read
    // binds the row or `nil`, so an absent row is a value, not a failure.
    repoLet: (st, scope) => {
      const { pattern, bindName } = tupleBind(st.name, scope);
      if (st.returnType.kind === "optional") {
        const { call, hit } = optionalReadLookup(
          {
            op: st.op,
            method: st.method,
            aggregate: st.aggName,
            retrievalName: st.retrievalName,
            widened: st.bypassRead !== undefined,
          },
          st.args.map(expr),
          contextModule,
          readPassesActor(st.retrievalName, renderCtx, ctx, {
            aggName: st.aggName,
            method: st.method,
          }),
        );
        return [
          {
            kind: "let",
            pattern,
            expr: `case ${call} do
           ${hit} -> hit
           _ -> nil
         end`,
            ...(bindName ? { bindName } : {}),
          },
        ];
      }
      const argList = st.args.map(expr).join(", ");
      const action =
        st.op === "load" ? `get_${snake(st.aggName)}` : elixirFindFacadeFn(st.method, st.aggName);
      // A `load` miss is the not-found-on-load 404 whose detail names the row;
      // a natural-key `getBy` miss is the find-absence 404.  The context facade
      // answers a bare `{:error, :not_found}`, so a workflow `run/1` body
      // (`renderCtx.tagGetByIdMiss`) tags the miss with its detail for the
      // dispatcher's `{:not_found, detail}` arm.
      const missDetail =
        st.op === "load"
          ? exSentence("not-found", `${upperFirst(st.aggName)} #{${argList}}`)
          : st.op === "load-by-key"
            ? JSON.stringify(FIND_ABSENT_DETAIL)
            : undefined;
      const call =
        missDetail && renderCtx.tagGetByIdMiss
          ? `(case ${contextModule}.${action}(${argList}) do
           {:error, :not_found} -> {:error, {:not_found, ${missDetail}}}
           found -> found
         end)`
          : `${contextModule}.${action}(${argList})`;
      return [
        { kind: "clause", text: `{:ok, ${pattern}} <- ${call}`, ...(bindName ? { bindName } : {}) },
      ];
    },

    // `emit E { … }` broadcasts on success only; inside a transaction
    // `<App>.PostCommit` holds it until the commit and drops it on a rollback.
    emit: (st) => [{ kind: "effect", text: broadcast(st.eventName, fieldsOf(st.fields)) }],

    // A bare resource op runs on success only and discards its result.
    resourceCall: (st) => [{ kind: "effect", text: `_ = ${expr(st.call)}` }],

    // A `mutating` domain-service call is sugar for the chain of its body's
    // context mutating calls, each rebinding the argument it mutates.  An
    // unresolvable shape keeps the sound side-effect line.
    domainServiceCall: (st) => {
      const clauses = resolveInlinedServiceClauses(st, renderCtx, contextModule, ctx);
      if (clauses.length > 0) {
        return clauses.map((c) => ({
          kind: "clause",
          text: c.text,
          ...(c.bindName ? { bindName: c.bindName } : {}),
        }));
      }
      return [{ kind: "effect", text: `_ = ${expr(st.call)}` }];
    },

    // `let xs = Repo.run(<Retrieval>(args), page?)` →
    // `{:ok, xs} <- Context.run_<ret>_<agg>(args..., limit: N, offset: M)`;
    // pagination, the actor and an `ignoring` clause ride as trailing opts.
    repoRun: (st, scope) => {
      const args = st.retrievalArgs.map(expr);
      const optEntries: string[] = [];
      if (st.page) {
        if (st.page.offset) optEntries.push(`offset: ${expr(st.page.offset)}`);
        if (st.page.limit) optEntries.push(`limit: ${expr(st.page.limit)}`);
      }
      if (readPassesActor(st.retrievalName, renderCtx, ctx)) {
        optEntries.push("current_user: current_user");
      }
      const skip = skipFiltersOption(st);
      if (skip) optEntries.push(skip);
      if (optEntries.length > 0) args.push(optEntries.join(", "));
      const call = `${contextModule}.run_${snake(st.retrievalName)}_${snake(st.aggName)}(${args.join(", ")})`;
      const { pattern, bindName } = tupleBind(st.name, scope);
      return [
        { kind: "clause", text: `{:ok, ${pattern}} <- ${call}`, ...(bindName ? { bindName } : {}) },
      ];
    },

    // `Orders.delete(o)` → `{:ok, _} <- Context.delete_order(o)`; a failure
    // rolls a transactional workflow back.
    repoDelete: (st) => {
      const action = internalDeleteFn(st.aggName, aggOf(ctx, st.aggName));
      const call = withWriteScopeGuards(
        st,
        `${contextModule}.${action}(${expr(st.entity)})`,
        renderCtx,
        contextModule,
        ctx,
      );
      return [{ kind: "clause", text: `{:ok, _} <- ${call}` }];
    },

    // `for x in xs { … }` → `Enum.reduce_while`: each iteration continues on
    // success and halts with the first failure, which threads up the chain.
    // A handle bound outside the loop that the body rebinds (an op on it
    // persists and returns the saved record) rides the accumulator, so the
    // next iteration — and the statements after the loop — see the record as
    // the last iteration saved it, not as it was loaded.
    forEach: (st, outer, body) => {
      const loopVar = bindUsedLater(st.var, body.stmts)
        ? escapeElixirIdent(snake(st.var))
        : `_${snake(st.var)}`;
      const rebound = new Set(
        body.steps.flatMap((s) => [
          ...((s.kind === "clause" || s.kind === "let") && s.bindName ? [s.bindName] : []),
          ...(s.kind === "clause" ? (s.rebinds ?? []) : []),
        ]),
      );
      const threaded = [...body.carried]
        .map((name) => ({ name, ident: escapeElixirIdent(snake(name)) }))
        .filter((t) => rebound.has(t.ident));
      const acc = `{${threaded.map((t) => t.ident).join(", ")}}`;
      const lines = assembleChain(
        body.steps,
        threaded.length > 0 ? `{:cont, {:ok, ${acc}}}` : "{:cont, {:ok, nil}}",
        (err) => `{:halt, ${err}}`,
      );
      // After the loop a threaded handle stays bound when something reads it
      // again — a later statement, or the next iteration of an enclosing loop
      // — and is discarded otherwise.
      const kept = threaded.filter(
        (t) => outer.carried.has(t.name) || bindUsedLater(t.name, outer.rest, outer.trailing),
      );
      const outAcc = `{${threaded
        .map((t) => (kept.includes(t) ? t.ident : `_${snake(t.name)}`))
        .join(", ")}}`;
      const head =
        threaded.length > 0
          ? `{:ok, ${outAcc}} <- Enum.reduce_while(${expr(st.iterable)}, {:ok, ${acc}}, fn ${loopVar}, {:ok, ${acc}} ->`
          : `{:ok, _} <- Enum.reduce_while(${expr(st.iterable)}, {:ok, nil}, fn ${loopVar}, _acc ->`;
      return [
        {
          kind: "clause",
          text: [head, ...lines.map((l) => `           ${l}`), `         end)`].join("\n"),
          ...(kept.length > 0 ? { rebinds: kept.map((t) => t.ident) } : {}),
        },
      ];
    },

    // `if let o = <optional read> { … } else { … }` → bind the row or `nil`,
    // then branch.  Each branch answers `{:ok, _}` or its first failure.
    ifLet: (st, _scope, thenBody, elseBody) => {
      const args = st.retrievalArgs.map(expr);
      const v = escapeElixirIdent(snake(st.var));
      const lookupLines =
        st.op === "bound"
          ? [`           ${v} = ${args.join(", ")}`]
          : ((l: { call: string; hit: string }) => [
              `           ${v} = case ${l.call} do`,
              `             ${l.hit} -> hit`,
              `             _ -> nil`,
              `           end`,
            ])(
              optionalReadLookup(
                {
                  op: st.op,
                  method: st.findMethod ?? "",
                  aggregate: st.aggName,
                  retrievalName: st.retrievalName,
                  widened: st.bypassRead !== undefined,
                },
                args,
                contextModule,
                readPassesActor(st.retrievalName, renderCtx, ctx, {
                  aggName: st.aggName,
                  method: st.findMethod,
                }),
              ),
            );
      // A guard — an empty then-branch over an `else` that answers the 404 —
      // keeps the hit bound for the statements after it.
      const guard = thenBody.steps.length === 0 && elseBody.steps.at(-1)?.kind === "fail";
      const text = [
        `{:ok, ${guard ? v : "_"}} <- (`,
        ...lookupLines,
        `           if ${v} != nil do`,
        ...assembleChain(thenBody.steps, `{:ok, ${v}}`).map((l) => `             ${l}`),
        `           else`,
        ...assembleChain(elseBody.steps, "{:ok, nil}").map((l) => `             ${l}`),
        `           end`,
        `         )`,
      ].join("\n");
      return [{ kind: "clause", text, ...(guard ? { bindName: v } : {}) }];
    },

    // `match <subject> { … }` → a parenthesised `case` (union subject) or
    // presence `if` (`T?` subject) whose arms answer like `if let` branches.
    variantMatch: (st, _scope, arms, elseBody) => [
      {
        kind: "clause",
        text: [
          `{:ok, _} <- (`,
          ...renderMatchBlock(st, expr(st.subject), arms, elseBody).map((l) => `           ${l}`),
          `         )`,
        ].join("\n"),
      },
    ],
  };
}

/** A statement `match` as the lines of one block answering `{:ok, _}` or the
 *  first `{:error, _}`.  A union subject holds the tagged tuple an
 *  `or`-returning call answers; a `_` clause runs the `else` body whenever the
 *  arms do not name every variant, so an uncovered value is a no-op rather than
 *  a `CaseClauseError`.  A `T?` subject is a presence `if` whose present arm
 *  binds its narrowed name to the subject. */
function renderMatchBlock(
  st: Extract<WorkflowStmtIR, { kind: "variant-match" }>,
  subject: string,
  arms: readonly PipelineBody[],
  elseBody: PipelineBody,
): string[] {
  const branch = (body: PipelineBody): string[] => assembleChain(body.steps, "{:ok, nil}");
  if (st.subjectShape === "absence") {
    const isAbsent = (a: (typeof st.arms)[number]) => a.varType.kind === "none" || a.isError;
    const presentIdx = st.arms.findIndex((a) => !isAbsent(a));
    const absentIdx = st.arms.findIndex(isAbsent);
    const presentBody = arms[presentIdx] ?? elseBody;
    const absentBody = arms[absentIdx] ?? elseBody;
    const binding = st.arms[presentIdx]?.binding;
    const bindLine =
      binding && bindUsedLater(binding, presentBody.stmts)
        ? [`${escapeElixirIdent(snake(binding))} = ${subject}`]
        : [];
    return [
      `if ${subject} != nil do`,
      ...[...bindLine, ...branch(presentBody)].map((l) => `  ${l}`),
      `else`,
      ...branch(absentBody).map((l) => `  ${l}`),
      `end`,
    ];
  }
  const clause = (pattern: string, body: PipelineBody): string[] => [
    `  ${pattern} ->`,
    ...branch(body).map((l) => `    ${l}`),
  ];
  const lines = st.arms.flatMap((a, i) => {
    const body = arms[i]!;
    const binder =
      a.binding && bindUsedLater(a.binding, body.stmts) ? escapeElixirIdent(snake(a.binding)) : "_";
    return clause(elixirVariantPattern(a, binder), body);
  });
  if (st.elseBody || !armsCoverUnion(st.subjectType, st.arms)) {
    lines.push(...clause("_", elseBody));
  }
  return [`case ${elixirUnionScrutinee(subject)} do`, ...lines, `end`];
}

/** A single op-call as the threaded `op_<agg>(target, %{...})` call source.
 *  When the called operation's guard/body references `currentUser`, the
 *  context function carries a trailing `current_user \\ nil` arity (emitted by
 *  `context-emit.ts` / `operation-returns-emit.ts`); thread the workflow's
 *  in-scope `current_user` binding through so the op guard resolves at runtime
 *  rather than raising on an unbound `current_user`.  `ctx` is undefined only on
 *  legacy/test call paths with no aggregate index — then no actor is threaded
 *  (byte-identical to the pre-fix output). */
function opCallSource(
  st: Extract<WorkflowStmtIR, { kind: "op-call" }>,
  renderCtx: RenderCtx,
  contextModule: string,
  ctx?: BoundedContextIR,
): string {
  const argTexts = st.args.map((arg) => renderExpr(arg, renderCtx));
  const op = ctx ? lookupOp(ctx, st.aggName, st.op) : undefined;
  const argFields = opCallParamFields(argTexts, op, `${st.aggName}.${st.op}`);
  const actor = ctx && opCallThreadsUser(st, ctx) ? ", current_user" : "";
  return withWriteScopeGuards(
    st,
    `${contextModule}.${snake(st.op)}_${snake(st.aggName)}(${escapeElixirIdent(snake(st.target))}, %{${argFields}}${actor})`,
    renderCtx,
    contextModule,
    ctx,
  );
}

/** The with-clauses re-loading each row `st` mutates or deletes through the
 *  context's `get_<agg>_for_write` — the load every mutation route uses — so
 *  a row outside the caller's write scope answers `{:error, :not_found}`
 *  (→ 404) before anything is written, and threads up the chain into the
 *  workflow's rollback.  Empty outside a command body (`renderCtx.writeScope`
 *  unset) and for a row the body created. */
function writeScopeGuardClauses(
  st: WorkflowStmtIR,
  renderCtx: RenderCtx,
  contextModule: string,
  ctx?: BoundedContextIR,
): string[] {
  const cx = renderCtx.writeScope;
  if (!cx) return [];
  return writeScopeGuards(st, cx).map((g) => {
    const agg = aggOf(ctx, g.aggName);
    const actor = agg && aggregateUsesPrincipalContextFilter(agg) ? ", current_user" : "";
    return `{:ok, _} <- ${contextModule}.get_${snake(g.aggName)}_for_write(${escapeElixirIdent(snake(g.name))}.id${actor})`;
  });
}

/** `call` behind the write-scope guards of `st`: unchanged when there are
 *  none, else an inline `with` that answers the first guard's error instead
 *  of running the call. */
function withWriteScopeGuards(
  st: WorkflowStmtIR,
  call: string,
  renderCtx: RenderCtx,
  contextModule: string,
  ctx?: BoundedContextIR,
): string {
  const clauses = writeScopeGuardClauses(st, renderCtx, contextModule, ctx);
  return clauses.length === 0 ? call : `(with ${clauses.join(", ")}, do: ${call})`;
}

/** Resolve a `mutating` `domain-service-call` to its inlined with-clauses
 *  (domain-services.md rev. 4).  Looks the service op up in `ctx`,
 *  then delegates to `inlineMutatingServiceCall`, which expands the body's
 *  param-op calls into context mutating-fn with-clauses.  Returns `[]` when
 *  `ctx` is absent (legacy/test path) or the op isn't resolvable/mutating — the
 *  caller then keeps the sound side-effect fallback. */
export function resolveInlinedServiceClauses(
  st: Extract<WorkflowStmtIR, { kind: "domain-service-call" }>,
  renderCtx: RenderCtx,
  contextModule: string,
  ctx?: BoundedContextIR,
): { text: string; bindName?: string }[] {
  if (!ctx) return [];
  const svc = (ctx.domainServices ?? []).find((s) => s.name === st.service);
  const op = svc?.operations.find((o) => o.name === st.op);
  if (!op) return [];
  const callArgs = st.call.kind === "call" ? st.call.args : [];
  const inlined = inlineMutatingServiceCall(op, callArgs, ctx, contextModule, (e) =>
    renderExpr(e, renderCtx),
  );
  // The rows the service mutates re-check their write scope ahead of its
  // first write.
  const guards =
    inlined.length > 0 ? writeScopeGuardClauses(st, renderCtx, contextModule, ctx) : [];
  return [...guards.map((text) => ({ text })), ...inlined];
}

/** Render the `params`-map fields for an `op-call` keyed by the called
 *  operation's REAL parameter names as STRING keys (`"label" => value`).  The
 *  context-facade op function reads them with `Map.get(params, "<name>")`
 *  (`context-emit.ts` / `domain-core-emit.ts` / `operation-returns-emit.ts`), so
 *  positional atom keys (`arg0:`) would silently resolve to `nil` (the BUG-2
 *  regression).  The op MUST be resolved — every real op-call targets a
 *  validated operation in the threaded context, so an unresolved op is a
 *  generator invariant violation, not a tolerable fallback: fail loudly with
 *  the offending name rather than re-emit positional keys.  `label` is the
 *  `<Agg>.<op>` the call targets, for the error message. */
export function opCallParamFields(
  argTexts: string[],
  op: OperationIR | undefined,
  label: string,
): string {
  // No args ⇒ `%{}`; the op need not resolve since there is nothing to key.
  if (argTexts.length === 0) return "";
  if (!op) {
    throw new Error(
      `elixir op-call to unresolved operation '${label}': cannot key the params map by ` +
        `parameter name (positional keys would mis-resolve in the op facade). This is a ` +
        `generator bug — the op-call should reference a validated aggregate operation.`,
    );
  }
  return argTexts.map((t, i) => `${JSON.stringify(op.params[i]!.name)} => ${t}`).join(", ");
}

/** Resolve the tier of a `domainService.<op>` referenced in a workflow body
 *  (domain-services.md rev. 4).  Threaded onto the workflow render context so a
 *  `reading` service call renders as a context fn (decision B); a `pure` call
 *  (or an unresolvable ref) keeps the `Domain.Services` module shape. */
export function lookupServiceTier(
  ctx: BoundedContextIR,
  service: string,
  opName: string,
): "pure" | "reading" | "mutating" | undefined {
  const svc = (ctx.domainServices ?? []).find((s) => s.name === service);
  const op = svc?.operations.find((o) => o.name === opName);
  return op ? classifyDomainServiceTier(op) : undefined;
}

/** True when this op-call targets a `currentUser`-gated operation — its context
 *  function takes the trailing `current_user` arg, so the call must pass it. */
function opCallThreadsUser(
  st: Extract<WorkflowStmtIR, { kind: "op-call" }>,
  ctx: BoundedContextIR,
): boolean {
  const op = lookupOp(ctx, st.aggName, st.op);
  return !!op && operationUsesCurrentUser(op);
}

/** True when the workflow needs a principal (`workflowNeedsCurrentUser`: the
 *  body names `currentUser`, or calls a `currentUser`-gated operation whose
 *  context fn takes the trailing actor), OR it runs a read that consumes the
 *  actor, OR it creates an aggregate whose lifecycle stamps read the
 *  principal, OR a write-scope re-check passes it.  Any
 *  of these means the workflow function threads `current_user \\ nil` so the
 *  binding is in scope for the rendered guard / op-call / create call, at any
 *  nesting depth (`for-each` / `if-let` / `variant-match` bodies). */
export function workflowThreadsActor(wf: WorkflowIR, ctx: BoundedContextIR): boolean {
  if (workflowNeedsCurrentUser(wf, ctx)) return true;
  if (bodyReadsActor([wf.statements], ctx)) return true;
  let needs = false;
  for (const st of wf.statements)
    walkWorkflowStmtsDeep(st, (n) => {
      if (n.kind === "factory-let" && factoryStampsActor(ctx, n.aggName)) needs = true;
    });
  if (needs) return true;
  // A write-scope re-check passes the actor to `get_<agg>_for_write`.
  return bodyWriteScopeGuards(wf.statements, writeScopeContext(wf.statements, ctx)).some((g) => {
    const agg = aggOf(ctx, g.aggName);
    return agg !== undefined && aggregateUsesPrincipalContextFilter(agg);
  });
}

/** Is `name` referenced by any statement in `rest` — or by any `trailing`
 *  expression the caller evaluates after the list?  Decides whether a bind
 *  needs its real name or can be `_`-discarded (an unread real-named bind trips
 *  `mix compile --warnings-as-errors`). */
export function bindUsedLater(
  name: string,
  rest: readonly WorkflowStmtIR[],
  trailing: readonly ExprIR[] = [],
): boolean {
  return namesUsed(rest, trailing).has(name);
}

/** The `{:ok, <name>}` half of a fallible bind (`factory-let` / `repo-let` /
 *  `repo-run`) and the `bindName` that goes with it.  The name is discarded
 *  only when it is unread downstream AND the bind is not the chain's result
 *  slot; the `:ok` half still gates the chain either way.  A discarded bind
 *  carries no `bindName`, so `assembleBody` can never answer `_name`. */
export function tupleBind(
  name: string,
  scope: PipelineScope,
): { pattern: string; bindName: string | undefined } {
  const bare = escapeElixirIdent(snake(name));
  if (!scope.discardableBind || bindUsedLater(name, scope.rest, scope.trailing)) {
    return { pattern: bare, bindName: bare };
  }
  return { pattern: `_${bare}`, bindName: undefined };
}

// ---------------------------------------------------------------------------
// Param surfacing — collect the declared create-params a workflow body
// actually references, so exactly those (and no unused ones) are
// destructured off the `run/1` map.
// ---------------------------------------------------------------------------

/** The declared create-params referenced anywhere in the body, in
 *  declaration order (stable output). */
function referencedParams(wf: WorkflowIR): string[] {
  // A `create(…): T` result may read a param the body never does.
  const refs = refsRead(wf.statements ?? [], [commandCreateResult(wf)?.value], "param");
  return (wf.params ?? []).map((p) => p.name).filter((n) => refs.has(n));
}

/** Compose lowered body lines into the inner-function body that the
 *  workflow module's `run_inner` (transactional) or inline body
 *  (non-transactional) executes.  Three line kinds:
 *
 *  - `with-clause` → stacks into the `with ... do ... end` chain.
 *  - `emit`        → renders INSIDE the `do`-branch before the success
 *                    return, so it fires only on with-chain success.
 *  - `stmt`        → leading statement before the `with` (the `# TODO`
 *                    fallthrough form).
 *
 *  The final result is `{:ok, <last-bound-name>}` or `{:ok, params}`
 *  if no binds were produced — matching the contract `run/1` returns
 *  `{:ok, _} | {:error, _}`.  An emit-only `do`-branch ends with
 *  `:ok` so the workflow still satisfies the `{:ok, _} | {:error, _}`
 *  contract. */
function assembleBody(
  lines: BodyLine[],
  completedCall: string,
  /** F58 — the saga-row persist, 0-indented.  Runs on the SUCCESS path only
   *  (inside the `with`-chain's `do`-branch when there is one), immediately
   *  before `workflow_completed`, so a short-circuited `{:error, _}` leaves the
   *  row as it was.  Empty for stateless / key-less workflows. */
  persistLines: string[] = [],
  /** `create(…): T { … return <expr> }` — the rendered return value.  When
   *  set it IS the success result (`{:ok, <expr>}`, which the controller
   *  answers as a 200 body) in every arm, instead of the last-bind default. */
  declaredResult?: string,
): string {
  const withClauses = lines.filter((l) => l.kind === "with-clause");
  const emitLines = lines.filter((l) => l.kind === "emit");
  const stmtLines = lines.filter((l) => l.kind === "stmt");
  const lastBind = [...withClauses].reverse().find((l) => l.bindName)?.bindName;

  const resultExpr =
    declaredResult !== undefined
      ? `{:ok, ${declaredResult}}`
      : lastBind
        ? `{:ok, ${lastBind}}`
        : "{:ok, params}";
  // The `do`-branch body: emits first (only run on with-chain success),
  // then `workflow_completed` (the success tail), then the success result.
  // Indented to match the `with ... do ... end` shape — 6 spaces under
  // `run_inner`.  The log fires only on success (the with-chain's do-branch),
  // never on an `{:error, _}` short-circuit.
  const at = (n: number, ls: string[]): string[] => ls.map((l) => `${" ".repeat(n)}${l}`);
  const doBody = [
    ...emitLines.map((l) => `      ${l.text}`),
    ...at(6, persistLines),
    `      ${completedCall}`,
    `      ${resultExpr}`,
  ].join("\n");

  if (stmtLines.length === 0 && withClauses.length === 0 && emitLines.length === 0) {
    // Empty body — keep the stub semantics; still announce completion.
    return [
      ...at(4, persistLines),
      `    ${completedCall}`,
      declaredResult !== undefined ? `    ${resultExpr}` : "    {:ok, params}",
    ].join("\n");
  }

  if (stmtLines.length === 0 && withClauses.length === 0 && emitLines.length > 0) {
    // Emit-only body — no with-chain to gate on, broadcasts run
    // unconditionally then return :ok.
    return [
      ...emitLines.map((l) => `    ${l.text}`),
      ...at(4, persistLines),
      `    ${completedCall}`,
      declaredResult !== undefined ? `    ${resultExpr}` : "    {:ok, :emitted}",
    ].join("\n");
  }

  if (stmtLines.length === 0 && withClauses.length > 0) {
    // Pure with-chain (optionally with emits in the do-branch).
    return `    with ${withClauses[0]!.text.trimStart()}${
      withClauses.length > 1
        ? `,\n${withClauses
            .slice(1)
            .map((l) => `         ${l.text}`)
            .join(",\n")}`
        : ""
    } do
${doBody}
    end`;
  }

  if (withClauses.length === 0 && stmtLines.length > 0) {
    return [
      "    # Workflow body — incremental lowering (see workflow-execution-emit.ts).",
      ...stmtLines.map((l) => `    ${l.text}`),
      ...emitLines.map((l) => `    ${l.text}`),
      ...at(4, persistLines),
      `    ${completedCall}`,
      `    ${resultExpr}`,
    ].join("\n");
  }

  // Mixed: stmt lines first, then with-chain (emits in its do-branch).
  const stmtBlock = stmtLines.map((l) => `    ${l.text}`).join("\n");
  const withBlock = withClauses
    .map((l, i) => (i === 0 ? `with ${l.text}` : `         ${l.text}`))
    .join(",\n");
  return `${stmtBlock}
    ${withBlock} do
${doBody}
    end`;
}

/** SQL-92 isolation-level name for a DSL level — Ecto has no `isolation_level:`
 *  option, so the level is set with `SET TRANSACTION ISOLATION LEVEL <NAME>`
 *  as the first statement inside the `Repo.transaction/1` fn. */
function elixirIsolationSql(level: IsolationLevel): string {
  switch (level) {
    case "readUncommitted":
      return "READ UNCOMMITTED";
    case "readCommitted":
      return "READ COMMITTED";
    case "repeatableRead":
      return "REPEATABLE READ";
    case "serializable":
      return "SERIALIZABLE";
  }
}

interface WorkflowModuleResult {
  content: string;
  /** M13 — one entry per top-level `WorkflowStmtIR` with an origin, its text
   *  ALREADY put through the same `contextModuleFq` → `Context` alias
   *  rewrite `content` itself went through, so it anchors verbatim via
   *  `SourceMapRecorder.fragment` regardless of the bucketing that moved it
   *  (with-clauses vs. `emit`s land in different structural positions —
   *  see `assembleBody`).  Empty when the caller didn't ask for it. */
  statementRegions: { text: string; origin: OriginRef | undefined }[];
}

function renderWorkflowModule(
  appModule: string,
  ctxModule: string,
  wf: WorkflowIR,
  resourceModules: Map<string, string>,
  ctx?: BoundedContextIR,
  sys?: SystemIR,
  /** Only collect `statementRegions` when a source-map recorder is present
   *  upstream (zero cost otherwise). */
  wantRegions = false,
): WorkflowModuleResult {
  const wfPascal = upperFirst(wf.name);
  const moduleName = `${appModule}.${ctxModule}.Workflows.${wfPascal}`;
  const contextModuleFq = `${appModule}.${ctxModule}`;
  const repoMod = `${appModule}.Repo`;
  const writeScope = ctx ? writeScopeContext(wf.statements, ctx) : undefined;
  const transactional = workflowRunsInTransaction(wf, ctx);
  const isolation = workflowIsolation(wf, ctx, sys);

  // F58 — a state-bearing workflow's COMMAND route addresses the SAME persisted
  // saga row its event-triggered starter does (`dispatch-emit.ts`
  // `renderPersistedBody`).  Before this the body rendered own-state writes as
  // `state <- (%{state | f: v})` with `state` bound NOWHERE in `run/1`, and
  // own-state reads against a `record` that likewise does not exist — and the
  // correlation row was never created, so a later `on` reactor for the same key
  // logged `event_unrouted` forever.  The key is the create param that
  // name-matches the correlation field (the command-side twin of the reactor's
  // omitted-`by` rule); it is read off the raw `params` map so it binds
  // regardless of whether the BODY happens to reference that param.
  const corrParam = commandCreateCorrelationParam(wf);
  const bindsState = !!corrParam && workflowBodyUsesOwnState(wf.statements ?? []);
  const renderCtx: RenderCtx = {
    thisName: bindsState ? "state" : "record",
    contextModule: contextModuleFq,
    // M-T5.1 A4 — only this body's miss reaches the workflows dispatcher's
    // `{:not_found, detail}` arm (`workflowLoadsById`).
    tagGetByIdMiss: true,
    resourceModules,
    // Domain-service call wiring (domain-services.md rev. 4, Elixir
    // decision B).  A workflow that calls a `reading`-tier service (e.g.
    // `precondition Registration.isEmailAvailable(holder)`) renders it as a
    // CONTEXT FUNCTION on this context module — `<Context>.is_email_available(…)`
    // — with NO read-port handle (the ambient `Repo` is free).  `readingServiceModule`
    // is the fully-qualified context module, rewritten to the `Context` alias
    // by the same `replaceAll` that aliases the rest of the body.  A `pure`
    // service call falls through to the `Domain.Services` module shape
    // (byte-identical).  `ctx` is undefined only on legacy/test paths — then no
    // tier is resolved and every call stays the pure module shape.
    domainServiceTier: ctx
      ? (service, opName) => lookupServiceTier(ctx, service, opName)
      : undefined,
    readingServiceModule: contextModuleFq,
    ...(writeScope ? { writeScope } : {}),
    // A workflow that binds `current_user` forwards it to every read that
    // scopes by the actor, as an explicit handler does.
    ...(ctx && workflowThreadsActor(wf, ctx) ? { repoRunActor: true } : {}),
  };
  // Workflow lifecycle narrative — `workflow_started` at run entry, woven into
  // the success tail of the body by `assembleBody` (`workflow_completed`).  The
  // workflow name is a compile-time string literal, so it interpolates straight
  // into the `valueExpr` (no inline `case`/expr that would mis-parse as a
  // keyword-arg value).  Shared catalog identity (field `workflow`) with
  // every backend.
  // Workflow `function` helpers — `defp <snake(fn)>(params) do … end` in this
  // per-workflow module (no scope prefix — the module already namespaces them).
  // Pure over params (validator-guaranteed).  Both the expression form and the
  // pure block form (domain-services.md rev. 4) render via `renderFunctionBodyLines`.
  const helperDefs = (wf.functions ?? [])
    .map((fn) => {
      const params = fn.params.map((p) => elixirLocal(p.name)).join(", ");
      const bodyLines = renderFunctionBodyLines(fn.body, renderCtx).join("\n");
      return `\n  defp ${snake(fn.name)}(${params}) do\n${bodyLines}\n  end`;
    })
    .join("");
  const startedCall = renderPhoenixLogCall("workflowStarted", [
    { name: "workflow", valueExpr: JSON.stringify(wf.name) },
  ]);
  const completedCall = renderPhoenixLogCall("workflowCompleted", [
    { name: "workflow", valueExpr: JSON.stringify(wf.name) },
  ]);
  // The TERMINAL event of a FAILED run.  Elixir's workflow is result-tuple
  // shaped, not exception shaped, so there is no `catch` to hang this on: the
  // body's `with`-chain short-circuits to `{:error, reason}` and hands it back
  // out of `run/1`.  Piping the RESULT through a reporter catches every one of
  // those paths without touching the body (no re-indent, and the statement
  // regions the source-map anchors on stay byte-identical).
  //
  // `def`, not `defp`, for the reason `commit_result/1` below is public:
  // Elixir 1.18 narrows a PRIVATE function's parameter to the inferred
  // argument type, so a workflow whose body cannot fail would have its
  // `{:error, _}` clause flagged "never matches" and fail the -Werror build.
  const failureReporter = `
  # Terminal log for a FAILED run.  Without it a workflow that errored logged
  # \`workflow_started\` and then nothing, so "started but never finished" was
  # indistinguishable from "still running" in the log stream.
  #
  # \`def\`, not \`defp\`: Elixir 1.18 narrows a PRIVATE function's parameter to
  # the inferred argument type, so a workflow whose body cannot fail would have
  # its \`{:error, _}\` clause flagged "never matches" under -Werror.
  def report_result({:error, reason} = result) do
    ${renderPhoenixLogCall("workflowFailed", [
      { name: "workflow", valueExpr: JSON.stringify(wf.name) },
      { name: "error", valueExpr: "inspect(reason)" },
    ])}
    result
  end

  def report_result(result), do: result`;
  // `create(…): T { … return <expr> }` — the declared result closes the chain
  // (`ownResult`), and its refs count as reads so the binds it names keep their
  // real names (`trailing`) — the explicit-handler path's exact contract.
  const result = commandCreateResult(wf);
  const lines = lowerStatements(
    wf.statements ?? [],
    contextModuleFq,
    renderCtx,
    ctx,
    result ? { trailing: [result.value], ownResult: true } : {},
  );
  // Load-or-allocate + persist, mirroring `renderPersistedBody`'s create arm.
  // `loom_state` keeps the row AS LOADED so the trailing changeset carries the
  // body's writes as real CHANGES — Elixir rebinds `state` in place
  // (`state = %{state | f: v}`), and `Ecto.Changeset.change(state, …)` against
  // the already-updated struct would diff to nothing and the update would be a
  // silent no-op (the trap `projection-fold` documents).
  const stateMod = `${contextModuleFq}.Workflows.${wfPascal}State`;
  const allocFields = corrParam
    ? [
        `${snake(wf.correlationField as string)}: key`,
        ...requiredStateFields(wf).map(
          (f) =>
            `${snake(f.name)}: ${stateDefault(f.type, ctx ? stateDefaultDecls(ctx) : undefined)}`,
        ),
      ]
    : [];
  // A fresh key allocates the instance IN MEMORY: the row is written only once
  // the body succeeded (below), so a failed start leaves no instance, as on
  // every other backend.
  const statePrelude = corrParam
    ? [
        `    key = params[${JSON.stringify(corrParam.name)}]`,
        `    loom_state =`,
        `      case Repo.get(${stateMod}, key) do`,
        `        nil -> %${stateMod}{${allocFields.join(", ")}}`,
        `        existing -> existing`,
        `      end`,
        ...(bindsState ? ["", "    state = loom_state"] : []),
        "",
      ].join("\n") + "\n"
    : "";
  const mutableStateFields = (wf.stateFields ?? [])
    .filter((f) => f.name !== wf.correlationField)
    .map((f) => `:${snake(f.name)}`);
  // On success the instance row is inserted (a fresh key) or updated with the
  // body's own-state writes.  An unchanged loaded row is an empty changeset,
  // which Ecto skips without touching `updated_at`.
  const writesState =
    bindsState && workflowBodyWritesOwnState(wf.statements ?? []) && mutableStateFields.length > 0;
  const persistLines = corrParam
    ? [
        writesState
          ? `Repo.insert_or_update!(Ecto.Changeset.change(loom_state, Map.take(state, [${mutableStateFields.join(", ")}])))`
          : "Repo.insert_or_update!(Ecto.Changeset.change(loom_state))",
      ]
    : [];
  const body = assembleBody(
    lines,
    completedCall,
    persistLines,
    result ? renderExpr(result.value, renderCtx) : undefined,
  );
  // A workflow that names `currentUser` in a guard/body — or calls a
  // `currentUser`-gated op, or creates a principal-stamped aggregate — threads
  // `current_user \\ nil` into `run/1`
  // (and `run_inner` on the transactional path) so the rendered bare token
  // `current_user` (and the trailing op-call actor) bind.  The
  // `WorkflowsController` passes `conn.assigns[:current_user]`.  A workflow
  // that references no actor renders byte-identically to before (no extra arg).
  const needsUser = ctx ? workflowThreadsActor(wf, ctx) : workflowUsesCurrentUser(wf);
  const userParam = needsUser ? ", current_user \\\\ nil" : "";
  // Emit the `Context` alias iff the body actually references the context
  // module — a `with`-clause alone is NOT proof (a workflow whose `with`
  // clauses only call `D.Resources.*` / `Domain.Services` references no
  // context module, so the alias would be unused and fail -Werror).  The
  // rewrite below keys on the same `contextModuleFq` substring, so this
  // predicate exactly matches "would the alias be used".
  const hasContextCall = body.includes(contextModuleFq);
  const contextAlias = hasContextCall ? `\n  alias ${contextModuleFq}, as: Context` : "";
  // Rewrite the body's fully-qualified context module to the `Context`
  // alias to keep the rendered Elixir tidy and avoid long-line warnings.
  const aliasedBody = hasContextCall ? body.replaceAll(contextModuleFq, "Context") : body;
  // M13 — one `fragment()` anchor per statement, independent of position
  // (assembleBody's with-clause/emit bucketing REORDERS statements relative
  // to source order, so a single cursor-walked fragment can't be used — see
  // https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/source-map-and-debugging.md).  Each line's own text is put
  // through the SAME `Context`-alias rewrite `aliasedBody` got, so the
  // anchor matches the final content verbatim.
  const statementRegions: { text: string; origin: OriginRef | undefined }[] = wantRegions
    ? lines
        .filter((l) => l.origin)
        .map((l) => ({
          text: hasContextCall ? l.text.replaceAll(contextModuleFq, "Context") : l.text,
          origin: l.origin,
        }))
    : [];
  // Surface referenced create-params as locals via a leading map
  // destructure — the body's bare `param` refs (`initial_title`) bind off
  // the `run/1` map.  Empty when no params are referenced, so a
  // param-free workflow renders byte-identically to before.
  const params = referencedParams(wf);
  // A PAYLOAD-typed param (`create(c: FileClaim)`) arrives as the decoded JSON
  // object — a STRING-keyed map — while the body reads its fields with the dot
  // syntax (`c.cargo`), i.e. ATOM keys: every run raised `KeyError: key :cargo
  // not found` (wave C3 D7).  Each referenced payload param is rebound to an
  // atom-keyed map over the payload's declared fields (wire key → snake atom,
  // the name the body's member access renders).
  const payloadRebinds = params.flatMap((n) => {
    const t = (wf.params ?? []).find((p) => p.name === n)?.type;
    const inner = t?.kind === "optional" ? t.inner : t;
    const payload =
      inner?.kind === "entity"
        ? ctx?.payloads.find((pl) => pl.name === inner.name && !pl.variants)
        : undefined;
    if (!payload) return [];
    const v = escapeElixirIdent(snake(n));
    const entries = payload.fields.map(
      (f) => `${snake(f.name)}: Map.get(${v}, ${JSON.stringify(f.name)})`,
    );
    return [`    ${v} = if is_map(${v}), do: %{${entries.join(", ")}}, else: ${v}\n`];
  });
  // A VALUE-OBJECT param arrives as string-keyed JSON with enum values as
  // strings, while the body reads it as the value object the constructor
  // builds (atom keys, enum atoms, `%Decimal{}`): `vehicle.usage == :Commercial`
  // compared a string to an atom and never matched.  Each referenced one is
  // cast through the codec its jsonb column uses (`Loom.ValueObject.cast/2`);
  // a value that is not an object stays as given.
  const voPools = ctx
    ? {
        vos: new Map(valueObjectPool(ctx).map((v) => [v.name, v])),
        enums: new Map(enumPool(ctx).map((e) => [e.name, e])),
      }
    : undefined;
  const voRebinds = params.flatMap((n) => {
    const t = (wf.params ?? []).find((p) => p.name === n)?.type;
    const inner = t?.kind === "optional" ? t.inner : t;
    if (!voPools || inner?.kind !== "valueobject") return [];
    const v = escapeElixirIdent(snake(n));
    const cast = valueObjectCastCall(inner.name, v, voPools.vos, voPools.enums);
    if (!cast) return [];
    return [
      `    ${v} =
      case ${cast} do
        {:ok, cast} -> cast
        :error -> ${v}
      end
`,
    ];
  });
  // A payload's MONEY fields are wire strings the body hands on unparsed, so a
  // malformed one ("1.2.3") reached the aggregate's changeset and came back
  // Ecto's "is invalid" at the AGGREGATE's field (`/amount`).  Every other
  // backend refuses it at the wire, as node's `Invalid decimal: "1.2.3"` at the
  // field's whole path (`/c/amount`, RS-33).  Each such field is checked against
  // node's money grammar before the body runs; a refusal is a changeset error on
  // the PARAM carrying the field on `loom_path`, which the shared renderer turns
  // into exactly that pointer.
  const moneyChecks = params.flatMap((n) => {
    const t = (wf.params ?? []).find((p) => p.name === n)?.type;
    const inner = t?.kind === "optional" ? t.inner : t;
    const payload =
      inner?.kind === "entity"
        ? ctx?.payloads.find((pl) => pl.name === inner.name && !pl.variants)
        : undefined;
    if (!payload || inner?.kind !== t?.kind) return [];
    return payload.fields
      .filter((f) => {
        const ft = f.type.kind === "optional" ? f.type.inner : f.type;
        return ft.kind === "primitive" && ft.name === "money";
      })
      .map((f) => `{:${snake(n)}, :${snake(f.name)}, ${snake(n)}.${snake(f.name)}}`);
  });
  // A VALUE-OBJECT param runs its value object's validating constructor
  // (`<Ctx>.<Vo>.new/1`, `valueobject-emit.ts`) on the cast value before the
  // body, so a broken invariant is the 422 at `/<param>/<member>` the other
  // four backends answer at the wire — the workflow twin of the operation
  // param guard (`op-param-guards.ts`).  Only the context's own value objects
  // carry a module here, the same scope the aggregate changeset reads.
  const voRuleChecks = params.flatMap((n) => {
    const t = (wf.params ?? []).find((p) => p.name === n)?.type;
    const inner = t?.kind === "optional" ? t.inner : t;
    if (!ctx || inner?.kind !== "valueobject") return [];
    const vo = ctx.valueObjects.find((v) => v.name === inner.name);
    if (!vo || !voHasConstraints(vo)) return [];
    return [
      `{:${snake(n)}, ${escapeElixirIdent(snake(n))}, &${contextModuleFq}.${upperFirst(vo.name)}.new/1}`,
    ];
  });
  const guardCalls = [
    ...(moneyChecks.length > 0 ? [`__loom_payload_money([${moneyChecks.join(", ")}])`] : []),
    ...(voRuleChecks.length > 0 ? [`__loom_vo_rules([${voRuleChecks.join(", ")}])`] : []),
  ];
  const guardSubject =
    guardCalls.length === 1
      ? guardCalls[0]
      : `(with ${guardCalls.map((c) => `:ok <- ${c}`).join(", ")}, do: :ok)`;
  const moneyGuardOpen =
    guardCalls.length > 0
      ? `    case ${guardSubject} do
      :ok ->
`
      : "";
  const moneyGuardClose =
    guardCalls.length > 0
      ? `
      {:error, _} = loom_payload_refusal -> loom_payload_refusal
    end`
      : "";
  const moneyGuardHelper =
    moneyChecks.length > 0
      ? `

  # node's money grammar, character for character — the payload twin of the
  # context's operation-param guard.
  defp __loom_payload_money(checks) do
    Enum.find_value(checks, :ok, fn {param, field, value} ->
      if is_nil(value) or (is_binary(value) and Regex.match?(${exMoneyGrammarRegex()}, value)) do
        nil
      else
        {:error,
         {%{}, %{param => :map}}
         |> Ecto.Changeset.change(%{})
         |> Ecto.Changeset.add_error(param, ${exLit(`${exValuePrefix("money-grammar")}: `)} <> Jason.encode!(value), loom_path: [field], loom_code: ${exFieldCode("money-grammar")}, loom_params: %{value: value})}
      end
    end)
  end`
      : "";
  const voRulesHelper =
    voRuleChecks.length > 0
      ? `

  # A value-object param's own invariants, judged by its validating
  # constructor; each refusal is reported at \`/<param>/<member>\`.
  defp __loom_vo_rules(checks) do
    Enum.find_value(checks, :ok, fn {param, value, new_fun} ->
      with true <- is_map(value),
           {:error, %Ecto.Changeset{errors: errors}} <- new_fun.(value) do
        {:error,
         errors
         |> Enum.reverse()
         |> Enum.reduce(Ecto.Changeset.change({%{}, %{param => :map}}, %{}), fn {key, {msg, opts}}, acc ->
           Ecto.Changeset.add_error(acc, param, msg, Keyword.put(opts, :loom_path, [key]))
         end)}
      else
        _ -> nil
      end
    end)
  end`
      : "";
  const paramDestructure =
    params.length > 0
      ? `    %{${params.map((n) => `${JSON.stringify(n)} => ${escapeElixirIdent(snake(n))}`).join(", ")}} = params\n${payloadRebinds.join("")}${voRebinds.join("")}`
      : "";
  // That destructure is a BARE MATCH: a request missing one of these keys
  // raises `MatchError` rather than returning, so it never reaches the
  // controller's `{:error, _}` arms and the fault handler answers 500 — on a
  // route whose own OpenAPI declares 422, and where node/dotnet/java/python
  // all validate and answer 422.  A guard on the public `run/1` plus a
  // fallback clause turns the raise into a value the controller can map,
  // without touching the body or its indentation.
  //
  // Scoped to the params the body actually DESTRUCTURES (`referencedParams`),
  // which is exactly the set that can raise.  A declared-but-unreferenced
  // param stays unchecked here: requiring it would be a new refusal this
  // defect does not call for, and the other backends' request schemas already
  // cover that case at the wire boundary.
  const requiredKeysGuard =
    params.length > 0
      ? params.map((n) => ` and is_map_key(params, ${JSON.stringify(n)})`).join("")
      : "";
  // A second clause forces the DEFAULT-ARGUMENT declaration out into a bodiless
  // header.  `userParam` is `, current_user \\ nil`, and Elixir rejects a
  // function that has several clauses AND declares defaults on them ("definitions
  // with multiple clauses and default values require a header"); it is a compile
  // ERROR, not a warning, so a currentUser-threading workflow would not build at
  // all.  Only emitted when BOTH the fallback clause and the default exist —
  // otherwise the single-clause output stays byte-identical.
  const defaultsHeader =
    params.length > 0 && userParam !== ""
      ? `  def run(params${userParam})

`
      : "";
  // …and with the header carrying the default, the clauses must not repeat it.
  const clauseUserParam = defaultsHeader !== "" ? ", current_user" : userParam;
  const missingParamsClause =
    params.length > 0
      ? `
  # The request omitted a param the body destructures.  Returned, not raised,
  # so the controller answers the 422 this route publishes instead of a 500.
  def run(params${defaultsHeader !== "" ? ", _current_user" : ""}) when is_map(params) do
    {:error, {:invalid_params, Enum.reject([${params.map((n) => JSON.stringify(n)).join(", ")}], &is_map_key(params, &1))}}
  end
`
      : "";
  // `workflow_started` runs first thing in the body (before the destructure +
  // the with-chain), so it fires at run/1 entry on every invocation.
  const finalBody =
    `    ${startedCall}\n` +
    paramDestructure +
    moneyGuardOpen +
    statePrelude +
    aliasedBody +
    moneyGuardClose;

  const transactionalDoc = transactional
    ? "\n\n  Marked `transactional` — the body runs inside `Repo.transaction/1`;\n  a rejection result rolls the transaction back."
    : "";

  if (transactional) {
    // Ecto has no `isolation_level:` option, so when an isolation level
    // resolves we set it as the FIRST statement inside the transaction fn.
    // Omitted entirely otherwise (connection default applies) — byte-identical
    // to the no-isolation output.
    // `run_inner` carries `current_user` only when the body references it; `run`
    // always passes it through the transaction fn so the binding stays in scope.
    const innerArgs = needsUser ? "params, current_user" : "params";
    const innerParam = needsUser ? "params, current_user" : "params";
    const txnBody = isolation
      ? `\n      Repo.query!("SET TRANSACTION ISOLATION LEVEL ${elixirIsolationSql(isolation)}")\n      commit_result(run_inner(${innerArgs}))\n    `
      : ` commit_result(run_inner(${innerArgs})) `;
    const content = `# Auto-generated.
defmodule ${moduleName} do
  @moduledoc """
  Workflow \`${wf.name}\` — plain Elixir.${transactionalDoc}
  """

  require Logger
  alias ${repoMod}${contextAlias}

  @spec run(map()${needsUser ? ", term()" : ""}) :: {:ok, term()} | {:error, term()}
${defaultsHeader}  def run(params${clauseUserParam}) when is_map(params)${requiredKeysGuard} do
    # A workflow is a per-dispatch boundary: run it in a child execution frame
    # (parent_id <- the request's root scope) so its audit / provenance rows
    # record their call-structure position.
    #
    # \`PostCommit.transaction\` holds every event this body announces — the
    # reactor fan-out and the PubSub broadcast — until the
    # transaction commits, and drops them on a rollback (M-T4.3 item 6).
    ${appModule}.RequestContext.with_child_frame(fn ->
      ${appModule}.PostCommit.transaction(fn ->
        Repo.transaction(fn ->${txnBody}end)
      end)
    end)
    |> report_result()
  end
${missingParamsClause}${failureReporter}

  # Public (not defp): Elixir 1.18 narrows a private fn's parameter to
  # run_inner's inferred result, which flags whichever arm this workflow's
  # body can't produce (e.g. a body that can't fail makes the rollback arm
  # "never match").  A public fn keeps both arms at their full clause domain.
  def commit_result({:ok, result}), do: result
  def commit_result({:error, reason}), do: Repo.rollback(reason)

  defp run_inner(${innerParam}) when is_map(params) do
${finalBody}
  end${helperDefs}${moneyGuardHelper}${voRulesHelper}
end
`;
    return { content, statementRegions };
  }

  const content = `# Auto-generated.
defmodule ${moduleName} do
  @moduledoc """
  Workflow \`${wf.name}\` — plain Elixir.
  """

  require Logger${corrParam ? `\n  alias ${repoMod}` : ""}${hasContextCall ? `${contextAlias}\n` : ""}

  @spec run(map()${needsUser ? ", term()" : ""}) :: {:ok, term()} | {:error, term()}
${defaultsHeader}  def run(params${clauseUserParam}) when is_map(params)${requiredKeysGuard} do
    # A workflow is a per-dispatch boundary: run it in a child execution frame
    # (parent_id <- the request's root scope) so its audit / provenance rows
    # record their call-structure position.
    ${appModule}.RequestContext.with_child_frame(fn ->
${finalBody}
    end)
    |> report_result()
  end
${missingParamsClause}${failureReporter}${helperDefs}${moneyGuardHelper}${voRulesHelper}
end
`;
  return { content, statementRegions };
}

/** Does any body of this workflow load through `getById` or answer `notFound`
 *  (at any depth)?  Gates the dispatcher's `{:not_found, detail}` arm. */
/** A statement whose miss reaches the dispatcher as the detail-carrying
 *  `{:not_found, detail}` term: a by-id or natural-key load (tagged under
 *  `tagGetByIdMiss`), or `notFound` itself. */
export function tagsNotFoundMiss(s: WorkflowStmtIR): boolean {
  return (
    (s.kind === "repo-let" && (s.op === "load" || s.op === "load-by-key")) || s.kind === "not-found"
  );
}

function workflowLoadsById(wf: WorkflowIR): boolean {
  const lists: readonly (readonly WorkflowStmtIR[])[] = [
    wf.statements,
    ...wf.creates.map((c) => c.statements),
    ...(wf.subscriptions ?? []).map((o) => o.statements),
  ];
  let found = false;
  for (const list of lists) {
    for (const top of list) {
      walkWorkflowStmtsDeep(top, (s) => {
        if (tagsNotFoundMiss(s)) found = true;
      });
    }
  }
  return found;
}

function renderWorkflowsController(appModule: string, groups: WorkflowControllerGroup[]): string {
  const webModule = `${appModule}Web`;

  // One action per command workflow across ALL hosted contexts.  Each action
  // routes to its own context-namespaced `<App>.<Ctx>.Workflows.<Wf>` module, so
  // workflows from different contexts coexist in this single controller (the HTTP
  // surface is per-deployable).  `currentUser` threading is decided per workflow
  // against its OWN context.
  const actions = groups
    .flatMap((g) => {
      const ctxModule = upperFirst(g.ctx.name);
      return g.workflows.map((wf) => {
        const wfSnake = snake(wf.name);
        const wfMod = `${appModule}.${ctxModule}.Workflows.${upperFirst(wf.name)}`;
        // When the workflow threads `current_user` (it names `currentUser` or
        // calls a `currentUser`-gated op), bind it off `conn.assigns` and pass it
        // through — mirrors the per-op controller action (api-emit.ts).
        const needsUser = workflowThreadsActor(wf, g.ctx);
        // `create(…): T` answers 200 with the value (`respond_result`); a
        // result-less workflow keeps the shared 204 `respond`.
        const responder = commandCreateResult(wf) ? "respond_result" : "respond";
        if (needsUser) {
          return `  def ${wfSnake}(conn, params) do
    current_user = Map.get(conn.assigns, :current_user)
    ${responder}(conn, ${wfMod}.run(params, current_user))
  end`;
        }
        return `  def ${wfSnake}(conn, params) do
    ${responder}(conn, ${wfMod}.run(params))
  end`;
      });
    })
    .join("\n\n");

  const ctxList = groups.map((g) => upperFirst(g.ctx.name)).join(", ");
  // `create(…): T` — the value crosses the wire UNWRAPPED (an id is its uuid
  // string), the same JSON token the other four backends answer.  Every other
  // result falls through to the shared `respond` (its error arms).  Emitted
  // only when some workflow declares a result, so the controller is
  // byte-identical otherwise.
  const resultResponder = groups.some((g) => g.workflows.some((wf) => commandCreateResult(wf)))
    ? `
  # A workflow that declares a result (\`create(…): T { … return x }\`) answers
  # 200 with that value as the JSON body.  Public, like \`respond\`, so Elixir
  # 1.18's type checker keeps both clauses at their full domain.
  def respond_result(conn, {:ok, result}) do
    conn
    |> put_status(200)
    |> json(result)
  end

  def respond_result(conn, other), do: respond(conn, other)
`
    : "";

  return `# Auto-generated.
defmodule ${webModule}.WorkflowsController do
  use ${webModule}, :controller
  alias ${webModule}.ProblemDetails

  @moduledoc """
  HTTP entry points for command-triggered workflows
  (${ctxList}).
  """
${renderRequiredParamsPlug(new Map(groups.flatMap((g) => g.workflows.map((wf) => [snake(wf.name), requiredWireParams(wf.params)] as const))))}${renderStrictParamsPlug(new Map(groups.flatMap((g) => g.workflows.map((wf) => [snake(wf.name), strictIngressFields(wf.params)] as const))))}
${actions}

  # Shared result handler.  Each workflow's run/1 result flows through
  # here; keeping the dispatch in one multi-clause function (rather than a
  # case inlined per action) means Elixir 1.18's type checker doesn't
  # narrow the scrutinee to a single workflow's exact result shape and
  # flag the error branches that workflow can't produce.
  # 204, empty body — the SAME success contract the other four backends serve
  # for a workflow POST (httpCtx.body(null, 204) / NoContent() /
  # @ResponseStatus(NO_CONTENT) / Response(status_code=204)), and the one this
  # deployable's own OpenAPI declares.
  #
  # Sweep F-030: this answered 202 with %{status: "accepted", result: ...}
  # while the published spec said 200 and the other four said 204 — three
  # contracts for one .ddd.  A client written against the "identical API
  # contracts" claim and tested on Hono broke the moment the deployable was
  # re-pointed at Phoenix.  The projected result body went with it: nothing
  # published it, and a workflow's durable output is read back through the
  # aggregate's own REST resource or its instance endpoints.
  def respond(conn, {:ok, _result}), do: send_resp(conn, 204, "")

  def respond(conn, {:error, %Ecto.Changeset{} = changeset}),
    do: ProblemDetails.validation_error_response(conn, changeset)

${respondErrorTail(
  "respond",
  "  ",
  groups[0] ? denialOverrides(groups[0].ctx) : undefined,
  contextsHaveWireDenials(groups.map((g) => g.ctx)),
  true,
  groups.some((g) => g.workflows.some(workflowLoadsById)),
  groups.some((g) => aggregatesNeedConcurrency(g.ctx.aggregates)),
)}${resultResponder}
end
`;
}

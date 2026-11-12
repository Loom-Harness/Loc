import { deriveEventSubscriptions } from "../../ir/enrich/enrichments.js";
import { foldTenancyFor, foldTenantColumns } from "../../ir/enrich/fold-tenancy.js";
import { hasStateRow, subscriptionHandler } from "../../ir/plan/index.js";
import type {
  ChannelIR,
  EnrichedBoundedContextIR,
  EnumIR,
  ExprIR,
  FunctionIR,
  ProjectionIR,
  ProjectionOnIR,
  StmtIR,
  SystemIR,
  TypeIR,
  WorkflowIR,
  WorkflowStmtIR,
} from "../../ir/types/loom-ir.js";
import type { OriginRef } from "../../ir/types/origin.js";
import { enumPool } from "../../ir/util/reachable-types.js";
import { resolveContextSchema } from "../../ir/util/resolve-datasource.js";
import { reactorNeedsPrincipal } from "../../ir/util/system-principal.js";
import { walkExprDeep, walkStmtExprsDeep, walkWorkflowStmtExprsDeep } from "../../ir/util/walk.js";
import { workflowBodyUsesOwnState } from "../../ir/util/workflow-own-state.js";
import { escapeElixirIdent, snake, upperFirst, workflowStateTableName } from "../../util/naming.js";
import { renderPhoenixLogCall } from "../_obs/render-phoenix.js";
import { lineCount, type SourceMapRecorder } from "../_trace/sourcemap.js";
import {
  lowerWorkflowPipeline,
  type PipelineStep,
  type WorkflowPipelineTarget,
} from "../_workflow/stmt-target.js";
import { buildPhoenixResourceModules } from "./adapters/resource-clients.js";
import type { ElixirChannelsCfg } from "./channels-emit.js";
import { internalCreateFn, internalDeleteFn } from "./lifecycle-seam.js";
import { type RenderCtx, renderExpr } from "./render-expr.js";
import { type StateDefaultDecls, stateDefault, stateDefaultDecls } from "./state-default.js";
import { exEctoIdJsonType, exEctoIdType } from "./vanilla/codec-spelling-ex.js";
import { normalizeDatetime } from "./vanilla/datetime-type-emit.js";
import { denialTerm } from "./vanilla/denial.js";
import { bodyUsesParam, renderFunctionBodyLines } from "./vanilla/function-emit.js";
import { emitsRestDelete } from "./vanilla/rest-surface.js";
import { mapTypeToEcto } from "./vanilla/schema-emit.js";
import { renderEsWorkflowHandler } from "./vanilla/workflow-eventsourced-emit.js";
import {
  assembleChain,
  chainLink,
  elixirWorkflowTarget,
  tupleBind,
} from "./vanilla/workflow-execution-emit.js";

/** M13 — a handler-render result: the module's final content plus one
 *  statement-granular `fragment()` anchor per rendered statement — the
 *  exact text a statement rendered to (VERBATIM, as it appears in the
 *  final content) paired with its origin.  Shared shape between the
 *  regular (`renderHandler`) and event-sourced (`renderEsWorkflowHandler`
 *  in `workflow-eventsourced-emit.ts`) reactor bodies, so `emitDispatch`'s
 *  call site handles both without a per-path branch. */
export interface HandlerResult {
  content: string;
  regions: { text: string; origin: OriginRef | undefined }[];
}

// ---------------------------------------------------------------------------
// In-process event dispatch for Phoenix LiveView (channels.md).
//
// Mirrors the Hono (#970) and .NET (#1012) slices: each channel-routed
// subscription — an `on(e: Event)` reactor or an event-triggered
// `create(e: Event) by` starter — becomes a handler module with a
// `handle(event)` function.  A per-context `Dispatcher` routes an emitted
// domain event (by its struct type) to every handler subscribed to it; a
// handler that itself `emit`s re-enters the dispatcher, so choreography
// chains (OrderPlaced → ShipmentRequested → …) fan out in-process.
//
// Correlation is persisted when the workflow declares a correlation field:
// the handler routes the event to a saga-instance row keyed by that field
// (load-or-allocate for `create`, route-or-drop+log for `on`).  The row is
// a plain `Ecto.Schema` over the saga table the shared `MigrationsIR`
// already derives — read/written through the app `Ecto.Repo`.
//
// A projection (projection.md) subscribes to the SAME channel events as a
// pure read-model fold (load-or-allocate → set fields → upsert; no route-or-
// drop split, no child frame).  Subscriptions are re-derived WITH projections
// (like python's `dispatchSubscriptionsOf`) because the enricher-stored
// `ctx.eventSubscriptions` omits them — so a projection-only context still gets
// a dispatcher.  Its fold joins the event's dispatch clause alongside any saga
// reactor.
//
// Emitted files (only when the context has ≥1 workflow subscription OR
// projection fold — a channel-/projection-less context emits none of this,
// byte-identical):
//   lib/<app>/<ctx>/dispatcher.ex                        — the router
//   lib/<app>/<ctx>/workflows/<wf>/<start|on>_<event>.ex — one per saga subscription
//   lib/<app>/<ctx>/workflows/<wf>_state.ex              — saga Ecto.Schema
//   lib/<app>/<ctx>/projections/<proj>/on_<event>.ex     — one per projection fold
// ---------------------------------------------------------------------------

interface Subscription {
  trigger: "on" | "create";
  event: string;
  param: string;
  workflow: WorkflowIR;
  correlation?: ExprIR;
  statements: WorkflowStmtIR[];
}

/** A projection fold subscription (projection.md) — a pure read-model upsert,
 *  kept SEPARATE from the saga `Subscription` so the workflow handler renderers
 *  keep their required-`workflow` contract. */
interface ProjectionSub {
  event: string;
  param: string;
  projection: ProjectionIR;
  on: ProjectionOnIR;
}

/** Resolve a context's channel-routed WORKFLOW subscriptions back to the
 *  concrete reactor / event-create node.  Re-derives WITH projections so the
 *  derivation is shared, then keeps only the workflow (non-projection) subs;
 *  projection folds are resolved by `resolveProjectionSubs`. */
function resolveSubscriptions(
  ctx: EnrichedBoundedContextIR,
  extraChannels: ChannelIR[] = [],
): Subscription[] {
  const subs: Subscription[] = [];
  for (const s of deriveEventSubscriptions(
    [...ctx.channels, ...extraChannels],
    ctx.workflows,
    ctx.projections,
  )) {
    if (s.projection) continue;
    const wf = ctx.workflows.find((w) => w.name === s.workflow);
    if (!wf) continue;
    const handler = subscriptionHandler(wf, s);
    if (!handler) continue;
    subs.push({
      trigger: s.trigger,
      event: s.event,
      param: s.param,
      workflow: wf,
      correlation: handler.correlation,
      statements: handler.statements,
    });
  }
  return subs;
}

/** Resolve a context's projection fold subscriptions (projection.md) — one per
 *  `(projection, on-handler)`.  A projection has no route-or-drop split: every
 *  event allocates-or-loads and upserts. */
function resolveProjectionSubs(ctx: EnrichedBoundedContextIR): ProjectionSub[] {
  const out: ProjectionSub[] = [];
  for (const proj of ctx.projections) {
    for (const on of proj.handlers) {
      // EVERY fold routes, carried or not (D-PROJECTION-IMPLICIT-SUB): `on(e: E)`
      // IS the subscription and a `channel` only decides cross-deployable
      // delivery / durability.  This mirrored the old `deriveEventSubscriptions`
      // carriage filter, which meant an uncarried fold was silently skipped here
      // AND produced no subscription there — a read model no backend ever wrote.
      out.push({ event: on.event, param: on.param, projection: proj, on });
    }
  }
  return out;
}

/** True when this context emits a `Dispatcher` module — i.e. it has at least
 *  one resolvable workflow event subscription OR projection fold.  Callers (e.g.
 *  the aggregate emit path, which fans emitted events into the dispatcher) must
 *  guard the `<Ctx>.Dispatcher.dispatch/1` reference on this, since the module is
 *  only emitted when a subscriber exists (`emitDispatch` short-circuits otherwise). */
export function contextHasDispatcher(
  ctx: EnrichedBoundedContextIR,
  extraChannels: ChannelIR[] = [],
): boolean {
  return (
    resolveSubscriptions(ctx, extraChannels).length > 0 || resolveProjectionSubs(ctx).length > 0
  );
}

/** The saga-state module name (`<App>.<Ctx>.Workflows.<Wf>State`). */
export function stateModule(contextModule: string, wf: WorkflowIR): string {
  return `${contextModule}.Workflows.${upperFirst(wf.name)}State`;
}

/** The projection read-model row module (`<App>.<Ctx>.Projections.<Proj>Row`) —
 *  the Ecto schema the fold upserts and the read controller queries. */
export function projectionRowModule(contextModule: string, proj: ProjectionIR): string {
  return `${contextModule}.Projections.${upperFirst(proj.name)}Row`;
}

/** The projection fold handler module (`<App>.<Ctx>.Projections.<Proj>.On<Event>`). */
function projectionHandlerModule(
  contextModule: string,
  proj: ProjectionIR,
  on: ProjectionOnIR,
): string {
  return `${contextModule}.Projections.${upperFirst(proj.name)}.On${upperFirst(on.event)}`;
}

/** Emit the saga-state Ecto schema (`<wf>_state.ex`) for EVERY
 *  correlation-bearing workflow in the context — not just the ones a
 *  subscription references (workflow-instance-visibility.md needs the schema
 *  to read instances even for a command-only saga).  Idempotent with
 *  `emitDispatch`'s own schema emission: same path, byte-identical content. */
export function emitWorkflowStateSchemas(
  appName: string,
  ctx: EnrichedBoundedContextIR,
  appModule: string,
  out: Map<string, string>,
  /** The context's schema for the saga-state `@schema_prefix`; undefined ⇒
   *  unqualified. */
  schema?: string,
  /** Any context this deployable hosts declares a durable channel — the saga
   *  row maps `last_event_id` whenever it can receive a durable envelope, even
   *  one whose channel is declared in another hosted context. */
  durable = false,
): void {
  const ctxSnake = snake(ctx.name);
  const contextModule = `${appModule}.${upperFirst(ctx.name)}`;
  for (const wf of ctx.workflows) {
    if (!hasStateRow(wf)) continue;
    out.set(
      `lib/${appName}/${ctxSnake}/workflows/${snake(wf.name)}_state.ex`,
      renderStateSchema(contextModule, wf, enumPool(ctx), schema, durable),
    );
  }
}

/** The handler module name for a subscription
 *  (`<App>.<Ctx>.Workflows.<Wf>.Start<Event>` / `.On<Event>`). */
function handlerModule(contextModule: string, sub: Subscription): string {
  const verb = sub.trigger === "on" ? "On" : "Start";
  return `${contextModule}.Workflows.${upperFirst(sub.workflow.name)}.${verb}${upperFirst(sub.event)}`;
}

export function emitDispatch(
  appName: string,
  ctx: EnrichedBoundedContextIR,
  appModule: string,
  out: Map<string, string>,
  sys?: SystemIR,
  /** Source-map collector (`--sourcemap`).  Each handler file is
   *  single-workflow-attributable, so it gets a whole-file `wf.origin`
   *  region (like the command-workflow file) PLUS per-statement fragments —
   *  same contract as `emitVanillaWorkflowExecution`. */
  sourcemap?: SourceMapRecorder,
  /** Broker channels (M-T4.4): presence widens the subscription
   *  derivation with the wired-but-foreign channels and re-routes handler
   *  re-emits through the `<App>.Channels` tee. */
  channels?: ElixirChannelsCfg,
  extraChannels: ChannelIR[] = [],
  /** See `emitWorkflowStateSchemas`' `durable`. */
  durable = false,
): void {
  const ctxSnake = snake(ctx.name);
  const contextModule = `${appModule}.${upperFirst(ctx.name)}`;
  const subs = resolveSubscriptions(ctx, extraChannels);
  const projSubs = resolveProjectionSubs(ctx);
  if (subs.length === 0 && projSubs.length === 0) return;

  // --- Saga-state Ecto schemas — one per correlation-bearing workflow that
  //     a subscription references (matches the saga table the migrations
  //     builder derives for the same workflow). ----------------------------
  // Event-sourced workflows fold a `<wf>_events` stream — they have no mutable
  // `<wf>_state` row (their `<wf>_state.ex` carries the plain fold struct,
  // emitted by `emitVanillaEsWorkflowFiles`), so skip the saga schema here.
  // Projection read-model row schemas are emitted by `emitVanillaProjections`
  // (vanilla/index.ts), not here.
  const correlationWfs = new Map<string, WorkflowIR>();
  for (const sub of subs) {
    if (hasStateRow(sub.workflow)) correlationWfs.set(sub.workflow.name, sub.workflow);
  }
  const dispatchSchema = sys ? resolveContextSchema(ctx, sys) : undefined;
  for (const wf of correlationWfs.values()) {
    out.set(
      `lib/${appName}/${ctxSnake}/workflows/${snake(wf.name)}_state.ex`,
      renderStateSchema(contextModule, wf, enumPool(ctx), dispatchSchema, durable),
    );
  }

  // --- Workflow handler modules — one per subscription. -----------------
  for (const sub of subs) {
    const verb = sub.trigger === "on" ? "on" : "start";
    // An event-sourced workflow's handler folds the stream on load and appends
    // its own emitted events (the saga analogue of the ES aggregate).
    const { content, regions }: HandlerResult = sub.workflow.eventSourced
      ? renderEsWorkflowHandler(contextModule, sub, channels)
      : renderHandler(appModule, contextModule, ctx, sub, sys, channels, durable);
    const path = `lib/${appName}/${ctxSnake}/workflows/${snake(sub.workflow.name)}/${verb}_${snake(sub.event)}.ex`;
    out.set(path, content);
    const construct = `${ctx.name}.${sub.workflow.name}`;
    sourcemap?.file(path, content, sub.workflow.origin, construct);
    // M13 — one independent `fragment()` anchor per rendered statement
    // (verified: `renderBody`/`renderStmt`'s guard/chain/dispatch bucketing —
    // and the ES handler's guards/lets/emits bucketing — relocate a
    // statement's own text WITHOUT splitting it, so each anchors on its own
    // exact text regardless of the position the bucketing moved it to).
    for (const r of regions) {
      if (!r.origin) continue;
      sourcemap?.fragment(path, content, r.text, [
        { rel: [1, lineCount(r.text)], origin: r.origin, construct },
      ]);
    }
  }

  // --- Projection fold modules — a pure read-model upsert per (proj, event). --
  for (const ps of projSubs) {
    const content = renderProjectionFoldHandler(appModule, contextModule, ps.projection, ps.on);
    const path = `lib/${appName}/${ctxSnake}/projections/${snake(ps.projection.name)}/on_${snake(ps.event)}.ex`;
    out.set(path, content);
    sourcemap?.file(path, content, ps.projection.origin, `${ctx.name}.${ps.projection.name}`);
  }

  // --- Dispatcher — routes each event struct to its handler(s). ----------
  out.set(
    `lib/${appName}/${ctxSnake}/dispatcher.ex`,
    renderDispatcher(contextModule, ctx, subs, projSubs, channels),
  );
}

// ---------------------------------------------------------------------------
// Saga-state Ecto schema
// ---------------------------------------------------------------------------

/** The Ecto field/primary-key type for an id-valued correlation column —
 *  aligned with the migration's column type through the `Codec` fact's
 *  `idColumn` (`codec-spelling-ex.ts`). */
export const ectoIdType = exEctoIdType;

/** Plain (non-correlation) state-field Ecto type — it must agree with the
 *  column the migrations builder derives for the same field
 *  (`workflowStateTableShape` → `renderInitialStateFile`):
 *
 *  - `optional` is unwrapped first — nullability is a column option, not a type
 *    (an optional `datetime` fell through to `:string`, so every reactor write
 *    of a DateTime was an `Ecto.ChangeError` — wave C3 D8).
 *  - an id is the guid key type (`ectoIdType`), as the PK is.
 *  - an enum holds the member ATOM the body assigns (`claimState := Filed`
 *    renders `:Filed`), which `:string` cannot dump (wave C3 D6); the column
 *    stays text, `Ecto.Enum` stores the member name.
 *  - a reference collection (`X id[]`) is a jsonb column holding the id list,
 *    so its elements are the id's JSON form (a guid is a string there, never
 *    Ecto's 16-byte `:binary_id` dump, which Jason cannot encode).
 *  - everything else rides the aggregate schema mapping (`mapTypeToEcto`): a
 *    value object is ONE `:map` column (the migration collapses its flattened
 *    leaf columns, `collapseVoGroups`), a `datetime` is the millisecond
 *    `Loom.Datetime` every declared datetime column uses (RS-38). */
function ectoStateFieldType(t: TypeIR, enums: readonly EnumIR[]): string {
  if (t.kind === "optional") return ectoStateFieldType(t.inner, enums);
  if (t.kind === "id") return ectoIdType();
  if (t.kind === "enum") {
    const values = enums.find((e) => e.name === t.name)?.values ?? [];
    if (values.length > 0) return `Ecto.Enum, values: [${values.map((v) => `:${v}`).join(", ")}]`;
    return ":string";
  }
  if (t.kind === "array" && t.element.kind === "id") {
    return `{:array, ${exEctoIdJsonType()}}`;
  }
  return mapTypeToEcto(t, new Map()) ?? ":string";
}

function renderStateSchema(
  contextModule: string,
  wf: WorkflowIR,
  enums: readonly EnumIR[],
  schema?: string,
  /** Idempotent-consumer marker (dispatch-delivery-semantics.md §3): a durable
   *  channel maps the shared `last_event_id` column the migrations add. */
  durable = false,
): string {
  const corr = wf.correlationField as string;
  const corrField = (wf.stateFields ?? []).find((f) => f.name === corr);
  const pkType = corrField && corrField.type.kind === "id" ? ectoIdType() : ":string";
  const table = workflowStateTableName(wf.name);
  const fieldLines = (wf.stateFields ?? [])
    .filter((f) => f.name !== corr)
    .map((f) => `    field :${snake(f.name)}, ${ectoStateFieldType(f.type, enums)}`);
  if (durable) fieldLines.push(`    field :last_event_id, :string`);
  // `@schema_prefix` targets the workflow's context schema, matching the
  // migration `prefix:`.  Omitted ⇒ public, byte-identical.
  const prefixLine = schema ? `  @schema_prefix ${JSON.stringify(schema)}\n` : "";
  return `# Auto-generated.
defmodule ${stateModule(contextModule, wf)} do
  @moduledoc "Persisted correlation state for the ${upperFirst(wf.name)} workflow."

  use Ecto.Schema

${prefixLine}  @primary_key {:${snake(corr)}, ${pkType}, autogenerate: false}
  schema "${table}" do
${fieldLines.length > 0 ? fieldLines.join("\n") + "\n" : ""}    timestamps()
  end
end
`;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

function renderDispatcher(
  contextModule: string,
  ctx: EnrichedBoundedContextIR,
  subs: Subscription[],
  projSubs: ProjectionSub[] = [],
  channels?: ElixirChannelsCfg,
): string {
  // Group handler-module calls by event type so one `dispatch(%Event{})` clause
  // invokes every subscriber — workflow reactor AND projection fold — of that
  // event (parity with python's isinstance fan-out / Hono's `projectionTee`).
  const byEvent = new Map<string, string[]>();
  const push = (event: string, mod: string): void => {
    const list = byEvent.get(event) ?? [];
    list.push(`    ${mod}.handle(event)`);
    byEvent.set(event, list);
  };
  for (const sub of subs) push(sub.event, handlerModule(contextModule, sub));
  for (const ps of projSubs)
    push(ps.event, projectionHandlerModule(contextModule, ps.projection, ps.on));
  const clauses: string[] = [];
  for (const [event, calls] of byEvent) {
    // A wired-but-foreign channel's event struct lives under its OWNING
    // context's module (M-T4.4) — qualify the match accordingly.
    const evModule = channels?.foreignEventModules.get(event) ?? contextModule;
    clauses.push(
      `  def dispatch(%${evModule}.Events.${upperFirst(event)}{} = event) do\n${calls.join("\n")}\n    :ok\n  end`,
    );
  }
  return `# Auto-generated.
defmodule ${contextModule}.Dispatcher do
  @moduledoc "In-process event dispatch for the ${upperFirst(ctx.name)} context."

${clauses.join("\n\n")}

  # Events with no in-process subscriber are a no-op.
  def dispatch(_event), do: :ok
end

defmodule ${contextModule}.Dispatcher.AfterCommit do
  @moduledoc """
  The request path's dispatcher (workflow.md § Reactor failures): it runs
  after the command's write committed, so a reactor failure is logged
  \`reactor_failed\` and swallowed instead of failing that committed command.
  The outbox relay, broker consumers and the scheduler call
  \`${contextModule}.Dispatcher\` directly — their retry rides the raise.
  """
  require Logger

  # Inside a transactional workflow the event waits for the workflow's commit
  # (\`${contextModule.split(".")[0]}.PostCommit\`) and is dropped on its rollback.
  def dispatch(event) do
    ${contextModule.split(".")[0]}.PostCommit.run(fn -> deliver(event) end)
  end

  defp deliver(event) do
    ${contextModule}.Dispatcher.dispatch(event)
  rescue
    e -> reactor_failed(event, Exception.message(e))
  catch
    kind, reason -> reactor_failed(event, inspect({kind, reason}))
  end

  defp reactor_failed(event, error) do
    ${renderPhoenixLogCall("reactorFailed", [
      { name: "handler", valueExpr: `"dispatch"` },
      { name: "event_type", valueExpr: "event.__struct__ |> Module.split() |> List.last()" },
      { name: "event_id", valueExpr: "Ecto.UUID.generate()" },
      { name: "error", valueExpr: "error" },
    ])}
    :ok
  end
end
`;
}

// ---------------------------------------------------------------------------
// Handler module
// ---------------------------------------------------------------------------

function renderHandler(
  appModule: string,
  contextModule: string,
  ctx: EnrichedBoundedContextIR,
  sub: Subscription,
  sys?: SystemIR,
  channels?: ElixirChannelsCfg,
  durable = false,
): HandlerResult {
  const wf = sub.workflow;
  const persisted = !!wf.correlationField;
  const usesThis = persisted && workflowBodyUsesOwnState(sub.statements);
  // A reactor has no request principal: it runs as the SYSTEM principal
  // (ruling D1) — `<Web>.Auth.system_principal/0`, carrying the originating
  // request's tenant and recording its user as `caused_by`.  Bound only when
  // the body — or an operation it calls — reads `currentUser`.
  const bindsPrincipal = reactorNeedsPrincipal(sub.statements, ctx);
  const renderCtx: RenderCtx = {
    thisName: "state",
    contextModule,
    typesModule: `${appModule}.Types`,
    resourceModules: buildPhoenixResourceModules(sys, appModule),
    paramRenames: { [sub.param]: "event" },
    reactorPrincipal: bindsPrincipal,
  };

  // Body statements → ordered Elixir lines (0-indented), woven into a
  // `with`-chain plus the re-entrant dispatches the do-branch runs.
  const { lines: body, regions } = renderBody(
    sub.statements,
    ctx,
    renderCtx,
    contextModule,
    channels,
  );

  // Idempotent-consumer marker (dispatch-delivery-semantics.md §3): under a
  // durable channel, the ChannelConsumer parks the envelope id (= the outbox
  // row id) in the process dictionary; the saga handler no-ops on a redelivery
  // of the recorded id and stamps it before the state save.
  // Saga routing wrapper, indented to the `def handle` body (4 spaces).
  const inner = persisted
    ? renderPersistedBody(
        appModule,
        contextModule,
        wf,
        sub,
        body,
        usesThis,
        durable,
        stateDefaultDecls(ctx),
      )
    : indent(body, 4).join("\n");

  // Module names render fully-qualified throughout the body, so the only
  // import a handler needs is `require Logger` for the `on` drop+log path
  // (`Logger.warning/2` is a macro).
  const needLogger = sub.trigger === "on" && persisted;
  const requireLogger = needLogger ? "  require Logger\n\n" : "";

  const content = `# Auto-generated.
defmodule ${handlerModule(contextModule, sub)} do
  @moduledoc "${sub.trigger === "on" ? "Reactor" : "Starter"} for ${upperFirst(sub.event)} → ${upperFirst(wf.name)}."

${requireLogger}  def handle(%${channels?.foreignEventModules.get(sub.event) ?? contextModule}.Events.${upperFirst(sub.event)}{} = event) do
    # A reactor is a per-dispatch boundary: run it in a child execution frame
    # (parent_id <- the dispatching request's scope) so its audit / provenance
    # rows record their call-structure position.  The reaction is ATOMIC
    # (workflow.md § Reactor failures): a raise / throw part-way rolls back
    # the saga-state row and every write before it, then propagates.
    ${appModule}.RequestContext.with_child_frame(fn ->
${bindsPrincipal ? `    current_user = ${appModule}Web.Auth.system_principal()\n\n` : ""}    ${appModule}.Repo.transaction(fn ->
${inner}
    end)
    end)
  end${workflowFnHelpers(wf, sub.statements, { ...renderCtx, paramRenames: {} })}
end
`;
  return { content, regions };
}

/** The workflow `function` helpers a reactor body calls — directly or through
 *  another helper — as `defp`s in the reactor's own module.  A workflow-fn
 *  call renders as a bare module-local `label(…)`, and the command path's
 *  per-workflow module (which defines them there) is a different module, so
 *  each reactor carries the ones it reaches.  Only those: an unused `defp`
 *  fails `mix compile --warnings-as-errors`. */
function workflowFnHelpers(
  wf: WorkflowIR,
  statements: readonly WorkflowStmtIR[],
  renderCtx: RenderCtx,
): string {
  const fns = new Map((wf.functions ?? []).map((f) => [f.name, f] as const));
  if (fns.size === 0) return "";
  const called = new Set<string>();
  const visit = (e: ExprIR): void => {
    if (e.kind !== "call" || e.callKind !== "workflow-fn" || called.has(e.name)) return;
    const fn = fns.get(e.name);
    if (!fn) return;
    called.add(e.name);
    for (const root of functionBodyExprs(fn.body)) walkExprDeep(root, visit);
  };
  for (const s of statements) walkWorkflowStmtExprsDeep(s, visit);
  return [...fns.values()]
    .filter((fn) => called.has(fn.name))
    .map((fn) => {
      const params = fn.params
        .map((p) => (bodyUsesParam(fn.body, p.name) ? snake(p.name) : `_${snake(p.name)}`))
        .join(", ");
      const body = renderFunctionBodyLines(fn.body, renderCtx).join("\n");
      return `\n\n  defp ${snake(fn.name)}(${params}) do\n${body}\n  end`;
    })
    .join("");
}

/** Every expression a function body holds — its one expression, or each
 *  block statement's expressions. */
function functionBodyExprs(body: FunctionIR["body"]): ExprIR[] {
  if ("expr" in body) return [body.expr];
  const out: ExprIR[] = [];
  for (const s of body.stmts) walkStmtExprsDeep(s, (e) => out.push(e));
  return out;
}

/** Prefix every non-empty physical line of a 0-indented block with `n`
 *  spaces.  Multi-line elements (a `with`-chain whose clauses joined with
 *  `\n`) are split so each physical line is shifted — preserving the
 *  relative continuation alignment. */
function indent(lines: string[], n: number): string[] {
  const pad = " ".repeat(n);
  return lines.flatMap((l) => l.split("\n").map((sub) => (sub.length > 0 ? pad + sub : sub)));
}

/** Wrap a 0-indented rendered body in the correlation routing logic:
 *  load-or-allocate (`create`) or route-or-drop+log (`on`).  All wrapper
 *  lines sit at the `def handle` body's 4-space base; the body itself is
 *  indented to its position (a sibling of the load for `create`, nested in
 *  the matched case clause for `on`). */
function renderPersistedBody(
  appModule: string,
  contextModule: string,
  wf: WorkflowIR,
  sub: Subscription,
  bodyLines: string[],
  usesThis: boolean,
  /** Under a durable channel the body is wrapped in the idempotent-consumer
   *  marker (check the process-dictionary event id against the loaded row, and
   *  stamp it after the fold) — dispatch-delivery-semantics.md §3. */
  durable = false,
  /** The context's declarations — a required value-object / enum state field
   *  allocates its zero (`stateDefault`), never a NOT NULL-violating `nil`. */
  decls: StateDefaultDecls = {},
): string {
  const corr = wf.correlationField as string;
  const stateMod = stateModule(contextModule, wf);
  // Routing key: the `by <expr>` value, else the event field name-matching
  // the correlation field (the omitted-`by` rule).
  const keyExpr = sub.correlation
    ? renderExpr(sub.correlation, {
        thisName: "state",
        contextModule,
        paramRenames: { [sub.param]: "event" },
      })
    : `event.${snake(corr)}`;
  // A durable handler always reads/stamps the loaded row, so `state` must bind
  // even when the fold body itself never touches `this`.
  const bind = usesThis || durable ? "state" : "_state";
  // The stamp: rewrite the (possibly body-rebound) row with the processed id,
  // in the same Repo call window as the fold — a redelivery then no-ops above.
  const stampLines = (base: number): string[] =>
    durable
      ? [
          `${" ".repeat(base)}if event_id,`,
          `${" ".repeat(base + 2)}do: ${appModule}.Repo.update!(Ecto.Changeset.change(state, %{last_event_id: event_id}))`,
        ]
      : [];

  if (sub.trigger === "create") {
    // Load-or-allocate: a fresh key seeds the instance row (typed defaults).
    const allocFields = [`${snake(corr)}: key`];
    for (const f of wf.stateFields ?? []) {
      if (f.name === corr || f.optional) continue;
      allocFields.push(`${snake(f.name)}: ${stateDefault(f.type, decls)}`);
    }
    const load = [
      `    key = ${keyExpr}`,
      `    ${bind} =`,
      `      case ${appModule}.Repo.get(${stateMod}, key) do`,
      `        nil -> ${appModule}.Repo.insert!(%${stateMod}{${allocFields.join(", ")}})`,
      `        existing -> existing`,
      `      end`,
      "",
    ];
    if (!durable) return [...load, ...indent(bodyLines, 4)].join("\n");
    return [
      ...load,
      `    event_id = Process.get(:loom_event_id)`,
      "",
      `    if event_id && state.last_event_id == event_id do`,
      `      :ok`,
      `    else`,
      ...indent(bodyLines, 6),
      ...stampLines(6),
      `    end`,
    ].join("\n");
  }
  // Reactor: route to the started instance, else drop + log `event_unrouted`.
  const logCall = renderPhoenixLogCall("eventUnrouted", [
    { name: "workflow", valueExpr: JSON.stringify(wf.name) },
    { name: "event_type", valueExpr: JSON.stringify(sub.event) },
    { name: "key", valueExpr: "key" },
  ]);
  if (durable) {
    return [
      `    key = ${keyExpr}`,
      `    case ${appModule}.Repo.get(${stateMod}, key) do`,
      `      nil ->`,
      `        ${logCall}`,
      `        :ok`,
      "",
      `      state ->`,
      `        event_id = Process.get(:loom_event_id)`,
      "",
      `        if event_id && state.last_event_id == event_id do`,
      `          :ok`,
      `        else`,
      ...indent(bodyLines, 10),
      ...stampLines(10),
      `        end`,
      `    end`,
    ].join("\n");
  }
  return [
    `    key = ${keyExpr}`,
    `    case ${appModule}.Repo.get(${stateMod}, key) do`,
    `      nil ->`,
    `        ${logCall}`,
    `        :ok`,
    `      ${bind} ->`,
    ...indent(bodyLines, 8),
    `    end`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Projection fold handler (projection.md)
// ---------------------------------------------------------------------------

/** A pure projection fold: load-or-allocate the read-model row for the event's
 *  key, apply each `:=` as an in-memory struct update, upsert.  Every event
 *  allocates (a projection has no route-or-drop split), and the body is pure —
 *  no emit, no child frame, no `event_unrouted` logging (contrast the saga
 *  reactor).  The fold body is `StmtIR` (the applier statement set), so it only
 *  ever carries `:=` assigns — rendered here directly, matching the ES-applier
 *  `state = %{state | field: value}` shape. */
/** True for a `datetime` field type (unwrapping `optional`) — its Ecto column is
 *  `:utc_datetime` (second precision), so a folded microsecond value needs a
 *  `DateTime.truncate(:second)` before it can be dumped. */
function isDatetimeType(t: TypeIR): boolean {
  return t.kind === "optional"
    ? isDatetimeType(t.inner)
    : t.kind === "primitive" && t.name === "datetime";
}

function renderProjectionFoldHandler(
  appModule: string,
  contextModule: string,
  proj: ProjectionIR,
  on: ProjectionOnIR,
): string {
  const corr = proj.correlationField as string;
  const rowMod = projectionRowModule(contextModule, proj);
  const renderCtx: RenderCtx = {
    thisName: "state",
    contextModule,
    paramRenames: { [on.param]: "event" },
  };
  // Routing key: the `by <expr>` value, else the event field name-matching the
  // correlation field (the omitted-`by` rule) — an id, so `Repo.get` keys on it.
  const keyExpr = on.correlation ? renderExpr(on.correlation, renderCtx) : `event.${snake(corr)}`;
  // A `datetime` read-model column is Ecto `:utc_datetime` (second precision),
  // but a folded value derived from `now()` is `DateTime.utc_now()` (microsecond
  // precision).  The fold sets the struct field directly and persists through
  // `Ecto.Changeset.change/1`, which — unlike a `cast` changeset — does NOT
  // truncate, so Ecto raises dumping the microsecond value into `:utc_datetime`
  // (a 500 on the emitting operation).  Truncate datetime assignments to
  // `:second` to match the column, the same stance `audit-emit`/`provenance-emit`
  // take for `now()` (nil-safe + single-eval via `then/2`, since an OPTIONAL
  // datetime field may fold a nil).
  const datetimeFields = new Set(
    proj.stateFields.filter((f) => isDatetimeType(f.type)).map((f) => snake(f.name)),
  );
  // Each `field := value` → a tracked changeset CHANGE (not an in-memory struct
  // rebind).  `Ecto.Changeset.change(state, %{…})` is load-bearing: a bare
  // `change(state)` after `state = %{state | f: v}` carries NO changes, so on an
  // EXISTING row (the second event for a key) `insert_or_update` → `Repo.update`
  // is a silent no-op and the fold never persists (e.g. `OrderShipped` would
  // never flip the row to `Shipped`).  Passing the changes to `change/2` tracks
  // them, so the update actually writes.  The correlation `:=` (if the fold
  // spells it) is skipped: it's the immutable primary key, seeded at allocation
  // (parity with the java / hono / python folds).
  //
  // A `let` binding is NOT a change entry — it is a real local, emitted as its
  // own line BEFORE the changeset so the entries that reference it resolve
  // (F2-XB-4: the `let` used to be filtered out while `at: stamped` survived,
  // an "undefined variable" under `--warnings-as-errors`).  `+=` / `-=` fold
  // into a change entry computed FROM the current row value, which is nil on
  // the first event for a key, so both coalesce.
  const letLines: string[] = [];
  const changeEntries: string[] = [];
  for (const s of on.statements) {
    const piece = renderProjectionFoldStmt(s, proj, on, corr, renderCtx, datetimeFields);
    if (piece === undefined) continue;
    if (piece.kind === "binding") letLines.push(`    ${piece.text}`);
    else changeEntries.push(piece.text);
  }
  const changeset =
    changeEntries.length > 0
      ? `Ecto.Changeset.change(state, %{${changeEntries.join(", ")}})`
      : `Ecto.Changeset.change(state)`;
  // A tenant-scoped fold (`fold-tenancy.ts`) reads the event's tenant from its
  // metadata — the dispatching process's event origin — keys the row by it and
  // stamps it on allocation.  An event with no tenant has no tenant's row.
  const tenancy = foldTenancyFor(proj);
  const cols = tenancy ? foldTenantColumns(tenancy) : undefined;
  const tenantCol = cols ? snake(cols.tenant.field) : "";
  const lookup = cols
    ? `${appModule}.Repo.get_by(${rowMod}, ${snake(corr)}: key, ${tenantCol}: tenant)`
    : `${appModule}.Repo.get(${rowMod}, key)`;
  const seed = cols ? `${snake(corr)}: key, ${tenantCol}: tenant` : `${snake(corr)}: key`;
  const body = [
    `    key = ${keyExpr}`,
    "",
    `    state =`,
    `      case ${lookup} do`,
    `        nil -> %${rowMod}{${seed}}`,
    `        existing -> existing`,
    `      end`,
    "",
    ...(letLines.length > 0 ? [...letLines, ""] : []),
    `    {:ok, _} = ${appModule}.Repo.insert_or_update(${changeset})`,
    `    :ok`,
  ];
  const event = `%${contextModule}.Events.${upperFirst(on.event)}{} = event`;
  const handle = cols
    ? `  def handle(${event}) do
    origin = ${appModule}Web.Auth.current_event_origin() || %{}

    case Map.get(origin, "tenant") do
      nil -> :ok
      tenant -> fold(event, tenant)
    end
  end

  defp fold(event, tenant) do
${body.join("\n")}
  end`
    : `  def handle(${event}) do
${body.join("\n")}
  end`;
  return `# Auto-generated.
defmodule ${projectionHandlerModule(contextModule, proj, on)} do
  @moduledoc "Projection fold for ${upperFirst(on.event)} → ${upperFirst(proj.name)}."

${handle}
end
`;
}

/** One rendered fold-body piece: either a real local `binding` line emitted
 *  BEFORE the changeset, or a changeset `entry` (`field: value`). */
type FoldPiece = { kind: "binding" | "entry"; text: string };

/** Render ONE fold-body statement of a folded projection.
 *
 *  This used to be a `.filter(s => s.kind === "assign")`, so every other
 *  statement kind a fold body can carry vanished from the emitted handler with
 *  no diagnostic and no compile error (F2-XB-4): a `let` disappeared while its
 *  USES survived (`at: stamped` with nothing binding `stamped` — "undefined
 *  variable" under `--warnings-as-errors`), and `+=` / `-=` were dropped
 *  outright, so the column was simply never written.
 *
 *  The four pure fold kinds `checkProjections`
 *  (`src/ir/validate/checks/projection-checks.ts`) admits are now rendered here;
 *  everything else is an internal invariant violation and THROWS, mirroring the
 *  loud `default:` in `fold-stmt-emit.ts` and hono's `renderFoldStatement` — a
 *  dropped statement is worse than a crash, because it ships. */
function renderProjectionFoldStmt(
  s: StmtIR,
  proj: ProjectionIR,
  on: ProjectionOnIR,
  corr: string,
  renderCtx: RenderCtx,
  datetimeFields: ReadonlySet<string>,
): FoldPiece | undefined {
  const truncated = (field: string, rendered: string): string =>
    datetimeFields.has(field)
      ? `(${rendered}) |> then(&(&1 && ${normalizeDatetime("&1")}))`
      : rendered;
  switch (s.kind) {
    case "assign": {
      const field = snake(s.target.segments[0] ?? "");
      // The correlation `:=` is the immutable primary key, seeded at allocation.
      if (field === snake(corr)) return undefined;
      return {
        kind: "entry",
        text: `${field}: ${truncated(field, renderExpr(s.value, renderCtx))}`,
      };
    }
    case "let":
      return {
        kind: "binding",
        text: `${escapeElixirIdent(snake(s.name))} = ${renderExpr(s.expr, renderCtx)}`,
      };
    case "add": {
      const field = snake(s.target.segments[0] ?? "");
      const value = renderExpr(s.value, renderCtx);
      return {
        kind: "entry",
        text: s.collection
          ? `${field}: (state.${field} || []) ++ [${value}]`
          : `${field}: ${accumulateElixir(proj, s.target.segments[0] ?? "", field, "+", value)}`,
      };
    }
    case "remove": {
      const field = snake(s.target.segments[0] ?? "");
      const value = renderExpr(s.value, renderCtx);
      return {
        kind: "entry",
        text: s.collection
          ? `${field}: List.delete(state.${field} || [], ${value})`
          : `${field}: ${accumulateElixir(proj, s.target.segments[0] ?? "", field, "-", value)}`,
      };
    }
    case "emit":
    case "call":
    case "precondition":
    case "requires":
    case "expression":
    case "return":
    case "variant-match":
    case "if":
      throw new Error(
        `elixir projection fold: unsupported fold statement '${s.kind}' in ` +
          `projection '${proj.name}' on(${on.param}: ${on.event}) — a fold applies pure ` +
          `assignments / collection mutations / let bindings only; ` +
          `'loom.projection-fold-impure' should have rejected this.`,
      );
    default: {
      const _exhaustive: never = s;
      return _exhaustive;
    }
  }
}

/** `state.<field> <op>= <value>` over a NULLABLE read-model column.  Elixir
 *  models BOTH `money` and `decimal` as `Decimal` structs, which have no `+`
 *  operator — they accumulate through `Decimal.add/2` / `Decimal.sub/2` (see the
 *  DECIMAL == MONEY note in `render-expr.ts`).  Every non-key projection column
 *  is nullable (the allocate seeds the key only), so the running total coalesces
 *  first: otherwise the first event for a key folds `nil + n`. */
function accumulateElixir(
  proj: ProjectionIR,
  declaredName: string,
  field: string,
  op: "+" | "-",
  value: string,
): string {
  const t = proj.stateFields.find((f) => f.name === declaredName)?.type;
  const inner = t?.kind === "optional" ? t.inner : t;
  const cur = `state.${field}`;
  if (inner?.kind === "primitive" && (inner.name === "money" || inner.name === "decimal")) {
    const verb = op === "+" ? "add" : "sub";
    return `Decimal.${verb}(${cur} || Decimal.new(0), ${value})`;
  }
  return `(${cur} || 0) ${op} ${value}`;
}

// ---------------------------------------------------------------------------
// Body rendering — the reactor / starter statement list, on the shared
// workflow `pipeline` spine (`_workflow/stmt-target.ts`).
// ---------------------------------------------------------------------------

interface RenderBodyResult {
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
function renderBody(
  statements: WorkflowStmtIR[],
  ctx: EnrichedBoundedContextIR,
  renderCtx: RenderCtx,
  contextModule: string,
  channels?: ElixirChannelsCfg,
): RenderBodyResult {
  const chunks = lowerWorkflowPipeline(
    statements,
    reactorTarget(ctx, renderCtx, contextModule, channels),
  );
  const regions = chunks.flatMap((steps, i) =>
    steps.map((step) => ({
      text: step.kind === "effect" ? step.text : chainLink(step),
      origin: statements[i]!.origin,
    })),
  );
  return {
    lines: assembleChain(chunks.flat(), ":ok", (err) => `throw(${err})`),
    regions,
  };
}

/** The reactor flavour of the Elixir workflow target: the command target's
 *  chain, with the leaves a reactor spells differently.  A reactor has no
 *  request principal (reads take no actor, a create takes the ungated seam),
 *  its `emit` re-enters the context `Dispatcher` (or the broker tee) so
 *  choreography chains keep fanning out, and its own-state `:=` persists the
 *  saga row. */
function reactorTarget(
  ctx: EnrichedBoundedContextIR,
  renderCtx: RenderCtx,
  contextModule: string,
  channels?: ElixirChannelsCfg,
): WorkflowPipelineTarget {
  const base = elixirWorkflowTarget(contextModule, renderCtx, ctx);
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

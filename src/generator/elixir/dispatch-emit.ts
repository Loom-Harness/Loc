import { deriveEventSubscriptions } from "../../ir/enrich/enrichments.js";
import { foldTenancyFor, foldTenantColumns } from "../../ir/enrich/fold-tenancy.js";
import {
  foldInboxClaimSql,
  type FoldRowSeed,
  type FoldStep,
  foldRowSeeds,
  foldSteps,
  foldsDedupe,
  hasStateRow,
  requiredStateFields,
  subscriptionHandler,
} from "../../ir/plan/index.js";
import type {
  ChannelIR,
  EnrichedBoundedContextIR,
  EnumIR,
  ExprIR,
  FunctionIR,
  ProjectionIR,
  ProjectionOnIR,
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
import { buildPhoenixResourceModules } from "./adapters/resource-clients.js";
import type { ElixirChannelsCfg } from "./channels-emit.js";
import { reactorTarget, renderReactorBody } from "./reactor-target.js";
import { type RenderCtx, renderExpr } from "./render-expr.js";
import { type StateDefaultDecls, stateDefault, stateDefaultDecls } from "./state-default.js";
import { exEctoIdJsonType, exEctoIdType } from "./vanilla/codec-spelling-ex.js";
import { normalizeDatetime } from "./vanilla/datetime-type-emit.js";
import { bodyUsesParam, renderFunctionBodyLines } from "./vanilla/function-emit.js";
import { mapTypeToEcto } from "./vanilla/schema-emit.js";
import { renderEsWorkflowHandler } from "./vanilla/workflow-eventsourced-emit.js";

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
      ? renderEsWorkflowHandler(
          contextModule,
          ctx,
          sub,
          reactorRenderCtx(appModule, contextModule, ctx, sub, sys),
          channels,
        )
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
    const content = renderProjectionFoldHandler(
      appModule,
      contextModule,
      ps.projection,
      ps.on,
      foldsDedupe(ctx, durable),
    );
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
  const push = (event: string, call: string): void => {
    const list = byEvent.get(event) ?? [];
    list.push(`    ${call}`);
    byEvent.set(event, list);
  };
  for (const sub of subs) push(sub.event, `${handlerModule(contextModule, sub)}.handle(event)`);
  // A fold is isolated per handler (D-PROJECTION-FOLD-AFTER-COMMIT): its
  // failure is logged and never reaches the command or the handlers after it.
  for (const ps of projSubs)
    push(ps.event, `fold(${projectionHandlerModule(contextModule, ps.projection, ps.on)}, event)`);
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

${projSubs.length > 0 ? "  require Logger\n\n" : ""}${clauses.join("\n\n")}

  # Events with no in-process subscriber are a no-op.
  def dispatch(_event), do: :ok
${projSubs.length > 0 ? renderFoldIsolation() : ""}end

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

/** The dispatcher's `fold/2`: one projection fold, its failure logged
 *  `reactor_failed` and swallowed. */
function renderFoldIsolation(): string {
  const log = (error: string): string =>
    renderPhoenixLogCall("reactorFailed", [
      { name: "handler", valueExpr: "inspect(mod)" },
      { name: "event_type", valueExpr: "event.__struct__ |> Module.split() |> List.last()" },
      { name: "event_id", valueExpr: "Ecto.UUID.generate()" },
      { name: "error", valueExpr: error },
    ]);
  return `
  defp fold(mod, event) do
    mod.handle(event)
  rescue
    e -> ${log("Exception.message(e)")}
  catch
    kind, reason -> ${log("inspect({kind, reason})")}
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
  const renderCtx = reactorRenderCtx(appModule, contextModule, ctx, sub, sys);
  const bindsPrincipal = renderCtx.reactorPrincipal === true;

  // Body statements → one 0-indented block: the `with`-chain in source order,
  // the re-entrant dispatches in its do-branch, the first failure thrown.
  const { lines: body, regions } = renderReactorBody(
    sub.statements,
    reactorTarget(ctx, renderCtx, contextModule, channels),
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

/** The render context of a reactor / starter body: own state reads off the
 *  loaded `state`, the event param is `event`, and the system principal is
 *  bound when the body — or an operation it calls — reads `currentUser`. */
function reactorRenderCtx(
  appModule: string,
  contextModule: string,
  ctx: EnrichedBoundedContextIR,
  sub: Subscription,
  sys?: SystemIR,
): RenderCtx {
  return {
    thisName: "state",
    contextModule,
    typesModule: `${appModule}.Types`,
    resourceModules: buildPhoenixResourceModules(sys, appModule),
    paramRenames: { [sub.param]: "event" },
    reactorPrincipal: reactorNeedsPrincipal(sub.statements, ctx),
  };
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
    for (const f of requiredStateFields(wf)) {
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
  /** Folds claim each durably delivered event in the fold inbox (`foldsDedupe`). */
  dedupe = false,
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
  // The steps rebind `state` one after another, so each reads the row as the
  // steps before it left it.  The write is a changeset over the row as it was
  // LOADED, carrying every column a step wrote: `Ecto.Changeset.change/2` tracks
  // those values, so `insert_or_update` writes them on an existing row too (a
  // bare `change(state)` after rebinding carries no changes and the update is
  // a silent no-op).
  const steps = foldSteps(proj, on);
  const stepLines = steps.map(
    (st) => `    ${renderProjectionFoldStep(st, proj, renderCtx, datetimeFields)}`,
  );
  const written = [...new Set(steps.flatMap((st) => (st.kind === "let" ? [] : [snake(st.field)])))];
  const changeset =
    written.length > 0
      ? `Ecto.Changeset.change(loaded, %{${written.map((f) => `${f}: state.${f}`).join(", ")}})`
      : `Ecto.Changeset.change(loaded)`;
  // A tenant-scoped fold (`fold-tenancy.ts`) reads the event's tenant from its
  // metadata — the dispatching process's event origin — keys the row by it and
  // stamps it on allocation.  An event with no tenant has no tenant's row.
  const tenancy = foldTenancyFor(proj);
  const cols = tenancy ? foldTenantColumns(tenancy) : undefined;
  const tenantCol = cols ? snake(cols.tenant.field) : "";
  const lookup = cols
    ? `${appModule}.Repo.get_by(${rowMod}, ${snake(corr)}: key, ${tenantCol}: tenant)`
    : `${appModule}.Repo.get(${rowMod}, key)`;
  // A fresh row: the key, the tenant, and each column's starting value
  // (`foldRowSeeds`); every other column starts nil.
  const seed = [
    `${snake(corr)}: key`,
    ...(cols ? [`${tenantCol}: tenant`] : []),
    ...foldRowSeeds(proj).map((sd) => `${snake(sd.field.name)}: ${exRowSeed(sd, renderCtx)}`),
  ].join(", ");
  const body = [
    `    key = ${keyExpr}`,
    "",
    `    loaded =`,
    `      case ${lookup} do`,
    `        nil -> %${rowMod}{${seed}}`,
    `        existing -> existing`,
    `      end`,
    "",
    // A fold that writes no column still binds `state` only when a step reads it.
    ...(steps.length > 0 ? [`    state = loaded`, ...stepLines] : []),
    ...(steps.length > 0 && written.length === 0 ? [`    _ = state`] : []),
    `    {:ok, _} = ${appModule}.Repo.insert_or_update(${changeset})`,
    `    :ok`,
  ];
  const event = `%${contextModule}.Events.${upperFirst(on.event)}{} = event`;
  const args = cols ? "event, tenant" : "event";
  // A durably delivered event folds once: the claim on `(projection, event_id)`
  // in the fold inbox commits with the row write, in one transaction.  An
  // event dispatched inline has no id and is never redelivered.
  const claimSql = foldInboxClaimSql("$1", "$2", true);
  const once = dedupe
    ? `  defp fold(${args}) do
    case Process.get(:loom_event_id) do
      nil ->
        apply_fold(${args})

      event_id ->
        {:ok, :ok} =
          ${appModule}.Repo.transaction(fn ->
            case ${appModule}.Repo.query!(${JSON.stringify(claimSql)}, [${JSON.stringify(proj.name)}, to_string(event_id)]) do
              %{num_rows: 0} -> :ok
              _ -> apply_fold(${args})
            end
          end)

        :ok
    end
  end

  defp apply_fold(${args}) do
${body.join("\n")}
  end`
    : undefined;
  const handle = cols
    ? `  def handle(${event}) do
    origin = ${appModule}Web.Auth.current_event_origin() || %{}

    case Map.get(origin, "tenant") do
      nil -> :ok
      tenant -> fold(event, tenant)
    end
  end

${
  once ??
  `  defp fold(event, tenant) do
${body.join("\n")}
  end`
}`
    : once
      ? `  def handle(${event}), do: fold(event)

${once}`
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

/** One fold-plan step as an Elixir rebinding of `state` (or a `let` local). */
function renderProjectionFoldStep(
  step: FoldStep,
  proj: ProjectionIR,
  renderCtx: RenderCtx,
  datetimeFields: ReadonlySet<string>,
): string {
  const expr = (e: ExprIR): string => renderExpr(e, renderCtx);
  const write = (field: string, value: string): string => `state = %{state | ${field}: ${value}}`;
  switch (step.kind) {
    case "let":
      return `${escapeElixirIdent(snake(step.name))} = ${expr(step.expr)}`;
    case "set": {
      const field = snake(step.field);
      const rendered = expr(step.value);
      // A `:utc_datetime` column holds seconds; `change/2` does not truncate.
      return write(
        field,
        datetimeFields.has(field)
          ? `(${rendered}) |> then(&(&1 && ${normalizeDatetime("&1")}))`
          : rendered,
      );
    }
    case "accumulate":
      return write(
        snake(step.field),
        accumulateElixir(proj, step.field, snake(step.field), step.op, expr(step.value)),
      );
    case "append": {
      const field = snake(step.field);
      return write(field, `(state.${field} || []) ++ [${expr(step.value)}]`);
    }
    case "remove-all": {
      const field = snake(step.field);
      return write(
        field,
        `Enum.reject(state.${field} || [], fn loom_el -> loom_el == ${expr(step.value)} end)`,
      );
    }
    default: {
      const _exhaustive: never = step;
      return _exhaustive;
    }
  }
}

/** A fresh row's starting value for one column. */
function exRowSeed(sd: FoldRowSeed, renderCtx: RenderCtx): string {
  if (sd.kind === "default") return renderExpr(sd.expr, renderCtx);
  switch (sd.zero) {
    case "int":
      return "0";
    case "decimal":
    case "money":
      return "Decimal.new(0)";
    case "bool":
      return "false";
    case "string":
      return `""`;
    case "list":
      return "[]";
    default: {
      const _exhaustive: never = sd.zero;
      return _exhaustive;
    }
  }
}

/** `state.<field> <op>= <value>` over a NULLABLE read-model column.  Elixir
 *  models BOTH `money` and `decimal` as `Decimal` structs, which have no `+`
 *  operator — they accumulate through `Decimal.add/2` / `Decimal.sub/2` (see the
 *  DECIMAL == MONEY note in `render-expr.ts`).  The column is nullable and a
 *  row written before its column was seeded holds nil, so the running total
 *  coalesces first. */
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

// ---------------------------------------------------------------------------
// Vanilla event-sourced WORKFLOWS — `workflow X eventSourced { … apply(…) }`
// on the plain Phoenix + Ecto foundation (workflow-and-applier.md A2-S5b).  The
// saga analogue of a `persistedAs: eventLog` aggregate (vanilla/eventsourced-emit.ts):
// instead of a mutable `<wf>_state` Ecto row, the workflow persists as an
// append-only `<wf>_events` stream (keyed by the correlation field) and folds it
// through its `apply(...)` blocks on load.  Emit-only handlers (A1 discipline).
//
// Per ES workflow (referenced by a resolved subscription) this emits:
//   * `<Wf>State` — a plain struct (the folded snapshot; NOT an Ecto schema,
//     so it shares the `workflows/<wf>_state.ex` path the state path would use);
//   * `<Wf>EventLog` — an Ecto schema over the shared `<wf>_events` table;
//   * `<Wf>Fold` — `apply_event/2` (one clause per applier) + `from_events/2`
//     (seed correlation key + typed defaults, then reduce);
//   * `<Wf>Stream` — `load/1` (load+map stream) + `append/2` (gap-free insert)
//     + the Jason codec (`event_type` / `event_to_data` / `row_to_event`).
//
// The fold-on-load handler modules (create / on) are rendered here too and
// wired by `emitDispatch` (dispatch-emit.ts); the shared `Dispatcher` router
// fans events to them unchanged (they are named like any other handler).
// ---------------------------------------------------------------------------

import {
  esStarterSharesEvent,
  eventSourcedWorkflows,
  foldedEventNames,
  workflowStreamType,
} from "../../../ir/plan/index.js";
import type {
  EnrichedBoundedContextIR,
  EventIR,
  TypeIR,
  WorkflowIR,
  WorkflowStmtIR,
} from "../../../ir/types/loom-ir.js";
import type { OriginRef } from "../../../ir/types/origin.js";
import { workflowBodyReadsOwnState } from "../../../ir/util/workflow-own-state.js";
import { escapeElixirIdent, snake, upperFirst } from "../../../util/naming.js";
import { renderPhoenixLogCall } from "../../_obs/render-phoenix.js";
import type { SourceMapRecorder } from "../../_trace/sourcemap.js";
import type { WorkflowPipelineTarget } from "../../_workflow/stmt-target.js";
import { type ElixirChannelsCfg, elixirDispatchCall } from "../channels-emit.js";
import { reactorTarget, renderReactorBody } from "../reactor-target.js";
import { type RenderCtx, renderExpr } from "../render-expr.js";
import { exLogInstantType } from "./codec-spelling-ex.js";
import { foldStmtsUseParam, renderFoldStatement } from "./fold-stmt-emit.js";

const wfModule = (contextModule: string, wf: WorkflowIR): string =>
  `${contextModule}.Workflows.${upperFirst(wf.name)}`;

/** A backend-zero Elixir literal for a required folded-state field at seed time
 *  (the correlation field is seeded from the routing key, never this). */
function stateDefault(t: TypeIR): string {
  if (t.kind === "primitive") {
    switch (t.name) {
      case "int":
      case "long":
        return "0";
      case "decimal":
      case "money":
        return "Decimal.new(0)";
      case "bool":
        return "false";
      case "datetime":
        return "DateTime.utc_now()";
      case "date":
        return "Date.utc_today()";
      default:
        return '""';
    }
  }
  if (t.kind === "array") return "[]";
  return "nil";
}

// --- `<Wf>State` plain struct (the folded snapshot) -------------------------

function renderStateStruct(contextModule: string, wf: WorkflowIR): string {
  const fields = (wf.stateFields ?? []).map((f) => `:${snake(f.name)}`);
  return `# Auto-generated.
defmodule ${contextModule}.Workflows.${upperFirst(wf.name)}State do
  @moduledoc "Folded saga state of the ${upperFirst(wf.name)} event-sourced workflow (no state table)."
  defstruct [${fields.join(", ")}]
  @type t :: %__MODULE__{}
end
`;
}

// --- `<Wf>EventLog` Ecto schema over the shared `<ctx>_events` log ----------
//
// Like the ES-aggregate `<Agg>EventLog`, an ES workflow's stream lives in the
// single per-context event log (event-log-architecture.md), tagged
// `stream_type = "<Wf>"`.  Composite PK `(stream_type, stream_id, version)`;
// `seq` is the inert DB-assigned bigserial cursor.

function renderEventLogSchema(
  contextModule: string,
  wf: WorkflowIR,
  ctxSnake: string,
  schema?: string,
): string {
  // `@schema_prefix` makes every Repo query/insert target the workflow's
  // context schema (`catalog`), matching the migration `prefix:`.  Omitted →
  // public, byte-identical for binding-free systems.
  const prefixLine = schema ? `  @schema_prefix ${JSON.stringify(schema)}\n` : "";
  return `# Auto-generated.
defmodule ${wfModule(contextModule, wf)}EventLog do
  @moduledoc false
  use Ecto.Schema

${prefixLine}  @primary_key false
  schema "${ctxSnake}_events" do
    field :stream_type, :string, primary_key: true
    field :stream_id, :string, primary_key: true
    field :version, :integer, primary_key: true
    field :type, :string
    field :data, :map
    field :occurred_at, ${exLogInstantType()}
    field :seq, :integer
  end
end
`;
}

// --- `<Wf>Fold` — apply_event/2 + from_events/2 -----------------------------

function renderFoldModule(contextModule: string, wf: WorkflowIR): string {
  const stateMod = `${contextModule}.Workflows.${upperFirst(wf.name)}State`;
  const eventsModule = `${contextModule}.Events`;
  const corr = wf.correlationField as string;
  const renderCtx: RenderCtx = { thisName: "state", contextModule };

  const seeds = [
    `${snake(corr)}: key`,
    ...(wf.stateFields ?? [])
      .filter((f) => f.name !== corr && !(f.optional || f.type.kind === "optional"))
      .map((f) => `${snake(f.name)}: ${stateDefault(f.type)}`),
  ];

  const clauses = (wf.appliers ?? []).map((ap) => {
    const bind = foldStmtsUseParam(ap.statements, ap.param, renderCtx)
      ? escapeElixirIdent(snake(ap.param))
      : `_${snake(ap.param)}`;
    const body = ap.statements.map((s) => renderFoldStatement(s, renderCtx)).join("\n");
    return `  def apply_event(state, %${eventsModule}.${upperFirst(ap.event)}{} = ${bind}) do
${body}
    state
  end`;
  });
  clauses.push(`  def apply_event(_state, ev) do
    raise ArgumentError, "no applier for event #{inspect(ev.__struct__)}"
  end`);

  return `# Auto-generated.
defmodule ${wfModule(contextModule, wf)}Fold do
  @moduledoc false

  @spec from_events(term(), [struct()]) :: ${stateMod}.t()
  def from_events(key, events) do
    Enum.reduce(events, %${stateMod}{${seeds.join(", ")}}, fn ev, acc -> apply_event(acc, ev) end)
  end

${clauses.join("\n\n")}
end
`;
}

// --- `<Wf>Stream` — load + gap-free append + Jason codec --------------------

function renderStreamModule(
  appModule: string,
  contextModule: string,
  wf: WorkflowIR,
  events: EventIR[],
): string {
  const eventsModule = `${contextModule}.Events`;
  const logMod = `${wfModule(contextModule, wf)}EventLog`;
  const logShort = `${upperFirst(wf.name)}EventLog`;

  const typeClauses = events
    .map(
      (e) =>
        `  defp event_type(%${eventsModule}.${upperFirst(e.name)}{}), do: ${JSON.stringify(e.name)}`,
    )
    .join("\n");
  const toDataClauses = events
    .map((e) => {
      const pairs = e.fields
        .map((f) => `${JSON.stringify(snake(f.name))} => e.${snake(f.name)}`)
        .join(", ");
      return `  defp event_to_data(%${eventsModule}.${upperFirst(e.name)}{} = e), do: %{${pairs}}`;
    })
    .join("\n");
  const fromRowClauses = events
    .map((e) => {
      const fields = e.fields
        .map((f) => `${snake(f.name)}: d[${JSON.stringify(snake(f.name))}]`)
        .join(", ");
      return `  defp row_to_event(%{type: ${JSON.stringify(e.name)}, data: d}), do: %${eventsModule}.${upperFirst(e.name)}{${fields}}`;
    })
    .join("\n");

  const foldMod = `${wfModule(contextModule, wf)}Fold`;
  const foldShort = `${upperFirst(wf.name)}Fold`;
  const stateMod = `${contextModule}.Workflows.${upperFirst(wf.name)}State`;
  // This workflow's stream is the subset of the shared `<ctx>_events` log
  // tagged with its own name — sibling streams (aggregates, other workflows)
  // in the same context must never fold in.
  const streamType = JSON.stringify(workflowStreamType(wf));
  return `# Auto-generated.
defmodule ${wfModule(contextModule, wf)}Stream do
  @moduledoc "Event stream IO for the ${upperFirst(wf.name)} event-sourced workflow."
  import Ecto.Query
  alias ${appModule}.Repo
  alias ${logMod}
  alias ${foldMod}

  @spec load(binary()) :: [struct()]
  def load(stream_id) when is_binary(stream_id) do
    Repo.all(
      from(r in ${logShort},
        where: r.stream_type == ^${streamType} and r.stream_id == ^stream_id,
        order_by: [asc: r.version]
      )
    )
    |> Enum.map(&row_to_event/1)
  end

  @doc "List every running instance: load all streams, group by stream_id, fold each."
  @spec list_instances() :: [${stateMod}.t()]
  def list_instances do
    Repo.all(
      from(r in ${logShort},
        where: r.stream_type == ^${streamType},
        order_by: [asc: r.stream_id, asc: r.version]
      )
    )
    |> Enum.group_by(& &1.stream_id)
    |> Enum.map(fn {sid, rows} ->
      ${foldShort}.from_events(sid, Enum.map(rows, &row_to_event/1))
    end)
  end

  @doc "One instance by correlation id: load + fold one stream (nil if empty)."
  @spec instance_by_id(binary()) :: ${stateMod}.t() | nil
  def instance_by_id(id) when is_binary(id) do
    case load(id) do
      [] -> nil
      loaded -> ${foldShort}.from_events(id, loaded)
    end
  end

  @doc "Append gap-free event versions to the workflow's stream."
  @spec append(binary(), [struct()]) :: :ok | {:error, term()}
  def append(_stream_id, []), do: :ok

  def append(stream_id, events) when is_binary(stream_id) and is_list(events) do
    Repo.transaction(fn ->
      prior =
        Repo.one(
          from(r in ${logShort},
            where: r.stream_type == ^${streamType} and r.stream_id == ^stream_id,
            select: max(r.version)
          )
        ) || 0

      events
      |> Enum.with_index(prior + 1)
      |> Enum.each(fn {ev, version} ->
        Repo.insert_all(${logShort}, [
          %{
            stream_type: ${streamType},
            stream_id: stream_id,
            version: version,
            type: event_type(ev),
            data: event_to_data(ev),
            occurred_at: DateTime.utc_now()
          }
        ])
      end)
    end)
    |> case do
      {:ok, _} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

${typeClauses}

${toDataClauses}

${fromRowClauses}
end
`;
}

/** Emit the per-workflow support modules (struct / event-log / fold / stream)
 *  for every event-sourced workflow in the context.  Called from the vanilla
 *  orchestrator alongside the dispatcher; the `<wf>_state.ex` path carries the
 *  plain fold struct (the state path skips ES workflows). */
export function emitVanillaEsWorkflowFiles(
  appName: string,
  appModule: string,
  ctx: EnrichedBoundedContextIR,
  out: Map<string, string>,
  /** The workflows' owning-context schema for the ES `<Wf>EventLog`
   *  `@schema_prefix`; undefined ⇒ unqualified. */
  schema?: string,
  /** Source-map collector (`--sourcemap`).  Each of these four
   *  derived-machinery files is single-workflow-attributable — a whole-file
   *  `wf.origin` region only (no statement-granular fragments; there is no
   *  per-statement rendering here to anchor against). */
  sourcemap?: SourceMapRecorder,
): void {
  const ctxSnake = snake(ctx.name);
  const contextModule = `${appModule}.${upperFirst(ctx.name)}`;
  const eventsByName = new Map(ctx.events.map((e) => [e.name, e]));
  for (const wf of eventSourcedWorkflows(ctx.workflows)) {
    const base = `lib/${appName}/${ctxSnake}/workflows`;
    const wfSnake = snake(wf.name);
    const eventNames = foldedEventNames(wf);
    const events = eventNames.map((n) => eventsByName.get(n)).filter((e): e is EventIR => !!e);
    const construct = `${ctx.name}.${wf.name}`;
    const files: [string, string][] = [
      [`${base}/${wfSnake}_state.ex`, renderStateStruct(contextModule, wf)],
      [
        `${base}/${wfSnake}_event_log.ex`,
        renderEventLogSchema(contextModule, wf, ctxSnake, schema),
      ],
      [`${base}/${wfSnake}_fold.ex`, renderFoldModule(contextModule, wf)],
      [`${base}/${wfSnake}_stream.ex`, renderStreamModule(appModule, contextModule, wf, events)],
    ];
    for (const [path, content] of files) {
      out.set(path, content);
      sourcemap?.file(path, content, wf.origin, construct);
    }
  }
}

// --- handler module (create / on), wired by emitDispatch --------------------

interface EsSub {
  trigger: "on" | "create";
  event: string;
  param: string;
  workflow: WorkflowIR;
  correlation?: import("../../../ir/types/loom-ir.js").ExprIR;
  statements: WorkflowStmtIR[];
}

/** Render an ES workflow handler module: fold-on-load, run the body against
 *  the folded snapshot on the reactor pipeline target (`../reactor-target.ts`),
 *  then re-publish for choreography.  Each `emit` appends its event to the
 *  workflow's own stream where the source states it, and dispatches it after
 *  the commit.  The reaction is one transaction: the first failure is thrown,
 *  so every append and write before it rolls back (workflow.md § Reactor
 *  failures).
 *
 *  Returns the module content plus one `fragment()` anchor per lowered step
 *  (see `HandlerResult` in `dispatch-emit.ts`, whose shape this matches). */
export function renderEsWorkflowHandler(
  contextModule: string,
  ctx: EnrichedBoundedContextIR,
  sub: EsSub,
  /** The reactor render context (`thisName: "state"`, the event param renamed
   *  to `event`, the system principal) — shared with the saga-row handler. */
  renderCtx: RenderCtx,
  /** Broker tee config (channels.md) — presence routes the post-append
   *  re-publish through `<App>.Channels.dispatch/2`, so broker-carried
   *  saga events publish instead of fanning out locally. */
  channels?: ElixirChannelsCfg,
): { content: string; regions: { text: string; origin: OriginRef | undefined }[] } {
  const wf = sub.workflow;
  // contextModule is `<appModule>.<Context>`; strip the context segment for the
  // RequestContext module path.
  const appModule = contextModule.replace(/\.[^.]+$/, "");
  const corr = wf.correlationField as string;
  const verb = sub.trigger === "on" ? "On" : "Start";
  const handlerMod = `${contextModule}.Workflows.${upperFirst(wf.name)}.${verb}${upperFirst(sub.event)}`;
  const foldMod = `${wfModule(contextModule, wf)}Fold`;
  const streamMod = `${wfModule(contextModule, wf)}Stream`;

  const keyExpr = sub.correlation ? renderExpr(sub.correlation, renderCtx) : `event.${snake(corr)}`;
  const usesState = workflowBodyReadsOwnState(sub.statements);
  const stateBind = usesState ? "state" : "_state";

  // The handler runs FROM the local Dispatcher (it exists by construction),
  // so the re-publish is the post-commit dispatcher call — or the broker tee
  // when channels are wired, so broker-carried saga events publish for remote
  // (and co-located) consumers instead of fanning out locally.
  const republish = (ev: string): string =>
    elixirDispatchCall(ev, contextModule, true, channels, true) ??
    `${contextModule}.Dispatcher.AfterCommit.dispatch(${ev})`;
  let emitted = 0;
  const target: WorkflowPipelineTarget = {
    ...reactorTarget(ctx, renderCtx, contextModule, channels),
    emit: (st) => {
      const fields = st.fields
        .map((f) => `${snake(f.name)}: ${renderExpr(f.value, renderCtx)}`)
        .join(", ");
      const name = `emitted_${++emitted}`;
      return [
        {
          kind: "let",
          pattern: name,
          expr: `%${contextModule}.Events.${upperFirst(st.eventName)}{${fields}}`,
        },
        { kind: "clause", text: `:ok <- ${streamMod}.append(sid, [${name}])` },
        { kind: "effect", text: republish(name) },
      ];
    },
  };
  const { lines: bodyLines, regions } = renderReactorBody(sub.statements, target);
  const body = (pad: number): string => indentLines(bodyLines, pad);

  // A `create` starter that shares its event with an `on` reactor on the same
  // workflow (S5b) must no-op when the stream ALREADY exists — the inverse of
  // the `on` emptiness guard — so the event folds once, not twice.  A starter
  // with no paired `on` stays byte-identical (folds unconditionally).
  const guardStreamExists = sub.trigger === "create" && esStarterSharesEvent(wf, sub.event);
  let inner: string;
  if (sub.trigger === "on") {
    // Reactor: a started saga has a non-empty stream; else drop + log.
    const logCall = renderPhoenixLogCall("eventUnrouted", [
      { name: "workflow", valueExpr: JSON.stringify(wf.name) },
      { name: "event_type", valueExpr: JSON.stringify(sub.event) },
      { name: "key", valueExpr: "key" },
    ]);
    inner = `    key = ${keyExpr}
    sid = to_string(key)

    case ${streamMod}.load(sid) do
      [] ->
        ${logCall}
        :ok

      loaded ->
        ${stateBind} = ${foldMod}.from_events(key, loaded)
${body(8)}
    end`;
  } else if (guardStreamExists) {
    // Starter with a paired `on`: fold from zero ONLY when the stream is empty;
    // a non-empty stream means the `on` reactor owns this event — drop + log.
    const logCall = renderPhoenixLogCall("eventUnrouted", [
      { name: "workflow", valueExpr: JSON.stringify(wf.name) },
      { name: "event_type", valueExpr: JSON.stringify(sub.event) },
      { name: "key", valueExpr: "key" },
    ]);
    inner = `    key = ${keyExpr}
    sid = to_string(key)

    case ${streamMod}.load(sid) do
      [] ->
        ${stateBind} = ${foldMod}.from_events(key, [])
${body(8)}

      _loaded ->
        ${logCall}
        :ok
    end`;
  } else {
    // Starter: fold from zero (empty stream → seeded defaults).
    inner = `    key = ${keyExpr}
    sid = to_string(key)
    ${stateBind} = ${foldMod}.from_events(key, ${streamMod}.load(sid))
${body(4)}`;
  }

  const requireLogger = sub.trigger === "on" || guardStreamExists ? "  require Logger\n\n" : "";
  const content = `# Auto-generated.
defmodule ${handlerMod} do
  @moduledoc "${sub.trigger === "on" ? "Reactor" : "Starter"} for ${upperFirst(sub.event)} → ${upperFirst(wf.name)} (event-sourced)."

${requireLogger}  def handle(%${contextModule}.Events.${upperFirst(sub.event)}{} = event) do
    # A reactor is a per-dispatch boundary: child execution frame (parent_id <-
    # the dispatching request's scope).  The reaction is ATOMIC (workflow.md
    # § Reactor failures): a throw part-way rolls back every append and write
    # before it; its events re-publish only once it committed.
    ${appModule}.RequestContext.with_child_frame(fn ->
${renderCtx.reactorPrincipal ? `    current_user = ${appModule}Web.Auth.system_principal()\n\n` : ""}    ${appModule}.PostCommit.transaction(fn ->
    ${appModule}.Repo.transaction(fn ->
${inner}
    end)
    end)
    end)
  end
end
`;
  return { content, regions };
}

/** Prefix every non-empty physical line of a 0-indented block with `n` spaces. */
function indentLines(lines: readonly string[], n: number): string {
  const pad = " ".repeat(n);
  return lines
    .flatMap((l) => l.split("\n"))
    .map((l) => (l.length > 0 ? pad + l : l))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Elixir / Phoenix `Logger` renderer for the neutral log-event catalog
// (see `./log-events.ts`).  Sister to `render-hono.ts` and
// `render-dotnet.ts` — produces the source line every per-model Phoenix
// emitter pastes at a log seam, so the same catalog event surfaces with
// the same level + fields on the Phoenix backend as on the Hono /
// .NET ones.
//
// Idiom: `Logger.<level>(message, keyword_list_of_metadata)`.  The
// message is the catalog event name (human-readable + grep-target); the
// metadata carries the structured fields, including a re-stamped
// `event:` key so a downstream filter pivoting on event identity works
// the same across all three backends.
//
// Level mapping: Elixir's Logger has no `trace` — both `trace` and
// `debug` from the catalog land on `Logger.debug`.  The `event:`
// metadata key still distinguishes them by name, and the runtime
// LOG_LEVEL filter at the Elixir layer collapses them anyway in
// production.  `warn` → `warning` (Elixir's spelling).
// ---------------------------------------------------------------------------

import { snake } from "../../util/naming.js";
import { type LogEventKey, LogEvents } from "./log-events.js";

const LEVEL_TO_METHOD: Record<string, string> = {
  trace: "debug",
  debug: "debug",
  info: "info",
  warn: "warning",
  error: "error",
};

/** One field passed to a Phoenix log call — `name` is the snake_case
 *  catalog key (becomes a metadata-keyword key, kept snake_case since
 *  Elixir's atoms admit snake_case directly), and `valueExpr` is the
 *  Elixir expression evaluated for the structured value.  Caller passes
 *  a SUBSET of the catalog entry's `fields` — sites that don't have a
 *  particular field at hand just omit it. */
export interface PhoenixField {
  name: string;
  valueExpr: string;
}

/** Render `Logger.<level>("event_name", event: "event_name", k1: v1,
 *  k2: v2)` from a catalog entry + the fields the call site has on
 *  hand.  Assumes the surrounding module has `require Logger` already
 *  declared — the renderer doesn't emit the require itself because per-
 *  module imports are the caller's concern. */
export function renderPhoenixLogCall(eventKey: LogEventKey, fields: PhoenixField[] = []): string {
  const e = LogEvents[eventKey];
  const method = LEVEL_TO_METHOD[e.level];
  // `event:` is always re-stamped in the metadata so cross-backend
  // pipelines pivot on the same key regardless of source.
  const baseMeta = `event: "${e.event}"`;
  const fieldMeta = fields.map((f) => `${f.name}: ${f.valueExpr}`).join(", ");
  const meta = fieldMeta ? `${baseMeta}, ${fieldMeta}` : baseMeta;
  return `Logger.${method}("${e.event}", ${meta})`;
}

// ---------------------------------------------------------------------------
// Domain-metric emission for Phoenix — the declarative sibling of the
// manual-increment `recordDomainOperation`/`recordDomainFault` calls the
// other four backends paste at their seams.  Phoenix counters are defined
// declaratively in `<App>.Telemetry.metrics/0` and fed by `:telemetry`
// events, so the SEAM just emits the event; the aggregation is wired in the
// Telemetry supervisor (`telemetry-emit.ts`).  The event prefix is the app's
// own name, so two apps' events stay apart on one node; the seam sites and the
// `counter(...)` defs both spell it through `phoenixDomainEvent`.
// ---------------------------------------------------------------------------

/** The telemetry event a domain seam fires: `[:<app>, :domain, :<kind>]`, the
 *  prefix the app module's snake-case name. */
export function phoenixDomainEvent(appModule: string, kind: "operation" | "fault"): string {
  return `[:${snake(appModule.replace(/\./g, ""))}, :domain, :${kind}]`;
}

/** `:telemetry.execute(...)` at the operation_invoked / aggregate_created
 *  seam — feeds the `domain_operations_total{aggregate,op}` counter. */
export function renderPhoenixDomainOperation(
  appModule: string,
  aggregate: string,
  op: string,
): string {
  return `:telemetry.execute(${phoenixDomainEvent(appModule, "operation")}, %{count: 1}, %{aggregate: "${aggregate}", op: "${op}"})`;
}

/** `:telemetry.execute(...)` at a fault seam — feeds the
 *  `domain_faults_total{kind}` counter. */
export function renderPhoenixDomainFault(appModule: string, kind: string): string {
  return `:telemetry.execute(${phoenixDomainEvent(appModule, "fault")}, %{count: 1}, %{kind: "${kind}"})`;
}

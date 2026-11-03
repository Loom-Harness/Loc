// Auto-generated.
import { pino, type Logger } from "pino";
import { requestContextStore } from "./als";

/** Base process logger.  Level is read from `LOG_LEVEL` (env), default
 *  `info`.  In dev, pipe stdout through `pino-pretty` for readable
 *  output:  `tsx index.ts | pino-pretty`.
 *
 *  Configuration aligned with the project's log envelope
 *  (`{ ts, level, event, request_id, scope_id?, actor_id?, ...fields }`):
 *    - `base: undefined`     — drop pino's default `{ pid, hostname }`
 *                                fields (noisy; orchestrator already records).
 *    - `formatters.level`     — emit the level *label* (`"info"`) rather
 *                                than pino's default numeric severity.
 *    - `timestamp`            — emit `"ts":"<ISO>"` rather than pino's
 *                                default epoch-ms `"time"`.
 *    - `mixin`                — read the ambient frame at log time so every
 *                                line carries the carrier's `scope_id` (and
 *                                `actor_id` once auth has run), joining logs to
 *                                the audit / provenance rows of the same frame.
 *                                Evaluated per call, so a workflow's child frame
 *                                surfaces its own scope; empty outside a request
 *                                (boot / outbox relay).
 *    - `browser`              — the SAME envelope when this backend is bundled
 *                                for a browser runtime (the Loom playground runs
 *                                it in a worker), where pino resolves its
 *                                `browser` entry instead of the node build.
 *                                That build reads `browser.formatters` — NOT the
 *                                top-level `formatters` above — and, without
 *                                `asObject`, hands `console.*` the raw arguments:
 *                                a child logger's bindings arrive as their OWN
 *                                argument (`console.info({ request_id }, { event,
 *                                … })`) and no `level` is attached at all.  With
 *                                `asObject` + `formatters` the browser build
 *                                merges bindings and payload into ONE object and
 *                                applies the level label; the `log` formatter
 *                                then renames the browser build's epoch-keyed
 *                                `time` to the envelope's ISO `ts` (the
 *                                node-side `timestamp` above is a serialized
 *                                fragment the browser build cannot use). */
export const baseLogger: Logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: undefined,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: () => `,"ts":"${new Date().toISOString()}"`,
  browser: {
    asObject: true,
    formatters: {
      level: (label) => ({ level: label }),
      log: (line) => {
        const rest = { ...line };
        delete rest.time;
        return { ts: new Date().toISOString(), ...rest };
      },
    },
  },
  mixin() {
    const ctx = requestContextStore.getStore();
    if (ctx === undefined) return {};
    // trace_id / span_id join every request-scoped line to its OTel span —
    // the log↔trace correlation the tracing layer projects onto the frame
    // (see obs/tracing.ts).  Present alongside scope_id (the audit join key).
    const ids = { trace_id: ctx.traceId, span_id: ctx.spanId };
    return ctx.actorId == null
      ? { scope_id: ctx.scopeId, ...ids }
      : { scope_id: ctx.scopeId, actor_id: ctx.actorId, ...ids };
  },
});

/** Per-request child logger type — created by the request-id middleware
 *  with `baseLogger.child({ request_id })`, so every line carries the
 *  correlation id automatically; `scope_id` / `actor_id` ride via the
 *  base logger's `mixin` (read from the ambient frame per line). */
export type RequestLogger = Logger;

/** What the request-id middleware puts on the Hono context, declared ONCE
 *  for the whole project.
 *
 *  A sub-router's `OpenAPIHono` cannot carry a custom `Variables` type
 *  (zod-openapi's internal `Env` constraint rejects one), so every read used
 *  to spell its own escape hatch inline:
 *
 *      (c as unknown as { get(k: "log"): RequestLogger }).get("log").info(…)
 *
 *  — the same 90-character double cast repeated at every log seam and every
 *  `trace_id` read, hundreds of times per generated backend, each one an
 *  independent chance to name the wrong type.  Hono's `ContextVariableMap` is
 *  the supported way to say this globally: augment it once here, and a plain
 *  `c.get("log")` / `c.get("requestId")` is typed everywhere, in generated
 *  code and in anything the user adds beside it.
 *
 *  `workflow` is set by a workflow COMMAND route at entry so the router's
 *  `onError` can name the workflow that failed (`workflow_failed`); it is
 *  absent on every other route, hence optional. */
declare module "hono" {
  interface ContextVariableMap {
    log: RequestLogger;
    requestId?: string;
    workflow?: string;
  }
}

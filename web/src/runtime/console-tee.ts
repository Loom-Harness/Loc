// ---------------------------------------------------------------------------
// Permanent `console.*` tee for the runtime worker.
//
// The generated Hono backend logs through pino.  pino's browser build
// binds the `console.*` methods at logger-creation time, and the backend
// creates its `baseLogger` while booting (inside the worker's `boot`
// RPC).  So whatever `console.info` exists at boot is the function pino
// keeps calling forever.
//
// The old approach patched `console.*` per-RPC and restored it in a
// `finally`.  That looked right but lost every structured line: pino
// bound the *boot* RPC's patch, so later dispatch logs (request_start /
// request_end / domain errors) flowed into the boot RPC's already-sent
// sink instead of the dispatch's — the Backend Logs tab stayed empty.
//
// Fix: install the tee ONCE (before any bundle is imported) and leave it
// in place.  It pushes into a swappable module-level sink, so the
// function pino bound at boot always routes to whichever RPC is current.
// `setLogSink(logs)` at the top of an RPC, `setLogSink(null)` after.
// Between RPCs, lines go to the background flush (`setBackgroundFlush`).
// ---------------------------------------------------------------------------

import {
  formatLogArg,
  LOG_LEVELS,
  type LogLine,
  structuredFromConsoleArgs,
} from "../util/log-line.js";

let activeLogSink: LogLine[] | null = null;

/** Point the tee at `sink` (an RPC's log array) or `null` between RPCs. */
export function setLogSink(sink: LogLine[] | null): void {
  activeLogSink = sink;
}

/** Lines one background flush carries at most.  A busy loop logging between
 *  RPCs would otherwise grow the batch without bound; the overflow is
 *  counted and reported as one line instead of silently dropped. */
export const BACKGROUND_BATCH_MAX = 500;

/** How long a background batch collects before it is flushed. */
export const BACKGROUND_FLUSH_MS = 100;

let backgroundFlush: ((lines: LogLine[]) => void) | null = null;
let backgroundBatch: LogLine[] = [];
let backgroundDropped = 0;
let backgroundTimer: ReturnType<typeof setTimeout> | null = null;

/** Where lines logged while no RPC is running go: channel consumers, the
 *  outbox relay and timers all log from callbacks no RPC awaits.  They are
 *  batched and handed to `flush` (the worker posts them to the main thread);
 *  with no flush installed they reach only the real console. */
export function setBackgroundFlush(flush: ((lines: LogLine[]) => void) | null): void {
  backgroundFlush = flush;
}

function flushBackground(): void {
  backgroundTimer = null;
  const lines = backgroundBatch;
  backgroundBatch = [];
  if (backgroundDropped > 0) {
    lines.push({
      level: "warn",
      text: `${backgroundDropped} more background log line(s) dropped (over ${BACKGROUND_BATCH_MAX} in ${BACKGROUND_FLUSH_MS} ms)`,
    });
    backgroundDropped = 0;
  }
  if (lines.length > 0) backgroundFlush?.(lines);
}

function pushBackground(line: LogLine): void {
  if (!backgroundFlush) return;
  if (backgroundBatch.length < BACKGROUND_BATCH_MAX) backgroundBatch.push(line);
  else backgroundDropped++;
  backgroundTimer ??= setTimeout(flushBackground, BACKGROUND_FLUSH_MS);
}

/** Wrap every `console[level]` on `target` so calls are teed into the
 *  active sink (when set) and still written through to the real console.
 *  Idempotent enough for one install at worker init; `target` is a seam
 *  for tests. */
export function installConsoleTee(target: Console = console): void {
  for (const level of LOG_LEVELS) {
    const original = target[level] as (...a: unknown[]) => void;
    target[level] = (...args: unknown[]): void => {
      const sink = activeLogSink;
      if (sink || backgroundFlush) {
        // Structured pino lines arrive as one or more plain object
        // arguments — `console.info({ event, … })` from the base logger,
        // `console.info({ request_id }, { event, … })` from a per-request
        // child (pino's browser build prepends the child bindings as their
        // own argument).  Merge them so the Output panel renders the line
        // without re-parsing, and take the semantic level off the payload
        // when it carries one (pino-in-browser routes `logger.trace`
        // through `console.debug`), else off the console method.
        const structured = structuredFromConsoleArgs(args, level);
        const line: LogLine = {
          level: structured?.level ?? level,
          text: args.map(formatLogArg).join(" "),
          ...(structured ? { structured } : {}),
        };
        if (sink) sink.push(line);
        else pushBackground(line);
      }
      original(...args);
    };
  }
}

// Coalesces log lines that arrive one RPC at a time into one flush per
// window.
//
// Each runtime-worker RPC (a dispatch, a preview fetch) hands its captured
// console lines to the main thread.  Appending them to React state straight
// away re-renders the playground shell once per request, and that render
// runs on the main thread between the request's reply and the next one —
// every request then waits for it.  Buffering the lines and flushing them
// once per `delayMs` keeps every line, in order, while a burst of requests
// costs one render per window instead of one per request.

import type { LogLine } from "./log-line.js";

export interface LogBatcher {
  /** Queue `lines`; they reach `flush` at the end of the current window. */
  push(lines: LogLine[]): void;
  /** Drop every queued line and the pending flush (the stream was cleared). */
  clear(): void;
}

/** The window the playground uses: short enough that the Output panel reads
 *  as live, long enough that a request burst renders a handful of times. */
export const LOG_FLUSH_MS = 200;

export function createLogBatcher(
  flush: (lines: LogLine[]) => void,
  delayMs: number = LOG_FLUSH_MS,
): LogBatcher {
  let queued: LogLine[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = (): void => {
    timer = null;
    const lines = queued;
    queued = [];
    if (lines.length > 0) flush(lines);
  };
  return {
    push(lines) {
      if (lines.length === 0) return;
      for (const line of lines) queued.push(line);
      if (timer === null) timer = setTimeout(fire, delayMs);
    },
    clear() {
      queued = [];
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

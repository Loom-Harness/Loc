// ---------------------------------------------------------------------------
// Run a corpus compile tier's per-feature commands concurrently inside ONE job.
//
// A corpus tier compiles ~100 generated projects.  Run one after another, a
// 4-core runner idles three cores while each `mypy` / `tsc` / `mix compile`
// burns one; split one-feature-per-job, every job repeats the same toolchain
// install, image pull and dependency build for a few seconds of real work.
// This module is the third option: one job, every feature, `PARALLELISM` at a
// time, each command's output CAPTURED so concurrent features never interleave
// on stdout — a failing command re-prints its own output in the thrown error.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import * as os from "node:os";

/** Concurrent features per job: the runner's cores, or `LOOM_CORPUS_PARALLEL`. */
export const PARALLELISM = Math.max(
  1,
  Number(process.env.LOOM_CORPUS_PARALLEL ?? os.availableParallelism()),
);

/** Longest captured output re-printed in a failure — the tail carries the diagnosis. */
const MAX_FAILURE_CHARS = 20_000;

export interface ShOpts {
  cwd?: string;
  /** ms before the command is killed (SIGKILL) and reported as a timeout. */
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

export interface ShResult {
  /** Exit status, or null when killed by a signal (a timeout among them). */
  status: number | null;
  timedOut: boolean;
  /** stdout and stderr, interleaved in arrival order. */
  output: string;
}

/** Run a shell command asynchronously, capturing its combined output. */
export function shResult(cmd: string, opts: ShOpts = {}): Promise<ShResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => chunks.push(c));
    let timedOut = false;
    const timer = opts.timeout
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, opts.timeout)
      : undefined;
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (status) => {
      if (timer) clearTimeout(timer);
      resolve({ status, timedOut, output: Buffer.concat(chunks).toString("utf8") });
    });
  });
}

/** A command that exited non-zero or timed out, carrying its captured output. */
export class ShError extends Error {
  constructor(
    readonly cmd: string,
    readonly result: ShResult,
  ) {
    const why = result.timedOut ? "timed out" : `exited ${result.status}`;
    const out = result.output;
    const tail = out.length > MAX_FAILURE_CHARS ? `…${out.slice(-MAX_FAILURE_CHARS)}` : out;
    super(`\`${cmd}\` ${why}\n${tail}`);
  }
}

/** Run a shell command; resolve with its output, reject with {@link ShError}. */
export async function sh(cmd: string, opts: ShOpts = {}): Promise<string> {
  const result = await shResult(cmd, opts);
  if (result.status !== 0 || result.timedOut) throw new ShError(cmd, result);
  return result.output;
}

/** A gate admitting at most `n` concurrent tasks; the rest wait in FIFO order. */
export function limiter(n: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    // A finishing task hands its slot straight to the next waiter, so `active`
    // never dips below the true count and a new caller cannot slip in between.
    if (active >= n) await new Promise<void>((wake) => waiting.push(wake));
    else active++;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

// ---------------------------------------------------------------------------
// Bounded retry around `npx playwright install --with-deps chromium`.
//
// Why: on CI runners the Chromium download sometimes stalls until the caller's
// timeout kills it, before any test body runs — `spawnSync … ETIMEDOUT` with an
// orphaned `npm exec playwright install` reaped at job end.  It hits every leg
// that installs a browser (the Phoenix UI smoke, the HEEx UI round-trip, the
// generated SPA e2e legs), and a re-run of the same download has succeeded each
// time.  A stalled transfer does not recover by waiting longer, so each attempt
// gets a shorter timeout and a fresh process, and a failure that is not a
// download (a broken `npx`, a bad cwd) still surfaces — after the last attempt,
// with every attempt's cause in the message.
//
// The attempt runs under GNU `timeout`, which signals its whole process group.
// A timeout on `execSync` alone kills only the `/bin/sh` wrapper: npm, the
// playwright CLI and its `apt-get` keep running, keep the install lock, and
// every retry then fails in seconds against it.
//
// Scope: the browser FETCH only.  Running the specs must keep failing fast.
// ---------------------------------------------------------------------------

import { execSync } from "node:child_process";

/** Total attempts (1 initial + `BACKOFF_MS.length`). */
export const PLAYWRIGHT_INSTALL_ATTEMPTS = 3;

/** Milliseconds to wait before attempt 2, before attempt 3. */
export const PLAYWRIGHT_INSTALL_BACKOFF_MS = [5_000, 20_000] as const;

/** Per-attempt timeout: long enough for a healthy download with `--with-deps`. */
export const PLAYWRIGHT_INSTALL_TIMEOUT_MS = 240_000;

export const PLAYWRIGHT_INSTALL_CMD = "npx playwright install --with-deps chromium";

type Exec = (cmd: string, opts: { cwd: string; timeout: number }) => void;

/** `cmd` under GNU `timeout` (group-wide kill, then SIGKILL 15 s later) where
 *  the host has it; the outer `execSync` timeout is the backstop. */
export function boundedCommand(cmd: string, timeoutMs: number): string {
  const s = Math.ceil(timeoutMs / 1000);
  return `if command -v timeout >/dev/null 2>&1; then timeout -k 15 ${s} ${cmd}; else ${cmd}; fi`;
}

const defaultExec: Exec = (cmd, { cwd, timeout }) => {
  execSync(boundedCommand(cmd, timeout), { cwd, stdio: "pipe", timeout: timeout + 30_000 });
};

/** The first line of the error plus the last line of the child's stderr. */
function causeOf(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const head = e.message.split("\n")[0]!;
  const stderr = (e as { stderr?: Buffer | string }).stderr;
  const tail = stderr ? String(stderr).trim().split("\n").pop() : undefined;
  return tail ? `${head} — ${tail}` : head;
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Install the Playwright Chromium (and its OS deps) for the project at `cwd`,
 *  retrying a failed or stalled fetch.  Throws once every attempt has failed. */
export function installPlaywrightChromium(
  cwd: string,
  opts: { exec?: Exec; wait?: (ms: number) => void; log?: (line: string) => void } = {},
): void {
  const exec = opts.exec ?? defaultExec;
  const wait = opts.wait ?? sleep;
  const log = opts.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const causes: string[] = [];
  for (let attempt = 1; attempt <= PLAYWRIGHT_INSTALL_ATTEMPTS; attempt++) {
    try {
      exec(PLAYWRIGHT_INSTALL_CMD, { cwd, timeout: PLAYWRIGHT_INSTALL_TIMEOUT_MS });
      return;
    } catch (e) {
      const cause = causeOf(e);
      causes.push(`attempt ${attempt}: ${cause}`);
      if (attempt === PLAYWRIGHT_INSTALL_ATTEMPTS) break;
      const backoff = PLAYWRIGHT_INSTALL_BACKOFF_MS[attempt - 1]!;
      log(`playwright install failed (${cause}); retrying in ${backoff / 1000}s`);
      wait(backoff);
    }
  }
  throw new Error(
    `\`${PLAYWRIGHT_INSTALL_CMD}\` failed ${PLAYWRIGHT_INSTALL_ATTEMPTS} times:\n${causes.join("\n")}`,
  );
}

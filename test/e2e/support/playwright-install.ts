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
// The download and the OS dependencies are separate steps.  `--with-deps`
// runs `sudo apt-get`, and an apt-get from a stalled attempt runs as root —
// beyond any timeout's reach — and keeps the dpkg lock, so every retry then
// fails in seconds (`Unable to acquire the dpkg frontend lock`).  The DOWNLOAD
// needs no lock and is what retries: each attempt runs under GNU `timeout`,
// which signals its whole process group (a timeout on `execSync` alone kills
// only the `/bin/sh` wrapper and leaves npm and the playwright CLI running).
// The deps step runs once and only warns on failure: the hosted Ubuntu images
// ship Chrome and its libraries, and a library that really is missing still
// fails the spec, with Playwright naming it at browser launch.
//
// Scope: the browser FETCH only.  Running the specs must keep failing fast.
// ---------------------------------------------------------------------------

import { execSync } from "node:child_process";

/** Total attempts (1 initial + `BACKOFF_MS.length`). */
export const PLAYWRIGHT_INSTALL_ATTEMPTS = 3;

/** Milliseconds to wait before attempt 2, before attempt 3. */
export const PLAYWRIGHT_INSTALL_BACKOFF_MS = [5_000, 20_000] as const;

/** Per-attempt timeout: long enough for a healthy browser download. */
export const PLAYWRIGHT_INSTALL_TIMEOUT_MS = 240_000;

export const PLAYWRIGHT_INSTALL_CMD = "npx playwright install chromium";

export const PLAYWRIGHT_INSTALL_DEPS_CMD = "npx playwright install-deps chromium";

/** The deps step's one bounded attempt. */
export const PLAYWRIGHT_INSTALL_DEPS_TIMEOUT_MS = 180_000;

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

/** Install the Playwright Chromium for the project at `cwd`, retrying a failed
 *  or stalled download, then its OS deps once.  Throws once every download
 *  attempt has failed; a failed deps step only warns. */
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
      try {
        exec(PLAYWRIGHT_INSTALL_DEPS_CMD, { cwd, timeout: PLAYWRIGHT_INSTALL_DEPS_TIMEOUT_MS });
      } catch (deps) {
        log(
          `playwright install-deps failed (${causeOf(deps)}); continuing with the host's libraries`,
        );
      }
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

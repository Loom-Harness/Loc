// ---------------------------------------------------------------------------
// The one `npm install` every e2e harness runs against a GENERATED project.
//
// WHY THIS EXISTS — a failed install must name its own cause.
//
// Every generated-project install in test/e2e/ used to be its own `execSync`,
// and 49 of them (23 files) spelled it `npm install --silent …`.  `--silent`
// sets npm's loglevel to *silent*, so npm writes its `npm error` lines to NO
// stream at all — `stdio: "inherit"` inherits nothing, and `stdio: "pipe"`
// captures nothing.  Measured here against npm 10.9.7, one unresolvable
// version pinned in package.json:
//
//   npm install --silent          → exit 1, 0 bytes stdout, 0 bytes stderr
//   npm install --loglevel=error  → exit 1, 0 bytes stdout, 356 bytes stderr:
//       npm error code ETARGET
//       npm error notarget No matching version found for @angular-devkit/architect@…
//
// So the harness reported `Command failed: npm install` and the reader was left
// with nothing.  Twice, for real:
//
//   • 2026-09-10 — one registry-resolution window failed three cells:
//     `generated-angular-build` (grid × angularMaterial@v1, showcase ×
//     primeng@v1) and `elixir-vanilla-build` (vanilla-embed-angular).  The two
//     Angular cells said only `Command failed: npm install`; the elixir cell —
//     the ONE harness that left its install unsilenced — carried the actual
//     `npm error code ETARGET … @angular-devkit/architect@0.2201.8`.  Same
//     cause, and only the unsilenced cell could say so.
//   • 2026-09-09 — the same class hit `generated-react-build`
//     (file-scaffold-system.ddd × mantine@v9) with no unsilenced sibling.  The
//     ETARGET diagnosis had to be INFERRED FROM STEP TIMING: 3.0 s in the
//     failing cell against 11–20 s in the seven cells that reached `tsc`.
//
// WHAT THIS DOES DIFFERENTLY.
//   1. Runs npm at `--loglevel=error`, never `--silent`, so npm actually emits
//      its diagnosis, and CAPTURES both streams instead of inheriting them.  A
//      green cell prints nothing (`--loglevel=error` says nothing on success
//      beyond a captured `added N packages in Ns`), which is what `--silent`
//      was protecting across the ~50 cells a matrix run produces; a red cell
//      re-prints npm's own text in the thrown error.  The volume saving is
//      kept, the diagnosis is not thrown away with it.
//   2. Retries ONCE — {@link NPM_INSTALL_ATTEMPTS} is 2, not a loop.  The
//      failure being defended against (a registry-resolution window, a
//      throttled proxy, a timeout on a loaded runner) is transient by
//      definition.  A retry LOOP is the thing not to build: it would launder a
//      genuinely broken manifest into three slow failures instead of one fast
//      one.
//
// WHY NOT `--prefer-offline` (moved here from generated-react-build.test.ts,
// where it applied to one caller and belongs to all of them): the pack-batch
// modes do reinstall a near-identical project per cell, but that flag also
// serves stale cached *packuments*, so a floating range whose newest matching
// version was published after the cache entry (`jiti@^2.7.0` is a live
// example) dies with ETARGET.  npm already reuses the warmed tarball cache
// after a cheap etag revalidation — the batch gets the saving without the
// flake.  The one legitimate use is alongside `npm ci`, which resolves from the
// lockfile rather than from a packument; {@link NpmInstallOpts.ciFirst} carries
// it there.
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";

/** Total install attempts per call: 1 initial + 1 retry.  Deliberately not a loop. */
export const NPM_INSTALL_ATTEMPTS = 2;

/** Pause before the retry — a resolution window is transient, so give it one. */
export const NPM_INSTALL_RETRY_DELAY_MS = 5_000;

/** Default flags: what 60 of the 67 migrated call sites already passed. */
export const NO_AUDIT_NO_FUND = ["--no-audit", "--no-fund"] as const;

/** Longest captured output re-printed per attempt — enough for npm's error block. */
const MAX_CAPTURE_CHARS = 8_000;

export interface NpmInstallOpts {
  /**
   * ms budget for EACH attempt, mirroring the per-`execSync` timeout this
   * replaces.  A retried install can therefore take up to twice this — the
   * retry only runs after a failure, so a green cell's wall time is unchanged.
   */
  timeout?: number;
  /** Flags for `npm install`.  Defaults to {@link NO_AUDIT_NO_FUND}; pass `[]` for a bare install. */
  flags?: readonly string[];
  /**
   * Try `npm ci <these flags>` first and fall back to `npm install` within the
   * SAME attempt — the `npm ci … || npm install` shape
   * `generated-elixir-vanilla-build.test.ts` carries.  `true` uses
   * {@link NO_AUDIT_NO_FUND}.
   */
  ciFirst?: readonly string[] | boolean;
  /** Extra environment for the child; merged over `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Tests only — shortens the retry pause so the proof file stays in the fast tier. */
  retryDelayMs?: number;
}

interface AttemptResult {
  ok: boolean;
  /** Rendered `npm …` command line(s) this attempt ran. */
  command: string;
  /** Exit status, or a description of the signal/spawn error that replaced one. */
  status: string;
  /** Captured stdout + stderr, trimmed and truncated. */
  output: string;
}

/**
 * Reject a caller trying to re-silence the install.
 *
 * The whole point of this helper is that npm's `npm error` lines reach the
 * reader; a `--silent` (or a competing `--loglevel`) in the caller's flags puts
 * the harness straight back into the 2026-09-09 state where the cause had to be
 * inferred from step timing.
 */
function assertNotSilenced(flags: readonly string[], where: string): void {
  const muting = flags.filter((f) => f === "--silent" || f === "-s" || f.startsWith("--loglevel"));
  if (muting.length > 0) {
    throw new Error(
      `installGeneratedProject(${where}): refusing ${muting.join(" ")} — npm at that loglevel ` +
        `writes its \`npm error\` lines to no stream at all, which is the defect this helper ` +
        `exists to close (see the header of test/e2e/support/npm-install.ts).  Output is ` +
        `captured and re-printed only on failure, so a green cell is already quiet.`,
    );
  }
}

function truncate(s: string): string {
  const t = s.trim();
  return t.length <= MAX_CAPTURE_CHARS ? t : `…${t.slice(-MAX_CAPTURE_CHARS)}`;
}

/** Run one `npm <args>` to completion, capturing both streams. */
function runNpm(
  args: readonly string[],
  cwd: string,
  opts: NpmInstallOpts,
): { ok: boolean; status: string; output: string } {
  const res = spawnSync("npm", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: opts.timeout,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
  });
  const output = truncate(`${res.stdout ?? ""}\n${res.stderr ?? ""}`);
  if (res.error) {
    // A timeout arrives here as ETIMEDOUT with status null — npm was killed
    // mid-resolution, which is the same transient class as a registry 5xx and
    // is worth the one retry.
    return {
      ok: false,
      status: `${res.error.message}${res.signal ? ` (${res.signal})` : ""}`,
      output,
    };
  }
  if (res.status !== 0) {
    return {
      ok: false,
      status: res.status === null ? `killed by ${res.signal}` : `exit ${res.status}`,
      output,
    };
  }
  return { ok: true, status: "exit 0", output };
}

function attemptInstall(cwd: string, opts: NpmInstallOpts): AttemptResult {
  const flags = opts.flags ?? NO_AUDIT_NO_FUND;
  assertNotSilenced(flags, cwd);
  const loglevel = "--loglevel=error";

  if (opts.ciFirst) {
    const ciFlags = opts.ciFirst === true ? NO_AUDIT_NO_FUND : opts.ciFirst;
    assertNotSilenced(ciFlags, cwd);
    const ci = runNpm(["ci", loglevel, ...ciFlags], cwd, opts);
    if (ci.ok)
      return {
        ok: true,
        command: `npm ci ${ciFlags.join(" ")}`,
        status: ci.status,
        output: ci.output,
      };
    // `npm ci` refuses a project with no lockfile (or one out of sync with
    // package.json), which is a routine state for a freshly generated tree —
    // the `|| npm install` fallback is the whole reason the caller asked for
    // `ci` first.  The fallback's own failure is what gets reported.
    const install = runNpm(["install", loglevel, ...flags], cwd, opts);
    return {
      ok: install.ok,
      command: `npm ci ${ciFlags.join(" ")} || npm install ${flags.join(" ")}`,
      status: install.status,
      output: `--- npm ci (${ci.status}) ---\n${ci.output}\n--- npm install (${install.status}) ---\n${install.output}`,
    };
  }

  const install = runNpm(["install", loglevel, ...flags], cwd, opts);
  return {
    ok: install.ok,
    command: `npm install ${flags.join(" ")}`.trim(),
    status: install.status,
    output: install.output,
  };
}

/** Block the calling thread — this helper is synchronous, like the `execSync` it replaces. */
function sleepSync(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Install a generated project's dependencies: npm's diagnosis is kept, and one
 * transient failure is survived.
 *
 * Quiet on success (output captured, nothing printed).  On a failed first
 * attempt it prints that attempt's captured output — a cell that goes green on
 * the retry still says WHAT it survived — waits {@link NPM_INSTALL_RETRY_DELAY_MS},
 * and tries exactly once more.  When the retry also fails it throws with the
 * command, the cwd, both statuses and npm's own text.
 */
export function installGeneratedProject(cwd: string, opts: NpmInstallOpts = {}): void {
  const attempts: AttemptResult[] = [];
  for (let i = 1; i <= NPM_INSTALL_ATTEMPTS; i++) {
    const attempt = attemptInstall(cwd, opts);
    attempts.push(attempt);
    if (attempt.ok) return;
    if (i < NPM_INSTALL_ATTEMPTS) {
      const wait = opts.retryDelayMs ?? NPM_INSTALL_RETRY_DELAY_MS;
      console.error(
        `loom-retry: \`${attempt.command}\` failed in ${cwd} (${attempt.status}), ` +
          `attempt ${i + 1} of ${NPM_INSTALL_ATTEMPTS} after ${Math.round(wait / 1000)}s\n${attempt.output}`,
      );
      sleepSync(wait);
    }
  }
  const last = attempts[attempts.length - 1];
  const detail = attempts
    .map((a, i) => `--- attempt ${i + 1} of ${NPM_INSTALL_ATTEMPTS} (${a.status}) ---\n${a.output}`)
    .join("\n");
  throw new Error(
    `\`${last.command}\` failed in ${cwd} after ${NPM_INSTALL_ATTEMPTS} attempts (${last.status}).\n${detail}`,
  );
}

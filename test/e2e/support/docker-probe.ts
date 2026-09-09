// The one docker-availability probe every runtime-e2e suite shares.
//
// WHY THIS EXISTS.  Ten suites each carried their own copy of
//
//     try { execSync("docker info", { stdio: "pipe", timeout: 5_000 }); return true }
//     catch { return false }
//
// and every one of them collapsed *all* failure modes into "docker is not
// here".  `docker info` talks to the daemon and enumerates its whole state, so
// on a busy runner it routinely takes longer than five seconds — and a probe
// that times out then reports the same `false` as a machine with no docker
// installed at all.  The callers turn that `false` into a hard
// `… requires docker` throw, so a loaded runner fails the suite while claiming
// a cause that is not true.
//
// MEASURED, not theorised: `java-obs-e2e` run 34244249164 (merge group
// `pr-2786-b9ea115…`, 2026-09-08T15:24:16Z) died in 5.59 s with
// `LOOM_OBS_E2E_JAVA=1 requires docker (or LOOM_OBS_PG_URL)` — and that same
// job's cleanup then reported `Terminate orphan process: pid (2652) (docker)`,
// plus `docker-compose` and `docker-buildx`.  Docker was present and busy; the
// five-second probe simply did not finish.  Reds of this shape evicted merge
// queue entries for #2804 and #2786, on a `main` that did not move for hours.
//
// WHAT THIS DOES DIFFERENTLY.
//   1. Probes with `docker version --format {{.Server.Version}}`, which still
//      proves the DAEMON answers (the client-only path prints nothing and
//      exits non-zero) but does not enumerate its state the way `info` does.
//   2. Gives the probe a realistic budget and one retry, because the failure
//      being defended against is load, and load is transient.
//   3. **Separates "no docker" from "could not tell".**  A missing binary
//      (ENOENT) is a real absence and still yields `false`.  A timeout or a
//      signal kill is NOT evidence of absence, so `requireDocker()` throws an
//      error that says the probe timed out rather than lying about the cause.
//
// The third point is the one that matters.  A gate may skip when docker is
// genuinely absent; it must never report a load-induced timeout as a missing
// dependency, because that sends whoever reads the failure looking for a
// runner-image problem that is not there.

import { execFileSync } from "node:child_process";

/** How long a single probe attempt may take before it is treated as inconclusive. */
export const DOCKER_PROBE_TIMEOUT_MS = 30_000;

/** Attempts made before giving up; the failure defended against is transient load. */
export const DOCKER_PROBE_ATTEMPTS = 2;

export type DockerProbe =
  /** The daemon answered. */
  | { readonly kind: "available" }
  /** No docker CLI on PATH — a real absence, safe to skip on. */
  | { readonly kind: "absent"; readonly detail: string }
  /** The CLI is there but did not answer in time — absence is NOT established. */
  | { readonly kind: "inconclusive"; readonly detail: string };

/** Overridable so the probe's own tests can run a short budget (see docker-probe.test.ts). */
export interface ProbeOptions {
  readonly timeoutMs?: number;
  readonly attempts?: number;
}

function attempt(timeoutMs: number): DockerProbe {
  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      stdio: "pipe",
      timeout: timeoutMs,
    });
    return { kind: "available" };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { signal?: string; status?: number };
    // `execFileSync` kills the child on timeout, which surfaces as a signal
    // (SIGTERM) rather than an exit status.  ETIMEDOUT appears on some
    // platforms.  Neither says anything about whether docker is installed.
    if (e.code === "ETIMEDOUT" || e.signal) {
      return {
        kind: "inconclusive",
        detail: `probe did not answer within ${timeoutMs} ms (${e.signal ?? e.code})`,
      };
    }
    if (e.code === "ENOENT") return { kind: "absent", detail: "no `docker` on PATH" };
    // A non-zero exit with the CLI present usually means the daemon is not
    // running (`Cannot connect to the Docker daemon`).  That is a real absence
    // of a usable daemon, not a timing artefact.
    return { kind: "absent", detail: `docker version exited ${e.status ?? "non-zero"}` };
  }
}

/** Probe docker, retrying once so a single slow moment is not read as absence. */
export function probeDocker(opts: ProbeOptions = {}): DockerProbe {
  const timeoutMs = opts.timeoutMs ?? DOCKER_PROBE_TIMEOUT_MS;
  const attempts = opts.attempts ?? DOCKER_PROBE_ATTEMPTS;
  let last: DockerProbe = { kind: "inconclusive", detail: "not probed" };
  for (let i = 0; i < attempts; i++) {
    last = attempt(timeoutMs);
    if (last.kind !== "inconclusive") return last;
  }
  return last;
}

/**
 * True when docker is usable.  An INCONCLUSIVE probe counts as usable here on
 * purpose: the caller that wants to skip should skip only on real absence, and
 * a caller that goes on to use docker will fail with docker's own error, which
 * is a truer diagnosis than this probe could give.
 */
export function hasDocker(opts: ProbeOptions = {}): boolean {
  return probeDocker(opts).kind !== "absent";
}

/**
 * Assert docker for a suite that has already decided it must run.  Throws with
 * the actual reason — absence and inconclusiveness read differently, so a
 * timeout under load never gets reported as a missing dependency.
 *
 * @param what     the env var or suite name to name in the message
 * @param override an env-var name that would make docker unnecessary, if any
 */
export function requireDocker(what: string, override?: string, opts: ProbeOptions = {}): void {
  const probe = probeDocker(opts);
  if (probe.kind === "available") return;
  const alt = override ? ` (or ${override})` : "";
  if (probe.kind === "absent") {
    throw new Error(`${what} requires docker${alt} — ${probe.detail}`);
  }
  throw new Error(
    `${what}: could not confirm docker${alt} — ${probe.detail}. ` +
      "The CLI is present, so this is a busy or unresponsive daemon, NOT a missing " +
      "dependency; re-run rather than provisioning docker.",
  );
}

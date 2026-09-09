// Proof for `docker-probe.ts`: a SLOW docker is not an ABSENT docker.
//
// The defect this pins, measured on `java-obs-e2e` run 34244249164
// (2026-09-08T15:24:16Z): the probe every runtime-e2e suite carried was
// `execSync("docker info", { timeout: 5_000 })` with `catch { return false }`,
// so a daemon that took longer than five seconds to answer produced the same
// `false` as a machine with no docker at all — and the caller turned that into
// `LOOM_OBS_E2E_JAVA=1 requires docker`.  That red evicted merge-queue entries
// for #2804 and #2786 while `main` sat still.
//
// These tests drive the probe against a REAL child process by putting a fake
// `docker` on PATH, so they exercise the actual `execFileSync` timeout path
// rather than a mock of it.  They need no docker of their own, and they pass a
// short `timeoutMs` so the whole file costs well under a second — the 30 s
// production budget is asserted separately, without being waited out.
//
// PROCESS STATE: this file mutates `process.env.PATH`, and the suite runs
// `isolate: false` (one module graph per worker), so every mutation is undone
// in `afterEach` — see vitest.config.ts.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DOCKER_PROBE_ATTEMPTS,
  DOCKER_PROBE_TIMEOUT_MS,
  hasDocker,
  probeDocker,
  requireDocker,
} from "./docker-probe.js";

/** Short enough to keep this file in the fast tier; the fake below outlasts it. */
const FAST = { timeoutMs: 250, attempts: 2 } as const;

const ORIGINAL_PATH = process.env.PATH;
const tmpDirs: string[] = [];

afterEach(() => {
  process.env.PATH = ORIGINAL_PATH;
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/**
 * Put a shim named `docker` FIRST on PATH, so it wins over any real one while
 * the shim itself can still reach `sleep`/`touch`.  (Replacing PATH outright
 * makes the shim exit 127 — a non-zero status, which the probe correctly reads
 * as `absent`, quietly defeating the timeout cases this file exists to pin.)
 */
function stubDocker(script: string): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-docker-stub-"));
  tmpDirs.push(dir);
  const bin = path.join(dir, "docker");
  fs.writeFileSync(bin, `#!/bin/sh\n${script}\n`);
  fs.chmodSync(bin, 0o755);
  process.env.PATH = `${dir}${path.delimiter}${ORIGINAL_PATH ?? ""}`;
}

/** An empty PATH dir: no `docker` binary anywhere. */
function stubNoDocker(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-docker-none-"));
  tmpDirs.push(dir);
  process.env.PATH = dir;
}

// Every case shells out to /bin/sh, which Windows runners have no equivalent of.
const onPosix = process.platform !== "win32";

describe.skipIf(!onPosix)("docker probe", () => {
  it("reports a responsive daemon as available", () => {
    stubDocker('echo "28.0.1"');
    expect(probeDocker(FAST).kind).toBe("available");
  });

  it("reports a missing binary as absent", () => {
    stubNoDocker();
    const probe = probeDocker(FAST);
    expect(probe.kind).toBe("absent");
    expect(probe.kind === "absent" && probe.detail).toContain("PATH");
  });

  it("reports a present CLI whose daemon refuses as absent", () => {
    // `Cannot connect to the Docker daemon` — a real absence of a usable
    // daemon, and correctly distinct from a timeout.
    stubDocker("exit 1");
    expect(probeDocker(FAST).kind).toBe("absent");
  });

  // ── The regression ────────────────────────────────────────────────────────
  // A daemon slower than the probe budget must NOT be reported as absent.
  it("reports a daemon slower than the probe budget as inconclusive, not absent", () => {
    stubDocker("sleep 5");
    const probe = probeDocker(FAST);
    expect(probe.kind).toBe("inconclusive");
    expect(probe.kind !== "available" && probe.detail).toMatch(/did not answer/);
  });

  it("requireDocker blames the timeout, never a missing dependency", () => {
    stubDocker("sleep 5");
    let message = "";
    try {
      requireDocker("LOOM_OBS_E2E_JAVA=1", "LOOM_OBS_PG_URL", FAST);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("could not confirm docker");
    expect(message).toContain("NOT a missing");
    // The exact wording the old probe produced, which sent readers looking for
    // a runner-image problem that did not exist.
    expect(message).not.toContain("requires docker");
  });

  // Control: without this, a probe hard-wired to `inconclusive` would satisfy
  // every assertion above while never skipping on a machine that has no docker.
  it("requireDocker still says `requires docker` when it genuinely is missing", () => {
    stubNoDocker();
    expect(() => requireDocker("LOOM_OBS_E2E_JAVA=1", "LOOM_OBS_PG_URL", FAST)).toThrow(
      /requires docker \(or LOOM_OBS_PG_URL\)/,
    );
  });

  it("hasDocker skips only on real absence, never on an inconclusive probe", () => {
    stubNoDocker();
    expect(hasDocker(FAST)).toBe(false);
    stubDocker("sleep 5");
    expect(hasDocker(FAST)).toBe(true);
  });

  it("retries, so one slow moment alone is not read as absence", () => {
    // Answers only on the second call: attempt 1 sleeps past the budget,
    // attempt 2 returns immediately. With DOCKER_PROBE_ATTEMPTS === 1 this
    // would come back `inconclusive`.
    const marker = path.join(os.tmpdir(), `loom-docker-retry-${process.pid}-${Date.now()}`);
    stubDocker(`if [ -f "${marker}" ]; then echo 28.0.1; else touch "${marker}"; sleep 5; fi`);
    try {
      expect(DOCKER_PROBE_ATTEMPTS).toBeGreaterThan(1);
      expect(probeDocker(FAST).kind).toBe("available");
    } finally {
      fs.rmSync(marker, { force: true });
    }
  });

  // The production budget itself, asserted rather than waited out. Five seconds
  // is what failed under load; anything at or below it reopens the defect.
  it("ships a budget comfortably above the five seconds that failed", () => {
    expect(DOCKER_PROBE_TIMEOUT_MS).toBeGreaterThan(5_000);
  });
});

// The ratchet.  Eleven suites each grew their own probe because writing one is
// four lines; the cost only showed up years later, in a merge queue, as a red
// that named the wrong cause.  A new inline `execSync("docker …")` availability
// check re-opens exactly that, so it fails here instead — with the fix being to
// import from this module, not to add a waiver.
describe("no suite re-grows its own docker probe", () => {
  const E2E = path.join(import.meta.dirname, "..");
  const SELF = new Set(["docker-probe.ts", "docker-probe.test.ts"]);

  function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, out);
      else if (e.name.endsWith(".ts") && !SELF.has(e.name)) out.push(full);
    }
    return out;
  }

  it("every docker availability check under test/e2e/ comes from docker-probe.ts", () => {
    // `execSync`/`execFileSync` invoking one of the read-only probe verbs.
    // Actually USING docker (run/exec/rm/compose) is untouched — this is about
    // asking "is docker here?", not about driving it.
    const PROBE = /exec(?:File)?Sync\(\s*["'`]docker (?:info|ps|version)\b/;
    const offenders = walk(E2E)
      .filter((f) => PROBE.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(E2E, f));
    expect(offenders).toEqual([]);
  });
});

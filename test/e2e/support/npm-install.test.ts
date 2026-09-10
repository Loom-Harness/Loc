// Proof for `npm-install.ts`, in two halves that are proved SEPARATELY:
//
//   1. A FAILED install names its own cause.  `npm install --silent` — the
//      spelling 49 call sites carried — writes npm's `npm error` block to no
//      stream at all, so the harness could only ever report `Command failed:
//      npm install`.  Measured against real npm 10.9.7 with one unresolvable
//      version pinned: `--silent` → exit 1 with 0 bytes on both streams;
//      `--loglevel=error` → exit 1 with 356 bytes of `npm error code ETARGET`.
//      The last case in this file is the CONTROL: it drives the pre-fix
//      `execSync("npm install --silent …")` shape against the same fake npm and
//      asserts the diagnosis is absent — without it, "the message contains
//      `npm error code`" could pass for reasons that have nothing to do with
//      this helper.
//
//   2. The retry is EXACTLY ONE.  Both a transient failure (fail, then succeed)
//      and a deterministic one (fail, fail) must produce exactly two
//      invocations — the first proves the retry happens, the second proves it
//      is bounded.  Asserting only the green case cannot tell a once-retry from
//      an unbounded loop.
//
// Every case drives a REAL child process through a fake `npm` first on PATH
// (the `docker-probe.test.ts` pattern), so it exercises the actual spawn,
// capture and status paths rather than a mock of them — and needs no registry.
// The fake honours `--silent` the way npm does (prints nothing at any stream),
// which is what makes the control above meaningful.
//
// PROCESS STATE: this file mutates `process.env` (PATH and the fake's own
// vars) and the suite runs `isolate: false` (one module graph per worker), so
// every mutation is undone in `afterEach` — see vitest.config.ts.

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  installGeneratedProject,
  NPM_INSTALL_ATTEMPTS,
  NPM_INSTALL_RETRY_DELAY_MS,
} from "./npm-install.js";

/** Short enough to keep the retrying cases in the fast tier. */
const FAST_RETRY = 10;

const ORIGINAL_PATH = process.env.PATH;
const tmpDirs: string[] = [];
let log = "";

afterEach(() => {
  process.env.PATH = ORIGINAL_PATH;
  process.env.LOOM_FAKE_NPM_LOG = undefined;
  process.env.LOOM_FAKE_NPM_MODE = undefined;
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function mkTmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

/**
 * Put a fake `npm` FIRST on PATH — the real one stays reachable for everything
 * else, and the fake can still reach `wc`/`printf`.
 *
 * `mode` selects the failure shape:
 *   `ok`         — every invocation succeeds.
 *   `always`     — every invocation fails (a genuinely broken manifest).
 *   `transient`  — the FIRST invocation fails, every later one succeeds.
 *   `ci-only`    — `npm ci` fails, `npm install` succeeds (the no-lockfile case).
 *
 * On failure the fake emits npm's real ETARGET block — unless the args mute it,
 * which is precisely what `--silent` does to real npm.
 */
function stubNpm(mode: "ok" | "always" | "transient" | "ci-only"): string {
  const dir = mkTmp("loom-npm-stub-");
  log = path.join(dir, "invocations.log");
  fs.writeFileSync(log, "");
  const bin = path.join(dir, "npm");
  fs.writeFileSync(
    bin,
    [
      "#!/bin/sh",
      'ARGS="$*"',
      'printf "%s\\n" "$ARGS" >> "$LOOM_FAKE_NPM_LOG"',
      'COUNT=$(wc -l < "$LOOM_FAKE_NPM_LOG" | tr -d " ")',
      "fail() {",
      '  case "$ARGS" in',
      // Real npm at loglevel silent writes its error to NO stream; the fake
      // must do the same or the control case below would be a lie.
      "    *--silent*|*--loglevel=silent*) : ;;",
      '    *) printf "npm error code ETARGET\\nnpm error notarget No matching version found for @angular-devkit/architect@0.2201.8.\\n" >&2 ;;',
      "  esac",
      "  exit 1",
      "}",
      'case "$LOOM_FAKE_NPM_MODE" in',
      "  always) fail ;;",
      '  transient) [ "$COUNT" -eq 1 ] && fail ;;',
      '  ci-only) case "$1" in ci) fail ;; esac ;;',
      "esac",
      'printf "added 13 packages in 2s\\n"',
      "exit 0",
    ].join("\n") + "\n",
  );
  fs.chmodSync(bin, 0o755);
  process.env.PATH = `${dir}${path.delimiter}${ORIGINAL_PATH ?? ""}`;
  process.env.LOOM_FAKE_NPM_LOG = log;
  process.env.LOOM_FAKE_NPM_MODE = mode;
  return dir;
}

/** Every argv the fake npm has seen, one per invocation. */
function invocations(): string[] {
  return fs
    .readFileSync(log, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "");
}

// The fake shells out to /bin/sh, which Windows runners have no equivalent of.
const onPosix = process.platform !== "win32";

describe.skipIf(!onPosix)("installGeneratedProject", () => {
  // ── Half 2: the retry is bounded, and counted ─────────────────────────────
  it("runs exactly once when the install succeeds, and does not sleep", () => {
    stubNpm("ok");
    const started = Date.now();
    installGeneratedProject(mkTmp("loom-proj-"));
    // The production pause is 5 s; a green cell must not pay it.
    expect(Date.now() - started).toBeLessThan(NPM_INSTALL_RETRY_DELAY_MS / 2);
    expect(invocations()).toHaveLength(1);
  });

  it("retries a transient failure exactly once and goes green", () => {
    stubNpm("transient");
    expect(() =>
      installGeneratedProject(mkTmp("loom-proj-"), { retryDelayMs: FAST_RETRY }),
    ).not.toThrow();
    // Exactly two: one more than the failure, and no more than that.
    expect(invocations()).toHaveLength(2);
  });

  it("stops after exactly two attempts when the failure is deterministic", () => {
    stubNpm("always");
    expect(() =>
      installGeneratedProject(mkTmp("loom-proj-"), { retryDelayMs: FAST_RETRY }),
    ).toThrow();
    // The failure mode NOT to build: a loop that laundered a broken manifest
    // into N slow failures.  Two attempts, then red.
    expect(invocations()).toHaveLength(2);
  });

  it("budgets exactly one retry — the constant every call site inherits", () => {
    // The two counting cases above assert the literal 2 they observed; this
    // pins the knob they observe it through, so widening the budget has to be
    // a deliberate edit to a documented constant rather than a quiet drift.
    expect(NPM_INSTALL_ATTEMPTS).toBe(2);
  });

  // ── Half 1: the failure names its own cause ───────────────────────────────
  it("re-prints npm's own error text when the install fails", () => {
    stubNpm("always");
    let message = "";
    try {
      installGeneratedProject(mkTmp("loom-proj-"), { retryDelayMs: FAST_RETRY });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("npm error code ETARGET");
    expect(message).toContain("No matching version found");
    // …and enough context to act on it without opening the workflow file.
    expect(message).toContain("npm install");
    expect(message).toMatch(/after 2 attempts/);
  });

  it("never runs npm at a loglevel that would swallow the diagnosis", () => {
    stubNpm("ok");
    installGeneratedProject(mkTmp("loom-proj-"), { flags: ["--no-audit", "--no-fund"] });
    expect(invocations()[0]).toContain("--loglevel=error");
    expect(invocations()[0]).not.toContain("--silent");
  });

  it("refuses a caller that tries to re-silence the install", () => {
    stubNpm("ok");
    expect(() => installGeneratedProject(mkTmp("loom-proj-"), { flags: ["--silent"] })).toThrow(
      /refusing --silent/,
    );
    expect(invocations()).toHaveLength(0);
  });

  // ── Call-site shapes that must survive the migration ──────────────────────
  it("passes the caller's flags through verbatim, and `[]` means a bare install", () => {
    stubNpm("ok");
    installGeneratedProject(mkTmp("loom-proj-"), { flags: [] });
    expect(invocations()[0]).toBe("install --loglevel=error");
  });

  it("falls back from `npm ci` to `npm install` inside ONE attempt", () => {
    stubNpm("ci-only");
    installGeneratedProject(mkTmp("loom-proj-"), {
      ciFirst: ["--prefer-offline", "--no-audit", "--no-fund"],
      flags: [],
      retryDelayMs: FAST_RETRY,
    });
    const seen = invocations();
    // `npm ci … || npm install` is ONE attempt: the fallback is not the retry,
    // so a project with no lockfile must not burn the retry budget getting
    // installed the ordinary way.
    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain("ci --loglevel=error --prefer-offline");
    expect(seen[1]).toBe("install --loglevel=error");
  });

  // ── The control ───────────────────────────────────────────────────────────
  // Without this, "the message contains `npm error code`" proves nothing about
  // the helper: it must be shown that the shape this replaced CANNOT satisfy
  // it.  This is the pre-fix call site, verbatim, against the same fake npm.
  it("CONTROL: the pre-fix `--silent` shape carries no diagnosis at all", () => {
    stubNpm("always");
    const dir = mkTmp("loom-proj-");
    let message = "";
    try {
      execSync("npm install --silent --no-audit --no-fund", {
        cwd: dir,
        stdio: "inherit",
        timeout: 30_000,
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("Command failed: npm install");
    expect(message).not.toContain("npm error code");
    expect(message).not.toContain("No matching version found");
    // One attempt, no retry — the other half of what the migration changes.
    expect(invocations()).toHaveLength(1);
  });
});

// ── The ratchet ─────────────────────────────────────────────────────────────
// The helper refuses a caller that passes `--silent`, but nothing stops a new
// suite from spelling its own `execSync("npm install --silent …")` the way all
// 49 migrated sites did.  This is the waiver-free half: every generated-project
// install in test/e2e/ goes through the helper, so the next one inherits both
// the diagnosis and the retry by default rather than by remembering to.
describe("no e2e suite installs a generated project behind the helper's back", () => {
  it("has no raw `npm install` / `npm ci` invocation left in test/e2e/", () => {
    const dir = path.join(import.meta.dirname, "..");
    const offenders: string[] = [];
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".test.ts"))) {
      const lines = fs.readFileSync(path.join(dir, name), "utf8").split("\n");
      lines.forEach((line, i) => {
        const code = line.trim();
        // Prose about npm is fine; a quoted command line is the thing.
        if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
        if (/["'`][^"'`]*\bnpm (install|ci)\b/.test(line)) {
          offenders.push(`${name}:${i + 1}: ${code}`);
        }
      });
    }
    expect(
      offenders,
      `Use installGeneratedProject() from test/e2e/support/npm-install.ts instead — a raw ` +
        `install discards npm's error output (with --silent) and never retries:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

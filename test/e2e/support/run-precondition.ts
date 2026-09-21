// The one place a runtime-e2e suite decides whether it may skip.
//
// WHY THIS EXISTS.  A lane that ASKED for a tier and then skipped it is the
// worst outcome available: it reports green having proven nothing, and every
// reader downstream — `pr-gate`, the merge queue, the person reading the check
// list — treats that green as evidence.
//
// This is not hypothetical.  `test/e2e/e2e.test.ts` paid for it once already:
// before `support/docker-probe.ts` separated "no docker" from "could not
// tell", the conformance nightly's five-second `docker info` timed out under
// load, was read as absence, skipped the whole describe, and finished GREEN in
// five minutes (runs 33953650250 on 2026-09-05 and 34020901813 on 2026-09-06).
// The first run after the probe was fixed found a `tsc` break in the generated
// console_web that had been there the whole time.
//
// The fix that shipped then was TWO things, and only one of them was shared:
// the probe moved into `docker-probe.ts`, but the guard that turns "asked and
// skipped" into a failure stayed hand-rolled inside `e2e.test.ts`.  Its four
// siblings — the native `*-oidc-e2e` suites — kept the bare
// `const RUN = ENABLED && hasDocker()` + `describe.skipIf(!RUN)` shape, so with
// docker unreachable they answer:
//
//     Test Files  1 skipped (1)
//          Tests  1 skipped (1)
//       Duration  210ms          → exit 0
//
// for a check `CLAUDE.md` lists as binding per-PR.  The .NET / Java / Python
// legs are strictly worse off than the docker-only case, because they also gate
// on `dotnet --version` / `gradle --version` / `uv --version` probes that
// collapse a TIMEOUT into the same `false` as a missing binary — the exact
// conflation `docker-probe.ts` exists to refuse.
//
// WHAT THIS DOES.  `declareRunPrecondition` both COMPUTES the suite's `RUN` and
// DECLARES the guard that fails when the tier was requested and cannot run.
// The two cannot drift, because there is no way to obtain `RUN` without
// declaring the guard — which is the property the hand-rolled version lacked
// and is why four suites went without one.
//
// A suite whose dependency is genuinely optional (a sidecar it can substitute,
// a second backend it merely prefers) should NOT route that choice through
// here: model it as the suite running with the substitute, not as a skip.

import { describe, expect, it } from "vitest";

/** One named thing the suite needs before its assertions mean anything. */
export interface RunRequirement {
  /** What it is, in the words the failure message should use — `docker`, `gradle`. */
  readonly name: string;
  /** Whether it is available. */
  readonly ok: boolean;
}

export interface RunPreconditionOptions {
  /** The suite, named as its describe names it. */
  readonly suite: string;
  /** The env var that ASKED for this tier, e.g. `LOOM_AUTH_E2E_JAVA=1`. */
  readonly gate: string;
  /** Whether that env var is set — i.e. whether this tier was requested at all. */
  readonly enabled: boolean;
  /** Everything else the suite needs; all must hold for it to run. */
  readonly requirements: readonly RunRequirement[];
  /**
   * Env var that accepts the skip deliberately for a local run.  Defaults to
   * the one `e2e.test.ts` has always documented, so there is a single opt-out
   * across every suite rather than one per file.
   */
  readonly allowSkipEnv?: string;
}

export const DEFAULT_ALLOW_SKIP_ENV = "LOOM_E2E_ALLOW_NO_DOCKER";

/**
 * Compute the suite's `RUN` and declare its precondition guard in one step.
 *
 * Call this at module top level, where vitest collects:
 *
 * ```ts
 * const RUN = declareRunPrecondition({
 *   suite: "auth OIDC e2e (Java)",
 *   gate: "LOOM_AUTH_E2E_JAVA=1",
 *   enabled: ENABLED,
 *   requirements: [
 *     { name: "a reachable docker daemon", ok: hasDocker() },
 *     { name: "gradle on PATH", ok: hasGradle() },
 *   ],
 * });
 *
 * describe.skipIf(!RUN)("auth OIDC e2e (Java): …", () => { … });
 * ```
 *
 * When the tier was NOT requested the suite skips silently, as it should — an
 * unrequested tier is not a lie.  When it WAS requested and something is
 * missing, a single failing test names the missing thing.
 *
 * @returns whether the suite may run.
 */
export function declareRunPrecondition(opts: RunPreconditionOptions): boolean {
  const allowSkipEnv = opts.allowSkipEnv ?? DEFAULT_ALLOW_SKIP_ENV;
  const missing = opts.requirements.filter((r) => !r.ok).map((r) => r.name);
  const run = opts.enabled && missing.length === 0;

  // Only fires when the tier was asked for and cannot run: `enabled` true,
  // `run` false.  Inside this describe `run` is false by construction, so the
  // assertion always fails — with the reason in the message.  It is an
  // assertion rather than a bare `throw` so the assertion-free ratchet
  // (test/platform/assertion-free-tests.test.ts) sees a real check.
  describe.runIf(opts.enabled && !run && process.env[allowSkipEnv] !== "1")(
    `${opts.suite}: precondition`,
    () => {
      it(`${opts.gate} requires ${missing.join(" and ")}`, () => {
        expect(
          run,
          `${opts.gate} asked for this tier, but ${missing.join(" and ")} ` +
            "could not be found, so every assertion below would have been skipped and this " +
            `job would have reported green having proven nothing. Provide ${missing.join(" and ")}, ` +
            `or set ${allowSkipEnv}=1 to accept the skip deliberately.`,
        ).toBe(true);
      });
    },
  );

  return run;
}

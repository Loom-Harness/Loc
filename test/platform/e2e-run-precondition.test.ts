// A runtime-e2e suite that gates its describe on a PROBE must fail — not skip
// — when the tier was requested and the probe says no.
//
// The failure this ratchets against is a green check that proves nothing.  A
// suite whose workflow sets its `LOOM_*` env var has been ASKED to run; if it
// then skips because docker, gradle, uv or the dotnet SDK was not found, the
// job exits 0 in a fraction of a second and `pr-gate` counts it as a passing
// binding check.  Measured on `main` before this ratchet landed:
//
//     $ PATH=<shim-with-failing-docker>:$PATH LOOM_AUTH_E2E=1 \
//         npx vitest run test/e2e/auth-oidc-e2e.test.ts
//      Test Files  1 skipped (1)
//           Tests  1 skipped (1)
//        Duration  210ms        → exit 0
//
// `test/e2e/e2e.test.ts` had a hand-rolled guard against exactly this and its
// four `*-oidc-e2e` siblings did not, for months.  A shared helper alone would
// not have prevented that — nothing made adopting it mandatory.  This test is
// what makes it mandatory.
//
// THE RULE.  A `test/e2e/**` suite that computes a run-gate by ANDing its
// `ENABLED` flag with anything else must obtain that gate from
// `declareRunPrecondition` (which declares the guard as a side effect of
// computing it), or call `requireDocker` (which throws with the real reason),
// or carry a waiver here saying why its silent skip is honest.
//
// Waivers RATCHET in both directions: a stale entry fails, so a suite that
// adopts the helper deletes its waiver in the same change.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const e2eDir = path.join(repoRoot, "test", "e2e");

/**
 * Suites whose silent skip is honest, each with the reason.  An entry here is
 * a reviewed decision, not a backlog: it must name why a skip cannot be a lie
 * for that suite.
 */
const WAIVERS: Record<string, string> = {
  // The phoenix half gates additionally on LOOM_HEX_MIRROR=1, which is an
  // explicit opt-in rather than a discovered dependency: a run that did not
  // set it did not ask for that half, so skipping it is not a lie.  The
  // suite's node half is ungated by any probe and always runs.
  "auth-gate-ui-e2e.test.ts":
    "the phoenix half is opt-in via LOOM_HEX_MIRROR=1, not probe-discovered",
};

/** Files that legitimately have no run-gate to check. */
const NOT_A_SUITE = (name: string): boolean => !name.endsWith(".test.ts");

function suiteFiles(): string[] {
  return fs
    .readdirSync(e2eDir)
    .filter((n) => !NOT_A_SUITE(n))
    .sort();
}

/**
 * A run-gate is `const <NAME> = <ENABLED-ish> && <something else>` — the shape
 * that turns a missing dependency into a skip.  A bare
 * `const ENABLED = process.env.X === "1"` is not one: an unrequested tier may
 * skip freely.
 */
const RUN_GATE = /^const\s+\w+\s*=\s*\w*ENABLED\w*\s*&&\s*[^;]+;/m;

const ADOPTS_HELPER = /declareRunPrecondition\s*\(/;
const THROWS_ITS_OWN = /requireDocker\s*\(/;

describe("runtime-e2e suites cannot skip a tier they were asked to run", () => {
  const offenders: string[] = [];

  for (const name of suiteFiles()) {
    const src = fs.readFileSync(path.join(e2eDir, name), "utf8");
    if (!RUN_GATE.test(src)) continue;
    if (ADOPTS_HELPER.test(src) || THROWS_ITS_OWN.test(src)) continue;
    offenders.push(name);
  }

  it("every probe-gated suite declares a precondition, or is waived with a reason", () => {
    const unwaived = offenders.filter((n) => !(n in WAIVERS));
    expect(
      unwaived,
      "These suites AND their ENABLED flag with a probe and then " +
        "`describe.skipIf` the result, so when the probe says no they report green having " +
        "run nothing. Route the gate through `declareRunPrecondition` " +
        "(test/e2e/support/run-precondition.ts), or add a waiver here saying why the skip " +
        "is honest.",
    ).toEqual([]);
  });

  it("no waiver outlives the suite it excuses", () => {
    const stale = Object.keys(WAIVERS).filter((n) => !offenders.includes(n));
    expect(
      stale,
      "These waivers name a suite that no longer skips silently (it adopted the helper, " +
        "or stopped probe-gating). Delete the entry in the same change that fixed it — a " +
        "waiver that outlives its reason is how the next one gets added without thought.",
    ).toEqual([]);
  });

  it("the guard is reachable — at least one suite is actually gated this way", () => {
    // Non-vacuity: if the RUN_GATE pattern ever stops matching anything (a
    // refactor renames the shape), both assertions above would pass by
    // scanning nothing at all.
    const gated = suiteFiles().filter((n) =>
      RUN_GATE.test(fs.readFileSync(path.join(e2eDir, n), "utf8")),
    );
    expect(gated.length).toBeGreaterThan(0);
  });
});

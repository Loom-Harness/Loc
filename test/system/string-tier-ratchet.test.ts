import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// String-tier ratchet (Wave CR1 packet h, audit row P1-2).
//
// The "string tier" is every substring assertion on GENERATED SOURCE TEXT —
// `toContain` / `toMatch` and their `.not.` forms under `test/generator/`.  It
// is the cheapest assertion to write and the weakest in the building: it
// breaks on formatting and passes on code that compiles to nothing.  Nothing
// measured its size, so it grew by ~3 assertions per merged PR.
//
// THE RULE IS BUMP-TO-GROW, NOT ONLY-FALLS.  A hard "may only fall" ceiling
// was rejected on evidence: of the 42 scenarios duplicated across target dirs,
// 39 have no corpus fixture (docs/audits/verification-architecture-2026-08-31.md
// §5), so their string tests are the ONLY gate they have.  A ceiling that
// forces a deletion per addition would delete those — the tier shrinks and the
// coverage goes with it.  The tier is reduced by PROMOTION instead (a corpus
// fixture + behavioural block first, then the per-target copies go under the
// `test/system/gate-ledger.test.ts` drain rule).  What this gate adds is that
// growth stops being invisible: crossing a bucket fails until the PR raises
// that target's ceiling, in the diff, where a reviewer sees it.
//
// WHY A BAND, NOT AN EXACT VALUE.  A ceiling is valid while the count sits
// strictly below it with at most MAX_HEADROOM to spare.  Growth to the ceiling
// fails, and so does a drain that leaves more than MAX_HEADROOM unused, so
// freed headroom cannot be silently re-spent.  The fix for either is the value
// the failure prints, `reseat(count)`: the next multiple of BUCKET above the
// count, plus one more BUCKET.  That gives every bump at least BUCKET of
// slack.  An exact `next multiple of BUCKET` rule left as little as one
// assertion of slack, which this repo's main overruns in hours (one row took
// 62 in a night), so a PR could not even sit in the merge queue without
// going stale.  The coarse granularity also keeps two concurrent PRs on one
// backend from colliding on the same line.
//
// WHY PER TARGET.  One global figure lets growth on one backend hide behind a
// drain on another.  A "target" is the first directory under `test/generator/`
// (`elixir`, `_walker`, …); loose files directly in `test/generator/` are the
// `(cross-target)` row.  A new target directory fails until it is seeded; a
// removed one fails until its row is deleted.
//
// MEASUREMENT METHOD — keep this exact, or the next re-count reads as a
// regression (the export-surface census baseline had to be re-measured three
// times for want of a stated method):
//   * files: every `*.ts` under `test/generator/`, recursively;
//   * matcher: the regex STRING_ASSERTION below, counted per occurrence —
//     `.not.toContain(` counts once; `toContainEqual` / `toMatchObject` /
//     `toMatchInlineSnapshot` do NOT count (they are structural, not textual);
//   * equivalent shell: `git grep -hoE "\.(not\.)?(toContain|toMatch)\("
//     -- test/generator/ | wc -l`  (19,533 on main @ d3f22676, the seed tree).
// The audit's 65.8%-of-40,463 figure counted per matcher across all of
// `test/`, so it is NOT comparable with these numbers; do not reconcile them.
//
// SCOPE.  `test/generator/` only.  The ~5,800 substring assertions elsewhere
// in `test/` are overwhelmingly on diagnostic MESSAGES and CLI output, which
// is the right assertion for a human-readable string and not this tier.
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const GENERATOR_TESTS = path.join(REPO_ROOT, "test/generator");
const STRING_ASSERTION = /\.(?:not\.)?(?:toContain|toMatch)\(/g;
const CROSS_TARGET = "(cross-target)";
const BUCKET = 100;
const MAX_HEADROOM = 2 * BUCKET;

/**
 * Per-target ceilings, each within (count, count + MAX_HEADROOM].  To change an entry, set it to the
 * value the failure message prints.  Raising one is a reviewed act — say in
 * the PR body why the new assertions are string-shaped rather than a corpus
 * fixture or a compile/behavioural cell.
 */
const CEILINGS: Record<string, number> = {
  "(cross-target)": 2300,
  _expr: 200,
  _frontend: 400,
  _i18n: 200,
  _numeric: 200,
  _obs: 200,
  _openapi: 200,
  _packs: 300,
  _persistence: 200,
  _stmt: 200,
  _walker: 700,
  _workflow: 200,
  angular: 1000,
  dotnet: 2300,
  elixir: 3200,
  "elixir-vanilla": 500,
  feliz: 1500,
  flutter: 1200,
  frontend: 200,
  hono: 500,
  i18n: 200,
  java: 1800,
  python: 1800,
  react: 1600,
  svelte: 600,
  typescript: 1500,
  vue: 700,
  walker: 200,
};

function reseat(count: number): number {
  return Math.floor(count / BUCKET) * BUCKET + 2 * BUCKET;
}

function countStringTier(root: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      const rel = path.relative(root, full).split(path.sep);
      const target = rel.length > 1 ? rel[0] : CROSS_TARGET;
      const hits = fs.readFileSync(full, "utf8").match(STRING_ASSERTION)?.length ?? 0;
      counts[target] = (counts[target] ?? 0) + hits;
    }
  };
  walk(root);
  return counts;
}

describe("string-tier ratchet", () => {
  const counts = countStringTier(GENERATOR_TESTS);

  it("measures something — the walker and the matcher both see the tier", () => {
    // A counter that returned `{}` (wrong root) or zeros (a broken regex)
    // would make every ceiling look generous.  The tier is ~20k; anything
    // under a tenth of that means the measurement went blind, not that the
    // drain went well.
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(2_000);
    expect(
      "expect(x).not.toContain(y); expect(x).toMatch(/z/);".match(STRING_ASSERTION),
    ).toHaveLength(2);
    expect(
      "expect(x).toContainEqual(y); expect(x).toMatchObject(z);".match(STRING_ASSERTION),
    ).toBeNull();
  });

  it("every target directory has a ceiling, and every ceiling a target", () => {
    expect(Object.keys(counts).sort()).toEqual(Object.keys(CEILINGS).sort());
  });

  it("each target sits inside its ceiling's band", () => {
    const drift = Object.entries(counts)
      .filter(([target]) => CEILINGS[target] !== undefined)
      .filter(([target, n]) => n >= CEILINGS[target] || CEILINGS[target] - n > MAX_HEADROOM)
      .map(([target, n]) => {
        const was = CEILINGS[target];
        const why =
          n >= was
            ? `GREW to its ceiling (${n} >= ${was}) — promote the scenario to the corpus, or drain a string test the gate ledger shows is watched by a stronger gate; if the new assertions genuinely belong in the string tier, raise the ceiling and say why in the PR body`
            : `fell more than ${MAX_HEADROOM} below its ceiling (${n}) — ratchet it down so the freed headroom cannot be silently re-spent`;
        return `  ${JSON.stringify(target)}: ${reseat(n)},   // was ${was}; ${why}`;
      });
    expect(
      drift,
      `string-tier ceilings out of band — set these CEILINGS entries:\n${drift.join("\n")}`,
    ).toEqual([]);
  });
});

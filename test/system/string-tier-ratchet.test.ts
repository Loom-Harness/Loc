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
// WHY BUCKETS.  Each ceiling is DERIVED, not chosen: `bucketOf(count)`, the
// next multiple of BUCKET strictly above the count.  So the map is exactly
// right or the test fails, in BOTH directions — growth past the bucket and a
// drain below it each move the expected value, and the fix is always "set the
// entry to what the failure prints".  A per-assertion ceiling would make every
// two concurrent PRs on one backend conflict on the same line; with a bucket
// of 100 at ~3 assertions per PR, a given target's line moves every few weeks.
// Headroom inside a bucket is therefore at most BUCKET - 1, and that is the
// whole of the silent growth this gate tolerates per target.
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
//     -- test/generator/ | wc -l`  (19,460 on main @ 8c0e05be, the seed tree).
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

/**
 * Per-target ceilings: `bucketOf(<count>)`.  To change an entry, set it to the
 * value the failure message prints.  Raising one is a reviewed act — say in
 * the PR body why the new assertions are string-shaped rather than a corpus
 * fixture or a compile/behavioural cell.
 */
const CEILINGS: Record<string, number> = {
  "(cross-target)": 2200,
  _expr: 100,
  _frontend: 300,
  _i18n: 100,
  _numeric: 100,
  _obs: 100,
  _openapi: 100,
  _packs: 200,
  _persistence: 100,
  _stmt: 100,
  _walker: 600,
  _workflow: 100,
  angular: 900,
  dotnet: 2100,
  elixir: 3100,
  "elixir-vanilla": 400,
  feliz: 1400,
  flutter: 1100,
  frontend: 100,
  hono: 400,
  i18n: 100,
  java: 1700,
  python: 1700,
  react: 1500,
  svelte: 500,
  typescript: 1400,
  vue: 600,
  walker: 100,
};

function bucketOf(count: number): number {
  return Math.floor(count / BUCKET) * BUCKET + BUCKET;
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

  it("each target sits in its ceiling's bucket", () => {
    const drift = Object.entries(counts)
      .filter(([target, n]) => CEILINGS[target] !== undefined && CEILINGS[target] !== bucketOf(n))
      .map(([target, n]) => {
        const was = CEILINGS[target];
        const why =
          n >= was
            ? `GREW past its ceiling (${n} >= ${was}) — promote the scenario to the corpus, or drain a string test the gate ledger shows is watched by a stronger gate; if the new assertions genuinely belong in the string tier, raise the ceiling and say why in the PR body`
            : `fell a full bucket (${n} < ${was - BUCKET}) — ratchet it down so the freed headroom cannot be silently re-spent`;
        return `  ${JSON.stringify(target)}: ${bucketOf(n)},   // was ${was}; ${why}`;
      });
    expect(
      drift,
      `string-tier ceilings out of bucket — set these CEILINGS entries:\n${drift.join("\n")}`,
    ).toEqual([]);
  });
});

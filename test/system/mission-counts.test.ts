// The plan's live-mission counts must be CODE, not a hand-typed cache
// (experience_gathered.md §91: "a count in prose is a cache with no
// invalidation story").
//
// What this replaces was the trap in one line. `docs/new-plan/README.md` used
// to say: "175 headings in all, 2026-09-10 count; the per-track table above is
// the 09-06 count and T6/T8/T9 have grown since" — two numbers, four days
// apart, in adjacent paragraphs, with the prose itself telling the reader that
// one of them was wrong and not which. Agents route on that file.
//
// `scripts/mission-counts.mjs` derives both the per-track table and the total
// from the `## M-Tx.y` headings under `docs/new-plan/T*.md` and
// `docs/new-plan/archive/T<n>-done.md` on every run, and splices them into a
// marked region of the README. This test runs its `--check` mode, so archiving
// a mission or flipping a status without regenerating fails here rather than
// shipping a stale count.
//
// MUTATION PROOFS (each run by hand against this file, reverted by file copy —
// never `git checkout --`, per experience_gathered.md §84):
//
//   1. Edit the total in the README's generated region (148 → 149).
//      → `--check passes on the committed README` fails with the
//        "mission-counts region is STALE" message, and
//        `regenerating reproduces the committed README exactly` fails on the
//        string comparison.
//   2. Delete one `## M-T…` heading from a track file.
//      → the same two fail, because the derived total drops by one while the
//        committed region still says 148.  This is the direction that matters:
//        it is what archiving a mission looks like.
//   3. Give a heading a status the legend does not define (`partial` →
//      `mostly partial`).
//      → `every live mission's status parses` still passes (it is a real
//        status, just not a legend one) while the count moves, so `--check`
//        fails — the status is REPORTED, not silently dropped.  That is the
//        point of the `nonLegend` bucket: the two live examples (`mostly done`
//        on M-T4.12, `in progress` on M-T9.42) are visible in the README
//        instead of vanishing from the arithmetic.
//
// The vacuity guard is `parses a real tree`: if the heading regex ever stops
// matching, every count goes to zero and `--check` would compare two agreeing
// zeroes, so the suite asserts a non-trivial denominator first.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs script, no type declarations by design
import { computeCounts, parseStatus, regenerateReadme } from "../../scripts/mission-counts.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const scriptPath = path.join(repoRoot, "scripts/mission-counts.mjs");
const readmePath = path.join(repoRoot, "docs/new-plan/README.md");

type Counts = {
  tracks: { track: string; file: string; live: number; archived: number }[];
  liveTotal: number;
  archivedTotal: number;
  byStatus: Record<string, number>;
  nonLegend: { id: string; status: string; file: string }[];
  duplicates: { id: string; files: string[] }[];
};

describe("mission counts are derived, not hand-typed (§91)", () => {
  it("parses a real tree — the vacuity guard", () => {
    const counts: Counts = computeCounts();
    // Ten track files, and a live count that could not be produced by a regex
    // that matches nothing.
    expect(counts.tracks).toHaveLength(10);
    expect(counts.liveTotal).toBeGreaterThan(100);
    expect(counts.archivedTotal).toBeGreaterThan(50);
  });

  it("--check passes on the committed README (its region matches the headings)", () => {
    expect(() =>
      execFileSync(process.execPath, [scriptPath, "--check"], { cwd: repoRoot, stdio: "pipe" }),
    ).not.toThrow();
  });

  it("regenerating reproduces the committed README exactly", () => {
    const readme = fs.readFileSync(readmePath, "utf8");
    expect(regenerateReadme(readme, computeCounts())).toBe(readme);
  });

  it("every live mission's status parses to something — none is silently absent", () => {
    const counts: Counts = computeCounts();
    const tallied =
      Object.values(counts.byStatus).reduce((a, b) => a + b, 0) + counts.nonLegend.length;
    // Every heading lands in exactly one bucket, so the buckets sum to the
    // total.  A heading whose status the parser cannot find at all would make
    // this short — which is how a malformed heading is caught, rather than
    // quietly shrinking the denominator.
    expect(tallied).toBe(counts.liveTotal);
  });

  it("no mission id appears in two track files", () => {
    // The duplicate `M-T6.60` that shipped in 2026-09 (two live missions, one
    // id) is exactly what this catches; it was found by hand.
    expect(computeCounts().duplicates).toEqual([]);
  });

  it("reads the status out of the headings the naive rules get wrong", () => {
    // Both shapes are live in the tree and both defeat an obvious parser; the
    // arms are pinned here so a future simplification of `parseStatus` fails
    // loudly instead of re-introducing a phantom `null` status.
    // A status whose parenthetical carries its own em-dash:
    expect(
      parseStatus(
        "## M-T1.3 — Charts & the dashboard ceiling — `partial` (reconciled 2026-08-05 — the ledger had gone stale) · **L** · P1",
      ),
    ).toEqual({ raw: "partial", legend: "partial" });
    // A title that IS a backticked identifier:
    expect(
      parseStatus("## M-T2.11 — `encryptedAtRest` — `blocked(proposal)` · **XL** · P3"),
    ).toEqual({ raw: "blocked(proposal)", legend: "blocked" });
    // A bare em-dash in the SIZE field:
    expect(
      parseStatus(
        "## M-T6.11 — Reserved compose slots (was: `PlatformSurface` hooks) — `blocked(T3/T4 features)` · — · P3",
      ),
    ).toEqual({ raw: "blocked(T3/T4 features)", legend: "blocked" });
    // A status outside the legend is reported, not dropped:
    expect(
      parseStatus("## M-T4.12 — Realtime needs a contract — `mostly done` · **M** · P1"),
    ).toEqual({ raw: "mostly done", legend: null });
  });
});

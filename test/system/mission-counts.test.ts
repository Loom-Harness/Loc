// The plan's live-mission counts are derived from the `## M-Tx.y` headings
// under `docs/new-plan/T*.md` and `docs/new-plan/archive/T<n>-done.md` by
// `scripts/mission-counts.mjs` on every run, and never committed: a committed
// copy is a value every mission-touching PR must rewrite, so two such PRs
// always conflict on it, in the PR and again in the merge queue's combined
// tree.  This suite pins the derivation itself and that no copy creeps back
// into the README.
//
// The vacuity guard is `parses a real tree`: if the heading regex ever stops
// matching, every count goes to zero, so the suite asserts a non-trivial
// denominator first.

import fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs script, no type declarations by design
import { computeCounts, parseStatus } from "../../scripts/mission-counts.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
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

  it("the README carries no committed copy of the counts", () => {
    const readme = fs.readFileSync(readmePath, "utf8");
    expect(readme).not.toMatch(/\*\*\d+ live missions\*\*/);
    expect(readme).not.toContain("mission-counts:begin");
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

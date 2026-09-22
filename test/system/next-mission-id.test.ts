// The NEXT-FREE-MISSION-ID check (M-T9.32, the ID half).
//
// Mission ids are minted by hand, in parallel, by agents who each read
// `docs/new-plan/` on `main`. A freshly minted id lives on an OPEN BRANCH for
// hours before it merges, so two agents reading `main` at the same moment
// compute the same "next free" number and both take it. Twice on record:
// M-T6.37 (two PRs in the same hour) and M-T5.37/M-T5.38 in wave C4 itself.
// `main` cannot answer the question, because the answer is not on `main` yet.
//
// `scripts/next-mission-id.mjs` reads both sides. This test drives its PURE
// core with fixtures — the network half is one `fetch` loop around these three
// functions, so a test that mocked GitHub would only be testing the mock.
//
// The four behaviours that matter, each with a way to get it WRONG that this
// pins against:
//
//   1. a HEADING mints an id; a MENTION does not (otherwise every `Relates to
//      M-T9.8` line in an added paragraph would push the next-free number up
//      and the check would drift into uselessness);
//   2. a title/body claim counts even with no heading yet (that is the window
//      the collision happens in);
//   3. two open PRs on one id is a collision, and so is an open PR minting an
//      id that already exists;
//   4. an incomplete run (no token / offline) says so instead of answering.

import { describe, expect, it } from "vitest";
import { collectLocalIds, idsIn, mintedInPatch, report } from "../../scripts/next-mission-id.mjs";

/** A realistic `pulls/:n/files` patch: a mission minted, plus prose that
 *  merely NAMES other ids. */
const PATCH = `@@ -40,6 +40,14 @@
 ## M-T5.9 — Surface hygiene — \`open\` · **S–M** · P2
 (a) the diagnostic; (b) the split.

+## M-T5.41 — A newly minted mission — \`open\` · **S** · P2
+
+Relates to M-T9.8 (hollow work) and supersedes half of M-T5.16.
+Sources: [weak-spots](../audits/weak-spots.md).
+
 ## M-T5.10 — API derivation — \`partial\`
-Old line mentioning M-T5.12.
+New line mentioning M-T5.12.
`;

describe("next-free-mission-id check (M-T9.32)", () => {
  it("an EDITED heading (removed and re-added) is not a mint", () => {
    const patch = [
      "-## M-T6.37 — thing — `open` · **M** · P2",
      "+## M-T6.37 — thing — `done` · **M** · P2",
      "+## M-T6.40 — a genuinely new mission — `open`",
    ].join("\n");
    expect(mintedInPatch(patch)).toEqual([{ track: 6, num: 40 }]);
  });

  it("a HEADING mints an id; a MENTION in the same patch does not", () => {
    expect(mintedInPatch(PATCH)).toEqual([{ track: 5, num: 41 }]);
    // The same text, read as plain mentions, names five ids — which is exactly
    // why the mint rule has to be the heading and not the id regex.
    expect(idsIn(PATCH).length).toBeGreaterThan(4);
    expect(mintedInPatch("")).toEqual([]);
    expect(mintedInPatch(undefined)).toEqual([]);
    // A heading that the patch only CONTEXT-lines (no leading `+`) is already
    // on main and mints nothing.
    expect(mintedInPatch(" ## M-T5.9 — Surface hygiene")).toEqual([]);
    // A REMOVED heading is not a mint either.
    expect(mintedInPatch("-## M-T5.9 — Surface hygiene")).toEqual([]);
  });

  it("the next free id is above BOTH main and the open claims", () => {
    const existing = [
      { track: 5, num: 39 },
      { track: 5, num: 12 },
      { track: 9, num: 65 },
    ];
    const claims = [{ pr: 3020, title: "Mint M-T5.41", ids: [{ track: 5, num: 41 }] }];
    const r = report(existing, claims, true);
    const t5 = r.rows.find((x) => x.track === "T5");
    expect(t5).toEqual({ track: "T5", maxExisting: 39, maxClaimed: 41, nextFree: 42 });
    // A track with no open claim still answers from main.
    expect(r.rows.find((x) => x.track === "T9")?.nextFree).toBe(66);
    expect(r.collisions).toEqual([]);
  });

  it("a claim in the PR TITLE counts before any heading lands", () => {
    // The whole point: the collision window is between "I picked an id" and
    // "my heading is on main".
    const claims = [{ pr: 3021, title: "Claim: M-T9.66 — a new mission", ids: idsIn("M-T9.66") }];
    const r = report([{ track: 9, num: 65 }], claims, true);
    expect(r.rows.find((x) => x.track === "T9")?.nextFree).toBe(67);
  });

  it("names both collision shapes, with the PRs", () => {
    const existing = [{ track: 6, num: 37 }];
    const minted37 = [{ track: 6, num: 37 }];
    const claims = [
      { pr: 100, title: "first claim", ids: [{ track: 6, num: 38 }] },
      { pr: 101, title: "second claim", ids: [{ track: 6, num: 38 }] },
      { pr: 102, title: "re-mints an existing id", ids: minted37, minted: minted37 },
      // A PR that merely MENTIONS an existing mission (a status flip, a
      // cross-reference in its body) is not a collision — the first live run
      // of this script reported eighteen of these on one wave PR.
      { pr: 103, title: "flips M-T6.37 to done", ids: [{ track: 6, num: 37 }] },
    ];
    const r = report(existing, claims, true);
    const kinds = r.collisions.map((c) => `${c.kind}:${c.id}`).sort();
    expect(kinds).toEqual(["already-on-main:M-T6.37", "two-open-prs:M-T6.38"]);
    expect(r.collisions.find((c) => c.kind === "two-open-prs")?.prs.sort()).toEqual([100, 101]);
    expect(r.collisions.find((c) => c.kind === "already-on-main")?.prs).toEqual([102]);
    // Two PRs both touching an EXISTING mission is ordinary, not a collision.
    const both = report(
      existing,
      [
        { pr: 110, title: "slice 1", ids: minted37 },
        { pr: 111, title: "slice 2", ids: minted37 },
      ],
      true,
    );
    expect(both.collisions).toEqual([]);
    // The checked-out branch's own PR does not collide with the ids it minted
    // — the tree HAS them because of that PR.
    const self = report(
      existing,
      [{ pr: 120, title: "the wave PR", ids: minted37, minted: minted37, headRef: "claude/wave" }],
      true,
      "claude/wave",
    );
    expect(self.collisions).toEqual([]);
    // A single PR claiming one id twice (title AND heading) is NOT a collision.
    const single = report(
      [],
      [
        {
          pr: 200,
          title: "M-T7.10",
          ids: [
            { track: 7, num: 10 },
            { track: 7, num: 10 },
          ],
        },
      ],
      true,
    );
    expect(single.collisions).toEqual([]);
  });

  it("an incomplete run is marked incomplete, not answered", () => {
    const r = report([{ track: 1, num: 34 }], [], false);
    expect(r.complete).toBe(false);
    // It still computes the main-only rows — the caller renders the warning —
    // but `complete: false` is what a consumer must key on.
    expect(r.rows.find((x) => x.track === "T1")?.nextFree).toBe(35);
  });

  it("reads the real plan tree, and every track answers above its highest live mission", () => {
    // Vacuum guard + the live wiring: the local half must actually find the
    // tracks, or every assertion above is about fixtures only.
    const existing = collectLocalIds();
    expect(existing.length).toBeGreaterThan(200);
    const r = report(existing, [], false);
    expect(r.rows.length).toBeGreaterThanOrEqual(9);
    for (const row of r.rows) {
      expect(row.maxExisting, `${row.track} found no mission heading`).toBeGreaterThan(0);
      expect(row.nextFree).toBe(row.maxExisting + 1);
    }
    // The two ids the known collisions burned exist, so a next-free answer of
    // T6.37 or T5.38 would be the bug this check prevents.
    expect(r.rows.find((x) => x.track === "T6")!.nextFree).toBeGreaterThan(37);
    expect(r.rows.find((x) => x.track === "T5")!.nextFree).toBeGreaterThan(38);
  });
});

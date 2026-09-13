import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ---------------------------------------------------------------------------
// An UNBALANCED conflict marker is a botched merge resolution that shipped.
//
// `main` carried one: `docs/new-plan/T8-dx-tooling-ai.md` ended a mission with
//
//     >>>>>>> a4e41edc8 (An independent audit, run without reading the ones ...)
//
// and no `<<<<<<<` anywhere above it — a resolution that deleted the opening
// half and committed the closing half.  Nothing caught it, and `docs/build.mjs`
// renders that file to GitHub Pages, so the published roadmap showed a raw git
// marker to every reader.
//
// THE RULE, and why it is this one.  A `>>>>>>> ` line with no `<<<<<<< `
// before it in the same file cannot be anything but a mistake.  The naive rule
// — "no conflict markers in tracked files" — is wrong here and would have
// needed a waiver list: `docs/old/proposals/i18n.md` and `i18n-strings.md`
// DOCUMENT three-way merge output, and legitimately print
//
//     <<<<<<< OURS
//     ...
//     >>>>>>> THEIRS
//
// inside fenced blocks.  Those are balanced, so the balance rule passes them
// without an entry, and a waiver list that has to hold legitimate prose is a
// list that rots.  Measured across every tracked text file at the time of
// writing: the balance rule produced exactly ONE hit and it was the real
// defect, so there is no waiver list at all.
//
// Balance, not pairing-by-position: this deliberately does not try to match
// each marker to its own hunk.  The cheap invariant catches the whole observed
// defect class (a half-resolved conflict) without a parser that would itself
// need testing.
// ---------------------------------------------------------------------------

const SKIP_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".pdf",
  ".zip",
  ".gz",
  ".jar",
]);

function trackedTextFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: REPO,
    maxBuffer: 64 * 1024 * 1024,
  }).toString("utf8");
  return out
    .split("\0")
    .filter(Boolean)
    .filter((f) => !SKIP_EXT.has(path.extname(f).toLowerCase()));
}

describe("conflict-marker census", () => {
  const files = trackedTextFiles();

  // Guard against passing by vacuum: a scan that reaches nothing is green and
  // blind, which is how gates have read here before (experience_gathered §59).
  it("the scan actually reaches the tracked corpus", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain("docs/new-plan/T8-dx-tooling-ai.md");
  });

  it("no tracked file carries an unbalanced conflict marker", () => {
    const offenders: string[] = [];
    let filesWithMarkers = 0;

    for (const rel of files) {
      let text: string;
      try {
        text = fs.readFileSync(path.join(REPO, rel), "utf8");
      } catch {
        continue; // unreadable / removed in a dirty tree — not this gate's business
      }
      if (!text.includes("<<<<<<< ") && !text.includes(">>>>>>> ")) continue;

      const lines = text.split("\n");
      const opens = lines.filter((l) => l.startsWith("<<<<<<< ")).length;
      const closes = lines.filter((l) => l.startsWith(">>>>>>> ")).length;
      if (opens > 0 || closes > 0) filesWithMarkers++;
      if (opens === closes) continue;

      const firstStray = lines.findIndex(
        (l) => l.startsWith(">>>>>>> ") || l.startsWith("<<<<<<< "),
      );
      offenders.push(
        `${rel}:${firstStray + 1} — ${opens} opening vs ${closes} closing marker(s): ` +
          `${lines[firstStray]?.slice(0, 80)}`,
      );
    }

    // The rule is only meaningful if marker-bearing files exist at all — the
    // i18n proposals document merge output on purpose and must stay reachable,
    // otherwise this test could go green by never seeing a marker.
    expect(filesWithMarkers).toBeGreaterThan(0);

    expect(
      offenders,
      `Unbalanced conflict marker(s) — a half-resolved merge:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

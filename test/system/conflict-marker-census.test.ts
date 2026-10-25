import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ---------------------------------------------------------------------------
// An UNBALANCED conflict marker is a botched merge resolution that shipped:
// a `>>>>>>> <sha> (…)` line with no `<<<<<<<` above it is a resolution that
// deleted the opening half and committed the closing half.
//
// THE RULE, and why it is this one.  A `>>>>>>> ` line with no `<<<<<<< `
// before it in the same file cannot be anything but a mistake.  The naive rule
// — "no conflict markers in tracked files" — would need a waiver list for prose
// that DOCUMENTS three-way merge output (the i18n `sync` merge prints
//
//     <<<<<<< OURS
//     ...
//     >>>>>>> THEIRS
//
// inside fenced blocks).  Those are balanced, so the balance rule passes them
// without an entry, and a waiver list that has to hold legitimate prose is a
// list that rots.
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

/** `null` when `text`'s conflict markers balance, else a one-line finding. */
function unbalancedMarkers(text: string): string | null {
  if (!text.includes("<<<<<<< ") && !text.includes(">>>>>>> ")) return null;
  const lines = text.split("\n");
  const opens = lines.filter((l) => l.startsWith("<<<<<<< ")).length;
  const closes = lines.filter((l) => l.startsWith(">>>>>>> ")).length;
  if (opens === closes) return null;
  const firstStray = lines.findIndex((l) => l.startsWith(">>>>>>> ") || l.startsWith("<<<<<<< "));
  return (
    `${firstStray + 1} — ${opens} opening vs ${closes} closing marker(s): ` +
    `${lines[firstStray]?.slice(0, 80)}`
  );
}

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
    expect(files).toContain("CLAUDE.md");
  });

  // The rule must be able to fire: no tracked file carries a marker today, so
  // the corpus alone cannot prove the detector is not blind.
  it("the rule flags a half-resolved merge and passes documented merge output", () => {
    expect(unbalancedMarkers("a\n>>>>>>> a4e41edc8 (msg)\nb\n")).not.toBeNull();
    expect(unbalancedMarkers("<<<<<<< OURS\nx\n=======\ny\n>>>>>>> THEIRS\n")).toBeNull();
    expect(unbalancedMarkers("no markers here\n")).toBeNull();
  });

  it("no tracked file carries an unbalanced conflict marker", () => {
    const offenders: string[] = [];
    for (const rel of files) {
      let text: string;
      try {
        text = fs.readFileSync(path.join(REPO, rel), "utf8");
      } catch {
        continue; // unreadable / removed in a dirty tree — not this gate's business
      }
      const finding = unbalancedMarkers(text);
      if (finding) offenders.push(`${rel}:${finding}`);
    }
    expect(
      offenders,
      `Unbalanced conflict marker(s) — a half-resolved merge:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

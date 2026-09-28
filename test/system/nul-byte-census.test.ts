import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ---------------------------------------------------------------------------
// A raw NUL byte in a SOURCE file makes the whole file invisible to `grep`.
//
// `grep` (and `git grep`, and ripgrep, and every tool built on them) decides a
// file is *binary* by looking for a NUL byte in its first block.  A binary file
// is not searched — it is reported as `Binary file … matches`, or under `-I`
// skipped in silence.  So one NUL byte anywhere near the top of a `.ts` file
// silently removes that file from **every grep-based census in this repo**.
//
// That is not hypothetical.  Four tracked files carried exactly one NUL each,
// all of them a deliberate composite-key separator written as the BYTE instead
// of the two-character escape:
//
//   | file | line | expression |
//   |---|---|---|
//   | `src/system/migrations-builder.ts` | 581 | `` `${schema ?? ""}\0${name}` `` |
//   | `src/ir/util/policy-decision-id.ts` | 43 | `` `${target}\0${gateSource}` `` |
//   | `src/ir/validate/checks/structural-checks.ts` | 1426 | `` `${location}\0${resourceName}.${verb}` `` |
//   | `scripts/quality-delta.mjs` | 457 | `const FIELD = "\0"` |
//
// The first three are M-T9.53's finding; the fourth is this check's first
// independent catch — the mission named three and a repo-wide scan found a
// fourth, which is the whole argument for scanning instead of listing.
//
// The FIX is a two-character source change with NO behavioural difference: the
// escape `\0` denotes U+0000 exactly as the embedded byte did, so every key,
// hash and snapshot built from it is byte-identical.  Which is precisely why
// this was easy to leave alone for so long, and why a gate — not a one-time
// sweep — is the deliverable.
//
// HOW THE COST SHOWED UP.  Wave C4 packet 4e's consumer sweep over
// `src/ir/validate/**` came back with `grep: … binary file matches` for
// `structural-checks.ts` — a *line of output*, not a row of results — so the
// file dropped out of that census without anyone noticing it had.
//
// THE RULE.  No tracked file under `src/`, `test/`, `docs/` or `scripts/` may
// contain a NUL byte.  There is deliberately NO waiver list: every tracked file
// under those four roots is text by construction (images and fonts live in
// `web/`, `designs/` and the template dirs, all outside the scanned roots), so
// the rule is exact at zero and a first offender is always a defect.  If a
// genuine binary fixture is ever needed under one of these roots, the honest
// move is to place it outside them or give this check an explicit, reasoned
// entry — not to loosen the rule to "only `src/`".
// ---------------------------------------------------------------------------

/** Roots that are text-only by construction. */
const SCANNED_ROOTS = ["src", "test", "docs", "scripts"];

function trackedFiles(roots: string[]): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", ...roots], {
    cwd: REPO,
    maxBuffer: 256 * 1024 * 1024,
  })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

/** The rule itself, over an explicit file list, resolved against `base`.  The
 *  mutation proof drives THIS function against a seeded file rather than a
 *  hand-written duplicate of the rule, so the proof and the live assertion
 *  cannot drift apart. */
function nulOffenders(files: string[], base: string): string[] {
  const offenders: string[] = [];
  for (const rel of files) {
    let buf: Buffer;
    try {
      buf = fs.readFileSync(path.join(base, rel));
    } catch {
      continue; // removed in a dirty tree — not this gate's business
    }
    const at = buf.indexOf(0);
    if (at < 0) continue;
    const line = buf.subarray(0, at).toString("latin1").split("\n").length;
    let total = 0;
    for (const byte of buf) if (byte === 0) total++;
    offenders.push(
      `${rel}:${line} — ${total} NUL byte(s), first at offset ${at}. ` +
        "Write the separator as the escape \\0 (or \\u0000) instead of the raw byte; " +
        "the runtime string is identical and the file stops being invisible to grep.",
    );
  }
  return offenders;
}

describe("NUL-byte census (M-T9.53)", () => {
  const files = trackedFiles(SCANNED_ROOTS);

  // Guard against passing by vacuum: a scan that reaches nothing is green and
  // blind, which is how gates have read here before (experience_gathered §59).
  it("the scan actually reaches the tracked corpus", () => {
    expect(files.length).toBeGreaterThan(2000);
    for (const root of SCANNED_ROOTS) {
      expect(
        files.some((f) => f.startsWith(`${root}/`)),
        `the scan reached no file under ${root}/`,
      ).toBe(true);
    }
    // The four files the mission named must be IN the scanned set, by name —
    // otherwise a future edit to the root list could drop them while the gate
    // still read green.
    for (const named of [
      "src/system/migrations-builder.ts",
      "src/ir/util/policy-decision-id.ts",
      "src/ir/validate/checks/structural-checks.ts",
      "scripts/quality-delta.mjs",
    ]) {
      expect(files, `${named} is no longer in the scanned set`).toContain(named);
    }
  });

  it("the rule fires on a file that carries a NUL byte, and grep skips that file", () => {
    // Proved against a file written for the purpose, so the live assertion
    // below can be an exact zero without also being unproven.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-nul-census-"));
    try {
      fs.writeFileSync(path.join(dir, "probe.ts"), 'export const k = "a\0b";\n');
      fs.writeFileSync(path.join(dir, "clean.ts"), 'export const k = "a-b";\n');

      const hits = nulOffenders(["probe.ts", "clean.ts"], dir);
      expect(hits).toHaveLength(1);
      expect(hits[0]).toContain("probe.ts:1");
      expect(hits[0]).toContain("1 NUL byte(s)");

      // …and the cost the rule exists to prevent: `grep -lI` reaches the clean
      // file and silently skips the NUL-bearing one, although BOTH contain the
      // searched text.
      const grepped = execFileSync(
        "bash",
        ["-c", "grep -lI -e 'export const k' probe.ts clean.ts || true"],
        { cwd: dir, encoding: "utf8" },
      ).trim();
      expect(grepped).toBe("clean.ts");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no tracked source file carries a NUL byte", () => {
    expect(
      nulOffenders(files, REPO),
      "A NUL byte makes the whole file binary to grep, so it silently drops out of " +
        "every grep-based census in the repo (M-T9.53):",
    ).toEqual([]);
  });
});

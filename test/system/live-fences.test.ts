// The live-fence register (test/_helpers/live-fences.ts) stays honest both ways.
//
// Offline (every run): each row is cited by at least one reader, so a fence
// nobody stands behind cannot mislead the next reader into thinking work is
// claimed.  Nightly (`LOOM_CENSUS_ONLINE=1`, test.yml `census-online`): each
// row is an issue or PR GitHub reports open.  The nightly leg never runs on a
// PR or in the merge queue: closing an issue must not turn an unrelated queue
// entry red; it fails the night after, and the main-red alarm reports it.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fenceFileProblem, fenceProblem, LIVE_FENCES } from "../_helpers/live-fences.js";

/** Every file that may cite a fence: the gap register and the test/system
 *  censuses that defer on one. */
function readerText(): string {
  const sys = readdirSync("test/system")
    .filter((f) => f.endsWith(".ts") && f !== "live-fences.test.ts")
    .map((f) => readFileSync(join("test/system", f), "utf8"));
  return [
    readFileSync("src/diagnostics/unsupported-register.ts", "utf8"),
    readFileSync("test/support/fakes/coverage.ts", "utf8"),
    readFileSync("test/behavioral/registers.mjs", "utf8"),
    ...sys,
  ].join("\n");
}

describe("live-fence register", () => {
  it("every fence is cited by a register row or a census waiver", () => {
    const text = readerText();
    const unused = Object.keys(LIVE_FENCES).filter((ref) => !text.includes(`"${ref}"`));
    expect(unused, "fences nothing cites — delete the file").toEqual([]);
  });

  it("refuses a misnamed or multi-line fence file", () => {
    expect(fenceFileProblem("5994.txt", "Shared ledgers\n")).toBe("");
    expect(fenceFileProblem("5994.md", "Shared ledgers\n")).toMatch(
      /is named <issue or PR number>\.txt/,
    );
    expect(fenceFileProblem("5994.txt", "Shared\nledgers\n")).toMatch(/title on one line/);
    expect(fenceFileProblem("5994.txt", "")).toMatch(/title on one line/);
  });

  it("refuses a reference that is not registered, and a malformed one", () => {
    expect(fenceProblem("#1")).toMatch(/is not a live fence/);
    expect(fenceProblem("M-T1.2")).toMatch(/not an issue or PR reference/);
    const [first] = Object.keys(LIVE_FENCES);
    expect(fenceProblem(first)).toBe("");
  });

  it.runIf(process.env.LOOM_CENSUS_ONLINE === "1")(
    "every fence is open on GitHub",
    async () => {
      const closed: string[] = [];
      for (const ref of Object.keys(LIVE_FENCES)) {
        const res = await fetch(
          `https://api.github.com/repos/Loom-Harness/Loc/issues/${ref.slice(1)}`,
          {
            headers: process.env.GITHUB_TOKEN
              ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
              : {},
          },
        );
        expect(res.ok, `GitHub answered ${res.status} for ${ref}`).toBe(true);
        if ((await res.json()).state === "closed") closed.push(ref);
      }
      expect(closed, "closed fences — delete their rows and settle what cited them").toEqual([]);
    },
    120_000,
  );
});

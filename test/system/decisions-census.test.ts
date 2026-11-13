import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

// Each pinned decision is one file, `docs/decisions/<stem>.md`, so two changes
// that each pin a decision add different files and never conflict.  The stem
// is the decision's tag (`D-FOO`), and the file's first line is its heading,
// `# <tag> — <title>` (or `# <tag>` alone); links name the file, so a heading that drifts from its
// file name, or two files carrying one tag, would leave a link pointing at the
// wrong decision.

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/decisions");

/** The file stem a decision heading's tag maps to. */
export function stemOfHeading(firstLine: string): string | undefined {
  const m = /^# (.+?)(?: — |$)/.exec(firstLine);
  return m?.[1]?.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Problems with a set of `{ file, firstLine }` decision files. */
export function decisionProblems(files: readonly { file: string; firstLine: string }[]): string[] {
  const out: string[] = [];
  const seen = new Map<string, string>();
  for (const { file, firstLine } of files) {
    const stem = stemOfHeading(firstLine);
    const want = file.replace(/\.md$/, "");
    if (!stem) out.push(`${file}: first line is not \`# <tag> — <title>\``);
    else if (stem !== want) out.push(`${file}: heading tag maps to ${stem}.md`);
    if (stem) {
      const other = seen.get(stem);
      if (other) out.push(`${file}: tag ${stem} is also ${other}`);
      seen.set(stem, file);
    }
  }
  return out;
}

describe("decisions census", () => {
  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".md"))
    .map((file) => ({
      file,
      firstLine: fs.readFileSync(path.join(DIR, file), "utf8").split("\n")[0] ?? "",
    }));

  it("scans the decisions directory", () => {
    expectReach("decision files", files.length, 120);
  });

  it("every decision file is named after its heading's tag, and no tag repeats", () => {
    expect(decisionProblems(files)).toEqual([]);
  });

  it("refuses a mismatched name and a repeated tag (positive control)", () => {
    expect(
      decisionProblems([
        { file: "D-A.md", firstLine: "# D-A — title" },
        { file: "D-B.md", firstLine: "# D-C — title" },
        { file: "D-X.md", firstLine: "no heading" },
      ]),
    ).toEqual([
      "D-B.md: heading tag maps to D-C.md",
      "D-X.md: first line is not `# <tag> — <title>`",
    ]);
    expect(
      decisionProblems([
        { file: "D-A.md", firstLine: "# D-A — one" },
        { file: "D-A.md", firstLine: "# D-A — two" },
      ]),
    ).toEqual(["D-A.md: tag D-A is also D-A.md"]);
  });
});

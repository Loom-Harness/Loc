// A universal claim in a reference doc names what holds it.
//
// A paragraph of a reference doc that says a thing holds on every backend
// must either be specific (name the plan module that decides it, or the
// backends it holds for) or carry a marker on its own line directly after it:
//
//   <!-- gate: `test/…/a.test.ts`, `test/fixtures/corpus/x.ddd` -->
//   <!-- review: docs/review-checklist.md#<anchor> -->
//   <!-- tracked: #NNNN — <what a gate would assert> -->
//
// A gate path must exist and run in CI, a review anchor must be a checklist
// section, and `tracked` names a live fence.  CLAUDE.md, which every session
// loads, carries no markers: its universal claims point at the reference doc
// that carries one, so a phrase hit there fails outright.
//
// The phrase list is a TRIPWIRE, not a proof: it finds the usual spellings of
// a universal claim, and a reviewer extends CLAIM_PHRASES when a new spelling
// slips past it.  Deterministic: committed files only.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CHECKLIST,
  checklistSections,
  ciRunProblem,
  ciText,
  readRepo,
} from "../_helpers/gate-paths.js";
import { fenceProblem } from "../_helpers/live-fences.js";

/** The spellings of a universal cross-backend claim this check trips on. */
const CLAIM_PHRASES: readonly RegExp[] = [
  /\bevery backend\b/i,
  /\ball five\b/i,
  /\bevery one of the five\b/i,
  /\bbit-for-bit\b/i,
];

/** The reference docs held to markers. */
const MARKED_DOCS: readonly string[] = [
  "docs/auth.md",
  "docs/generators.md",
  "docs/migrations.md",
  "docs/platforms.md",
  "docs/tenancy.md",
  "docs/workflow.md",
];

/** Docs a universal claim may not appear in at all. */
const NO_CLAIM_DOCS: readonly string[] = ["CLAUDE.md"];

const MARKER = /^\s*<!-- (gate|review|tracked): (.+?) -->\s*$/;

interface Block {
  readonly line: number;
  readonly text: string;
  readonly marker?: { readonly kind: string; readonly body: string };
}

/** Prose blocks (blank-line separated, fenced code skipped), each with the
 *  marker that closes it: a marker line inside the block's tail or the line
 *  directly after it. */
function blocks(md: string): Block[] {
  const lines = md.split("\n");
  const out: Block[] = [];
  let fence = false;
  let start = -1;
  const close = (end: number) => {
    if (start < 0) return;
    const body = lines.slice(start, end);
    const prose = body.filter((l) => !MARKER.test(l));
    const markerLine =
      body.find((l) => MARKER.test(l)) ??
      (MARKER.test(lines[end + 1] ?? "") ? lines[end + 1] : undefined);
    const m = markerLine ? MARKER.exec(markerLine) : null;
    out.push({
      line: start + 1,
      text: prose.join("\n"),
      ...(m ? { marker: { kind: m[1], body: m[2] } } : {}),
    });
    start = -1;
  };
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) {
      close(i);
      fence = !fence;
      return;
    }
    if (fence) return;
    if (l.trim() === "") close(i);
    else if (start < 0) start = i;
  });
  close(lines.length);
  return out;
}

const claims = (text: string) => CLAIM_PHRASES.some((p) => p.test(text));

/** What is wrong with one marker (empty when nothing is). */
function markerProblems(
  where: string,
  m: NonNullable<Block["marker"]>,
  read: (p: string) => string | undefined,
  ci: string,
  fence: (ref: string) => string,
): string[] {
  if (m.kind === "tracked") {
    const issue = /^(#\d+) — .+$/.exec(m.body)?.[1];
    if (!issue)
      return [`${where}: a tracked marker is \`tracked: #N — <what a gate would assert>\``];
    const problem = fence(issue);
    return problem ? [`${where}: ${problem}`] : [];
  }
  if (m.kind === "review") {
    const [doc, anchor] = m.body.split("#");
    if (doc !== CHECKLIST || !anchor)
      return [`${where}: a review marker points into ${CHECKLIST}#<anchor>`];
    return checklistSections(read(doc) ?? "").has(anchor)
      ? []
      : [`${where}: ${CHECKLIST} has no section #${anchor}`];
  }
  const paths = [...m.body.matchAll(/`([^`]+)`/g)].map((x) => x[1] as string);
  if (paths.length === 0) return [`${where}: a gate marker names its tests in backticks`];
  return paths.flatMap((p) => {
    const src = read(p);
    if (src === undefined) return [`${where}: \`${p}\` does not exist`];
    const dead = ciRunProblem(p, src, ci);
    return dead ? [`${where}: \`${p}\` ${dead}`] : [];
  });
}

/** Every unmarked universal claim and every bad marker in one doc. */
function docProblems(
  path: string,
  md: string,
  opts: {
    markers: boolean;
    read: (p: string) => string | undefined;
    ci: string;
    fence: (ref: string) => string;
  },
): string[] {
  return blocks(md).flatMap((b) => {
    const where = `${path}:${b.line}`;
    if (!opts.markers) {
      if (b.marker)
        return [`${where}: ${path} carries no markers — point at the reference doc instead`];
      return claims(b.text)
        ? [
            `${where}: a universal claim in ${path} — reword it, or point at the reference doc that gates it`,
          ]
        : [];
    }
    if (b.marker) return markerProblems(where, b.marker, opts.read, opts.ci, opts.fence);
    return claims(b.text)
      ? [
          `${where}: a universal claim with no marker — make it specific (the plan module, or the backends it holds for), ` +
            "or add `<!-- gate|review|tracked: … -->` on its own line after the paragraph",
        ]
      : [];
  });
}

const CI = ciText();
const live = { read: readRepo, ci: CI, fence: fenceProblem };

describe("reference-doc claims name what holds them", () => {
  it("every universal claim in a reference doc is specific or marked, and every marker holds", () => {
    expect(
      MARKED_DOCS.flatMap((d) =>
        docProblems(d, readFileSync(d, "utf8"), { markers: true, ...live }),
      ),
    ).toEqual([]);
  });

  it("CLAUDE.md makes no universal claim and carries no marker", () => {
    expect(
      NO_CLAIM_DOCS.flatMap((d) =>
        docProblems(d, readFileSync(d, "utf8"), { markers: false, ...live }),
      ),
    ).toEqual([]);
  });

  it("refuses an unmarked claim, a dead gate, a missing anchor and a closed fence (positive control)", () => {
    const read = (p: string) =>
      ({ "test/a.test.ts": 'it("x", () => {});', [CHECKLIST]: "### D-X\nA reviewer checks x.\n" })[
        p
      ];
    const fence = (ref: string) => (ref === "#1" ? "" : `${ref} is not a live fence`);
    const run = (md: string, markers = true) =>
      docProblems("d.md", md, { markers, read, ci: "", fence });
    expect(run("Every backend sorts the rows.\n")).toHaveLength(1);
    expect(run("Drizzle and EF sort the rows.\n")).toEqual([]);
    expect(run("Every backend sorts the rows.\n<!-- gate: `test/a.test.ts` -->\n")).toEqual([]);
    expect(run("Every backend sorts the rows.\n\n<!-- gate: `test/a.test.ts` -->\n")).toEqual([]);
    expect(
      run("- Every backend sorts the rows.\n  <!-- tracked: #1 — order is asserted -->\n"),
    ).toEqual([]);
    expect(run("Every backend sorts the rows.\n<!-- gate: `test/gone.test.ts` -->\n")[0]).toMatch(
      /does not exist/,
    );
    expect(
      run("Every backend sorts the rows.\n<!-- review: docs/review-checklist.md#d-y -->\n")[0],
    ).toMatch(/has no section/);
    expect(run("Every backend sorts the rows.\n<!-- tracked: #2 — order -->\n")[0]).toMatch(
      /not a live fence/,
    );
    expect(run("```\nevery backend\n```\n")).toEqual([]);
    expect(run("All five backends sort.\n", false)).toHaveLength(1);
    expect(run("Sorted.\n<!-- gate: `test/a.test.ts` -->\n", false)[0]).toMatch(
      /carries no markers/,
    );
  });
});

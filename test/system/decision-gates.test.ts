// Every decision record names the gate that enforces it.
//
// A ruling about how generated code behaves protects nothing unless a test
// observes it, or — where a gate is impractical — a reviewer checks it against
// a checklist every session is told to read.  So each `docs/decisions/D*.md`
// ends with one line, its last non-blank line, in one of three tiers:
//
//   gate:      **Enforced by:** `test/…/a.test.ts`, `test/fixtures/corpus/x.ddd`
//   review:    **Enforced by:** review — `docs/review-checklist.md#<tag>` — <why a gate is impractical>
//   not built: **Enforced by:** none, tracked by #NNNN — <why there is no gate yet>
//   superseded: **Enforced by:** superseded by `D-<TAG>`
//
// A gate path must exist, must name the record's tag in its header — the
// comment lines above its first line of code, or for a corpus fixture its
// `.corpus.json` sidecar — so the link holds from both ends and survives a
// rename of either, and must run in CI.  A superseded record names the record
// that replaced it, which must exist and not be superseded itself.  A
// review anchor must be a section of the checklist that names the tag, and
// every checklist section must be pointed at by its record.  `tracked by`
// names a live fence (`test/_helpers/live-fences.ts`), so the deferral
// expires with its issue.  The not-built records are pinned in NOT_BUILT
// below: the set only shrinks, and a new one is a reviewed line here.  The
// review tier is not forced to shrink; moving a record from gate to review is
// a reviewed change of its line.
//
// Deterministic: it reads committed files only — no network, no clock.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fenceProblem } from "../_helpers/live-fences.js";

const DIR = "docs/decisions";
const LINE = /^\*\*Enforced by:\*\* (.+)$/;
const NONE_TRACKED = /^none, tracked by (#\d+) — (.+)$/;
const SUPERSEDED = /^superseded by `(D[-0-9][A-Z0-9-]*)`$/;
const REVIEW = /^review — `([^`#]+)#([a-z0-9-]+)` — (.+)$/;
/** The one checklist review-tier records point into; the runbook sends every
 *  session to it. */
const CHECKLIST = "docs/review-checklist.md";
const GATES = /^`[^`]+`(?:, `[^`]+`)*$/;

/** The records with no gate built yet, sorted, one per line.  Shrink-only. */
const NOT_BUILT: readonly string[] = [
  "D-API-TOOLKIT",
  "D-CROSSTENANT-ACK",
  "D-CTX-SHAPE",
  "D-ENVELOPE",
  "D-FORM-BINDS-ACTION",
  "D-GRANULARITY",
  "D-LIFECYCLE-SHAPE",
  "D-MIG-DSL-STEPS",
  "D-MIG-NO-DOWN",
  "D-MISC-C0",
  "D-MODAL-CONTROLLED-OP-FORM",
  "D-POLYMORPHIC-ID-REPRESENTATION",
  "D-TPH-BEATS-SHAPE",
];

type Enforcement =
  | { kind: "gates"; paths: string[] }
  | { kind: "tracked"; issue: string; reason: string }
  | { kind: "review"; doc: string; anchor: string; reason: string }
  | { kind: "superseded"; by: string };

/** The record's enforcement line, parsed, or what is wrong with it. */
function parseEnforcement(text: string): Enforcement | string {
  const lines = text.split("\n");
  const marked = lines.filter((l) => l.startsWith("**Enforced by:**"));
  if (marked.length === 0) return "no `**Enforced by:**` line";
  if (marked.length > 1) return `${marked.length} \`**Enforced by:**\` lines — keep one`;
  const last = [...lines].reverse().find((l) => l.trim() !== "") ?? "";
  if (!last.startsWith("**Enforced by:**"))
    return "the `**Enforced by:**` line is not the record's last line";
  const body = LINE.exec(last)?.[1] ?? "";
  const tracked = NONE_TRACKED.exec(body);
  if (tracked) return { kind: "tracked", issue: tracked[1], reason: tracked[2] };
  const superseded = SUPERSEDED.exec(body);
  if (superseded) return { kind: "superseded", by: superseded[1] };
  const review = REVIEW.exec(body);
  if (review) return { kind: "review", doc: review[1], anchor: review[2], reason: review[3] };
  if (GATES.test(body))
    return { kind: "gates", paths: [...body.matchAll(/`([^`]+)`/g)].map((m) => m[1]) };
  return (
    "the line must be `**Enforced by:** `<path>`, …`, " +
    "`**Enforced by:** review — `docs/review-checklist.md#<tag>` — <why>` or " +
    "`**Enforced by:** none, tracked by #N — <why>` or `**Enforced by:** superseded by `D-<TAG>``"
  );
}

/** Why a named gate never runs in CI (empty when it does): a test file the
 *  fast suite does not collect, one whose every test is skipped or `todo`, an
 *  env-gated suite no workflow runs, a corpus fixture with no sidecar, or a
 *  script no workflow calls.  `ci` is the text of the workflows plus the
 *  package scripts they invoke. */
function ciRunProblem(path: string, src: string, ci: string): string {
  if (/^test\/fixtures\/corpus\/[a-z0-9-]+\.ddd$/.test(path))
    return existsSync(path.replace(/\.ddd$/, ".corpus.json"))
      ? ""
      : "is a corpus fixture with no sidecar, so no corpus leg runs it";
  if (/^test\/behavioral\/systems\/[a-z0-9-]+\.ddd$/.test(path)) return "";
  if (/^scripts\//.test(path)) return ci.includes(path) ? "" : "is a script no workflow runs";
  if (!/^(test|packages)\/.+\.test\.ts$/.test(path) || path.startsWith("test/fixtures/"))
    return "is neither a test file the suite collects, a corpus or behavioural fixture, nor a CI script";
  const active =
    src.match(
      /\b(?:it|test)(?:\.each\([^)]*\)|\.runIf\([^)]*\)|\.skipIf\([^)]*\)|\.concurrent)?\(\s*["'`]/g,
    ) ?? [];
  if (/\bdescribe\.(?:skip|todo)\(/.test(src) || active.length === 0)
    return "has no test that runs (every test is skipped or todo)";
  const envGated =
    /\b(?:describe|it|test)\.(?:skipIf|runIf)\(/.test(src) &&
    /process\.env\.LOOM_|ENABLED/.test(src);
  if (envGated && !ci.includes(path) && !ci.includes(path.split("/").pop() as string))
    return "is env-gated and no workflow (or package script a workflow runs) names it";
  return "";
}

/** Where a gate names the decisions it enforces: a corpus fixture's sidecar,
 *  else the file's header — its leading comment and blank lines. */
function headerOf(path: string, read: (path: string) => string | undefined): string {
  if (/^test\/fixtures\/corpus\/[a-z0-9-]+\.ddd$/.test(path))
    return read(path.replace(/\.ddd$/, ".corpus.json")) ?? "";
  const lines = (read(path) ?? "").split("\n");
  const end = lines.findIndex((l) => !/^\s*(?:\/\/|\/\*|\*|$)/.test(l));
  return lines.slice(0, end < 0 ? lines.length : end).join("\n");
}

/** The checklist's sections by anchor (a heading's GitHub slug) → their text,
 *  heading included, up to the next heading of any level. */
function checklistSections(md: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = md.split(/^(?=#{1,6} )/m);
  for (const part of parts) {
    const heading = /^#{1,6} (.+)$/m.exec(part)?.[1];
    if (!heading || !part.startsWith("#")) continue;
    const slug = heading
      .toLowerCase()
      .replace(/[^a-z0-9 -]/g, "")
      .replace(/ /g, "-");
    out.set(slug, part);
  }
  return out;
}

/** What is wrong with one record's enforcement (empty when nothing is). */
function recordProblems(
  tag: string,
  text: string,
  read: (path: string) => string | undefined,
  fence: (ref: string) => string = fenceProblem,
  ci = "",
): string[] {
  const e = parseEnforcement(text);
  if (typeof e === "string") return [`${tag}: ${e}`];
  if (e.kind === "tracked") {
    const problem = fence(e.issue);
    return problem ? [`${tag}: ${problem}`] : [];
  }
  const tagWord = new RegExp(`(^|[^A-Z0-9-])${tag}(?![A-Z0-9-])`);
  if (e.kind === "superseded") {
    const target = read(`${DIR}/${e.by}.md`);
    if (target === undefined) return [`${tag}: superseded by ${e.by}, which has no record`];
    const t = parseEnforcement(target);
    return typeof t !== "string" && t.kind === "superseded"
      ? [
          `${tag}: superseded by ${e.by}, which is itself superseded by ${t.by} — name the live record`,
        ]
      : [];
  }
  if (e.kind === "review") {
    if (e.doc !== CHECKLIST)
      return [`${tag}: a review line points into ${CHECKLIST}, not \`${e.doc}\``];
    const section = checklistSections(read(e.doc) ?? "").get(e.anchor);
    if (section === undefined) return [`${tag}: ${e.doc} has no section \`#${e.anchor}\``];
    return tagWord.test(section) ? [] : [`${tag}: ${e.doc}#${e.anchor} does not name ${tag}`];
  }
  const out: string[] = [];
  for (const p of e.paths) {
    const src = read(p);
    if (src === undefined) {
      out.push(`${tag}: \`${p}\` does not exist`);
      continue;
    }
    if (!tagWord.test(headerOf(p, read)))
      out.push(
        `${tag}: \`${p}\` does not name ${tag} in its header — name the decision in the file's top comment (a corpus fixture: its .corpus.json "//")`,
      );
    const dead = ci === "" ? "" : ciRunProblem(p, src, ci);
    if (dead) out.push(`${tag}: \`${p}\` ${dead}`);
  }
  return out;
}

const tags = readdirSync(DIR)
  .filter((f) => /^D[-0-9][A-Z0-9-]*\.md$/.test(f))
  .map((f) => f.slice(0, -3))
  .sort();
const textOf = (tag: string) => readFileSync(join(DIR, `${tag}.md`), "utf8");
const readRepo = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : undefined);

/** The workflows, plus every package script a workflow names (as `npm run x`
 *  or in a matrix list of script names). */
function ciText(): string {
  const wf = readdirSync(".github/workflows")
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => readFileSync(join(".github/workflows", f), "utf8"))
    .join("\n");
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<
    string,
    string
  >;
  const invoked = Object.entries(scripts)
    .filter(([name]) =>
      new RegExp(`(?:^|[\\s"'])${name.replace(/[:.]/g, "\\$&")}(?=$|[\\s"'])`, "m").test(wf),
    )
    .map(([, cmd]) => cmd);
  return [wf, ...invoked].join("\n");
}
const CI = ciText();

describe("decision records name their gate", () => {
  it("reads every record (guard against a vacuous pass)", () => {
    expect(tags.length).toBeGreaterThan(100);
  });

  it("every record's gate exists and names the decision, or the record says why there is none", () => {
    expect(tags.flatMap((t) => recordProblems(t, textOf(t), readRepo, fenceProblem, CI))).toEqual(
      [],
    );
  });

  it("the not-built records are exactly the pinned ones, and the set only shrinks", () => {
    const notBuilt = tags.filter((t) => {
      const e = parseEnforcement(textOf(t));
      return typeof e !== "string" && e.kind === "tracked";
    });
    expect(
      notBuilt,
      "A record whose gate landed leaves NOT_BUILT; a new not-built record is added there in review.",
    ).toEqual([...NOT_BUILT]);
    expect([...NOT_BUILT], "NOT_BUILT is kept sorted, one tag per entry").toEqual(
      [...new Set(NOT_BUILT)].sort(),
    );
  });

  it("every checklist item is a review-tier record's, and the runbook sends sessions to the checklist", () => {
    const pointed = new Set(
      tags.flatMap((t) => {
        const e = parseEnforcement(textOf(t));
        return typeof e !== "string" && e.kind === "review" ? [e.anchor] : [];
      }),
    );
    const items = [...checklistSections(readFileSync(CHECKLIST, "utf8")).keys()].filter((a) =>
      /^d(?:-|\d)/.test(a),
    );
    expect(
      items.filter((a) => !pointed.has(a)),
      `${CHECKLIST} sections no review-tier record points at — delete them or point the record here`,
    ).toEqual([]);
    expect(readFileSync("docs/agent-runbook.md", "utf8")).toContain(CHECKLIST);
  });

  it("refuses a gate that never runs in CI", () => {
    const ci = "run: npx vitest run test/e2e/gated.test.ts";
    const live = 'it("works", () => {});';
    expect(ciRunProblem("test/system/x.test.ts", live, ci)).toBe("");
    expect(ciRunProblem("test/system/x.test.ts", 'it.skip("works", () => {});', ci)).toMatch(
      /skipped or todo/,
    );
    expect(
      ciRunProblem("test/system/x.test.ts", `describe.skip("all", () => { ${live} });`, ci),
    ).toMatch(/skipped or todo/);
    const gated = `describe.skipIf(!process.env.LOOM_X)("e2e", () => { ${live} });`;
    expect(ciRunProblem("test/e2e/gated.test.ts", gated, ci)).toBe("");
    expect(ciRunProblem("test/e2e/orphan.test.ts", gated, ci)).toMatch(/env-gated and no workflow/);
    expect(ciRunProblem("scripts/x.mjs", "", ci)).toMatch(/no workflow runs/);
    expect(ciRunProblem("docs/x.md", "", ci)).toMatch(/neither a test file/);
    expect(ciRunProblem("test/fixtures/corpus/no-such-fixture.ddd", "", ci)).toMatch(/no sidecar/);
    expect(ciRunProblem("test/fixtures/corpus/core-domain.ddd", "", ci)).toBe("");
  });

  it("refuses a missing line, a line that is not last, a bad path, an unnamed tag and a closed fence", () => {
    const read = (p: string) =>
      ({ "test/a.test.ts": "// D-X: the gate", "test/b.test.ts": "// nothing" })[p];
    const open = (ref: string) => (ref === "#1" ? "" : `${ref} is not a live fence`);
    const rec = (line: string, tail = "") => `# D-X\n\nThe decision.\n\n${line}\n${tail}`;
    expect(recordProblems("D-X", rec("**Enforced by:** `test/a.test.ts`"), read, open)).toEqual([]);
    expect(recordProblems("D-X", "# D-X\n\nNo line.\n", read, open)).toEqual([
      "D-X: no `**Enforced by:**` line",
    ]);
    expect(
      recordProblems(
        "D-X",
        rec("**Enforced by:** `test/a.test.ts`", "\nMore prose.\n"),
        read,
        open,
      ),
    ).toEqual(["D-X: the `**Enforced by:**` line is not the record's last line"]);
    expect(recordProblems("D-X", rec("**Enforced by:** `test/gone.test.ts`"), read, open)).toEqual([
      "D-X: `test/gone.test.ts` does not exist",
    ]);
    expect(recordProblems("D-X", rec("**Enforced by:** `test/b.test.ts`"), read, open)).toEqual([
      `D-X: \`test/b.test.ts\` does not name D-X in its header — name the decision in the file's top comment (a corpus fixture: its .corpus.json "//")`,
    ]);
    expect(
      recordProblems("D-X", rec("**Enforced by:** none, tracked by #1 — not built"), read, open),
    ).toEqual([]);
    expect(
      recordProblems("D-X", rec("**Enforced by:** none, tracked by #2 — not built"), read, open),
    ).toEqual(["D-X: #2 is not a live fence"]);
    const checklist = "# Checklist\n\n### D-X\nThe diff keeps D-X.\n\n### D-Y\nOther.\n";
    const withChecklist = (p: string) => (p === CHECKLIST ? checklist : read(p));
    const review = (anchor: string, doc = CHECKLIST) =>
      rec(`**Enforced by:** review — \`${doc}#${anchor}\` — a naming rule`);
    expect(recordProblems("D-X", review("d-x"), withChecklist, open)).toEqual([]);
    expect(recordProblems("D-X", review("d-z"), withChecklist, open)).toEqual([
      `D-X: ${CHECKLIST} has no section \`#d-z\``,
    ]);
    expect(recordProblems("D-X", review("d-y"), withChecklist, open)).toEqual([
      `D-X: ${CHECKLIST}#d-y does not name D-X`,
    ]);
    expect(recordProblems("D-X", review("d-x", "docs/other.md"), withChecklist, open)).toEqual([
      `D-X: a review line points into ${CHECKLIST}, not \`docs/other.md\``,
    ]);
    expect(recordProblems("D-X", rec("**Enforced by:** tests"), read, open)[0]).toMatch(
      /the line must be/,
    );
    // The tag must be in the header: a mention below the first line of code,
    // where other changes append tests, does not count.
    const below = (p: string) =>
      p === "test/d.test.ts" ? 'import x from "y";\n// D-X\n' : read(p);
    expect(
      recordProblems("D-X", rec("**Enforced by:** `test/d.test.ts`"), below, open),
    ).toHaveLength(1);
    // A superseded record names a live record.
    const records = (p: string) =>
      ({
        "docs/decisions/D-Y.md": "# D-Y\n\n**Enforced by:** `test/a.test.ts`\n",
        "docs/decisions/D-Z.md": "# D-Z\n\n**Enforced by:** superseded by `D-Y`\n",
      })[p] ?? read(p);
    expect(
      recordProblems("D-X", rec("**Enforced by:** superseded by `D-Y`"), records, open),
    ).toEqual([]);
    expect(
      recordProblems("D-X", rec("**Enforced by:** superseded by `D-Q`"), records, open),
    ).toEqual(["D-X: superseded by D-Q, which has no record"]);
    expect(
      recordProblems("D-X", rec("**Enforced by:** superseded by `D-Z`"), records, open),
    ).toEqual(["D-X: superseded by D-Z, which is itself superseded by D-Y — name the live record"]);
    // A tag is matched as a whole word: D-X does not credit a file naming D-XY.
    expect(
      recordProblems("D-X", rec("**Enforced by:** `test/c.test.ts`"), () => "// D-XY", open),
    ).toEqual([
      `D-X: \`test/c.test.ts\` does not name D-X in its header — name the decision in the file's top comment (a corpus fixture: its .corpus.json "//")`,
    ]);
  });
});

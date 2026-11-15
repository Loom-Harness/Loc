// Every decision record names the gate that enforces it.
//
// A ruling about how generated code behaves protects nothing unless a test
// observes it.  So each `docs/decisions/D-*.md` ends with one line, its last
// non-blank line, in one of three forms:
//
//   **Enforced by:** `test/…/a.test.ts`, `test/…/b.test.ts`
//   **Enforced by:** none, tracked by #NNNN — <why there is no gate yet>
//   **Enforced by:** none, not observable — <why no test can observe it>
//
// A named path must exist and must mention the record's tag, so the link
// holds from both ends and survives a rename of either.  `tracked by` names a
// live fence (`test/_helpers/live-fences.ts`), so the deferral expires with
// its issue.  The records that are `none` are pinned in NONE_RECORDS below:
// the set only shrinks, and a new `none` record is a reviewed line here.
//
// Deterministic: it reads committed files only — no network, no clock.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fenceProblem } from "../_helpers/live-fences.js";

const DIR = "docs/decisions";
const LINE = /^\*\*Enforced by:\*\* (.+)$/;
const NONE_TRACKED = /^none, tracked by (#\d+) — (.+)$/;
const NONE_UNOBSERVABLE = /^none, not observable — (.+)$/;
const GATES = /^`[^`]+`(?:, `[^`]+`)*$/;

/** The records whose line is `none`, sorted, one per line.  Shrink-only. */
const NONE_RECORDS: readonly string[] = [
  "D-AI-EMPHASIS",
  "D-API-TOOLKIT",
  "D-CROSSTENANT-ACK",
  "D-CTX-SHAPE",
  "D-ENV-SWAP",
  "D-ENVELOPE",
  "D-FORM-BINDS-ACTION",
  "D-GRANULARITY",
  "D-HONO-SHARED",
  "D-LIFECYCLE-SHAPE",
  "D-MIG-DSL-STEPS",
  "D-MIG-NO-DOWN",
  "D-MISC-C0",
  "D-MODAL-CONTROLLED-OP-FORM",
  "D-NO-MIXED-FOUNDATION",
  "D-PERSISTENCE-PER-BACKEND",
  "D-PHOENIX-DIR",
  "D-PHOENIX-FORMAT-GATE",
  "D-PHOENIX-FOUNDATION-ROUTING",
  "D-PHOENIX-FOUNDATION-STRATEGY",
  "D-PHOENIX-TRANSPORT",
  "D-POLICY-STYLE",
  "D-POLYMORPHIC-ID-REPRESENTATION",
  "D-PRIORITY-ORDER",
  "D-PYTHON-SINGLE-REALIZATION",
  "D-READ-SURFACE-ORDER",
  "D-SEED-XREF",
  "D-TARGET-MATRIX-FROZEN",
  "D-TENANCY-HIERARCHY",
  "D-TENANCY-SCOPE",
  "D-TPH-BEATS-SHAPE",
  "D-VANILLA-PHOENIX-FOUNDATION",
  "D-WIRESHAPE-KEEP",
];

type Enforcement =
  | { kind: "gates"; paths: string[] }
  | { kind: "tracked"; issue: string; reason: string }
  | { kind: "not-observable"; reason: string };

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
  const unobservable = NONE_UNOBSERVABLE.exec(body);
  if (unobservable) return { kind: "not-observable", reason: unobservable[1] };
  if (GATES.test(body))
    return { kind: "gates", paths: [...body.matchAll(/`([^`]+)`/g)].map((m) => m[1]) };
  return (
    "the line must be `**Enforced by:** `<path>`, …`, " +
    "`**Enforced by:** none, tracked by #N — <why>` or `**Enforced by:** none, not observable — <why>`"
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
  if (e.kind === "not-observable") return [];
  const out: string[] = [];
  const tagWord = new RegExp(`(^|[^A-Z0-9-])${tag}(?![A-Z0-9-])`);
  for (const p of e.paths) {
    const src = read(p);
    if (src === undefined) {
      out.push(`${tag}: \`${p}\` does not exist`);
      continue;
    }
    if (!tagWord.test(src))
      out.push(
        `${tag}: \`${p}\` does not mention ${tag} — name the decision where the gate checks it`,
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

  it("the `none` records are exactly the pinned ones, and the set only shrinks", () => {
    const none = tags.filter((t) => {
      const e = parseEnforcement(textOf(t));
      return typeof e !== "string" && e.kind !== "gates";
    });
    expect(
      none,
      "A record that gained a gate leaves NONE_RECORDS; a new `none` record is added there in review.",
    ).toEqual([...NONE_RECORDS]);
    expect([...NONE_RECORDS], "NONE_RECORDS is kept sorted, one tag per entry").toEqual(
      [...new Set(NONE_RECORDS)].sort(),
    );
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
      "D-X: `test/b.test.ts` does not mention D-X — name the decision where the gate checks it",
    ]);
    expect(
      recordProblems("D-X", rec("**Enforced by:** none, tracked by #1 — not built"), read, open),
    ).toEqual([]);
    expect(
      recordProblems("D-X", rec("**Enforced by:** none, tracked by #2 — not built"), read, open),
    ).toEqual(["D-X: #2 is not a live fence"]);
    expect(
      recordProblems(
        "D-X",
        rec("**Enforced by:** none, not observable — a naming rule"),
        read,
        open,
      ),
    ).toEqual([]);
    expect(recordProblems("D-X", rec("**Enforced by:** tests"), read, open)[0]).toMatch(
      /the line must be/,
    );
    // A tag is matched as a whole word: D-X does not credit a file naming D-XY.
    expect(
      recordProblems("D-X", rec("**Enforced by:** `test/c.test.ts`"), () => "// D-XY", open),
    ).toEqual([
      "D-X: `test/c.test.ts` does not mention D-X — name the decision where the gate checks it",
    ]);
  });
});

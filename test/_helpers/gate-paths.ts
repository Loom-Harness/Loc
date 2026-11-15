// What makes a named gate real: it exists and runs in CI, and — for a review
// tier — the checklist section it names.  Shared by the checks that hold a
// written claim to the test behind it (`decision-gates.test.ts` for decision
// records, `doc-claims.test.ts` for the reference docs).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The one checklist review-tier claims point into; the runbook sends every
 *  session to it. */
export const CHECKLIST = "docs/review-checklist.md";

export const readRepo = (p: string): string | undefined =>
  existsSync(p) ? readFileSync(p, "utf8") : undefined;

/** Why a named gate never runs in CI (empty when it does): a test file the
 *  fast suite does not collect, one whose every test is skipped or `todo`, an
 *  env-gated suite no workflow runs, a corpus fixture with no sidecar, or a
 *  script no workflow calls.  `ci` is the text of the workflows plus the
 *  package scripts they invoke. */
export function ciRunProblem(path: string, src: string, ci: string): string {
  if (/^test\/fixtures\/corpus\/[a-z0-9-]+\.ddd$/.test(path))
    return existsSync(path.replace(/\.ddd$/, ".corpus.json"))
      ? ""
      : "is a corpus fixture with no sidecar, so no corpus leg runs it";
  if (/^test\/behavioral\/systems\/[a-z0-9-]+\.ddd$/.test(path)) return "";
  if (/^scripts\//.test(path)) return ci.includes(path) ? "" : "is a script no workflow runs";
  if (/^test\/behavioral\/.+\.pw\.ts$/.test(path))
    return ci.includes(path.split("/").slice(-2, -1)[0] as string)
      ? ""
      : "is a behavioural Playwright spec no workflow runs";
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

/** The checklist's sections by anchor (a heading's GitHub slug) → their text,
 *  heading included, up to the next heading of any level. */
export function checklistSections(md: string): Map<string, string> {
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

/** The workflows, plus every package script a workflow names (as `npm run x`
 *  or in a matrix list of script names). */
export function ciText(): string {
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

// ---------------------------------------------------------------------------
// Runner adapter — Playwright `--reporter=json` → the `TestOutcome[]`
// `computeVerification` joins on.
//
// The generated ui-e2e suite (`<react-deployable>/e2e/<System>.ui.spec.ts`,
// `src/system/ui-e2e-render.ts`) runs under Playwright, whose JSON report is
// not the jest shape `from-vitest.ts` reads.  Without this adapter a
// `test e2e … against <ui>` block's `verifies` could only reach the gate
// through a hand-written results file.
//
// THE SHAPE.  Playwright's `json` reporter nests suites — one per spec file,
// then one per `describe` — and puts the `test(...)` calls under `specs`,
// each with one `tests[]` entry per configured project:
//
//     { "suites": [ { "title": "Shop.ui.spec.ts", "specs": [
//         { "title": "checkout works", "tests": [
//           { "projectName": "chromium", "status": "expected" } ] } ],
//       "suites": [ … nested describes … ] } ] }
//
// The innermost enclosing suite title is the `suite` (the spec FILE when the
// spec has no `describe`, which is the generated shape — the join aliases
// `<System>.ui.spec.ts` back onto `"<System> e2e"`), the spec title is the
// `name`, and each project run is one outcome (several runs of one test
// resolve to the worst of them in the join).
//
// Pure and dependency-free, like `verification.ts`: no fs, no Date.
// ---------------------------------------------------------------------------

import type { TestOutcome } from "../ir/types/loom-ir.js";

interface PlaywrightSuite {
  title?: unknown;
  specs?: unknown;
  suites?: unknown;
}
interface PlaywrightSpec {
  title?: unknown;
  tests?: unknown;
}
interface PlaywrightTest {
  status?: unknown;
}

/** Playwright's per-test verdict onto Loom's three-valued outcome.
 *  `expected` — the run matched the test's expected status (a pass, or a
 *  `test.fail()` that failed as declared); `flaky` — failed, then passed on a
 *  retry, which Playwright itself counts as passing; `unexpected` — failed;
 *  `skipped` — did not run, which is `skip`, never a pass. */
function mapStatus(raw: unknown): TestOutcome["status"] | undefined {
  switch (raw) {
    case "expected":
    case "flaky":
      return "pass";
    case "unexpected":
      return "fail";
    case "skipped":
      return "skip";
    default:
      return undefined;
  }
}

/** Thrown when the document is not a Playwright JSON report. */
export class PlaywrightReportError extends Error {}

/**
 * Convert a parsed Playwright `--reporter=json` document into the normalized
 * outcomes `computeVerification` consumes.
 *
 * @throws {PlaywrightReportError} when `suites` is missing or not an array,
 *         or a test carries a status this adapter does not know.
 */
export function fromPlaywrightReport(raw: unknown): TestOutcome[] {
  const doc = raw as { suites?: unknown } | null;
  if (doc == null || typeof doc !== "object" || !Array.isArray(doc.suites)) {
    throw new PlaywrightReportError(
      'expected a top-level "suites" array (playwright --reporter=json)',
    );
  }
  const out: TestOutcome[] = [];
  const visit = (suite: PlaywrightSuite): void => {
    const title = typeof suite?.title === "string" ? suite.title : undefined;
    for (const spec of (Array.isArray(suite?.specs) ? suite.specs : []) as PlaywrightSpec[]) {
      if (typeof spec?.title !== "string") {
        throw new PlaywrightReportError('a spec has no string "title"');
      }
      for (const test of (Array.isArray(spec.tests) ? spec.tests : []) as PlaywrightTest[]) {
        const status = mapStatus(test?.status);
        if (status === undefined) {
          throw new PlaywrightReportError(
            `unknown test status ${JSON.stringify(test?.status)} for "${spec.title}" — expected ` +
              "one of expected / unexpected / flaky / skipped",
          );
        }
        out.push(
          title === undefined
            ? { name: spec.title, status }
            : { name: spec.title, status, suite: title },
        );
      }
    }
    for (const child of (Array.isArray(suite?.suites) ? suite.suites : []) as PlaywrightSuite[]) {
      visit(child);
    }
  };
  for (const s of doc.suites as PlaywrightSuite[]) visit(s);
  return out;
}

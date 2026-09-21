// ---------------------------------------------------------------------------
// Runner adapter — vitest / jest `--reporter=json` → the `TestOutcome[]`
// `computeVerification` joins on.
//
// WHY THIS EXISTS.  `ddd verify` gates on a `{ version, results: [...] }`
// document, and `docs/verify.md` used to tell the reader to produce it "from
// your runner's report" — which, for the one runner Loom's own generated
// backend tests run under, meant hand-writing an adapter before the gate could
// be wired at all.  Feeding vitest's JSON reporter straight in got
//
//     Could not parse results file: expected a top-level "results" array
//
// and the hand-written adapter is exactly where the (suite, name) join
// convention gets guessed wrong — the failure mode F-017 measured, where the
// file name is used as `suite` and the run reports `0/N verified, exit 0`.
// Shipping the adapter makes the convention the toolchain's problem rather
// than the user's.
//
// THE SHAPE.  Vitest's `json` reporter emits the jest-compatible document:
//
//     { "testResults": [ { "name": "<file>", "assertionResults": [
//         { "ancestorTitles": ["A"], "title": "go works", "status": "passed" }
//     ] } ] }
//
// A Loom-generated unit test file is `describe("<Aggregate>") / it("<test
// name>")`, and an e2e file is `describe("<System> e2e")` — so the INNERMOST
// `describe` title is exactly the `suite` `collectExecTests` records, and the
// `it` title is exactly the DSL `test "…"` string.  Nested describes are read
// the same way (innermost wins), because that is the suite a runner reports
// for the assertion.
//
// Pure and dependency-free, like `verification.ts`: no fs, no Date.  The CLI
// reads the file; this only reshapes already-parsed JSON.
// ---------------------------------------------------------------------------

import type { TestOutcome } from "../ir/types/loom-ir.js";

/** The subset of the jest/vitest JSON report this adapter reads.  Everything
 *  else in the document (timings, failure messages, counts) is ignored. */
interface VitestAssertion {
  title?: unknown;
  fullName?: unknown;
  status?: unknown;
  ancestorTitles?: unknown;
}
interface VitestFileResult {
  assertionResults?: unknown;
}

/** Map a jest/vitest assertion status onto Loom's three-valued outcome.
 *  `pending` / `skipped` / `todo` / `disabled` all mean "did not run" — which
 *  is `skip`, NOT a pass: `computeVerification` keeps a skipped backing test
 *  out of `VERIFIED`, and that is the honest reading. */
function mapStatus(raw: unknown): TestOutcome["status"] | undefined {
  switch (raw) {
    case "passed":
      return "pass";
    case "failed":
      return "fail";
    case "pending":
    case "skipped":
    case "todo":
    case "disabled":
      return "skip";
    default:
      return undefined;
  }
}

/** Thrown when the document is not a jest/vitest JSON report at all — kept
 *  distinct from "the report ran zero tests", which is a legitimate (and, for
 *  the gate, loudly-reported) outcome rather than a malformed input. */
export class VitestReportError extends Error {}

/**
 * Convert a parsed vitest/jest `--reporter=json` document into the normalized
 * outcomes `computeVerification` consumes.
 *
 * @param raw  the already-`JSON.parse`d report.
 * @throws {VitestReportError} when `testResults` is missing or not an array,
 *         or when an assertion carries a status this adapter does not know.
 */
export function fromVitestReport(raw: unknown): TestOutcome[] {
  const doc = raw as { testResults?: unknown } | null;
  if (doc == null || typeof doc !== "object" || !Array.isArray(doc.testResults)) {
    throw new VitestReportError(
      'expected a top-level "testResults" array (vitest/jest --reporter=json)',
    );
  }

  const out: TestOutcome[] = [];
  for (const file of doc.testResults as VitestFileResult[]) {
    const assertions = Array.isArray(file?.assertionResults) ? file.assertionResults : [];
    for (const a of assertions as VitestAssertion[]) {
      const status = mapStatus(a?.status);
      if (status === undefined) {
        throw new VitestReportError(
          `unknown assertion status ${JSON.stringify(a?.status)} — expected one of ` +
            "passed / failed / pending / skipped / todo",
        );
      }
      const name = typeof a?.title === "string" ? a.title : undefined;
      if (name === undefined) {
        throw new VitestReportError('an assertionResult has no string "title"');
      }
      // The suite the runner reports for this assertion: its innermost
      // enclosing `describe`.  A top-level `it` has none, and a suite-less
      // outcome is a legal (if less precise) input — `outcomeFor` attributes
      // it only when the bare name is unambiguous.
      const ancestors = Array.isArray(a?.ancestorTitles)
        ? (a.ancestorTitles as unknown[]).filter((t): t is string => typeof t === "string")
        : [];
      const suite = ancestors.length > 0 ? ancestors[ancestors.length - 1] : undefined;
      out.push(suite === undefined ? { name, status } : { name, status, suite });
    }
  }
  return out;
}

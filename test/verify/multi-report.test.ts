import { beforeAll, describe, expect, it } from "vitest";
import type { EnrichedLoomModel, TestOutcome } from "../../src/ir/types/loom-ir.js";
import {
  describeJoinMismatch,
  describeMissingCause,
  missingEvidence,
  reportWarnings,
} from "../../src/verify/diagnose.js";
import { fromPlaywrightReport, PlaywrightReportError } from "../../src/verify/from-playwright.js";
import { fromVitestReport } from "../../src/verify/from-vitest.js";
import { attributeResults, computeVerification } from "../../src/verify/verification.js";
import { buildLoomModel as build } from "../_helpers/index.js";

// ---------------------------------------------------------------------------
// A generated tree runs its unit tests and its e2e tests in separate runner
// projects, so a whole-system verdict joins SEVERAL reports.  These pin the
// pure half of that: concatenated reports join like one, a declared test with
// no `verifies` is told apart from a test nobody declared, and a missing
// result is explained by the cause that actually holds — a report that was
// not supplied, a drifted title, or a test that simply did not run.
// ---------------------------------------------------------------------------

/** One unit test and one api-e2e test that each verify a test case, plus an
 *  api-e2e test with no `verifies` — the shape of the audit's FieldOps model. */
const MODEL = `
  requirement R-001 { type: UserStory  title: "complete" }
  requirement R-002 { type: UserStory  title: "lifecycle" }
  system FieldOps {
    subdomain Core { context Ops {
      aggregate WorkOrder { operation complete() {}  test "complete works" verifies TC-001 {} }
    } }
    deployable api { platform: node  contexts: [Ops] }
    test e2e "lifecycle round-trips" against api verifies TC-002 {}
    test e2e "no technician" against api {}
  }
  testCase TC-001 verifies R-001 { covers [ Core.Ops.WorkOrder.complete ] }
  testCase TC-002 verifies R-002 { covers [ Core.Ops.WorkOrder.complete ] }
`;

/** The unit runner's report, as `vitest --reporter=json` writes it. */
const unitReport = (status = "passed") =>
  fromVitestReport({
    testResults: [
      {
        name: "/gen/api/src/domain/work-order.test.ts",
        assertionResults: [{ ancestorTitles: ["WorkOrder"], title: "complete works", status }],
      },
    ],
  });

/** The api-e2e runner's report — titles carry the ` against <slug>` suffix. */
const e2eReport = () =>
  fromVitestReport({
    testResults: [
      {
        name: "/gen/e2e/FieldOps.e2e.test.ts",
        assertionResults: [
          {
            ancestorTitles: ["FieldOps e2e"],
            title: "lifecycle round-trips against api",
            status: "passed",
          },
          {
            ancestorTitles: ["FieldOps e2e"],
            title: "no technician against api",
            status: "passed",
          },
        ],
      },
    ],
  });

const SLUGS = ["api"];
let loom: EnrichedLoomModel;
beforeAll(async () => {
  loom = await build(MODEL);
});

function verify(results: TestOutcome[]) {
  return computeVerification(
    loom.traceability!,
    loom.requirements.map((r) => r.id),
    results,
    { serviceSlugs: SLUGS },
  );
}

describe("several reports, one verdict", () => {
  it("the unit and e2e reports concatenated verify every requirement", () => {
    const v = verify([...unitReport(), ...e2eReport()]);
    expect(v.summary).toMatchObject({ verified: 2, unverified: 0, total: 2 });
    expect(v.diagnostics.unknownTests).toEqual([]);
  });

  it("one report alone leaves the other tier's requirement UNVERIFIED, not lost silently", () => {
    const v = verify(e2eReport());
    expect(v.requirements["R-001"].verdict).toBe("UNVERIFIED");
    expect(v.testCases["TC-001"].backing).toEqual([{ name: "complete works", status: "missing" }]);
    expect(v.requirements["R-002"].verdict).toBe("VERIFIED");
  });

  it("the same test in two reports resolves to the worst run (fail > skip > pass)", () => {
    const v = verify([...unitReport("passed"), ...unitReport("failed"), ...e2eReport()]);
    expect(v.requirements["R-001"].verdict).toBe("FAILING");
    // …and the passing duplicate is still that test's run, not an unknown one.
    expect(v.diagnostics.unknownTests).toEqual([]);
  });
});

describe("a declared test with no `verifies` is not an unknown test", () => {
  it("lands in unlinkedTests, never in unknownTests", () => {
    const v = verify([...unitReport(), ...e2eReport()]);
    expect(v.diagnostics.unlinkedTests.map((r) => r.name)).toEqual(["no technician against api"]);
    expect(v.diagnostics.unknownTests).toEqual([]);
  });

  it("a test nobody declared still lands in unknownTests", () => {
    const stray: TestOutcome = { name: "hand-written", suite: "WorkOrder", status: "pass" };
    const v = verify([...unitReport(), stray]);
    expect(v.diagnostics.unknownTests).toEqual([stray]);
    expect(v.diagnostics.unlinkedTests).toEqual([]);
  });

  it("every replay of one api-e2e block is that block's evidence, not just the worst", async () => {
    // Two backends replay the block; both titles resolve to the one declared
    // test.  The worst picks the STATUS — but the other run is still a run of
    // a declared test and must not be reported as matching none.
    const two = await build(`
      requirement R-001 { type: UserStory  title: "a" }
      system P {
        subdomain Core { context Core { aggregate W { operation touch() {} } } }
        deployable honoApi   { platform: node    contexts: [Core] }
        deployable dotnetApi { platform: dotnet  contexts: [Core] }
        test e2e "creates" against honoApi verifies TC-001 {}
      }
      testCase TC-001 verifies R-001 { covers [ Core.Core.W.touch ] }
    `);
    const v = computeVerification(
      two.traceability!,
      ["R-001"],
      [
        { name: "creates against hono_api", suite: "P e2e", status: "pass" },
        { name: "creates against dotnet_api", suite: "P e2e", status: "pass" },
      ],
      { serviceSlugs: ["hono_api", "dotnet_api"] },
    );
    expect(v.requirements["R-001"].verdict).toBe("VERIFIED");
    expect(v.diagnostics.unknownTests).toEqual([]);
  });
});

describe("why a declared test has no result", () => {
  const explain = (results: TestOutcome[]) => {
    const execTests = loom.traceability!.execTests;
    const attribution = attributeResults(loom.traceability!, results, { serviceSlugs: SLUGS });
    const missing = missingEvidence(execTests, attribution);
    return { missing, text: describeMissingCause(missing, attribution, execTests, SLUGS) };
  };

  it("names the missing REPORT when a whole tier has no result at all", () => {
    // The audit's case: only the e2e report passed.  The unmatched e2e
    // results used to be classified as a join failure — "the SUITE does not
    // match" quoting two identical suites.  The real cause is the absent
    // unit report.
    const { missing, text } = explain(e2eReport());
    expect(missing.refs.map((r) => r.name)).toEqual(["complete works"]);
    expect(missing.silentKinds).toEqual(["unit"]);
    expect(text).toMatch(/no result for ANY unit test was supplied/);
    expect(text).toMatch(/repeatable/);
    expect(text).not.toMatch(/SUITE does not match/);
    expect(text).not.toMatch(/matched no declared test/);
  });

  it("names the drifted field when the tier DID report, under the wrong title", () => {
    const drifted: TestOutcome = {
      name: "complete works",
      suite: "work-order.test.ts",
      status: "pass",
    };
    const { missing, text } = explain([drifted, ...e2eReport()]);
    expect(missing.silentKinds).toEqual(["unit"]);
    // A stray result means the unit report may have been passed with drifted
    // titles, so "the report was not passed" is offered as one reading, not
    // asserted.
    expect(text).toMatch(/either the backend unit-test runner's report was not passed, or it was/);
    expect(text).not.toMatch(/most likely not passed/);
    expect(text).toMatch(/1 result\(s\) matched no declared test — the SUITE does not match/);
    expect(text).toContain('"work-order.test.ts"');
    expect(text).toMatch(/declared with suite "WorkOrder"/);
  });

  it("says the test did not run when every result is accounted for", async () => {
    const twoUnits = await build(`
      requirement R-001 { type: UserStory  title: "a" }
      system S {
        subdomain M { context C { aggregate A {
          operation go() {}
          test "one" verifies TC-001 {}
          test "two" verifies TC-001 {}
        } } }
        deployable api { platform: node  contexts: [C] }
      }
      testCase TC-001 verifies R-001 { covers [ M.C.A.go ] }
    `);
    const execTests = twoUnits.traceability!.execTests;
    const attribution = attributeResults(twoUnits.traceability!, [
      { name: "one", suite: "A", status: "pass" },
    ]);
    const missing = missingEvidence(execTests, attribution);
    expect(missing.silentKinds).toEqual([]);
    expect(describeMissingCause(missing, attribution, execTests, ["api"])).toMatch(
      /every supplied result was attributed to a declared test, so the missing test\(s\) did not run/,
    );
  });

  it("never reports a SUITE mismatch whose declared suite is the reported one", () => {
    // Defensive: fed a result whose (name, suite) does resolve, the
    // classifier must not contradict itself by quoting identical suites.
    const execTests = loom.traceability!.execTests;
    const text = describeJoinMismatch(
      execTests,
      [{ name: "no technician against api", suite: "FieldOps e2e", status: "pass" }],
      SLUGS,
    );
    expect(text).not.toMatch(/SUITE does not match/);
  });
});

describe("per-report warnings", () => {
  it("flags an empty report and a report none of whose results join", () => {
    const stray: TestOutcome[] = [{ name: "x", suite: "Y", status: "pass" }];
    const unit = unitReport();
    const reports = [
      { label: "--from-vitest unit.json", outcomes: unit },
      { label: "--from-vitest empty.json", outcomes: [] },
      { label: "--results other.json", outcomes: stray },
    ];
    const attribution = attributeResults(loom.traceability!, [...unit, ...stray], {
      serviceSlugs: SLUGS,
    });
    expect(reportWarnings(reports, attribution)).toEqual([
      "--from-vitest empty.json contains no test results",
      "none of the 1 result(s) in --results other.json matched a declared test — check it is a report of this model's generated suites",
    ]);
  });

  it("a report holding only tests with no `verifies` is NOT flagged — they are declared", () => {
    const e2e = e2eReport().filter((o) => o.name.startsWith("no technician"));
    const attribution = attributeResults(loom.traceability!, e2e, { serviceSlugs: SLUGS });
    expect(reportWarnings([{ label: "e2e", outcomes: e2e }], attribution)).toEqual([]);
  });
});

describe("--from-playwright adapter", () => {
  /** The Playwright JSON reporter's shape: file suite → specs → per-project tests. */
  const report = (status: string, nested = false) => {
    const spec = {
      title: "creates a widget in the UI",
      ok: status !== "unexpected",
      tests: [{ projectName: "chromium", status, results: [] }],
    };
    return {
      config: {},
      suites: [
        nested
          ? {
              title: "VerifyProbe.ui.spec.ts",
              specs: [],
              suites: [{ title: "Widgets", specs: [spec] }],
            }
          : { title: "VerifyProbe.ui.spec.ts", file: "VerifyProbe.ui.spec.ts", specs: [spec] },
      ],
    };
  };

  it("maps expected/flaky → pass, unexpected → fail, skipped → skip", () => {
    expect(fromPlaywrightReport(report("expected"))).toEqual([
      { name: "creates a widget in the UI", suite: "VerifyProbe.ui.spec.ts", status: "pass" },
    ]);
    expect(fromPlaywrightReport(report("flaky"))[0]!.status).toBe("pass");
    expect(fromPlaywrightReport(report("unexpected"))[0]!.status).toBe("fail");
    expect(fromPlaywrightReport(report("skipped"))[0]!.status).toBe("skip");
  });

  it("the innermost describe is the suite", () => {
    expect(fromPlaywrightReport(report("expected", true))[0]!.suite).toBe("Widgets");
  });

  it("rejects a non-Playwright document and an unknown status", () => {
    expect(() => fromPlaywrightReport({ testResults: [] })).toThrow(PlaywrightReportError);
    expect(() => fromPlaywrightReport(report("passed"))).toThrow(/unknown test status "passed"/);
  });

  it("a generated ui spec's report verifies its `test e2e … against <ui>` block", async () => {
    const ui = await build(`
      requirement R-001 { type: UserStory  title: "A widget can be created in the UI" }
      system VerifyProbe {
        subdomain Core { context Core { aggregate Widget { operation touch() {} } } }
        ui WebApp with scaffold(subdomains: [Core]) {}
        deployable api    { platform: node   contexts: [Core] }
        deployable webApp { platform: react  targets: api  ui: WebApp }
        test e2e "creates a widget in the UI" against webApp verifies TC-001 {}
      }
      testCase TC-001 verifies R-001 { covers [ Core.Core.Widget.touch ] }
    `);
    const v = computeVerification(
      ui.traceability!,
      ["R-001"],
      fromPlaywrightReport(report("expected")),
    );
    expect(v.requirements["R-001"].verdict).toBe("VERIFIED");
    expect(v.diagnostics.unknownTests).toEqual([]);
  });
});

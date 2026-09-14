// Unit coverage for the runner adapter — the pure half of F-017 fix #3.
//
// `docs/verify.md` told the reader to produce the `{ results: [...] }`
// document "from your runner's report", and feeding vitest's own
// `--reporter=json` straight in answered
//
//   Could not parse results file: expected a top-level "results" array
//
// so every user wrote this mapping by hand — which is precisely where the
// (suite, name) join convention gets guessed wrong.  These cases pin the
// mapping the toolchain now owns.

import { describe, expect, it } from "vitest";
import { fromVitestReport, VitestReportError } from "../../src/verify/from-vitest.js";

/** One assertion inside one file, with the field names a real
 *  `vitest run --reporter=json` emits. */
const doc = (assertions: unknown[]) => ({
  numTotalTests: assertions.length,
  testResults: [
    { name: "/gen/api/domain/a.test.ts", status: "passed", assertionResults: assertions },
  ],
});

describe("fromVitestReport", () => {
  it("maps title → name and the innermost describe → suite", () => {
    // A Loom-generated unit file is `describe("<Aggregate>") / it("<test>")`,
    // and `collectExecTests` records `suite = <Aggregate>` — so the innermost
    // ancestor title IS the join key, with no guessing at the call site.
    expect(
      fromVitestReport(doc([{ ancestorTitles: ["A"], title: "go works", status: "passed" }])),
    ).toEqual([{ name: "go works", status: "pass", suite: "A" }]);
  });

  it("takes the INNERMOST describe when they nest", () => {
    expect(
      fromVitestReport(
        doc([{ ancestorTitles: ["outer", "Order"], title: "ships", status: "passed" }]),
      ),
    ).toEqual([{ name: "ships", status: "pass", suite: "Order" }]);
  });

  it("omits `suite` for a top-level `it` rather than inventing one", () => {
    // A suite-less outcome is legal input: `outcomeFor` attributes it only
    // when the bare name is unambiguous.  Inventing a suite here would make
    // an ambiguous result look precise.
    expect(
      fromVitestReport(doc([{ ancestorTitles: [], title: "lone", status: "passed" }])),
    ).toEqual([{ name: "lone", status: "pass" }]);
  });

  it("maps every non-run status to `skip`, never to `pass`", () => {
    for (const raw of ["pending", "skipped", "todo", "disabled"]) {
      expect(
        fromVitestReport(doc([{ ancestorTitles: ["A"], title: "t", status: raw }]))[0],
      ).toEqual({ name: "t", status: "skip", suite: "A" });
    }
  });

  it("maps failed → fail", () => {
    expect(
      fromVitestReport(doc([{ ancestorTitles: ["A"], title: "t", status: "failed" }]))[0]?.status,
    ).toBe("fail");
  });

  it("flattens assertions across several files", () => {
    const multi = {
      testResults: [
        {
          name: "a.test.ts",
          assertionResults: [{ ancestorTitles: ["A"], title: "x", status: "passed" }],
        },
        {
          name: "b.test.ts",
          assertionResults: [{ ancestorTitles: ["B"], title: "y", status: "failed" }],
        },
      ],
    };
    expect(fromVitestReport(multi)).toEqual([
      { name: "x", status: "pass", suite: "A" },
      { name: "y", status: "fail", suite: "B" },
    ]);
  });

  it("accepts a report that ran zero tests — an empty run is data, not garbage", () => {
    // The gate's job, not the parser's: `ddd verify` fails this run on the
    // missing evidence it produces.
    expect(fromVitestReport({ testResults: [] })).toEqual([]);
  });

  it("refuses a document that is not a vitest report", () => {
    for (const bad of [null, 42, {}, { results: [] }, { testResults: {} }]) {
      expect(() => fromVitestReport(bad)).toThrow(VitestReportError);
    }
  });

  it("refuses an unknown assertion status instead of guessing", () => {
    expect(() =>
      fromVitestReport(doc([{ ancestorTitles: ["A"], title: "t", status: "flaky" }])),
    ).toThrow(/unknown assertion status/);
  });

  it("refuses an assertion with no title", () => {
    expect(() => fromVitestReport(doc([{ ancestorTitles: ["A"], status: "passed" }]))).toThrow(
      /no string "title"/,
    );
  });
});

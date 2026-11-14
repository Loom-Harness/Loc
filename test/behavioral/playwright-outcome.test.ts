// Fast guard over the shared Playwright report classification the behavioral UI
// runners use (`playwright-outcome.mjs`): a test that never ran is a failure.
//
// Behaviour claim, unit tier: the classifier is pure; the runners that call it
// boot full stacks and run outside `npm test`.

import { describe, expect, it } from "vitest";
import { judgePlaywrightReport } from "./playwright-outcome.mjs";

const t = (status: string, annotations: { type: string }[] = [], error?: string) => ({
  status,
  annotations,
  results: [
    {
      status: status === "expected" ? "passed" : status,
      error: error ? { message: error } : undefined,
    },
  ],
});
const spec = (title: string, test: ReturnType<typeof t>) => ({
  title,
  ok: test.status === "expected" || test.status === "skipped",
  tests: [test],
});
const report = (...specs: ReturnType<typeof spec>[]) => ({
  suites: [{ title: "f", specs: [], suites: [{ title: "d", specs }] }],
});

describe("judgePlaywrightReport", () => {
  it("all passed is ok", () => {
    const r = judgePlaywrightReport(report(spec("a", t("expected")), spec("b", t("expected"))));
    expect(r.ok).toBe(true);
    expect(r.summary).toBe("2 passed, 0 failed, 0 did not run");
  });

  it("one failed + N did not run is NOT ok and names the unrun tests", () => {
    const r = judgePlaywrightReport(
      report(
        spec("seed", t("unexpected", [], "boom")),
        spec("p1", t("skipped")),
        spec("p2", t("skipped")),
      ),
    );
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("2 did not run");
    expect(r.summary).toContain("p1; p2");
    expect(r.outcomes.filter((o) => o.status === "fail")).toHaveLength(3);
  });

  it("a skipped test is NOT ok even with no other failure", () => {
    expect(
      judgePlaywrightReport(report(spec("a", t("expected")), spec("b", t("skipped")))).ok,
    ).toBe(false);
  });

  it("a test.skip by design is ok only when allowlisted with a reason", () => {
    const rep = report(spec("a", t("expected")), spec("b", t("skipped", [{ type: "skip" }])));
    expect(judgePlaywrightReport(rep).ok).toBe(false);
    expect(
      judgePlaywrightReport(rep, { allowSkips: [{ title: "b", reason: "needs gpu" }] }).ok,
    ).toBe(true);
    const starved = report(spec("b", t("skipped")));
    expect(judgePlaywrightReport(starved, { allowSkips: [{ title: "b", reason: "x" }] }).ok).toBe(
      false,
    );
    expect(() =>
      judgePlaywrightReport(rep, { allowSkips: [{ title: "b", reason: "" }] }),
    ).toThrow();
  });

  it("an empty run is NOT ok", () => {
    const r = judgePlaywrightReport({ suites: [] });
    expect(r.ok).toBe(false);
    expect(r.summary).toBe("Playwright ran no specs");
  });

  it("a report-level error is NOT ok", () => {
    const rep = { ...report(spec("a", t("expected"))), errors: [{ message: "load failed" }] };
    expect(judgePlaywrightReport(rep).ok).toBe(false);
  });
});

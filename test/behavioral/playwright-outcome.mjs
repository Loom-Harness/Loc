// The ONE classification of a Playwright JSON report shared by every behavioral
// UI runner.  Pure: no I/O.
//
// Playwright marks a test that never ran (its `beforeAll` failed, an earlier
// serial test failed, a conditional `test.skip`) as `status: "skipped"` with
// `spec.ok === true`, so reading `spec.ok` alone counts a probe that never
// reached an assertion as a pass.  Here a skipped test is a failure unless it is
// named in an explicit allowlist (`{ title, reason }`) AND carries a
// `skip`/`fixme` annotation, i.e. it was skipped by design rather than starved.
// An empty report is a failure, and so is a report-level error (a spec that
// failed to load).

/** @typedef {{ title: string, reason: string }} SkipAllowance */

const DID_NOT_RUN = "did not run (skipped)";

/**
 * @param {any} json Playwright `--reporter=json` output.
 * @param {{ allowSkips?: SkipAllowance[] }} [opts]
 * @returns {{ ok: boolean, summary: string, outcomes: {name:string,status:"pass"|"fail",error?:string}[] }}
 */
export function judgePlaywrightReport(json, opts = {}) {
  const allow = new Map();
  for (const a of opts.allowSkips ?? []) {
    if (!a?.title || !a?.reason) throw new Error("allowSkips entries need a title and a reason");
    allow.set(a.title, a.reason);
  }
  const outcomes = [];
  const visit = (suites) => {
    for (const s of suites ?? []) {
      for (const spec of s.specs ?? []) {
        const tests = spec.tests ?? [];
        const err = tests
          .flatMap((t) => t.results ?? [])
          .map((r) => r.error?.message)
          .find(Boolean);
        const skipped = tests.length === 0 || tests.every((t) => t.status === "skipped");
        if (skipped) {
          const annotated = tests.some((t) =>
            (t.annotations ?? []).some((a) => a.type === "skip" || a.type === "fixme"),
          );
          if (annotated && allow.has(spec.title)) {
            outcomes.push({ name: spec.title, status: "pass" });
          } else {
            const why = annotated ? "; its skip annotation is not in the allowlist" : "";
            outcomes.push({
              name: spec.title,
              status: "fail",
              error: `${DID_NOT_RUN}: a probe that never reached an assertion is a failure${why}`,
            });
          }
          continue;
        }
        const ok = spec.ok && tests.every((t) => t.status === "expected" || t.status === "flaky");
        outcomes.push({ name: spec.title, status: ok ? "pass" : "fail", error: err });
      }
      visit(s.suites);
    }
  };
  visit(json?.suites);
  for (const e of json?.errors ?? []) {
    outcomes.push({ name: "(report-level error)", status: "fail", error: e?.message ?? JSON.stringify(e) });
  }
  const failed = outcomes.filter((o) => o.status === "fail");
  const unrun = failed.filter((o) => String(o.error).startsWith(DID_NOT_RUN));
  let summary;
  if (outcomes.length === 0) {
    summary = "Playwright ran no specs";
  } else {
    summary = `${outcomes.length - failed.length} passed, ${failed.length - unrun.length} failed, ${unrun.length} did not run`;
    if (unrun.length) summary += `: ${unrun.map((o) => o.name).join("; ")}`;
  }
  return { ok: outcomes.length > 0 && failed.length === 0, summary, outcomes };
}

/** Flatten a report to `{name,status,error}` outcomes (a skipped test is a fail). */
export function outcomesFromPlaywrightJson(json, opts) {
  return judgePlaywrightReport(json, opts).outcomes;
}

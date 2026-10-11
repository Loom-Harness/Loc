// ---------------------------------------------------------------------------
// Gate diagnostics for `ddd verify` — WHY a declared test has no result.
//
// "A declared test had no matching result" has three distinct causes, and the
// fix for each is different, so the message has to name the one that holds:
//
//   1. A whole runner's report was not supplied.  A generated tree runs its
//      unit tests and its e2e tests in separate runner projects, each writing
//      its own report; pass only one and every test of the other tier is
//      missing.  Fingerprint: NO result was attributed to ANY declared test of
//      that tier — not one.
//   2. The join failed: the test ran, but its reported (suite, name) does not
//      line up with the declared one.  Fingerprint: the same run also has
//      results attributed to NO declared test (`unknown`), and
//      `describeJoinMismatch` names the field that differs.
//   3. The test simply did not run in the reports supplied (filtered out, or
//      its report is missing while sibling tests of its tier came from
//      another report).
//
// A result of a declared test with no `verifies` is none of these: it is a
// real, declared test that backs no test case.  `attributeResults` keeps
// those results out of `unknown`, so this module only ever classifies a
// result no declared test claims — fed one whose name and suite both resolve,
// the join-mismatch classifier would have no differing field to name.
//
// Pure and dependency-free (no fs, no Langium, no Date), like the rest of
// `src/verify/`.
// ---------------------------------------------------------------------------

import type { ExecTestRef, TestOutcome } from "../ir/types/loom-ir.js";
import type { ResultAttribution } from "./verification.js";

/** One runner report as the CLI read it: a label naming the flag + file, and
 *  the outcomes it contributed to the merged result list. */
export interface LabelledReport {
  label: string;
  outcomes: readonly TestOutcome[];
}

/** The declared tests the gate has no evidence for, and which tiers received
 *  no evidence at all. */
export interface MissingEvidence {
  /** Declared tests that verify a test case and had no attributed result. */
  refs: ExecTestRef[];
  /** Tiers that have missing tests AND received no result for ANY declared
   *  test of that tier — the fingerprint of a report that was not supplied. */
  silentKinds: ExecTestRef["kind"][];
}

const KIND_ORDER: readonly ExecTestRef["kind"][] = ["unit", "api", "ui"];

/** Human label for a test tier. */
const KIND_LABEL: Readonly<Record<ExecTestRef["kind"], string>> = {
  unit: "unit",
  api: "api e2e",
  ui: "ui e2e",
};

/** Which report a tier's results normally come from. */
const KIND_REPORT: Readonly<Record<ExecTestRef["kind"], string>> = {
  unit: "the backend unit-test runner's report",
  api: "the api e2e runner's report (vitest)",
  ui: "the ui e2e Playwright report (--from-playwright)",
};

/** Collect the missing declared tests and the tiers that went entirely
 *  unreported. */
export function missingEvidence(
  execTests: readonly ExecTestRef[],
  attribution: ResultAttribution,
): MissingEvidence {
  const refs: ExecTestRef[] = [];
  const reported = new Set<ExecTestRef["kind"]>();
  for (const ref of execTests) {
    const hits = attribution.byRef.get(ref) ?? [];
    if (hits.length > 0) reported.add(ref.kind);
    else if (ref.testCaseId != null) refs.push(ref);
  }
  const missingKinds = new Set(refs.map((r) => r.kind));
  const silentKinds = KIND_ORDER.filter((k) => missingKinds.has(k) && !reported.has(k));
  return { refs, silentKinds };
}

/** The clause that explains a missing-evidence gate failure — appended after
 *  "N declared test(s) had no matching result (…)".  Names a missing report
 *  first (cause 1), then a join mismatch (cause 2), and otherwise says plainly
 *  that every supplied result was accounted for (cause 3).
 *
 *  A silent tier is only called a missing report OUTRIGHT when every result
 *  was attributed: if some result matched no declared test, that tier's
 *  report may well have been passed with drifted titles, so both readings
 *  are named and the join mismatch is spelled out. */
export function describeMissingCause(
  missing: MissingEvidence,
  attribution: ResultAttribution,
  execTests: readonly ExecTestRef[],
  serviceSlugs: readonly string[],
): string {
  const clauses: string[] = [];
  const unknown = attribution.unknown;
  for (const kind of missing.silentKinds) {
    const n = missing.refs.filter((r) => r.kind === kind).length;
    const label = KIND_LABEL[kind];
    clauses.push(
      unknown.length === 0
        ? `no result for ANY ${label} test was supplied (${n} of the missing test(s) are ${label}),` +
            ` so ${KIND_REPORT[kind]} was most likely not passed — each runner project writes its own report,` +
            ` and --from-vitest / --from-playwright / --results are repeatable: pass every one`
        : `no result was attributed to ANY ${label} test (${n} of the missing test(s) are ${label}):` +
            ` either ${KIND_REPORT[kind]} was not passed, or it was and its titles do not match`,
    );
  }
  if (unknown.length > 0) {
    clauses.push(
      `${unknown.length} result(s) matched no declared test` +
        describeJoinMismatch(execTests, unknown, serviceSlugs),
    );
  } else if (missing.silentKinds.length === 0) {
    clauses.push(
      "every supplied result was attributed to a declared test, so the missing test(s) did not run" +
        " in the supplied report(s) — filtered out, or in a report that was not passed",
    );
  }
  return clauses.length > 0 ? ` — ${clauses.join("; and ")}` : "";
}

/** Per-report warnings: a report that contributed nothing to the join is
 *  almost certainly the wrong file, and with several reports merged it would
 *  otherwise vanish without a trace. */
export function reportWarnings(
  reports: readonly LabelledReport[],
  attribution: ResultAttribution,
): string[] {
  const out: string[] = [];
  for (const r of reports) {
    if (r.outcomes.length === 0) {
      out.push(`${r.label} contains no test results`);
      continue;
    }
    const attributed = r.outcomes.filter(
      (o) => attribution.linked.has(o) || attribution.unlinked.has(o),
    ).length;
    if (attributed === 0) {
      out.push(
        `none of the ${r.outcomes.length} result(s) in ${r.label} matched a declared test` +
          ` — check it is a report of this model's generated suites`,
      );
    }
  }
  return out;
}

/** Name the field that ACTUALLY differs when a result matched no declared
 *  test, for the gate-failure message.
 *
 *  An api-e2e result's suite is correct and its NAME carries the
 *  ` against <slug>` suffix `e2e-render.ts` appends, so asserting a `suite`
 *  mismatch unconditionally names the right suite as the wrong thing.  So
 *  classify: compare the reported pair against the declared pairs and report
 *  the side that does not line up.
 *
 *  `unknown` must hold only results NO declared test claims (the
 *  `attributeResults` contract) — a result of a declared test with no
 *  `verifies` resolves on both fields and has no mismatch to name. */
export function describeJoinMismatch(
  execTests: readonly ExecTestRef[],
  unknown: readonly TestOutcome[],
  serviceSlugs: readonly string[],
): string {
  const first = unknown[0];
  if (!first) return "";
  const got = `{name: ${JSON.stringify(first.name)}, suite: ${JSON.stringify(first.suite ?? null)}}`;
  const quoted = (xs: string[]): string =>
    xs
      .slice(0, 3)
      .map((x) => JSON.stringify(x))
      .join(", ") + (xs.length > 3 ? ", …" : "");

  // Undo the ` against <slug>` replay suffix the way the join does, so the
  // rest of the classification compares the same name the join compared.
  let effective = first.name;
  const at = first.name.lastIndexOf(" against ");
  if (at > 0) {
    const stem = first.name.slice(0, at);
    const slug = first.name.slice(at + " against ".length);
    if (execTests.some((t) => t.name === stem)) {
      // The stem IS declared.  Either the slug names a real deployable (so
      // the suffix resolves and any remaining mismatch is the suite), or it
      // does not — which is its own, very specific, breakage.
      if (serviceSlugs.includes(slug)) {
        effective = stem;
      } else {
        return (
          ` — reported ${got}: ${JSON.stringify(stem)} IS declared, but ${JSON.stringify(slug)}` +
          ` is not a deployable of this model, so the \` against <deployable>\` replay suffix` +
          ` could not be resolved`
        );
      }
    }
  }

  // Only a declared test in a DIFFERENT suite is a suite mismatch; quoting
  // the reported suite back as the "declared" one would contradict itself.
  const byName = execTests.filter((t) => t.name === effective && t.suite !== first.suite);
  const bySuite = execTests.filter((t) => t.suite === first.suite);
  if (byName.length > 0) {
    const behind =
      effective === first.name ? "" : ` (whose declared name is ${JSON.stringify(effective)})`;
    return (
      ` — the SUITE does not match: reported ${got}${behind}, but that test is declared with` +
      ` suite ${quoted([...new Set(byName.map((t) => t.suite))])}`
    );
  }
  if (bySuite.length > 0) {
    return (
      ` — the NAME does not match: reported ${got}; suite` +
      ` ${JSON.stringify(first.suite ?? null)} is correct, but no declared test in it is called` +
      ` that (declared there: ${quoted([...new Set(bySuite.map((t) => t.name))])})`
    );
  }
  return (
    ` — neither field matches a declared test: reported ${got}` +
    ` (the join wants the AGGREGATE name as the suite for a unit test,` +
    ` "<System> e2e" for an e2e test)`
  );
}

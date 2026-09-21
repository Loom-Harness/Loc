// ---------------------------------------------------------------------------
// Verification rollup — joins test-execution results onto the traceability
// graph to produce a per-requirement Definition-of-Done verdict.
//
// This is the missing `TEST_EXECUTION → DoD` step of the traceability model:
// the graph already knows which executable tests back each testCase
// (`TraceabilityIR.execTests` / `execTestsByTestCase`) and which testCases
// verify each requirement (`TraceabilityIR.testsByRequirement`, already
// rolled up through child requirements).  Given the results of running
// those tests, this computes the obvious join.
//
// The join is by (suite, name): a unit-test name is unique only within an
// aggregate, so `name` alone is ambiguous.  `ExecTestRef.suite` is the
// suite `collectExecTests` records (aggregate name for unit tests,
// `"<System> e2e"` for e2e tests).
//
// TITLE NORMALIZATION.  The runner does not always report that (suite, name)
// pair verbatim — two emitters deliberately report a different title, and
// the join has to undo the difference or every `verifies` on a `test e2e`
// block is dead:
//
//   • an api-e2e title carries a ` against <serviceSlug>` SUFFIX, because
//     `src/system/e2e-render.ts` replays one `test e2e` block against every
//     compatible backend deployable and the suffix is what names the
//     diverging backend in a multi-backend failure.  The declared name
//     therefore never appears verbatim in an api-e2e report.
//   • a ui-e2e SUITE is the spec file, because the generated `.ui.spec.ts`
//     (`src/system/ui-e2e-render.ts`) carries no `describe` — so Playwright
//     reports the file as the top-level suite while `collectExecTests`
//     recorded `"<System> e2e"`.
//
// Both are undone on the RESULT side (`resolveResults`), so the emitters keep
// the titles they want.  Normalization is deliberately EXACT, never a loose
// prefix match: see `aliasedNames` for the four conditions, the last of
// which drops an ambiguous title rather than guessing — one result can never
// be attributed to two different declared tests.
//
// Pure and dependency-free (no fs, no Langium, no Date) so both the CLI
// (`ddd verify`) and the in-browser playground runner consume the same
// function.  Deterministic: identical inputs → deep-equal output.
// ---------------------------------------------------------------------------

import type {
  ExecTestRef,
  RequirementVerdict,
  TestCaseStatus,
  TestOutcome,
  TraceabilityIR,
  VerificationIR,
} from "../ir/types/loom-ir.js";

/** The slice of the traceability index the rollup needs. */
export type VerificationIndex = Pick<TraceabilityIR, "execTests" | "testsByRequirement">;

/** Join inputs that are NOT derivable from the traceability index.
 *
 *  `serviceSlugs` is the compose-service slug of every deployable in the
 *  model (`serviceSlug(d.name)` — see `src/system/index.ts`), which is the
 *  exact set of suffixes an api-e2e title can carry.  Supply it and the
 *  suffix set is closed; omit it and a suffix is accepted on its shape
 *  alone (a single slug token), which is looser but still unambiguous. */
export interface VerificationJoinInfo {
  serviceSlugs?: readonly string[];
}

/** The separator `src/system/e2e-render.ts` puts before the backend slug. */
const AGAINST = " against ";

/** `serviceSlug()` lowercases a deployable name and underscore-splits its
 *  camel humps, so a slug is exactly one `[a-z0-9]+(_[a-z0-9]+)*` token.
 *  Used to bound the suffix when the caller supplies no slug set. */
const SLUG_SHAPE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

/** Append `value` to the array stored at `key`, creating it if absent. */
function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  let arr = map.get(key);
  if (!arr) {
    arr = [];
    map.set(key, arr);
  }
  arr.push(value);
}

/** One result with its reported title resolved back onto the declared
 *  (suite, name).  `outcome` is the ORIGINAL object, so `consumed` /
 *  `unknownTests` keep reporting what the runner actually said. */
interface ResolvedOutcome {
  outcome: TestOutcome;
  /** Declared name this result is attributed to (suffix undone). */
  name: string;
  /** Declared suite this result is attributed to, or undefined when the
   *  result carried none. */
  suite: string | undefined;
}

/** Reported api-e2e title → the declared name it is a replay of.
 *
 *  A title is un-suffixed only when ALL FOUR hold — this is what keeps the
 *  normalization exact rather than a prefix match:
 *
 *  1. the title is not itself a declared name (a verbatim report wins, so a
 *     unit or ui title is never mistaken for a suffixed one);
 *  2. the declared test it would attribute to is `kind: "api"` — the only
 *     kind whose emitter appends the suffix;
 *  3. the remainder after ` against ` is a single service-slug token, and a
 *     REAL deployable slug whenever the caller supplied the set; and
 *  4. exactly one declared name satisfies 2–3.  A title that could be a
 *     replay of two different declared tests is dropped, not guessed, so it
 *     is reported as unmatched instead of over-attributing a verdict. */
function aliasedNames(
  execTests: readonly ExecTestRef[],
  results: readonly TestOutcome[],
  slugs: ReadonlySet<string> | undefined,
): Map<string, string> {
  const declared = new Set(execTests.map((t) => t.name));
  // Only an api-e2e title is suffixed; unit (`describe("<Agg>")`) and ui
  // (Playwright, no describe) titles are emitted verbatim.
  const suffixed = [...new Set(execTests.filter((t) => t.kind === "api").map((t) => t.name))];
  const alias = new Map<string, string>();
  for (const r of results) {
    if (declared.has(r.name) || alias.has(r.name)) continue; // (1), and done already
    const hits = suffixed.filter((name) => {
      if (!r.name.startsWith(name + AGAINST)) return false; // (2)
      const slug = r.name.slice(name.length + AGAINST.length);
      return SLUG_SHAPE.test(slug) && (slugs === undefined || slugs.has(slug)); // (3)
    });
    if (hits.length === 1) alias.set(r.name, hits[0]!); // (4)
  }
  return alias;
}

/** Reported ui-e2e suite → the declared `"<System> e2e"` suite.
 *
 *  The generated `.ui.spec.ts` has no `describe`, so a Playwright report's
 *  top-level suite title is the spec FILE (`<System>.ui.spec.ts`, with or
 *  without a directory prefix) while `collectExecTests` recorded
 *  `"<System> e2e"`.  Only a ui-kind declared suite is aliased, and only
 *  from the exact file title its own system emits. */
function aliasedSuites(
  execTests: readonly ExecTestRef[],
  results: readonly TestOutcome[],
): Map<string, string> {
  const alias = new Map<string, string>();
  for (const ref of execTests) {
    if (ref.kind !== "ui") continue;
    if (!ref.suite.endsWith(" e2e")) continue;
    const system = ref.suite.slice(0, -" e2e".length);
    const file = `${system}.ui.spec.ts`;
    for (const r of results) {
      if (r.suite === undefined || alias.has(r.suite)) continue;
      if (r.suite === file || r.suite.endsWith(`/${file}`)) alias.set(r.suite, ref.suite);
    }
  }
  return alias;
}

/** Undo the two deliberate title divergences on every result. */
function resolveResults(
  index: VerificationIndex,
  results: readonly TestOutcome[],
  slugs: ReadonlySet<string> | undefined,
): ResolvedOutcome[] {
  const nameAlias = aliasedNames(index.execTests, results, slugs);
  const suiteAlias = aliasedSuites(index.execTests, results);
  return results.map((outcome) => ({
    outcome,
    name: nameAlias.get(outcome.name) ?? outcome.name,
    suite:
      outcome.suite === undefined ? undefined : (suiteAlias.get(outcome.suite) ?? outcome.suite),
  }));
}

/** Pick the result for one executable test.  Prefer an exact
 *  (suite, name) match; fall back to a name-only match when the result
 *  carries no suite AND the name is unique across the whole test set.
 *  Returns the chosen outcome, or undefined when nothing ran for it.
 *
 *  `sharedNames` holds every test name claimed by more than one
 *  `ExecTestRef`.  Without it, a single suiteless result
 *  `{name:"create works"}` was attributed to EVERY same-named ref — so two
 *  aggregates each declaring `test "create works"` (verifying different
 *  requirements) both went VERIFIED off one run, over-attributing a false
 *  green (and symmetrically over-attributing a FAIL). */
function outcomeFor(
  ref: ExecTestRef,
  byName: Map<string, ResolvedOutcome[]>,
  sharedNames: ReadonlySet<string>,
): ResolvedOutcome | undefined {
  const named = byName.get(ref.name);
  if (!named || named.length === 0) return undefined;
  const exact = named.filter((r) => r.suite === ref.suite);
  if (exact.length > 0) return worst(exact);
  // No suite-qualified match.  Only attribute a bare-name result when it
  // can't be confused with another test of the same name — i.e. the name
  // is owned by exactly one executable test.
  if (sharedNames.has(ref.name)) return undefined;
  const suiteless = named.filter((r) => r.suite === undefined);
  if (suiteless.length > 0) return worst(suiteless);
  return undefined;
}

/** Of several runs of one test, the most pessimistic: fail > skip > pass. */
function worst(rs: ResolvedOutcome[]): ResolvedOutcome {
  return (
    rs.find((r) => r.outcome.status === "fail") ??
    rs.find((r) => r.outcome.status === "skip") ??
    rs[0]!
  );
}

/**
 * @param index           the precomputed traceability slice (read, not recomputed)
 * @param requirementIds  every requirement id, in source order (stable output)
 * @param results         normalized test outcomes from any runner
 * @param join            optional model facts the index cannot carry — the
 *                        deployable slugs that close the api-e2e suffix set
 */
export function computeVerification(
  index: VerificationIndex,
  requirementIds: readonly string[],
  results: readonly TestOutcome[],
  join?: VerificationJoinInfo,
): VerificationIR {
  const slugs = join?.serviceSlugs ? new Set(join.serviceSlugs) : undefined;
  const resolved = resolveResults(index, results, slugs);

  const byName = new Map<string, ResolvedOutcome[]>();
  for (const r of resolved) {
    pushInto(byName, r.name, r);
  }

  // Names claimed by more than one executable test.  A suiteless result can
  // only be safely attributed to a bare name when that name is unique — two
  // tests sharing a name make an unqualified result ambiguous.
  const nameCounts = new Map<string, number>();
  for (const ref of index.execTests) {
    nameCounts.set(ref.name, (nameCounts.get(ref.name) ?? 0) + 1);
  }
  const sharedNames = new Set<string>();
  for (const [name, count] of nameCounts) {
    if (count > 1) sharedNames.add(name);
  }

  // Group executable tests by the testCase they verify.  `testCaseId`
  // is a resolved cross-reference (the linker rejects a `verifies <TC>`
  // that doesn't exist — it lands as null), so every non-null id here
  // names a declared testCase.
  const refsByTestCase = new Map<string, ExecTestRef[]>();
  for (const ref of index.execTests) {
    if (ref.testCaseId == null) continue; // unlinked test — not part of any verdict
    pushInto(refsByTestCase, ref.testCaseId, ref);
  }

  const consumed = new Set<TestOutcome>();
  const testCases: VerificationIR["testCases"] = {};
  const testCaseStatus = new Map<string, TestCaseStatus>();

  for (const tcId of [...refsByTestCase.keys()].sort()) {
    const refs = refsByTestCase.get(tcId)!;
    const backing: { name: string; status: string }[] = [];
    let anyFail = false;
    let anyNotPassed = false; // any non-pass: missing, skip, or fail

    for (const ref of refs) {
      const hit = outcomeFor(ref, byName, sharedNames);
      if (hit) consumed.add(hit.outcome);
      const status = hit ? hit.outcome.status : "missing";
      if (status === "fail") anyFail = true;
      if (status !== "pass") anyNotPassed = true;
      backing.push({ name: ref.name, status });
    }

    const status: TestCaseStatus = anyFail ? "FAILING" : anyNotPassed ? "UNVERIFIED" : "VERIFIED";
    testCaseStatus.set(tcId, status);
    testCases[tcId] = { status, backing };
  }

  const requirements: VerificationIR["requirements"] = {};
  let verified = 0;
  let failing = 0;
  let untested = 0;
  let unverified = 0;

  for (const reqId of requirementIds) {
    const tcIds = (index.testsByRequirement[reqId] ?? []).slice().sort();
    const failingTestCaseIds = tcIds.filter((id) => testCaseStatus.get(id) === "FAILING");

    let verdict: RequirementVerdict;
    if (tcIds.length === 0) {
      verdict = "UNTESTED";
      untested++;
    } else if (failingTestCaseIds.length > 0) {
      verdict = "FAILING";
      failing++;
    } else if (tcIds.every((id) => testCaseStatus.get(id) === "VERIFIED")) {
      verdict = "VERIFIED";
      verified++;
    } else {
      verdict = "UNVERIFIED";
      unverified++;
    }
    requirements[reqId] = { verdict, testCaseIds: tcIds, failingTestCaseIds };
  }

  // Results that ran but matched no declared executable test (e.g. a
  // hand-written test, or a renamed one).  Surfaced, never scored.
  const unknownTests = results.filter((r) => !consumed.has(r));

  return {
    version: 1,
    testCases,
    requirements,
    summary: {
      verified,
      failing,
      untested,
      unverified,
      total: requirementIds.length,
    },
    diagnostics: { unknownTests, unmappedTestCases: [] },
  };
}

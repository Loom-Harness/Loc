// ---------------------------------------------------------------------------
// Traceability
// ---------------------------------------------------------------------------

export type RequirementType = "UserStory" | "UseCase" | "AcceptanceCriteria" | "BusinessReq";

export type RequirementStatus = "Draft" | "Approved" | "InProgress" | "Done";

export interface RequirementIR {
  id: string;
  type: RequirementType;
  title: string;
  status?: RequirementStatus;
  priority?: number;
  /** Parent requirement id (hierarchy), or undefined for a root. */
  parentId?: string;
}

/** The kind of code symbol a CodeRefIR points at — read off the
 *  resolved AST node's type at lowering time so backends never
 *  re-resolve. */
export type CodeRefKind =
  | "subdomain"
  | "context"
  | "aggregate"
  | "operation"
  | "valueobject"
  | "event"
  | "repository"
  | "workflow"
  | "deployable"
  | "api";

/** A resolved, qualified reference from a Solution/TestCase into the
 *  domain model (`Identity.Auth.LoginSession.start`). */
export interface CodeRefIR {
  qualifiedName: string;
  kind: CodeRefKind;
}

export interface SolutionIR {
  id: string;
  /** Requirement this solution justifies (`for <req>`). */
  forRequirement: string;
  title: string;
  /** Code symbols this solution legitimises (`entitles [...]`). */
  entitles: CodeRefIR[];
}

export interface TestCaseIR {
  id: string;
  /** Requirement this test case verifies (`verifies <req>`). */
  verifies: string;
  title: string;
  /** Code symbols this test case exercises (`covers [...]`). */
  covers: CodeRefIR[];
}

/** Derived traceability / coverage index built by `enrichLoomModel`
 *  in one pure pass.  Every report generator reads these precomputed
 *  views rather than recomputing — the same contract `wireShape` has. */
export interface TraceabilityIR {
  /** Requirement id → its direct child requirement ids. */
  childrenOf: Record<string, string[]>;
  /** Requirement id → TestCase ids that verify it directly OR verify
   *  one of its (transitive) descendants. */
  testsByRequirement: Record<string, string[]>;
  /** Requirement id → Solution id justifying it, or null if none. */
  solutionByRequirement: Record<string, string | null>;
  /** Every targetable code symbol referenced anywhere, keyed by
   *  qualified name (union of all entitles + covers). */
  codeElements: Record<string, CodeRefKind>;
  /** Code qualified name → TestCase ids that `cover` it. */
  testsByCodeElement: Record<string, string[]>;
  /** Code qualified name → ids of executable tests (TestIR /
   *  TestE2EIR names) whose `verifies` testCase covers it. */
  execTestsByCodeElement: Record<string, string[]>;
  /** TestCase id → executable-test names backing it (via the test's
   *  `verifies` back-link). */
  execTestsByTestCase: Record<string, string[]>;
  /** Flat provenance list of every executable test, carrying the
   *  `suite` + `kind` that identify it in a runner's results.  The
   *  verification rollup joins results to testCases through this
   *  (names alone are unique only within an aggregate). */
  execTests: ExecTestRef[];
}

/** One executable test located for the verification join.  `suite`
 *  matches the runner's reported suite EXACTLY: the aggregate name for
 *  a unit test (`describe("<Aggregate>")`) and `"<System> e2e"` for an
 *  api/ui e2e test (`describe("<System> e2e")`). */
export interface ExecTestRef {
  name: string;
  suite: string;
  kind: "unit" | "api" | "ui";
  /** TestCase id from the test's `verifies` clause, or null. */
  testCaseId: string | null;
}

// ---------------------------------------------------------------------------
// Verification (Definition of Done) — the runtime overlay on the
// traceability graph.  Given test-execution results, `computeVerification`
// (`src/verify/verification.ts`) rolls each testCase up to a status and
// each requirement up to a verdict.  Pure: it reads the precomputed
// `TraceabilityIR` index + a normalized result list, nothing else.
// ---------------------------------------------------------------------------

/** One executed test, normalized from any runner (the playground
 *  harness's `TestResult`, a vitest/xUnit/Playwright JSON report, …). */
export interface TestOutcome {
  /** Display name — the DSL `test`/`test e2e` string, emitted verbatim
   *  as `it("…")` / `[Fact(DisplayName="…")]` / `test("…")`. */
  name: string;
  status: "pass" | "fail" | "skip";
  /** Optional disambiguators when a `name` is not unique model-wide
   *  (unit-test names are unique only within an aggregate). */
  suite?: string;
  kind?: string;
}

export type TestCaseStatus = "VERIFIED" | "FAILING" | "UNVERIFIED";

export type RequirementVerdict = "VERIFIED" | "FAILING" | "UNTESTED" | "UNVERIFIED";

export interface VerificationIR {
  version: 1;
  testCases: Record<
    string,
    { status: TestCaseStatus; backing: { name: string; status: string }[] }
  >;
  requirements: Record<
    string,
    {
      verdict: RequirementVerdict;
      testCaseIds: string[];
      failingTestCaseIds: string[];
    }
  >;
  summary: {
    verified: number;
    failing: number;
    untested: number;
    unverified: number;
    total: number;
  };
  diagnostics: {
    /** Result rows that matched no declared executable test at all. */
    unknownTests: TestOutcome[];
    /** Result rows of a declared executable test that carries no
     *  `verifies` — real tests, just not evidence for any test case. */
    unlinkedTests: TestOutcome[];
    /** TestCase ids referenced by a test's `verifies` that don't exist. */
    unmappedTestCases: string[];
  };
}

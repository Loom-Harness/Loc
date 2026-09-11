/**
 * Hand-written types for the plain-node report script beside this file.
 *
 * `ci-budget-report.mjs` stays `.mjs` on purpose — it is run directly
 * (`node test/behavioral/ci-budget-report.mjs`) as the one-command
 * re-derivation of the budget table, so it must not need a build step.  But
 * `timeout-budgets.test.ts` imports its two pure helpers precisely so the rule
 * cannot be restated in the test and drift from the one the report prints, and
 * an untyped import defeats that: at `any`, `budgetFor("20m")` type-checks.
 *
 * `tsconfig.test.json` includes only `test/**\/*.ts` and does not set `allowJs`,
 * so a sibling declaration file is what gives the import a real signature.
 */

/** The rule: 50 % margin over the observed p95, rounded up to 5 minutes, floor 10. */
export declare const budgetFor: (p95Seconds: number) => number;

/** One step of a GitHub Actions job, as the REST API returns it. */
export interface JobStep {
  started_at: string | null;
  completed_at: string | null;
}

/**
 * Job EXECUTION seconds = the sum of the job's step durations — NOT its wall
 * time, which the API measures from QUEUE time and which therefore reads far
 * over the cap on a job that merely waited.  Steps that started but never
 * completed are skipped; see the test for why that filter is load-bearing.
 */
export declare const jobExecSeconds: (job: { steps?: JobStep[] | null }) => number;

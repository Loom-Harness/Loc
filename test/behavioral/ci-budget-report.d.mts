// Type surface of ci-budget-report.mjs for the tests that import it under the
// `test/` typecheck (tsconfig.test.json): the script itself is plain ESM.
export declare const budgetFor: (p95Seconds: number) => number;
export declare const jobExecSeconds: (job: {
  steps?: Array<{ started_at?: string | null; completed_at?: string | null }>;
}) => number;

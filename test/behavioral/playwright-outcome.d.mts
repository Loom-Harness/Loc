// Types for the plain-JS `playwright-outcome.mjs` (shared Playwright report classification).

export interface SkipAllowance {
  readonly title: string;
  readonly reason: string;
}
export interface Outcome {
  readonly name: string;
  readonly status: "pass" | "fail";
  readonly error?: string;
}
export function judgePlaywrightReport(
  json: unknown,
  opts?: { allowSkips?: readonly SkipAllowance[] },
): { ok: boolean; summary: string; outcomes: Outcome[] };
export function outcomesFromPlaywrightJson(json: unknown, opts?: { allowSkips?: readonly SkipAllowance[] }): Outcome[];

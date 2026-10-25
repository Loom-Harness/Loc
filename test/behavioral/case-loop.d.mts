// Types for the plain-JS `case-loop.mjs` — the per-case loop the behavioural
// runners share.  Only the pure half is typed: the runners that use the loop
// itself are untyped node scripts.

import type { ExpectedFailure } from "./registers.mjs";

/** Outcome kinds, in pipeline order. */
export const OUTCOMES: readonly ("error" | "fail" | "wire" | "pass")[];

export interface ObservedOutcome {
  readonly kind: string;
  readonly message?: string;
  readonly failures?: readonly { readonly name: string; readonly error: string }[];
}

/** Judge one observed case outcome against its register entry. */
export function settle(
  entry: ExpectedFailure | null,
  observed: ObservedOutcome,
): { verdict: "ok" | "xfail" | "xpass" | "mismatch"; detail?: string };

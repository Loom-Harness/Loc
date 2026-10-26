// The optional THIRD argument of an e2e operation call —
// `api.<aggs>.<op>(id, body, { ifMatch: <version> })` — which sends the
// optimistic-concurrency `If-Match` precondition header.
//
// One reading shared by the validator (`e2e-route-checks.ts`, which refuses any
// other shape as `loom.e2e-call-options`) and the renderer
// (`src/system/e2e-render.ts`, which turns it into the header), so the two can
// never disagree about what the argument means: a third argument the renderer
// dropped would leave a test that MEANT to send a stale precondition sending
// none.
//
// Scope is every operation whose write-path contract reads `If-Match`
// (`operationVersionCheck`, `ir/enrich/version-check.ts`) — each named
// operation of a `versioned` aggregate.  A backend that does not honour it yet
// fails the case under a tracked expected failure; the test still states the
// contract.

import { operationVersionCheck, readsIfMatch } from "../enrich/version-check.js";
import type { AggregateIR, ExprIR } from "../types/loom-ir.js";

/** The one key the options object accepts. */
export const E2E_IF_MATCH_OPTION = "ifMatch";

/** The parsed options argument: `undefined` when the call passes none, the
 *  `ifMatch` expression when it is the accepted `{ ifMatch: <expr> }` literal,
 *  `"malformed"` for any other shape. */
export function readE2eCallOptions(
  arg: ExprIR | undefined,
): { readonly ifMatch: ExprIR } | "malformed" | undefined {
  if (arg === undefined) return undefined;
  if (arg.kind !== "object" || arg.fields.length !== 1) return "malformed";
  const [field] = arg.fields;
  if (field?.name !== E2E_IF_MATCH_OPTION) return "malformed";
  return { ifMatch: field.value };
}

/** Does this operation's route read `If-Match` (its write-path contract)? */
export function e2eIfMatchApplies(agg: AggregateIR, opName: string): boolean {
  const op = agg.operations.find((o) => o.name === opName);
  return op !== undefined && readsIfMatch(operationVersionCheck(agg, op));
}

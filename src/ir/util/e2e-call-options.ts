// The optional THIRD argument of an e2e operation call —
// `api.<aggs>.update(id, body, { ifMatch: <version> })` — which sends the
// optimistic-concurrency `If-Match` precondition header (M-T6.91).
//
// One reading shared by the validator (`e2e-route-checks.ts`, which refuses any
// other shape as `loom.e2e-call-options`) and the renderer
// (`src/system/e2e-render.ts`, which turns it into the header), so the two can
// never disagree about what the argument means.  Before this, a third argument
// parsed, validated and was silently DROPPED by the renderer.
//
// Scope is the `update` operation of a `versioned` aggregate: that is the one
// route every backend reads `If-Match` on (elixir's named operations do not),
// and the one `api-surface.ts` declares the `ConcurrencyConflict` 409 for.

import type { AggregateIR, ExprIR } from "../types/loom-ir.js";
import { aggregateIsVersioned } from "./versioned-capability.js";

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

/** Does every backend read `If-Match` on this operation's route? */
export function e2eIfMatchApplies(agg: AggregateIR, opName: string): boolean {
  return opName === "update" && aggregateIsVersioned(agg);
}

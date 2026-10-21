// ---------------------------------------------------------------------------
// Where an explicit `route <METHOD> <PATH> -> <Ctx>.<Handler>` is MOUNTED.
//
// The contract: an explicit route is a DOMAIN route, so it serves
// under the shared `API_BASE_PATH` — `route POST "/echo/{text}"` answers at
// `POST /api/echo/hi` on every backend.  That is not a per-backend preference:
// `src/system/e2e-render.ts` builds EVERY routed-handler request as
// `base + API_BASE_PATH + <declared path>` for all five platforms, and
// `src/util/api-base.ts` states the rule ("domain routes live under `/api`,
// infra endpoints stay at the root").
//
// A slot an explicit route shares with the auto-derived REST surface (the
// `with scaffoldHandlers` + `with scaffoldApi` shape mirrors that surface 1:1)
// belongs to the explicit route: the derived surface YIELDS it
// (D-EXPLICIT-ROUTE-WINS, `BoundedContextIR.explicitRouteSlots`), so the two
// never land on one slot.  That matters because the frameworks resolve a
// double registration differently — elixir fails `mix compile
// --warnings-as-errors` on the unreachable `do_match` clause, .NET throws
// `AmbiguousMatchException` and java `Ambiguous handler methods mapped` at
// request time, node and python silently serve whichever mounted first.
// ---------------------------------------------------------------------------

import type { EnrichedBoundedContextIR, RouteIR } from "../../ir/types/loom-ir.js";
import {
  deriveContextOperations,
  explicitRouteSlot,
  routeSlot,
} from "../../ir/util/api-surface.js";
import { API_BASE_PATH } from "../../util/api-base.js";

/**
 * The `{token}` names in a route path — the params bound from the URL rather
 * than the request body.
 *
 * The .NET, java and python route emitters each still carry a private copy of
 * this three-liner; this is the shared one, and a new consumer takes it from
 * here rather than adding a fourth.
 */
export function pathParamNames(path: string): Set<string> {
  const names = new Set<string>();
  for (const m of path.matchAll(/\{(\w+)\}/g)) names.add(m[1]!);
  return names;
}

/** The path an explicit route serves at, absolute from the host root —
 *  `/api/echo/{text}`.  The emitters that render a full absolute path (.NET's
 *  `[Http*]` template, java's `@*Mapping`) take it from here. */
export function explicitRoutePath(route: RouteIR): string {
  return `${API_BASE_PATH}${route.path}`;
}

/** Does this explicit route take over a slot of the auto-derived surface?
 *  A router that matches in registration order (Phoenix) must place such a
 *  route where the derived one would have gone — after the derived static
 *  finds it would otherwise shadow (`GET /orders/{orderId}` registered ahead
 *  of `GET /orders/by_status` swallows it). */
export function claimsDerivedSlot(
  route: RouteIR,
  contexts: readonly EnrichedBoundedContextIR[],
): boolean {
  const slot = explicitRouteSlot(route);
  return contexts.some((ctx) =>
    deriveContextOperations(ctx).some((op) => routeSlot(op.method, op.path) === slot),
  );
}

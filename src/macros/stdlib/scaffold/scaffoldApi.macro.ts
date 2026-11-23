import type { Route, Subdomain } from "../../../language/generated/ast.js";
import { defineMacro, sendRoute } from "../../api/index.js";
import {
  canRecordName,
  canRoutePath,
  handlerTargets,
  permissionQueryTargets,
  targetMethod,
  targetPath,
  targetRecordName,
} from "./_handlers-shared.js";

/** Emit a `route <METHOD> <path> -> <Context>.<Handler>` for every eligible
 * source of every aggregate across the named subdomain's contexts
 * (unfoldable-api-derivation.md, A3 + A3.2).  The HTTP method and path depend on
 * the source kind:
 *
 *   api SalesApi with scaffoldApi(of: Sales)
 *
 *   ↓ SalesApi gains
 *
 *   route GET  "/orders/by_status"          -> Ordering.ByStatus
 *   route GET  "/orders/{id}"               -> Ordering.GetOrderById
 *   route POST "/orders"                    -> Ordering.CreateOrder
 *   route POST "/orders/{id}/cancel"        -> Ordering.CancelOrder
 *   route GET  "/orders/{id}/can_ship"      -> Ordering.canShipOrder
 *
 * Host-local: the routes splice into the api's own `routes[]`.  The route's
 * method, path, and handler segment are all derived from the SAME
 * `handlerTargets` selection + `target*` helpers that `scaffoldHandlers` uses,
 * so a route always resolves to a handler that macro emitted.
 *
 * Each aggregate's finds are emitted BEFORE its get-by-id.  These routes own
 * their slots outright (D-EXPLICIT-ROUTE-WINS), and node, python and elixir
 * match in registration order — `GET /orders/{id}` registered first would
 * swallow `GET /orders/by_status`.
 * `scaffoldHandlers` must be applied to each targeted context
 * (`context X with scaffoldHandlers`) to supply those handlers. */
export default defineMacro({
  name: "scaffoldApi",
  target: "api",
  late: true,
  apiVersion: 1,
  description:
    "Emits a route per operation, create, and get-by-id read of every " +
    "aggregate in the named subdomain — POST for writes, GET for reads — " +
    "targeting the handler scaffoldHandlers emits for it.",
  params: {
    of: { kind: "ref", of: "Subdomain" },
  },
  expand({ args }) {
    const sub = args.of as Subdomain;
    const out: Route[] = [];
    for (const ctx of sub.contexts ?? []) {
      for (const t of handlerTargets(ctx)) {
        out.push(sendRoute(targetMethod(t), targetPath(t), ctx.name, targetRecordName(t)));
      }
      // The permission queries: `GET /<coll>/{id}/can_<op>`, the slot the
      // derived probe would otherwise serve (an explicit route claims it).
      for (const { agg, op } of permissionQueryTargets(ctx)) {
        out.push(
          sendRoute(
            "GET",
            canRoutePath(agg.name, op.name),
            ctx.name,
            canRecordName(op.name, agg.name),
          ),
        );
      }
    }
    return out;
  },
});

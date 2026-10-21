import type { Route } from "../../../language/generated/ast.js";
import { defineMacro, handlerRef, route } from "../../api/index.js";
import {
  criterionAggName,
  type PagedReadSource,
  pagedHandlerName,
  pagedRoutePath,
} from "./_paged-shared.js";

/** Emit the `route` half of the ergonomic paged criterion / retrieval read
 * (read-path-architecture.md, "The ergonomic default").  The transport twin of
 * `scaffoldPaged`:
 *
 *   api SalesApi with scaffoldPagedApi(of: InRegion) { }
 *
 *   ↓ SalesApi gains
 *
 *   route GET "/orders/projections/in_region" -> Sales.ListOrderByInRegion
 *
 * The scaffolded read mounts on the aggregate's collection route under the
 * `/projections` namespace (the locked home for scaffolded reads — Phase-3
 * sign-off).  `of:` is the same criterion or retrieval `scaffoldPaged` reads;
 * method, path, and handler segment all derive from it (the aggregate +
 * context both come off its `of T` target and its container context), so the
 * route always resolves to the handler that macro emits — `scaffoldPaged` must
 * be applied to the read's context (`context X with scaffoldPaged(of: <read>)`)
 * to supply it.  The gate is the handler's (`scaffoldPaged(requires:)`). */
export default defineMacro({
  name: "scaffoldPagedApi",
  target: "api",
  apiVersion: 1,
  description:
    "Emits the GET route (on the aggregate collection route + /projections) that " +
    "binds to the paged queryHandler scaffoldPaged emits for the named criterion or retrieval.",
  params: {
    of: { kind: "ref", of: ["Criterion", "Retrieval"] },
  },
  expand({ args }) {
    const crit = args.of as PagedReadSource;
    const aggName = criterionAggName(crit);
    // The read is a context member — its container context hosts the
    // handler `scaffoldPaged` splices, so it is the route's handler-ref context.
    const ctx = crit.$container;
    if (!ctx?.name) return [];
    const out: Route[] = [
      route(
        "GET",
        pagedRoutePath(aggName, crit.name),
        handlerRef(ctx.name, pagedHandlerName(aggName, crit.name)),
      ),
    ];
    return out;
  },
});

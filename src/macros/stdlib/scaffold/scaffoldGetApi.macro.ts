import type { Route } from "../../../language/generated/ast.js";
import { defineMacro, handlerRef, route } from "../../api/index.js";
import { getHandlerName, getReadSource, getRoutePath } from "./_get-shared.js";

/** Emit the `route` half of the single-row read — the transport twin of
 *  `scaffoldGet`, as `scaffoldPagedApi` is `scaffoldPaged`'s:
 *
 *   api ShopApi with scaffoldGetApi(of: ByCode) from Sales { }
 *
 *   ↓ ShopApi gains
 *
 *   route GET "/orders/by_code" -> Shop.GetOrderByCode
 *
 *  The path is the one a declared repository `find` named like the read had
 *  (`find byCode(code)` → `GET /orders/by_code?code=…`): the read's params ride
 *  the query string, and the handler answers the aggregate or 404, so a client
 *  of the find keeps its URL.  `of:` / `key:` are the same arguments
 *  `scaffoldGet` reads, and the handler name and path derive from them, so the
 *  route always names the handler that macro emits — `scaffoldGet` must be
 *  applied to the read's context to supply it.  The gate is the handler's
 *  (`scaffoldGet(requires:)`). */
export default defineMacro({
  name: "scaffoldGetApi",
  target: "api",
  apiVersion: 1,
  description:
    "Emits the GET route (on the aggregate collection route + the read's name) that binds " +
    "to the single-row queryHandler scaffoldGet emits for the same criterion or unique key.",
  params: {
    of: { kind: "ref", of: ["Criterion", "Aggregate"] },
    key: { kind: "string", default: "" },
  },
  expand({ args }) {
    const src = getReadSource(args.of, args.key, "scaffoldGetApi");
    // The read's container context hosts the handler `scaffoldGet` splices,
    // so it is the route's handler-ref context.
    const host = src.kind === "criterion" ? src.criterion.$container : src.aggregate.$container;
    const ctxName = host?.$type === "BoundedContext" ? host.name : undefined;
    if (!ctxName) return [];
    const out: Route[] = [
      route("GET", getRoutePath(src), handlerRef(ctxName, getHandlerName(src))),
    ];
    return out;
  },
});

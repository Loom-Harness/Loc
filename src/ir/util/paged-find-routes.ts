// Which route serves a SYNTHESIZED paged find — the client side of the
// paged-run read (`scaffoldPaged` / a hand-written paged `queryHandler`).
//
// Enrich synthesizes a paged find for every paged-run handler
// (`findAllBy<Criterion>` / `page<Retrieval>`) and flags it `synthesized`, so
// the aggregate router never derives `GET /<plural>/<find>` for it.  The only
// HTTP surface it has is the explicit `route` an api binds to the handler —
// what `scaffoldPagedApi` emits.  A frontend hook for such a find must
// therefore call THAT route, and a find no served api routes has no client at
// all.  Both the frontend api-module emitters and the page-read validator read
// this one derivation, so the hook and the gate cannot disagree.

import { pagedReturn } from "../stdlib/generics.js";
import type { DeployableIR, FindIR, RouteIR, SystemIR } from "../types/loom-ir.js";
import { pagedRunFindName, pagedRunStmt } from "./paged-run.js";

/** aggregate name → synthesized paged find name → the route serving it. */
export type PagedFindRoutes = ReadonlyMap<string, ReadonlyMap<string, RouteIR>>;

/** The routes `backend` serves for synthesized paged finds: every `GET` route
 *  on an api the backend `serves:` whose target is a paged-run queryHandler and
 *  whose path carries no `{token}` — a client hook sends a paged read's
 *  arguments as the query string, which is the shape `scaffoldPagedApi` emits.
 *  The first route wins when two bind the same handler. */
export function pagedFindRoutes(
  sys: Pick<SystemIR, "apis" | "subdomains">,
  backend: Pick<DeployableIR, "serves"> | undefined,
): PagedFindRoutes {
  const out = new Map<string, Map<string, RouteIR>>();
  if (!backend) return out;
  const contexts = new Map(sys.subdomains.flatMap((s) => s.contexts).map((c) => [c.name, c]));
  for (const apiName of backend.serves) {
    const api = sys.apis.find((a) => a.name === apiName);
    for (const route of api?.routes ?? []) {
      if (route.method.toUpperCase() !== "GET" || route.path.includes("{")) continue;
      const h = contexts
        .get(route.target.context)
        ?.queryHandlers?.find((q) => q.name === route.target.handler);
      if (!h || h.extern || !pagedReturn(h.returnType)) continue;
      const run = pagedRunStmt(h);
      if (!run) continue;
      const byFind = out.get(run.aggName) ?? new Map<string, RouteIR>();
      const find = pagedRunFindName(run);
      if (!byFind.has(find)) byFind.set(find, route);
      out.set(run.aggName, byFind);
    }
  }
  return out;
}

/** The route a frontend hook calls for `find`, or `undefined` when the find is
 *  synthesized and no served api routes it (so no hook is emitted).  A
 *  declared find keeps its derived `/<plural>/<find>` route: `null` says "use
 *  the derived path". */
export function servedFindRoute(
  aggName: string,
  find: Pick<FindIR, "name" | "synthesized">,
  routes: PagedFindRoutes | undefined,
): RouteIR | null | undefined {
  if (!find.synthesized) return null;
  return routes?.get(aggName)?.get(find.name);
}

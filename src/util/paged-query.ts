// The paged list read's query vocabulary, shared by the IR (validation, the
// emitters) and the typing pass (the `test e2e` client's list query).

/** The query parameters every backend adds to a `paged` read, in wire
 *  spelling: the two paging controls plus the server-side sort pair (M-T2.6).
 *  The union across all five backends and the frontend api clients —
 *  Hono/zod and the `_frontend` client (`page`/`pageSize`/`sort`/`dir`), .NET
 *  `CS_PAGED_QUERY_PARAMS`, Spring `JAVA_PAGED_QUERY_PARAMS`, FastAPI
 *  `PY_PAGED_CONTROLS` + `sort`/`dir`, Phoenix `page_param(params, "page" |
 *  "pageSize")` + `Map.get(params, "sort" | "dir")`.
 *
 *  A paged read's OWN parameter may not reuse one of these names
 *  (`loom.paged-param-reserved`): it would be a second value for the same HTTP
 *  query key and a duplicate parameter in every generated repository / service
 *  / controller signature. */
export const PAGED_QUERY_PARAMS: readonly string[] = ["page", "pageSize", "sort", "dir"];

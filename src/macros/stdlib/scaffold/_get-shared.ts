// Shared selection + naming logic for the single-row read scaffold macros.
// `scaffoldGet` (context-targeted) emits the `queryHandler` over one lookup —
// `Repo.find(<Criterion>(args))` or `Repo.getBy(<key>: …)` — and
// `scaffoldGetApi` (api-targeted) emits the `route` that binds to it, so the
// two MUST agree on the derived handler name and route path.  Both derive
// everything here, the way `scaffoldPaged` / `scaffoldPagedApi` share
// `_paged-shared.ts`.
//
// The route answers on the URL a declared repository `find` used to have —
// `GET /<aggs>/<snake read name>?<param>=…` — so a client of the find keeps its
// URL: a criterion `ByCode(code)` of `Order` mounts at `/orders/by_code`, and a
// unique key `(code)` reads the same `/orders/by_code`.  A bodyless method's
// params ride the query string (`routedParamSource`), which is the find's wire.

import type { Aggregate, Criterion } from "../../../language/generated/ast.js";
import { snake, upperFirst } from "../../../util/naming.js";
import { collectionPath } from "./_handlers-shared.js";
import { criterionAggName } from "./_paged-shared.js";

/** What a single-row scaffold reads: the first match of a criterion, or the
 *  row a declared `unique (…)` key names. */
export type GetReadSource =
  | { kind: "criterion"; criterion: Criterion; aggName: string }
  | { kind: "key"; aggregate: Aggregate; aggName: string; columns: string[] };

/** Resolve the macros' `of:` / `key:` arguments.  `of:` is a criterion, or the
 *  aggregate whose `unique (…)` tuple `key:` names (comma-separated columns).
 *  Throws (a call-site diagnostic) on a shape neither form covers. */
export function getReadSource(of: unknown, key: string, macro: string): GetReadSource {
  const node = of as { $type?: string; name?: string };
  const cols = key
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  if (node.$type === "Criterion") {
    if (cols.length > 0)
      throw new Error(
        `${macro}: 'key:' names a unique key of an aggregate — pass 'of: <Aggregate>, key: "${key}"', ` +
          `or drop 'key:' to read the criterion '${node.name}'`,
      );
    const criterion = of as Criterion;
    return { kind: "criterion", criterion, aggName: criterionAggName(criterion) };
  }
  if (node.$type === "Aggregate") {
    if (cols.length === 0)
      throw new Error(
        `${macro}(of: ${node.name}) needs 'key:' — the columns of a declared unique (…) key ` +
          `(\`key: "code"\`), or pass a criterion as 'of:'`,
      );
    return {
      kind: "key",
      aggregate: of as Aggregate,
      aggName: node.name ?? "",
      columns: cols,
    };
  }
  throw new Error(`${macro}: 'of:' must be a criterion, or an aggregate with 'key:'`);
}

/** The read's name segment: the criterion's name, or `By<Col>And<Col>` for a
 *  key (`(code)` → `ByCode`). */
export function getReadName(src: GetReadSource): string {
  return src.kind === "criterion"
    ? src.criterion.name
    : `By${src.columns.map((c) => upperFirst(c)).join("And")}`;
}

/** The handler name: `Get<Agg>By<Read>` (`ByCode` of `Order` →
 *  `GetOrderByCode`; `OpenFor` → `GetTicketByOpenFor`).  The single source of
 *  truth for the `queryHandler` name and the route's handler segment. */
export function getHandlerName(src: GetReadSource): string {
  const read = upperFirst(getReadName(src));
  return `Get${upperFirst(src.aggName)}${read.startsWith("By") ? read : `By${read}`}`;
}

/** The route path: the aggregate collection route plus the snake-cased read
 *  name (`ByCode` of `Order` → `/orders/by_code`), the shape a declared find's
 *  route had. */
export function getRoutePath(src: GetReadSource): string {
  return `${collectionPath(src.aggName)}/${snake(getReadName(src))}`;
}

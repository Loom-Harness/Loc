import { snake } from "../../util/naming.js";

/** The per-aggregate CRUD functions the generated context module defines
 *  itself, keyed by the verb before `_<agg>`: `get_<agg>/1` (by-id load),
 *  `create_<agg>`, `update_<agg>`, `delete_<agg>`, `change_<agg>/0..2`
 *  (form changeset) and `destroy_<agg>!`. */
const CONTEXT_FACADE_VERBS: ReadonlySet<string> = new Set([
  "get",
  "create",
  "update",
  "delete",
  "change",
  "destroy",
]);

/** The context-module function a declared repository `find` is re-exported
 *  under — `<find>_<agg>`, the defdelegate every caller goes through (find
 *  controller, workflow / handler loads, domain-service reads, tests).  A find
 *  whose verb is one of the context's own CRUD verbs is escaped with a `_find`
 *  suffix (`get` on `Order` → `get_order_find`), since `get_order/1` is the
 *  built-in by-id load; so no find name is reserved because of this backend.
 *  `aggregate` is the aggregate's declared (PascalCase) name. */
export function elixirFindFacadeFn(findName: string, aggregate: string): string {
  const verb = snake(findName);
  const fn = `${verb}_${snake(aggregate)}`;
  return CONTEXT_FACADE_VERBS.has(verb) ? `${fn}_find` : fn;
}

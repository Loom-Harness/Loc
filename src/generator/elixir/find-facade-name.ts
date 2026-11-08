import { snake } from "../../util/naming.js";

/** The context-module function a repository `find` is re-exported under —
 *  `<find>_<agg>`, the defdelegate every caller goes through (find controller,
 *  workflow / handler loads, domain-service reads, tests).  `aggregate` is the
 *  aggregate's declared (PascalCase) name.
 *
 *  No collision with the context's own CRUD functions (`get_<agg>`,
 *  `create_<agg>`, …) is possible: every find is compiler-synthesized
 *  (`all`, `findBy…`, `getBy…`, `findFirst…`, `findAllBy…`, `page…`), so none
 *  is named by a bare CRUD verb. */
export function elixirFindFacadeFn(findName: string, aggregate: string): string {
  return `${snake(findName)}_${snake(aggregate)}`;
}

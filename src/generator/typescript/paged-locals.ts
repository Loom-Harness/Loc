// ---------------------------------------------------------------------------
// Collision-free names for the locals a PAGED find method declares.
//
// Every node repository's `find … paged` method body declares bookkeeping
// locals (`offset`, `total`, `totalPages`, `items`, the sort whitelist, …) in
// the SAME function scope as the find's own parameters.  A find param that
// happens to share one of those names — `find byTotal(total: int): X paged` —
// redeclared it: `const total = …` against a `total: number` parameter is
// TS2300 "Duplicate identifier" in the generated project, with no diagnostic
// from `ddd parse`.  The param name is the user's (it is the route's query
// field and the `where` clause reads it), so the method's OWN locals step
// aside instead: a colliding local gets a `__` prefix (more `_`s until free),
// and a non-colliding one keeps its name — byte-identical output for every
// find that has no collision.
//
// Only the locals a paged branch declares in its own body are handled here;
// the locals the shared hydration/load helpers hardcode, which every find
// shape declares too (`rootIds`, `<part>Rows`, `rows`, `all`, `em`), are the
// same collision class on the unpaged finds and are not renamed.
// ---------------------------------------------------------------------------

import { escapeTsIdent } from "../../util/naming.js";

/** The binding names a find's params occupy in the method scope. */
export function findParamBindings(params: readonly { name: string }[]): string[] {
  return params.map((p) => escapeTsIdent(p.name));
}

/** Map each method-local name to one that no param binding (and no other
 *  local) already occupies.  Identity when nothing collides. */
export function pagedLocalNames<K extends string>(
  locals: readonly K[],
  paramBindings: readonly string[],
): Record<K, string> {
  const taken = new Set<string>([...paramBindings, ...locals]);
  const out = {} as Record<K, string>;
  for (const l of locals) {
    if (!paramBindings.includes(l)) {
      out[l] = l;
      continue;
    }
    let n = `__${l}`;
    while (taken.has(n)) n = `_${n}`;
    taken.add(n);
    out[l] = n;
  }
  return out;
}

/** The `{ items, page, pageSize, total, totalPages }` envelope literal, with a
 *  `key: value` pair wherever the value is not the same-named local
 *  (shorthand otherwise) — a renamed local, or an `items: []` literal. */
export function pagedEnvelopeLiteral(n: {
  items: string;
  total: string;
  totalPages: string;
}): string {
  const f = (k: string, v: string) => (k === v ? k : `${k}: ${v}`);
  return `{ ${f("items", n.items)}, page, pageSize, ${f("total", n.total)}, ${f("totalPages", n.totalPages)} }`;
}

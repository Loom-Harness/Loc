// ---------------------------------------------------------------------------
// Collision-free names for the locals a node repository READ method declares.
//
// Every node repository read method — a `find … paged`, an array or single-row
// find, a `run<Retrieval>` — declares its own names (`offset`, `total`,
// `items`, `query`, `rootRows`, `rootIds`, `result`, the run method's trailing
// call-site `page?` parameter, …) in the SAME function scope as the read's own
// parameters.  A param that happens to share one of those names —
// `criterion ByRows(rootRows: int)` read through `run…` — redeclared it:
// `const rootRows = …` against a `rootRows: number` parameter is TS2300
// "Duplicate identifier" in the generated project, with no diagnostic from
// `ddd parse`.  The param name is the user's (it is the route's query field and
// the `where` clause reads it), so the method's OWN names step aside instead: a
// colliding name gets a `__` prefix (more `_`s until free), and a non-colliding
// one keeps its name — byte-identical output for every read that has no
// collision.  The shared bulk-load helpers take the owner-ids local's name, so
// a renamed `rootIds` reaches them.
//
// The per-containment locals the hydration helpers derive from a field name
// (`<part>Rows`, `<part>ByParent`, `<field>JoinRows`) are not renamed.
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

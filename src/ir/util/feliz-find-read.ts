// What a repository find must look like for the Feliz frontend to READ it.
//
// The Feliz frontend issues a find as `GET /<aggs>/<find>?<param>=…` from the
// Elmish `init` (and from a paging control's `update` arm), and decodes the
// aggregate's own wire record.  That fixes three limits the JS frontends do not
// have, because they build the request inside the rendering component:
//
//   * a parameter must be a SCALAR the query string can spell — no list, value
//     object, or record;
//   * the return must be the aggregate itself (`T`, `T?`, `T[]`, `T paged`) —
//     not a primitive or a list of primitives;
//   * every argument must be resolvable where the fetch is built: a literal,
//     page `state {}` cell, store field, enum value or the route `id`.  A row
//     binding (`For { each: rows, r => … byName(r.name) }`), a page param or a
//     `derived` is not in scope in `init`.
//
// ONE definition, two consumers: the phase-⑦ vocabulary gate
// (`ui-body-vocabulary-checks.ts`, feature `find-read-*`) refuses what these
// reject, and the Feliz read builder (`generator/feliz/wire.ts`) asks the same
// predicates before it emits, keeping its throw as the backstop.

import { upperFirst } from "../../util/naming.js";
import { pagedReturn } from "../stdlib/generics.js";
import type { ExprIR, FindIR, TypeIR } from "../types/loom-ir.js";

/** Primitive parameter types the Feliz find request can carry in a query
 *  string — each has a spelling in `wire.ts`'s `findParamQueryValue`. */
const FELIZ_FIND_QUERY_PRIMITIVES: ReadonlySet<string> = new Set([
  "int",
  "long",
  "decimal",
  "money",
  "bool",
  "datetime",
  "string",
  "guid",
  "json",
]);

/** True when a find parameter of type `t` can travel in the Feliz query string. */
export function felizFindParamSupported(t: TypeIR): boolean {
  const base = t.kind === "optional" ? t.inner : t;
  if (base.kind === "primitive") return FELIZ_FIND_QUERY_PRIMITIVES.has(base.name);
  return base.kind === "id" || base.kind === "enum";
}

/** True when the Feliz frontend can decode `find`'s return into `aggregate`'s
 *  wire record: `T`, `T?`, `T[]` or `T paged`. */
export function felizFindReturnDecodable(find: FindIR, aggregate: string): boolean {
  const paged = pagedReturn(find.returnType);
  const ret = paged ? paged.arg : find.returnType;
  const inner = ret.kind === "optional" ? ret.inner : ret;
  const elem = inner.kind === "array" ? inner.element : inner;
  return elem.kind === "entity" && upperFirst(elem.name) === upperFirst(aggregate);
}

/** True when a `ref` inside a find ARGUMENT resolves where the Feliz frontend
 *  builds the fetch — a store field, an enum value, or one of the hosting
 *  body's `state {}` cells. */
export function felizFindArgRefResolvable(
  e: Extract<ExprIR, { kind: "ref" }>,
  stateNames: ReadonlySet<string>,
): boolean {
  return e.refKind === "store-field" || e.refKind === "enum-value" || stateNames.has(e.name);
}

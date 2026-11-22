// -------------------------------------------------------------------------
// Tiny helpers shared by all four shape repositories (relational /
// embedded / document / event-sourced): the `raw(...)` fragment detector,
// the tenant-scoped `maskUserImport` line, and the repository-method
// parameter-type renderer.  Split out of mikroorm.ts by packet 2.6
// (wave-2) — mechanical move, no logic change.
// -------------------------------------------------------------------------

import type { ReadOrderTerm } from "../../../ir/enrich/read-scope.js";
import { clientSortTieBreak, singleReadOrder } from "../../../ir/plan/index.js";
import type {
  EnrichedAggregateIR,
  FindIR,
  RepositoryIR,
  TypeIR,
} from "../../../ir/types/loom-ir.js";
import { findUsesCurrentUser } from "../../../ir/types/loom-ir.js";
import { snake } from "../../../util/naming.js";
import { renderTsType } from "../render-expr.js";
import { aggHasFieldMask } from "../repository-wire-builder.js";
import { TT } from "../ts-symbols.js";

/**
 * The `User` type-only import a `mask unless` aggregate's repository needs.
 *
 * Every MikroORM repository variant emits `toWireMaskedMethod(agg, ctx.payloads)` when the
 * aggregate carries a `mask unless` field, and that method's signature is
 * `toWireMasked(root: T, currentUser: User | null)` — so the file names `User`
 * and must import it.  All four variants emitted the method without the import,
 * which made `mask unless` × `persistence: mikroorm` fail `tsc` with TS2304
 * (M-T9.29 finding F3; the drizzle relational builder has always applied this
 * rule — `typescript/repository-builder.ts`).  One helper rather than four
 * inline conditions, so the next variant cannot forget it independently.
 */
/**
 * Does an emitted repository body call MikroORM's `raw()` fragment helper?
 *
 * Body-scanned exactly like the `requireCurrentUser()` accessor, and for the
 * same reason: a repository that emits no raw fragment must keep a
 * byte-identical import list.  The raw fragments are FilterQuery *keys* built
 * from SQL the operator vocabulary cannot spell — intrinsics, temporal
 * comparisons, reference-collection membership and principal tests.
 *
 * The negative lookbehind excludes a METHOD named `raw` (`x.raw(...)`), which
 * is not the imported helper.  The scan runs over the string-blanked body, so
 * the word cannot come from a string literal.
 */

export const usesRawFragment = (bodyScan: string): boolean => /(?<!\.)\braw\(/.test(bodyScan);

export const maskUserImport = (agg: EnrichedAggregateIR, repo?: RepositoryIR): string | false =>
  // …and the same rule now covers the SECOND way a repository names `User`: a
  // find whose `where` reads `currentUser` declares a trailing
  // `currentUser: User` parameter.  The event-sourced variant already spelled
  // this out (`repoUsesUser`); folding it in here keeps the other three from
  // rediscovering it one at a time.
  (aggHasFieldMask(agg) || (repo?.finds ?? []).some(findUsesCurrentUser)) &&
  `import type { User } from "../../auth/user-types";`;

/** TS type for a find parameter (id params are branded; scalars pass through). */

export function tsParamType(t: TypeIR): string {
  const inner = t.kind === "optional" ? t.inner : t;
  // A collection keeps its element type (`string[]`, `Ids.XId[]`); the shared
  // TS type renderer owns the element mapping.
  if (inner.kind === "array") return renderTsType(inner);
  if (inner.kind === "id") return `${TT.Ids}.${inner.targetName}Id`;
  if (inner.kind === "enum") return inner.name;
  if (inner.kind === "primitive") {
    switch (inner.name) {
      case "int":
      case "long":
        return "number";
      case "bool":
        return "boolean";
      case "datetime":
        return "Date";
      default:
        return "string";
    }
  }
  return "string";
}

/** `orderBy: { col: "asc", … }` — an `em.find` option over the row's own
 *  columns. */
export function mikroOrderBy(
  terms: readonly ReadOrderTerm[],
  codePoint: ReadonlySet<string> = new Set(),
): string {
  // MikroORM refuses a raw key beside field keys in one object, so a collated
  // order is the array form, one term per object (order preserved).
  if (terms.some((t) => codePoint.has(t.field))) {
    return `orderBy: [${mikroOrderTerms(terms, codePoint)}]`;
  }
  return `orderBy: { ${terms.map((t) => `${t.field}: "${t.direction}"`).join(", ")} }`;
}

/** The `orderBy` array entries of `terms`, one single-key map per term; a text
 *  or enum column sorts by code point (`COLLATE "C"`, the one sort order —
 *  `src/ir/plan/sort-order.ts`), through a `raw()` key. */
export function mikroOrderTerms(
  terms: readonly ReadOrderTerm[],
  codePoint: ReadonlySet<string> = new Set(),
): string {
  return terms
    .map((t) =>
      codePoint.has(t.field)
        ? `{ [raw(${JSON.stringify(`${snake(t.field)} collate "C"`)})]: "${t.direction}" }`
        : `{ ${t.field}: "${t.direction}" }`,
    )
    .join(", ");
}

/** The leading `orderBy` entry of a page sorted by the caller's `?sort=` key
 *  (`sortField`, already whitelisted) in `dir`: a text or enum column
 *  (`codePoint`) collates by code point through a `raw()` key, the rest sort
 *  by field.  The column map is a literal so a collated key needs no runtime
 *  casing. */
export function mikroClientSortEntry(
  sortField: string,
  fields: readonly string[],
  codePoint: ReadonlySet<string>,
): string {
  const dir = `dir === "desc" ? "desc" : "asc"`;
  const collated = fields.filter((f) => codePoint.has(f));
  if (collated.length === 0) return `{ [${sortField}]: ${dir} }`;
  const columns = collated
    .map((f) => `${JSON.stringify(f)}: ${JSON.stringify(snake(f))}`)
    .join(", ");
  return `(((c: Record<string, string>) => Object.hasOwn(c, ${sortField}) ? { [raw(\`\${c[${sortField}]} collate "C"\`)]: ${dir} } : { [${sortField}]: ${dir} })({ ${columns} }))`;
}

/** The `em.findOne` options of a single-row find: the first-match order, then
 *  its `ignoring` filter switch; `null` when it needs neither. */
export function mikroFindOneOptions(f: FindIR, ignoring: string | null): string | null {
  const order = singleReadOrder(f);
  const opts = [order ? mikroOrderBy(order) : null, ignoring].filter((o) => o);
  return opts.length > 0 ? `{ ${opts.join(", ")} }` : null;
}

/** The `orderBy` array entries a page sorted by the caller's `?sort=` key
 *  takes after that key (`clientSortTieBreak`), one single-key map per term so
 *  the terms keep their order. */
export function mikroClientSortTieBreak(): string {
  return clientSortTieBreak()
    .map((t) => `{ ${t.field}: "${t.direction}" }`)
    .join(", ");
}

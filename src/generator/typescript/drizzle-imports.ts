// Which `drizzle-orm` root symbols an emitted repository module must import —
// answered from the RENDERED BODY, not from a hand-kept candidate list.
//
// WHY THIS IS SHARED, AND WHY IT READS THE BODY.
//
// Every TypeScript repository emitter used to decide its `drizzle-orm` import
// the same way: accumulate a CANDIDATE set while walking the IR shapes it
// expects to render, then intersect that set with a regex scan of the body it
// actually rendered.  The intersection half is sound — it is what keeps a
// scalar-only repository's header clean.  The candidate half is the bug: it is
// a second, hand-maintained enumeration of "what this file renders", and it
// drifts from the real one the moment a new render site is added and the walk
// is not.
//
// That drift is silent.  The emitter builds strings, so nothing type-checks
// the output; `ddd generate system` reports `0 error(s)` and the project fails
// at `tsc --noEmit` with `TS2304: Cannot find name 'ne'`.  Concretely
// (eval F-009): query-time projections synthesise repository reads through
// `synthProjectionFinds` and render them with the SAME `findQueryMethod` as a
// declared find — but only `repo.finds` was in the candidate walk, so
// `projection … where t.status != Closed` emitted
//
//     .where(ne(schema.tickets.status, "Closed"))
//     import { and, asc, count, desc, eq, inArray } from "drizzle-orm";   // no `ne`
//
// Replacing the candidate half with the CLOSED VOCABULARY of drizzle-orm's
// root exports removes the second enumeration entirely.  The set of names a
// module imports is then a pure function of the text it emitted, which is the
// only description of "what this file renders" that cannot go stale.  A new
// render site — a new synthesised find, a new predicate shape, a new emitter —
// is covered the moment it emits, with nothing to remember.
//
// Over-listing here is free and under-listing is the only failure mode, so the
// vocabulary is deliberately generous: a name is imported only when the body
// CALLS it, so a symbol nothing renders costs nothing.

/**
 * drizzle-orm root exports an emitted repository / route module can render.
 *
 * Generous on purpose (see the header): membership here makes a name
 * *eligible*, and `drizzleImports` still requires the rendered body to call
 * it.  The comparison, logical, null, membership, range, pattern, ordering and
 * aggregate families are all listed even where no emitter reaches them today,
 * because the cost of a spare entry is zero and the cost of a missing one is a
 * generated project that does not compile.
 */
export const DRIZZLE_ORM_SYMBOLS: readonly string[] = [
  // comparison
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  // logical
  "and",
  "or",
  "not",
  // null
  "isNull",
  "isNotNull",
  // membership
  "inArray",
  "notInArray",
  "exists",
  "notExists",
  // range
  "between",
  "notBetween",
  // pattern
  "like",
  "notLike",
  "ilike",
  "notIlike",
  // array columns
  "arrayContains",
  "arrayContained",
  "arrayOverlaps",
  // ordering
  "asc",
  "desc",
  // aggregates
  "count",
  "countDistinct",
  "sum",
  "sumDistinct",
  "avg",
  "avgDistinct",
  "min",
  "max",
  // escape hatch — also reachable as a tagged template (`` sql`…` ``)
  "sql",
];

/**
 * Strip string / template contents from rendered source before scanning it for
 * symbol references.
 *
 * A name that appears only inside an error message, a log event or an
 * `.openapi("…")` label is not a reference, and importing on its say-so mints
 * a dead import (which Biome's generated-code gate then fails).  Backticks are
 * blanked too, but the blanking preserves the backtick delimiters so a
 * `` sql`…` `` tag is still visible as a call site.
 */
export function stripStringLiterals(src: string): string {
  return src
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, "``");
}

/**
 * True iff `src` calls `name` as a FREE symbol — `name(` or `` name` `` — and
 * not as a member (`d.gt(`) or the tail of a longer identifier (`rowCount(`).
 *
 * The lookbehind matters more than it looks.  Money arithmetic renders
 * decimal.js method chains (`new Decimal(a).gt(new Decimal(b))`), and a bare
 * `\bgt\(` scan reads that as a reference to drizzle's `gt` — which, against a
 * generous vocabulary, would mint an import the module never needed.  Anchored
 * at a non-identifier, non-dot boundary, a member call cannot masquerade as a
 * root call.
 */
export function callsFreeSymbol(src: string, name: string): boolean {
  return new RegExp(`(?<![.\\w$])${name}[(\`]`).test(src);
}

/**
 * The `drizzle-orm` names `body` actually calls, sorted.
 *
 * `body` is the module's rendered source — pass every fragment that lands in
 * the file, including anything hoisted outside the class (criterion predicate
 * functions render the same operators).
 */
export function drizzleImports(body: string): string[] {
  const scan = stripStringLiterals(body);
  return DRIZZLE_ORM_SYMBOLS.filter((name) => callsFreeSymbol(scan, name)).sort();
}

/**
 * The whole `import … from "drizzle-orm"` line for `body`, or `false` when it
 * calls none — the falsy form `lines(...)` drops.
 */
export function drizzleImportLine(body: string): string | false {
  const used = drizzleImports(body);
  return used.length > 0 && `import { ${used.join(", ")} } from "drizzle-orm";`;
}

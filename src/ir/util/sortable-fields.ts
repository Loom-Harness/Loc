// Server-side sort whitelist.
//
// A paged list endpoint accepts `?sort=<field>&dir=asc|desc` and applies a
// server-side ORDER BY.  The `<field>` must be validated against a fixed
// whitelist — an unrestricted column name is an injection / invalid-column
// risk, and only scalar root columns can be ordered by anyway.  The whitelist
// is derived from the aggregate's wire projection: the `id` token plus every
// scalar `property` field (primitive- or enum-typed — those map to a single
// root-table column).  Containments, derived fields, and value-object /
// entity-typed properties are excluded (not single orderable columns), and so
// is every field the read surface hides — `secret`/`internal` access and
// `mask unless` — because an accepted sort key over a hidden column is an
// ordering side-channel, not just a useless option.
//
// Shared across every backend's route/repo emitter, so the accepted sort keys
// agree across backends.  The scaffolded SERVER-paged list page marks only these
// columns `sortable:` — the macro runs on the AST, so it carries an AST-side twin
// (`serverSortable` in src/macros/stdlib/scaffold/_body-builders.ts), pinned
// equal to this list by test/macro/scaffold-sortable-allowlist.test.ts.  Change
// one, change both; never widen this list to match a frontend — that is the leak.

import type { AggregateIR } from "../types/loom-ir.js";

/** The ordered list of field names a paged list may be sorted by — `id` first,
 *  then the declared scalar and enum properties in declaration order.  Always
 *  non-empty.  A field is left off when ordering by it would disclose what the
 *  read surface hides:
 *    - a `token` field (the `rowVersion` concurrency token) is infrastructure,
 *      not a sort dimension;
 *    - a `secret` or `internal` field is never on the read surface, and as a
 *      `?sort=` key it would be an ordering oracle over the hidden column
 *      (binary-searchable through pagination);
 *    - a `mask unless` field: the mask is per caller and the sort enum is
 *      emitted once, so ordering by it would leak the value through row order;
 *    - a `provenanced` field crosses as its carrier, not a scalar. */
export function sortableFields(agg: AggregateIR): string[] {
  const out = ["id"];
  for (const f of agg.fields) {
    const access = f.access ?? "editable";
    if (access === "token" || access === "secret" || access === "internal") continue;
    if (f.maskUnless || f.provenanced) continue;
    if (f.type.kind === "primitive" || f.type.kind === "enum") out.push(f.name);
  }
  return out;
}

/** The ORDER a paged find takes its page in when the caller's `sort` key is
 *  not whitelisted, or `undefined` for the `id` fallback every paged read
 *  shares.  A find carrying a `defaultSort` (a retrieval's declared `sort:`)
 *  answers its declared terms, then `id` ascending as the tie-break so a page
 *  boundary never splits equal keys nondeterministically.  Field names are the
 *  candidate's own (first path segment — nested sort paths are refused at
 *  validation); each backend spells the column. */
export function defaultSortOrder(
  defaultSort:
    | readonly { path: readonly { name: string }[]; direction: "asc" | "desc" }[]
    | undefined,
): { field: string; direction: "asc" | "desc" }[] | undefined {
  if (!defaultSort || defaultSort.length === 0) return undefined;
  const terms = defaultSort.map((t) => ({
    field: t.path[0]!.name,
    direction: t.direction,
  }));
  if (!terms.some((t) => t.field === "id")) terms.push({ field: "id", direction: "asc" });
  return terms;
}

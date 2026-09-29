// RAW-ORM-ROW wire canonicalisation — the `datetime` half.
//
// Most node read routes serialise through the owning repository's `toWire()`,
// which puts every `datetime` through `canonicalIsoExpr` (RS-4 + RS-38: a whole
// second carries NO fraction).  Three routes do not have a repository to go
// through — they hand a raw persistence row straight to `httpCtx.json(...)`:
//
//   * a folded projection's list / by-key routes (`http/projections.ts`),
//   * an observable workflow's instance list / by-id routes (`http/workflows.ts`),
//   * a query-time projection over a RAW table (`http/query-projections.ts`).
//
// A `datetime` column arrives on those rows as a JS `Date` from BOTH adapters
// (drizzle's `timestamp(...)` defaults to `mode: "date"`; MikroORM's `datetime`
// hydrates a `Date`), and `JSON.stringify` then calls `Date.prototype.toJSON` —
// i.e. a bare `toISOString()`, which pads the fraction to three digits.  So a
// projection row observed on an exact second shipped `…T15:48:23.000Z` while the
// same instant read through the aggregate's own route shipped `…T15:48:23Z`, and
// the other four backends shipped the trimmed form too.  Latent by nature: it
// only fires when the instant has no sub-second part.
//
// .NET fixed the same class with ONE `CanonicalInstant.Format` reachable from
// every raw-`DateTime` serialization (`src/generator/dotnet/emit/
// canonical-instant.ts`) rather than per-route patches.  This module is the node
// twin: one emitted helper, built from `canonicalIsoExpr` so the trim literal
// still lives in exactly one place in the compiler — a fourth raw read route
// cannot spell the instant a second way.

import type { TypeIR, WireField } from "../../ir/types/loom-ir.js";
import { canonicalIsoExpr } from "./repository-wire-builder.js";

/** The emitted helper's name.  `__`-prefixed like `__intWire`, the other
 *  module-level helper the projection emitters write into generated files. */
export const RAW_INSTANT_FN = "__wireInstant";

/** Does a wire field of this type arrive off a raw persistence row as a JS
 *  `Date` (or an array of them)?  `optional` is unwrapped because a read-model
 *  column is nullable whether or not the field was declared `T?` — a fold writes
 *  only the fields its event carries, so a row is partial until every
 *  contributing event has landed. */
export function isInstantWireType(t: TypeIR): boolean {
  if (t.kind === "optional") return isInstantWireType(t.inner);
  if (t.kind === "array") return isInstantWireType(t.element);
  return t.kind === "primitive" && t.name === "datetime";
}

/** The raw-row prop names a read route over `shape` must canonicalise, in wire
 *  order.  Empty for a shape with no `datetime` — which is what keeps every
 *  datetime-free projection / workflow byte-identical.
 *
 *  `source: "id"` rows are skipped: the correlation token is already a string
 *  (the response DTO declares it `z.string()` for that reason). */
export function rawInstantFields(shape: readonly WireField[] | undefined): string[] {
  return (shape ?? [])
    .filter((f) => f.source !== "id" && isInstantWireType(f.type))
    .map((f) => f.name);
}

/** `rowExpr`, re-spread with each named prop put through the emitted helper —
 *  or `rowExpr` VERBATIM when there is nothing to canonicalise, so the
 *  no-datetime route keeps the exact text it has always had. */
export function rawRowWireExpr(rowExpr: string, fields: readonly string[]): string {
  if (fields.length === 0) return rowExpr;
  const conv = fields.map((n) => `${n}: ${RAW_INSTANT_FN}(${rowExpr}.${n})`).join(", ");
  return `{ ...${rowExpr}, ${conv} }`;
}

/** The module-level helper itself, emitted once into any generated file whose
 *  body calls it.  `unknown` in / `unknown` out because the call sites already
 *  cast the whole row to its `z.infer<…>` response type — and because a partial
 *  read-model row legitimately holds `null` where the `Date` is not yet known.
 *
 *  The `Array.isArray` arm serves a `datetime[]` column (drizzle
 *  `timestamp(...).array()`); it is reached only for a field whose DECLARED type
 *  is datetime-ish, so it can never re-spell some other array's elements. */
export function renderRawInstantHelper(): string[] {
  return [
    "/** A raw persistence row's `datetime` → the CANONICAL wire string (RS-4 +",
    " *  RS-38): ISO-8601 UTC in milliseconds, with NO fraction at all on a whole",
    " *  second.  Both adapters hand back a JS `Date` here, and `JSON.stringify`",
    " *  would serialise it through `toJSON` — a bare `toISOString()`, which always",
    " *  pads the fraction to `.000`, the one spelling no other backend ships. */",
    `function ${RAW_INSTANT_FN}(v: unknown): unknown {`,
    `  if (v instanceof Date) return ${canonicalIsoExpr("v")};`,
    `  if (Array.isArray(v)) return v.map(${RAW_INSTANT_FN});`,
    "  return v;",
    "}",
  ];
}

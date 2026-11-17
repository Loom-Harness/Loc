// The read-side access filter — which fields an API read discloses for each
// `FieldAccess` role.  A pure rule every layer reads; the
// write-side filters live beside the wire projection (`enrich/wire-projection.ts`).

import type { FieldAccess } from "../types/loom-ir.js";

/** Any structure carrying a resolved access role.  Both `WireField`
 * and `FieldIR` satisfy this — backends choose the shape that suits
 * the call site (wire shape includes the synthetic id row; field list
 * is property-only). */
export type WithAccess = { access?: FieldAccess };

/** Fields visible in an **API read** response (HTTP/OpenAPI surfaces).
 * Excludes:
 *   - `internal` — never exposed via API; views may still render it.
 *   - `secret`   — write-only, never disclosed in any read.
 * Everything else (editable, immutable, managed, token) is included. */
export function forApiRead<T extends WithAccess>(items: readonly T[]): T[] {
  return items.filter((f) => f.access !== "internal" && f.access !== "secret");
}

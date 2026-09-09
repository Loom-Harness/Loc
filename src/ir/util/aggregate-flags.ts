// ---------------------------------------------------------------------------
// Aggregate-set feature predicates — the "does any in-scope aggregate need
// feature X" booleans every backend orchestrator computes to presence-gate an
// emit (so a project without the feature stays byte-identical).  Each was
// hand-inlined per backend, verbatim apart from whether it iterates the merged
// context's aggregates (`merged.aggregates.some(...)`, dotnet/node/python) or
// the hosted contexts (`contexts.some((c) => c.aggregates.some(...))`,
// java/elixir) — both compute the same boolean, so the shared predicate takes
// the aggregate list and each caller keeps its own iteration shape.
//
// The leaf predicates (`aggregateIsVersioned`, `aggregateIsEventSourced`) live
// in sibling util modules; composing them once here keeps the "versioned OR
// event-sourced ⇒ concurrency" rule from drifting across five backends.
// ---------------------------------------------------------------------------

import { emitsRestDestroy } from "../enrich/wire-projection.js";
import type { AggregateIR, TypeIR } from "../types/loom-ir.js";
import { aggregateIsEventSourced } from "./resolve-datasource.js";
import { aggregateIsVersioned } from "./versioned-capability.js";

/** True when some aggregate needs the optimistic-concurrency (HTTP 409)
 *  machinery — it carries the `versioned` capability OR is event-sourced (an
 *  event-log append raises the same stale-write conflict on a
 *  `(stream_id, version)` collision).  Backends gate their concurrency error
 *  class + 409 arm on this; a project with neither stays byte-identical. */
export function aggregatesNeedConcurrency(aggregates: readonly AggregateIR[]): boolean {
  return aggregates.some((a) => aggregateIsVersioned(a) || aggregateIsEventSourced(a));
}

/** True when some aggregate declares a `unique` key — gates each backend's
 *  unique-violation (integrity → 409) handling. */
export function aggregatesHaveUniqueKeys(aggregates: readonly AggregateIR[]): boolean {
  return aggregates.some((a) => (a.uniqueKeys?.length ?? 0) > 0);
}

/** Peel `optional` / `array` wrappers off a field type. */
function unwrapType(t: TypeIR): TypeIR {
  let cur = t;
  while (cur.kind === "optional" || cur.kind === "array") {
    cur = cur.kind === "optional" ? cur.inner : cur.element;
  }
  return cur;
}

/** True when hard-deleting one of these aggregates can trip a Postgres
 *  `foreign_key_violation` (SQLSTATE 23503) — i.e. the project needs the
 *  still-referenced → `ReferencedInUse` (409 by default) arm.
 *
 *  A cross-aggregate `X id` field becomes a FK column with `ON DELETE RESTRICT`
 *  (`src/system/migrations-builder.ts`), so deleting a row another aggregate
 *  still points at fails at the database.  Every backend answers that with the
 *  resolved `ReferencedInUse` status instead of leaking a 500 — except java,
 *  which gated its whole `DataIntegrityViolationException` advice on
 *  `unique (...)` keys, so a model with a reference and no unique key answered
 *  500 where the other four answered 409.  This predicate is that arm's own
 *  gate; a project that can't trip 23503 stays byte-identical.
 *
 *  Both halves are required: something must be REST-deletable, and something
 *  must hold a reference to an in-scope aggregate. */
export function aggregatesCanTripReferencedDelete(aggregates: readonly AggregateIR[]): boolean {
  if (!aggregates.some((a) => emitsRestDestroy(a))) return false;
  const names = new Set(aggregates.map((a) => a.name));
  return aggregates.some((a) =>
    a.fields.some((f) => {
      const t = unwrapType(f.type);
      return t.kind === "id" && names.has(t.targetName);
    }),
  );
}

/** True when a WRITE against one of these aggregates can trip a Postgres
 *  `foreign_key_violation` (SQLSTATE 23503) by naming a reference row that
 *  does not exist — i.e. the project needs the dangling-reference → domain-floor
 *  (422 by default) arm.
 *
 *  The twin of `aggregatesCanTripReferencedDelete`, on the OTHER side of the same
 *  constraint.  A cross-aggregate `X id` field becomes a FK column, so a create
 *  (or an operation) that carries a WELL-FORMED uuid for a row that is absent
 *  fails at the database — and every backend leaked that as a 500, because each
 *  one's 23503 handling was written for the still-referenced DELETE and lives on
 *  the delete path only.  Wire validation cannot catch it: a uuid is only wrong
 *  because the row is missing, which nothing above the database knows.
 *
 *  Parts count: a contained entity's `X id` field (`OrderLine.productId`) is a
 *  FK column on the part's own table, reachable from the operation that appends
 *  it.  `aggregatesCanTripReferencedDelete` looks at aggregate fields alone
 *  because it only needs SOME reference to exist for a restrict-delete to be
 *  possible; this one gates the arm that answers for the reference itself. */
export function aggregatesCanTripDanglingReference(aggregates: readonly AggregateIR[]): boolean {
  const names = new Set(aggregates.map((a) => a.name));
  return aggregates.some((a) => aggregateCanTripDanglingReference(a, names));
}

/** The per-aggregate leaf of `aggregatesCanTripDanglingReference`, for the
 *  backends whose error mapper is per-aggregate (the Hono router's `onError`)
 *  rather than app-global.  `inScope` is the set of aggregate names whose tables
 *  exist in the same schema — the caller's context, exactly as the app-global
 *  form derives it from the merged aggregate list. */
export function aggregateCanTripDanglingReference(
  agg: AggregateIR,
  inScope: ReadonlySet<string>,
): boolean {
  return (
    outboundReferenceFields(agg.fields, inScope).length > 0 ||
    agg.parts.some((p) => outboundReferenceFields(p.fields, inScope).length > 0)
  );
}

/** The fields in `fields` that carry a cross-aggregate `X id` pointing at an
 *  in-scope aggregate — i.e. the ones that become FK columns.  A SELF reference
 *  (`parent: Self id?`, the `tenantRegistry` tree) counts: its FK can dangle
 *  exactly like any other.  The list form is for backends that need the field
 *  NAMES, not just the boolean (the Ecto changeset's per-column
 *  `foreign_key_constraint`). */
export function outboundReferenceFields<F extends { type: TypeIR }>(
  fields: readonly F[],
  inScope: ReadonlySet<string>,
): F[] {
  return fields.filter((f) => {
    const t = unwrapType(f.type);
    return t.kind === "id" && inScope.has(t.targetName);
  });
}

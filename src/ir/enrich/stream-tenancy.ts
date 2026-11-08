// Phase ⑥ stream-tenancy fact — where an event-sourced `tenantOwned`
// aggregate keeps its tenant, and which read restrictions its stream reads
// apply.
//
// An event-sourced aggregate (`persistedAs: eventLog`) has no state row to
// carry a `tenantId` column: its truth is its stream in the per-context
// `<ctx>_events` log.  So the tenant lives ON THE STREAM, as METADATA of every
// stored event — the `tenant_id` / `data_key` columns of the event-log row
// (and the `tenantid` / `datakey` extension attributes of the CloudEvents
// channel envelope) — never in an event payload, which stays pure domain data.
//
//   - Stamped once, when the stream is created: the creation command's
//     append takes the `tenantOwned` capability's `onCreate` stamp
//     (`tenantId := currentUser.<claim>`, `dataKey := currentUser.orgPath`)
//     from the request principal.  Every later append copies the stream's
//     tenant forward from the loaded aggregate, never from the caller.
//   - Folded back: a load hydrates the aggregate's `tenantId` / `dataKey`
//     fields (the capability's internal fields) from the stream's metadata, so
//     the folded instance answers exactly like a `tenantOwned` row.
//   - Scoped: every stream load, list and append-load applies the tenancy
//     restrictions of the aggregate's `readScope` fact, rendered over the
//     metadata columns — the same predicate a `tenantOwned` table applies over
//     its own columns, because the metadata columns carry the same field
//     names.  A foreign tenant's by-id load finds no stream (404), its list
//     never sees one, and it can't append to one it cannot load.
//
// The fact is DERIVED, never stamped: a pure function of the aggregate's
// `capabilities`, `persistedAs`, `contextStamps` and read scope.

import type {
  AggregateIR,
  BoundedContextIR,
  ContextStampAssignmentIR,
  EventIR,
} from "../types/loom-ir.js";
import type { AggPool } from "../util/inheritance.js";
import {
  hasTenantOwned,
  TENANT_OWNED_DATA_KEY_FIELD,
  TENANT_OWNED_TENANT_ID_FIELD,
} from "../util/tenant-stance.js";
import { type ReadRestriction, type ReadScopeOptions, readScopeFor } from "./read-scope.js";

/** One tenant metadata slot of a stored event: the aggregate field it folds
 *  into and the event-log column that stores it. */
export interface StreamTenantMetadataField {
  /** The `tenantOwned` field on the aggregate (`tenantId` / `dataKey`). */
  field: string;
  /** The event-log column (`tenant_id` / `data_key`). */
  column: string;
  /** False for `data_key`: a principal with no org path stamps null. */
  required: boolean;
}

/** The tenant metadata every stored event of a tenant-scoped stream carries,
 *  in column order.  `data_key` rides along under flat tenancy too — the
 *  `orgPath` claim falls back to the tenant itself there, exactly as on a
 *  `tenantOwned` table — so the deep/global scopes a `policy` widens to always
 *  have their column. */
export const STREAM_TENANT_METADATA: readonly StreamTenantMetadataField[] = [
  { field: TENANT_OWNED_TENANT_ID_FIELD, column: "tenant_id", required: true },
  { field: TENANT_OWNED_DATA_KEY_FIELD, column: "data_key", required: false },
];

/** The stream-tenancy fact of one event-sourced `tenantOwned` aggregate. */
export interface StreamTenancy {
  aggregate: string;
  /** The metadata the stream's events carry. */
  metadata: readonly StreamTenantMetadataField[];
  /** The assignments that stamp a NEW stream's metadata from the principal —
   *  the capability's `onCreate` stamp, nothing else. */
  stamp: readonly ContextStampAssignmentIR[];
  /** The restrictions every stream read applies at the store, over the
   *  metadata columns: the `tenancy` restrictions of the aggregate's read scope
   *  (the floor, or a `policy`-widened deep/global subtree sentinel), with the
   *  read's `ignoring` clause applied. */
  restrictions: readonly ReadRestriction[];
}

const METADATA_FIELDS = new Set(STREAM_TENANT_METADATA.map((m) => m.field));

/** True when `agg` is event-sourced and `tenantOwned` — its stream carries
 *  tenant metadata. */
export function isTenantScopedStream(agg: Pick<AggregateIR, "persistedAs" | "capabilities">) {
  return agg.persistedAs === "eventLog" && hasTenantOwned(agg);
}

/** True when `a` is one of the `tenantOwned` capability's own stamp
 *  assignments (`tenantId` / `dataKey`) on a `tenantOwned` aggregate — the
 *  tenancy stamp, as opposed to a lifecycle stamp such as `createdAt`. */
export function isTenancyStampAssignment(
  agg: Pick<AggregateIR, "capabilities">,
  a: Pick<ContextStampAssignmentIR, "field">,
): boolean {
  return hasTenantOwned(agg) && METADATA_FIELDS.has(a.field);
}

/** The stream-tenancy fact of `agg` (resolved within its context's aggregate
 *  `pool`), or undefined when its stream carries no tenant. */
export function streamTenancyFor(
  agg: AggregateIR,
  pool: AggPool,
  opts: ReadScopeOptions = {},
): StreamTenancy | undefined {
  if (!isTenantScopedStream(agg)) return undefined;
  const stamp = (agg.contextStamps ?? [])
    .filter((s) => s.event === "create")
    .flatMap((s) => s.assignments)
    .filter((a) => isTenancyStampAssignment(agg, a));
  const restrictions = readScopeFor(agg, pool, opts).restrictions.filter(
    (r) => r.kind === "tenancy",
  );
  return { aggregate: agg.name, metadata: STREAM_TENANT_METADATA, stamp, restrictions };
}

/** True when the context's `<ctx>_events` log carries tenant metadata
 *  columns: some aggregate of the context has a tenant-scoped stream.  Rows of
 *  the log's other streams (a `crossTenant` aggregate, an `eventSourced`
 *  workflow) leave them null. */
export function eventLogCarriesTenant(ctx: Pick<BoundedContextIR, "aggregates">): boolean {
  return ctx.aggregates.some(isTenantScopedStream);
}

/** The tenant metadata an event carries when it is stored or published, or
 *  undefined when it carries none.  An event carries its stream's tenant when
 *  some tenant-scoped stream of its context folds it (an applier names it):
 *  the stored-event row and the CloudEvents channel envelope then expose the
 *  emitting stream's tenant, so a folded projection or a cross-deployable
 *  consumer reads it from the metadata, never from the payload. */
export function eventTenantMetadataFor(
  ctx: Pick<BoundedContextIR, "aggregates">,
  event: Pick<EventIR, "name">,
): readonly StreamTenantMetadataField[] | undefined {
  const folds = ctx.aggregates.some(
    (a) => isTenantScopedStream(a) && (a.appliers ?? []).some((ap) => ap.event === event.name),
  );
  return folds ? STREAM_TENANT_METADATA : undefined;
}

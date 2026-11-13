// Write-time reference admission (docs/tenancy.md → "Reference admission").
//
// A reference a write persists — an `X id` field of an aggregate or of one of
// its contained parts, however the value arrived (a create or update body, an
// operation parameter, a workflow or handler parameter) — resolves in the
// target's scope, decided here once from the target's tenancy stance:
//
//   - a `tenantOwned` target resolves in the tenant of the row being written
//     (the caller's operating tenant, for a row the caller creates);
//   - the tenancy registry resolves to the row's own tenant (the registry's
//     self-scope: a tenant sees exactly its own registry row);
//   - a `crossTenant` target, or any target outside `tenancy by`, is global:
//     the plain foreign key already admits exactly the rows that exist;
//   - a target with no table beside the row (another context's aggregate)
//     cannot be resolved at write time, which `loom.ref-scope-unresolvable`
//     reports when that target is tenant-scoped.
//
// Every backend renders the same step from this fact: before the row is
// written, each `row-tenant` / `tenant-registry` reference is probed, and a
// reference that does not resolve is refused exactly as a reference to a row
// that does not exist (the dangling-reference refusal) — so the refusal tells
// a caller nothing about rows outside its scope.
//
// The scope follows the ROW, not the principal: a reference is admitted when
// it lives where the row lives.  That is the locality rule
// (D-TENANCY-FLAT §7) made checkable, and it holds for a system-principal
// write (a reactor, a timer) as much as for a request.

import type { AggregateIR, ContainmentIR, ExprIR, TypeIR } from "../types/loom-ir.js";
import {
  buildTenantFloorFilter,
  hasTenantOwned,
  TENANCY_SELF_SCOPE_ORIGIN,
  TENANT_OWNED_CAPABILITY,
} from "../util/tenant-stance.js";

/** Where a persisted reference must resolve. */
export type RefScope =
  /** The target is `tenantOwned`: it resolves only among the rows of the
   *  writing row's tenant. */
  | "row-tenant"
  /** The target is the tenancy registry: the reference resolves only to the
   *  writing row's own tenant. */
  | "tenant-registry"
  /** No tenant constraint: the foreign key admits every existing row. */
  | "global"
  /** The target has no table beside the row, so no write-time check is
   *  possible. */
  | "unresolvable";

/** One persisted reference column and the scope it resolves in. */
export interface ScopedReference {
  /** The contained part declaring the field; `undefined` for the aggregate's
   *  own field. */
  part?: string;
  /** The containment chain from the root to the part; empty for a root
   *  field. */
  via: ContainStep[];
  /** The field name as declared. */
  field: string;
  /** The referenced aggregate. */
  target: string;
  /** `X id[]`: every element resolves in the scope. */
  collection: boolean;
  /** `X id?`: an absent reference is admitted. */
  optional: boolean;
  scope: RefScope;
}

type Stance = Pick<AggregateIR, "name" | "capabilities" | "contextFilterOrigins">;

/** The scope a reference to `target` resolves in when written from `source`.
 *  Read off the target alone: a `tenantOwned` target carries the capability,
 *  the registry carries its derived self-scope filter.  `undefined` = the
 *  target has no table beside the row (`hosted` is false). */
export function refScopeOf(source: Stance, target: Stance, hosted: boolean): RefScope {
  const scoped = hasTenantOwned(target) || isTenantRegistry(target);
  if (!hosted) return scoped ? "unresolvable" : "global";
  if (hasTenantOwned(target)) return "row-tenant";
  // The registry tree (`parent: Self id?`) manages sub-tenants under its own
  // rules; a registry row is not tenant-owned, so the self-scope applies only
  // to a reference written from a tenant-owned row.
  if (isTenantRegistry(target)) return hasTenantOwned(source) ? "tenant-registry" : "global";
  return "global";
}

/** One containment step from the aggregate root down to a part. */
export interface ContainStep {
  /** The containment's member name on its owner. */
  contain: string;
  collection: boolean;
  optional: boolean;
}

/** Every persisted `X id` column of `agg` (its own fields, then each
 *  contained part's, depth first), with the scope it resolves in.  `hosted` is
 *  the aggregates whose tables live beside `agg`'s (its context's);
 *  `elsewhere` resolves any other target (the rest of the system), so a
 *  tenant-scoped target there reads as `unresolvable` rather than `global`. */
export function scopedReferences(
  agg: AggregateIR,
  hosted: readonly AggregateIR[],
  elsewhere: (name: string) => AggregateIR | undefined = () => undefined,
): ScopedReference[] {
  const byName = new Map(hosted.map((a) => [a.name, a]));
  const parts = new Map(agg.parts.map((p) => [p.name, p]));
  const out: ScopedReference[] = [];
  const visit = (
    fields: readonly { name: string; type: TypeIR }[],
    via: ContainStep[],
    part?: string,
  ): void => {
    for (const f of fields) {
      const ref = referenceShape(f.type);
      if (!ref) continue;
      const local = byName.get(ref.target);
      const target = local ?? elsewhere(ref.target);
      out.push({
        ...(part !== undefined ? { part } : {}),
        via,
        field: f.name,
        target: ref.target,
        collection: ref.collection,
        optional: ref.optional,
        scope: target ? refScopeOf(agg, target, local !== undefined) : "global",
      });
    }
  };
  const descend = (
    contains: readonly ContainmentIR[],
    via: ContainStep[],
    seen: Set<string>,
  ): void => {
    for (const c of contains) {
      const part = parts.get(c.partName);
      if (!part || seen.has(part.name)) continue;
      const path = [...via, { contain: c.name, collection: c.collection, optional: c.optional }];
      visit(part.fields, path, part.name);
      descend(part.contains, path, new Set([...seen, part.name]));
    }
  };
  visit(agg.fields, []);
  descend(agg.contains, [], new Set());
  return out;
}

/** The references of `agg` a write must probe before it persists the row:
 *  the `row-tenant` and `tenant-registry` ones.  Empty for an aggregate whose
 *  every reference is global, so its emitted write path is unchanged. */
export function admittedReferences(
  agg: AggregateIR,
  hosted: readonly AggregateIR[],
): ScopedReference[] {
  return scopedReferences(agg, hosted).filter(
    (r) => r.scope === "row-tenant" || r.scope === "tenant-registry",
  );
}

/** True for the tenancy registry: enrichment gives it the derived
 *  `this.id == currentUser.<claim>` self-scope filter. */
function isTenantRegistry(agg: Pick<AggregateIR, "contextFilterOrigins">): boolean {
  return agg.contextFilterOrigins.includes(TENANCY_SELF_SCOPE_ORIGIN);
}

function referenceShape(
  t: TypeIR,
): { target: string; collection: boolean; optional: boolean } | undefined {
  let cur = t;
  let collection = false;
  let optional = false;
  while (cur.kind === "optional" || cur.kind === "array") {
    if (cur.kind === "optional") {
      optional = true;
      cur = cur.inner;
    } else {
      collection = true;
      cur = cur.element;
    }
  }
  return cur.kind === "id" ? { target: cur.targetName, collection, optional } : undefined;
}

/** The predicate a probed reference's target row must satisfy, over the
 *  TARGET's own row (`this`): its tenant restriction exactly as its read scope
 *  carries it — the `tenantOwned` floor for `row-tenant`, the registry's
 *  derived self-scope for `tenant-registry`.  A backend lowers it with the same
 *  filter lowering its read scope uses, so the probe and the target's reads
 *  agree on which tenant is the caller's (the operating org).  `undefined`
 *  for a reference that is not probed. */
export function admissionFilter(
  ref: ScopedReference,
  hosted: readonly AggregateIR[],
): ExprIR | undefined {
  const origin =
    ref.scope === "row-tenant"
      ? TENANT_OWNED_CAPABILITY
      : ref.scope === "tenant-registry"
        ? TENANCY_SELF_SCOPE_ORIGIN
        : undefined;
  if (origin === undefined) return undefined;
  const target = hosted.find((a) => a.name === ref.target);
  if (!target) return undefined;
  const at = target.contextFilterOrigins.indexOf(origin);
  if (at >= 0) return target.contextFilters[at];
  return ref.scope === "row-tenant" ? buildTenantFloorFilter(target) : undefined;
}

// Phase ⑥ fold-tenancy fact — which folded projections are tenant-scoped, and
// how a scoped fold row carries, keys and reads its tenant.
//
// A folded projection (`projection P keyed by k { on(e: Ev) { … } }`) writes
// rows no tenant command owns: the fold runs when an event is dispatched.  Under
// `tenancy by`, an event raised by a `tenantOwned` aggregate (state or
// event-sourced) carries its tenant as METADATA — the dispatching frame's event
// origin (`tenantid` / `loomorgpath` on the outbox row and the CloudEvents
// envelope; the stream's tenant for an event-sourced stream, see
// `stream-tenancy.ts`).  A scoped fold therefore:
//
//   - stamps every row it writes with the event's tenant: `tenant_id` from the
//     origin's tenant, `data_key` from its org path (the tenant itself when the
//     origin has none) — the two columns a `tenantOwned` table carries;
//   - keys the row by `(tenant_id, <key>)`, so two tenants folding the same
//     business key never share a row;
//   - reads through `scope` (`foldRowReadScope` in `read-scope.ts`): the tenant
//     floor over the row's `tenantId`, exactly the predicate a `tenantOwned`
//     table read applies.
//
// The verdict (`foldTenancyVerdict`) classifies the aggregates that raise the
// folded events, across the whole system (a fold may consume another context's
// events over a channel):
//
//   - `unscoped` — no `tenancy by`;
//   - `exempt`   — every producer is `crossTenant`: there is no tenant to leak,
//                  so the fold carries no tenant column and reads unscoped;
//   - `mixed`    — some producer is `crossTenant` and some is not: one row would
//                  fold tenant-less and tenant-owned events under one key, so
//                  the shape is refused (`loom.tenancy-folded-projection-mixed`);
//   - `scoped`   — everything else (a `tenantOwned` producer, a workflow, a
//                  registry; also no producer found — scoping is the
//                  fail-closed default).

import type { AggregateIR, OperationIR, ProjectionIR, StmtIR, SystemIR } from "../types/loom-ir.js";
import { isMaterializedProjection } from "../types/loom-ir.js";
import { classifyTenantStance } from "../util/tenant-stance.js";
import { walkStmtsDeep, workflowEmits } from "../util/walk.js";
import { foldRowReadScope, type ReadScope } from "./read-scope.js";
import { STREAM_TENANT_METADATA, type StreamTenantMetadataField } from "./stream-tenancy.js";

export type FoldTenancyVerdict = "unscoped" | "exempt" | "mixed" | "scoped";

/** The producers of a fold's events, by tenancy stance (`Ctx.Agg` names). */
export interface FoldProducers {
  tenantOwned: string[];
  crossTenant: string[];
  /** Registry / unscoped aggregates and workflows. */
  other: string[];
}

/** The tenancy fact of one scoped folded projection. */
export interface FoldTenancy {
  projection: string;
  /** The tenant columns every fold row carries (`tenant_id` NOT NULL and part
   *  of the primary key; `data_key` nullable), named like a `tenantOwned`
   *  table's. */
  metadata: readonly StreamTenantMetadataField[];
  /** The principal claim the floor compares `tenantId` against. */
  claim: string;
  /** The restrictions every read of the projection's rows applies. */
  scope: ReadScope;
}

function eventsEmittedByStatements(stmts: readonly StmtIR[], into: Set<string>): void {
  for (const root of stmts)
    walkStmtsDeep(root, (s) => {
      if (s.kind === "emit") into.add(s.eventName);
    });
}

/** Every event `agg` raises: an `emit` anywhere in an operation / create /
 *  destroy body, or an applier it folds. */
function eventsRaisedBy(agg: AggregateIR): Set<string> {
  const out = new Set<string>();
  const ops: OperationIR[] = [...agg.operations, ...(agg.creates ?? []), ...(agg.destroys ?? [])];
  for (const op of ops) eventsEmittedByStatements(op.statements, out);
  for (const ap of agg.appliers ?? []) out.add(ap.event);
  return out;
}

/** The producers of the events `proj` folds, across `sys`. */
export function foldProducersOf(
  proj: ProjectionIR,
  sys: Pick<SystemIR, "tenancy" | "subdomains">,
): FoldProducers {
  const events = new Set(proj.handlers.map((h) => h.event));
  const out: FoldProducers = { tenantOwned: [], crossTenant: [], other: [] };
  for (const sd of sys.subdomains) {
    for (const ctx of sd.contexts) {
      for (const agg of ctx.aggregates) {
        if (agg.isAbstract) continue;
        const raised = eventsRaisedBy(agg);
        if (![...events].some((e) => raised.has(e))) continue;
        const stance = classifyTenantStance(agg, sys);
        const name = `${ctx.name}.${agg.name}`;
        if (stance === "tenantOwned") out.tenantOwned.push(name);
        else if (stance === "crossTenant") out.crossTenant.push(name);
        else out.other.push(name);
      }
      for (const wf of ctx.workflows) {
        const emitted = [
          ...workflowEmits(wf.statements),
          ...wf.creates.flatMap((c) => workflowEmits(c.statements)),
          ...(wf.subscriptions ?? []).flatMap((h) => workflowEmits(h.statements)),
        ];
        if (emitted.some((e) => events.has(e.eventName))) out.other.push(`${ctx.name}.${wf.name}`);
      }
    }
  }
  return out;
}

/** The tenancy verdict of a folded projection under `sys` (see the header). */
export function foldTenancyVerdict(
  proj: ProjectionIR,
  sys: Pick<SystemIR, "tenancy" | "subdomains">,
): FoldTenancyVerdict {
  if (!sys.tenancy || !isMaterializedProjection(proj)) return "unscoped";
  const p = foldProducersOf(proj, sys);
  const scopedProducers = p.tenantOwned.length + p.other.length;
  if (p.crossTenant.length > 0) return scopedProducers > 0 ? "mixed" : "exempt";
  return "scoped";
}

/** The tenancy fact of a folded projection, or undefined when its rows carry
 *  no tenant.  Reads the claim enrichment recorded (`foldTenantClaim`). */
export function foldTenancyFor(proj: ProjectionIR): FoldTenancy | undefined {
  const claim = proj.foldTenantClaim;
  if (claim === undefined || !isMaterializedProjection(proj)) return undefined;
  return {
    projection: proj.name,
    metadata: STREAM_TENANT_METADATA,
    claim,
    scope: foldRowReadScope(proj.name, claim),
  };
}

/** One equality term of a fold row's read scope: the row column `column`
 *  (aggregate-field spelling `field`) equals the principal's `claim`. */
export interface FoldFloorTerm {
  field: string;
  column: string;
  claim: string;
}

/** The read scope of a scoped fold as column equalities — the shape every
 *  backend's projection read spells (`WHERE tenant_id = <principal claim>`).
 *  A fold row's scope is the tenant floor alone (`foldRowReadScope`); any other
 *  restriction is an internal invariant violation, never silently dropped. */
export function foldFloorTerms(t: FoldTenancy): FoldFloorTerm[] {
  return t.scope.restrictions.map((r) => {
    const p = r.predicate;
    if (
      r.kind !== "tenancy" ||
      r.tenancy !== "tenant" ||
      p?.kind !== "binary" ||
      p.left.kind !== "member" ||
      p.left.receiver.kind !== "this" ||
      p.right.kind !== "member"
    )
      throw new Error(`fold row read scope of '${t.projection}' is not the tenant floor`);
    const field = p.left.member;
    const column = t.metadata.find((m) => m.field === field)?.column;
    if (column === undefined)
      throw new Error(`fold row read scope of '${t.projection}' names no tenant column '${field}'`);
    return { field, column, claim: p.right.member };
  });
}

/** The tenant column every scoped fold row is keyed by (`tenant_id`), with its
 *  aggregate-field spelling, and the org-path column stamped beside it. */
export function foldTenantColumns(t: FoldTenancy): {
  tenant: StreamTenantMetadataField;
  dataKey: StreamTenantMetadataField;
} {
  const tenant = t.metadata.find((m) => m.required)!;
  const dataKey = t.metadata.find((m) => !m.required)!;
  return { tenant, dataKey };
}

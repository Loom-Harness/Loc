// -------------------------------------------------------------------------
// Universal (not per-backend) gates on the query-time projection shapes
// (read-path-architecture.md): column-less direct-table sources and
// capability-filtered document aggregations.  Split out of system-checks.ts by
// packet 2.6 (wave-2).  The per-backend support gates that used to live here
// (paged queryHandler, query-time / whole-table-aggregation / group-by /
// workflow-source / projection-source projections) were deleted once every
// backend emitted them: a support set naming all five backends gates nothing.
// When partial support reappears, a `loom.*-unsupported` code is the honest
// place for it.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import type { SystemIR } from "../../types/loom-ir.js";
import { isQueryTimeProjection } from "../../types/loom-ir.js";
import {
  columnlessProjectionSource,
  documentAggregationSource,
  unappliedCapabilityFilters,
} from "../../util/query-projection-arm.js";
import type { LoomDiagnostic } from "./diagnostic.js";

// ---------------------------------------------------------------------------
// COLUMN-LESS direct-table projection source — universal, not per-backend.
//
// The two direct-table arms (`select n = count()/sum(o.x)`, `group by`) push
// the aggregation into SQL, which means they name COLUMNS on the source
// aggregate's own table.  Three source shapes have no such columns:
// `persistedAs: eventLog` (no state table at all), `shape: document` (one
// `(id, data, version)` triple, declared fields inside the jsonb blob), and a
// TPC abstract base (no table of its own).  Every backend then emitted a
// reference to something that does not exist — `schema.orders.total` (TS2339),
// `_db.Orders` / `o.Total` (CS0117 / CS1061), `sum(e.total)` in JPQL,
// `OrderRow.total` in SQLAlchemy, `record.total` in Ecto — with nothing said at
// generate time.
//
// This was a `persistence: dapper` gate until now, on the premise that EF Core
// translated the JSON itself.  It does not; Loom maps a document aggregate to
// a hand-rolled `<Agg>Document` row type.  So the gate is universal, and it is
// NOT a gate-SET: no backend emits this correctly, so there is no per-platform
// membership to keep honest.
//
// It stays PRECISE about the document case: a document table really does have
// an `id` column, so `select n = count()` over a document source emits and runs
// on all five backends — and must keep doing so, since that is the row-count
// tile `scaffoldDashboard` synthesises.  Only a reference to some OTHER member
// is refused.  The condition is `columnlessProjectionSource`, which keys off the
// same `queryProjectionArm` classification the .NET emitter switches on
// (`ir/util/query-projection-arm.ts`), so the gate and the emission arm cannot
// disagree about WHICH arm is being refused.
// ---------------------------------------------------------------------------

export function validateColumnlessProjectionSources(sys: SystemIR, diags: LoomDiagnostic[]): void {
  for (const sd of sys.subdomains) {
    for (const ctx of sd.contexts) {
      for (const p of ctx.projections ?? []) {
        if (!isQueryTimeProjection(p)) continue;
        const reason = columnlessProjectionSource(p, ctx, sys);
        if (!reason) continue;
        diags.push({
          severity: "error",
          code: "loom.projection-columnless-source",
          message: diagMessage("loom.projection-columnless-source", {
            name: p.name,
            ctxName: ctx.name,
            reason,
          }),
          source: `${ctx.name}/${p.name}`,
          origin: p.origin,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// CAPABILITY-FILTERED direct-table aggregation over a `shape: document` source
// — universal, and the one gate here that closes a SILENT DATA LEAK rather
// than a miscompile.
//
// `columnlessProjectionSource` above deliberately lets `select n = count()`
// through over a document source: a document table really is `(id, data,
// version)`, so a row count names a real column and four of the five backends
// emit it correctly.  What that gate cannot see is the OTHER half of the SQL —
// the capability filters (tenancy scope, `softDeletable`, any `filter`
// capability) that the aggregation emitters splice in themselves, because the
// read bypasses the repository that would otherwise apply them.  Those
// predicates name `tenant_id` / `is_deleted`, and a document table has neither:
//
//   node/drizzle    `eq(schema.orders.tenantId, …)`        TS2339
//   node/mikroorm   `qb.where({ tenantId: … })`            not a property of OrderRow
//   python          `OrderRow.tenant_id == …`              AttributeError / mypy
//   elixir          `record.tenant_id`                     `mix compile` error
//   dotnet/dapper   `WHERE tenant_id = @__cu_org`          Postgres 42703 at runtime
//   dotnet/EF       — NOTHING —                            counts every tenant's rows
//
// The last row is why this is refused universally instead of being left to the
// per-backend compile.  EF applies capability filters through
// `modelBuilder.Entity<T>().HasQueryFilter(…)`, which Loom registers only for a
// RELATIONALLY-mapped aggregate; a document aggregate's filters live in-app, in
// the repository's `_CapabilityVisible`.  So the EF aggregation compiles clean,
// ships, and silently counts other tenants' (and soft-deleted) rows — the exact
// failure a compile gate can never catch.
//
// `ignoring` is honoured: a projection that explicitly waives the filters needs
// none applied, so it is not gated (`unappliedCapabilityFilters`).  That is the
// documented way out for an author who genuinely wants the unscoped total.
// ---------------------------------------------------------------------------

export function validateDocumentAggregationFilters(sys: SystemIR, diags: LoomDiagnostic[]): void {
  for (const sd of sys.subdomains) {
    for (const ctx of sd.contexts) {
      for (const p of ctx.projections ?? []) {
        if (!isQueryTimeProjection(p)) continue;
        const agg = documentAggregationSource(p, ctx, sys);
        if (!agg) continue;
        const caps = unappliedCapabilityFilters(p, agg);
        if (caps.length === 0) continue;
        diags.push({
          severity: "error",
          code: "loom.projection-document-source-capability-filtered",
          message: diagMessage("loom.projection-document-source-capability-filtered", {
            name: p.name,
            ctxName: ctx.name,
            source: agg.name,
            caps: caps.join(", "),
          }),
          source: `${ctx.name}/${p.name}`,
          origin: p.origin,
        });
      }
    }
  }
}

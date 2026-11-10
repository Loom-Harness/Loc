// Auto-generated-code emitter for the .NET event store (appliers A2.2b).
//
// Per-context event log (event-log-architecture.md): a single append-only
// `<ctx>_events` table holds EVERY event-sourced stream in a bounded context —
// every `persistedAs: eventLog` aggregate AND every `eventSourced` workflow —
// discriminated by `stream_type` (the aggregate/workflow name).  EF maps it
// through ONE shared persistence POCO (`EventRecord`) + a per-context
// `IEntityTypeConfiguration` (`<Ctx>EventRecordConfiguration`).  The
// repositories (see `repository.ts:renderEventSourcedRepositoryImpl`) and the
// workflow handlers each scope their load/append/fold to their own
// `stream_type` — the correctness trap: two streams sharing one table must
// each fold only their own events.  No Marten — the log lives on the same
// relational store as every other table (D-DOCUMENT-AXIS rejected a dedicated
// Marten backend).
//
// Column names are spelled snake_case explicitly so the EF entity matches the
// canonical `<ctx>_events` migration (the multi-word `stream_type` /
// `stream_id` / `occurred_at` wouldn't fold to the migration's names under
// EF's default PascalCase → Postgres case-folding; mirrors the value-object
// `HasColumnName` fix).

import { STREAM_TENANT_METADATA, streamTenancyFor } from "../../../ir/enrich/stream-tenancy.js";
import type { EnrichedAggregateIR } from "../../../ir/types/loom-ir.js";
import type { AggPool } from "../../../ir/util/inheritance.js";
import { lines } from "../../../util/code-builder.js";
import { snake, upperFirst } from "../../../util/naming.js";
import { csJsonSqlType } from "../codec-spelling.js";
import { AMBIENT_CURRENT_USER, renderCsExpr } from "../render-expr.js";

/** A read's `ignoring` clause (`ignoring <Cap>` / `ignoring *`). */
export interface StreamScopeBypass {
  bypassAll?: boolean;
  bypassCaps?: readonly string[];
}

/** The in-app tenancy predicate of a tenant-scoped event stream (stream-tenancy.ts),
 *  over the folded aggregate `x` — the fact's tenancy restrictions the read's
 *  `ignoring` clause does not drop, conjoined.  A stream's tenant is metadata of
 *  its stored events, adopted onto the folded instance, so the same predicate a
 *  `tenantOwned` table filters by applies to it.  Null when the stream is not
 *  tenant-scoped or the read drops every restriction. */
export function streamScopePredicate(
  agg: EnrichedAggregateIR,
  pool: AggPool,
  bypass?: StreamScopeBypass,
): string | null {
  const kept = streamTenancyFor(agg, pool, { ignoring: bypass })?.restrictions ?? [];
  if (kept.length === 0) return null;
  return kept
    .map(
      (r) =>
        `(${renderCsExpr(r.predicate!, { thisName: "x", agg, currentUserExpr: AMBIENT_CURRENT_USER })})`,
    )
    .join(" && ");
}

/** The `.Where(...)` suffix a find applies for its tenancy scope ("" when unscoped). */
export function streamScopeWhere(
  agg: EnrichedAggregateIR,
  pool: AggPool,
  bypass?: StreamScopeBypass,
): string {
  const pred = streamScopePredicate(agg, pool, bypass);
  return pred ? `.Where(x => ${pred})` : "";
}

/** The event-origin frame for the dispatch of a tenant-scoped stream's events:
 *  the stream's tenant, entered only when it differs from the raising principal's
 *  (the common case keeps the request's own frame).  The outbox capture and the
 *  CloudEvents envelope (`tenantid`) read the ambient origin. */
export function streamOriginFrameLines(ns: string, indent: string): string[] {
  return [
    `${indent}var __ambientOrigin = global::${ns}.Auth.User.CurrentEventOrigin();`,
    `${indent}using var __streamOrigin = __ambientOrigin?.Tenant == aggregate.TenantId`,
    `${indent}    ? null`,
    `${indent}    : global::${ns}.Auth.User.EnterEventOrigin(new global::${ns}.Auth.EventOrigin(aggregate.TenantId, __ambientOrigin?.CausedBy));`,
  ];
}

/** The row-tenant event origin of a state `tenantOwned` save
 *  (`eventsCarryRowTenant`): `__rowOrigin` is null when the raising
 *  principal's operating org is the row's tenant (the common case keeps the
 *  request's own frame), else the row tenant's origin.  Declared once ahead of
 *  the outbox record; {@link inRowOriginLines} enters it around the outbox
 *  record and around the post-commit dispatch — never around the save, whose
 *  audit stamps read the request's own principal. */
export function rowOriginDeclLines(ns: string, indent: string): string[] {
  return [
    `${indent}var __ambientRowOrigin = global::${ns}.Auth.User.CurrentEventOrigin();`,
    `${indent}var __rowTenant = global::System.Convert.ToString(aggregate.TenantId);`,
    `${indent}global::${ns}.Auth.EventOrigin? __rowOrigin = __ambientRowOrigin?.Tenant == __rowTenant`,
    `${indent}    ? null`,
    `${indent}    : new global::${ns}.Auth.EventOrigin(__rowTenant, __ambientRowOrigin?.CausedBy);`,
  ];
}

/** `body` run inside the row-tenant origin `__rowOrigin` (when it is set). */
export function inRowOriginLines(ns: string, indent: string, body: string[]): string[] {
  return [
    `${indent}using (__rowOrigin is null ? null : global::${ns}.Auth.User.EnterEventOrigin(__rowOrigin))`,
    `${indent}{`,
    ...body,
    `${indent}}`,
  ];
}

/** A save's post-commit dispatch `body`, in the row-tenant origin when the
 *  aggregate's events carry its row's tenant (`__rowOrigin` declared earlier). */
export function rowDispatchLines(ns: string, rowTenant: boolean, body: string[]): string[] {
  if (!rowTenant) return body;
  return inRowOriginLines(
    ns,
    "        ",
    body.map((l) => `    ${l}`),
  );
}

/** The outbox record of a save's pending events, in the row-tenant origin when
 *  the aggregate's events carry its row's tenant. */
export function recordDurableLines(
  ns: string,
  rowTenant: boolean,
  call: string,
  indent: string,
): string[] {
  if (!rowTenant) return [`${indent}var __deferred = await ${call};`];
  return [
    ...rowOriginDeclLines(ns, indent),
    `${indent}global::System.Collections.Generic.IReadOnlyList<global::${ns}.Domain.Events.IDomainEvent> __deferred;`,
    ...inRowOriginLines(ns, indent, [`${indent}    __deferred = await ${call};`]),
  ];
}

/** The persistence record (POCO) class name for a context's event log —
 *  `<Ctx>EventRecord`.  ONE per bounded context (not one shared type): EF Core
 *  maps each CLR entity type to a single table, so a deployable hosting several
 *  event-sourced contexts needs a distinct entity per `<ctx>_events` table
 *  (mirrors Python / MikroORM's `<Ctx>EventRow`). */
export function eventRecordClass(ctxName: string): string {
  return `${upperFirst(ctxName)}EventRecord`;
}

/** The per-context event-log `DbSet` name (`<Ctx>Events`). */
export function eventDbSetName(ctxName: string): string {
  return `${upperFirst(ctxName)}Events`;
}

/** The per-context persistence record (POCO) for a context's event log —
 *  `<Ctx>EventRecord`, one row per recorded event across every event-sourced
 *  aggregate/workflow in that context, keyed by `(StreamType, StreamId,
 *  Version)`.  `StreamType` discriminates the owning stream (aggregate/workflow
 *  name); `Seq` is the context-global bigserial cursor (DB-assigned — EF never
 *  writes it).  It implements the domain-side `IWorkflowEventRow` marker (audit
 *  so the generic `IWorkflowEventStore<<Ctx>EventRecord>` port
 *  adapter can read the stream key; get/set satisfies the get-only members. */
export function renderEventRecordPoco(
  ns: string,
  ctxName: string,
  /** The log carries the stream tenant metadata columns (`eventLogCarriesTenant`). */
  carriesTenant = false,
): string {
  const cls = eventRecordClass(ctxName);
  const marker = ` : global::${ns}.Domain.Common.IWorkflowEventRow`;
  return (
    lines(
      "// Auto-generated.",
      "using System;",
      `namespace ${ns}.Infrastructure.Persistence.Events;`,
      "",
      "/// <summary>Append-only row in the per-context event log (<ctx>_events),",
      "/// shared by every event-sourced aggregate (persistedAs: eventLog) and",
      "/// workflow (eventSourced) in the context; StreamType discriminates the",
      "/// owning stream, keyed by (StreamType, StreamId, Version).  Data is the",
      "/// JSON event payload; Seq is the DB-assigned context-global cursor.</summary>",
      `public sealed class ${cls}${marker}`,
      "{",
      // Context-global monotonic cursor (bigserial).  DB-assigned; EF must NOT
      // write it (ValueGeneratedOnAdd in the configuration).  Carried inert
      // until the projection-replay reader lands.
      "    public long Seq { get; set; }",
      "    public string StreamType { get; set; } = default!;",
      "    public string StreamId { get; set; } = default!;",
      "    public int Version { get; set; }",
      "    public string Type { get; set; } = default!;",
      '    public string Data { get; set; } = "{}";',
      "    public DateTime OccurredAt { get; set; }",
      // Stream tenant metadata (`stream-tenancy.ts`) — null on every other
      // stream's rows.
      ...(carriesTenant
        ? STREAM_TENANT_METADATA.map(
            (m) => `    public string? ${upperFirst(m.field)} { get; set; }`,
          )
        : []),
      "}",
    ) + "\n"
  );
}

/** EF Core configuration for a context's event log: composite
 *  `(stream_type, stream_id, version)` key, jsonb `data`, DB-assigned `seq`,
 *  snake_case column names matching the canonical `<ctx>_events` migration.
 *  One per bounded context that owns any event-sourced stream. */
export function renderEventRecordConfiguration(
  ctxName: string,
  ns: string,
  schema?: string,
  carriesTenant = false,
): string {
  const cls = `${upperFirst(ctxName)}EventRecordConfiguration`;
  const record = eventRecordClass(ctxName);
  const tableName = `${snake(ctxName)}_events`;
  // `schema` set (the context's dataSource schema) → two-arg ToTable; undefined
  // → single-arg, byte-identical with the unqualified default.
  const toTableArgs = schema ? `"${tableName}", "${schema}"` : `"${tableName}"`;
  return (
    lines(
      "// Auto-generated.",
      "using Microsoft.EntityFrameworkCore;",
      "using Microsoft.EntityFrameworkCore.Metadata.Builders;",
      `using ${ns}.Infrastructure.Persistence.Events;`,
      "",
      `namespace ${ns}.Infrastructure.Persistence.Configurations;`,
      "",
      `public sealed class ${cls} : IEntityTypeConfiguration<${record}>`,
      "{",
      `    public void Configure(EntityTypeBuilder<${record}> builder)`,
      "    {",
      `        builder.ToTable(${toTableArgs});`,
      "        builder.HasKey(x => new { x.StreamType, x.StreamId, x.Version });",
      // `seq` is a bigserial the database assigns on INSERT — tell EF to read it
      // back but never write it (ValueGeneratedOnAdd), so the append emits no
      // `seq` column and the cursor stays gap-free and DB-owned.
      '        builder.Property(x => x.Seq).HasColumnName("seq").ValueGeneratedOnAdd();',
      '        builder.Property(x => x.StreamType).HasColumnName("stream_type");',
      '        builder.Property(x => x.StreamId).HasColumnName("stream_id");',
      '        builder.Property(x => x.Version).HasColumnName("version");',
      '        builder.Property(x => x.Type).HasColumnName("type");',
      `        builder.Property(x => x.Data).HasColumnName("data").HasColumnType("${csJsonSqlType()}");`,
      '        builder.Property(x => x.OccurredAt).HasColumnName("occurred_at");',
      ...(carriesTenant
        ? STREAM_TENANT_METADATA.map(
            (m) =>
              `        builder.Property(x => x.${upperFirst(m.field)}).HasColumnName("${m.column}");`,
          )
        : []),
      "    }",
      "}",
    ) + "\n"
  );
}

// `EnrichedAggregateIR` retained as the documented caller shape.
export type { EnrichedAggregateIR };

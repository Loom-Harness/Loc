import { deriveEventSubscriptions } from "../../ir/enrich/enrichments.js";
import { foldFloorTerms, foldTenancyFor, foldTenantColumns } from "../../ir/enrich/fold-tenancy.js";
import { wireStatus } from "../../ir/enrich/wire-policy.js";
import { type FoldRowSeed, type FoldStep, foldRowSeeds, foldSteps } from "../../ir/plan/index.js";
import type {
  EnrichedBoundedContextIR,
  ProjectionIR,
  ProjectionOnIR,
  TypeIR,
  WireField,
} from "../../ir/types/loom-ir.js";
import { exprUsesCurrentUser, isMaterializedProjection } from "../../ir/types/loom-ir.js";
import { escapeCsharpIdent, snake, upperFirst } from "../../util/naming.js";
import { CS, CS_PERSISTENCE_USINGS, sortedCsUsings } from "./cs-symbols.js";
import { csIdValueClrType, dtoParam, projectToResponse, wireType } from "./dto-mapping.js";
import { dotnetNotFoundThrow } from "./emit/common.js";
import { sqlIdent } from "./emit/dapper.js";
import { dapperProjectionColumns } from "./emit/dapper-workflow.js";
import {
  projectionRowClass,
  projectionRowDbSet,
  projectionRowTable,
} from "./projection-state-emit.js";
import { collectCsExprUsings, renderCsExpr } from "./render-expr.js";
import { csProblemResponseAttr } from "./wire-policy-cs.js";
import { renderExprWithEventParam } from "./workflow-emit.js";

// ---------------------------------------------------------------------------
// Projection dispatch + read routes (.NET / ASP.NET + EF Core), projection.md.
//
//   - fold handler: one Mediator `INotificationHandler<TEvent>` per (projection,
//     event) — load-or-allocate the read-model row keyed by the correlation
//     column, write each `:=`, SaveChanges.  Every event allocates (a projection
//     has no route-or-drop split), and the body is pure (no emit, no saves).
//     Mediator auto-discovers the handler by assembly scan, so no DI wiring.
//   - read routes: a `<Ctx>ProjectionsController` exposing GET
//     /<prefix>projections/<snake> (list) + /<snake>/{key} (one by correlation
//     id, 404 if absent), projecting each row through the projection wireShape.
//
// Subscriptions are re-derived WITH projections (like python's
// `dispatchSubscriptionsOf`) because the enricher-stored `ctx.eventSubscriptions`
// omits folds — index.ts also OR-s projections into `hasSubscriptions` so a
// projection-only context still gets the Mediator dispatcher + IDomainEvent
// notification plumbing.
// ---------------------------------------------------------------------------

/** Every non-key column is nullable → wrap the wire field's type as optional so
 *  the DTO field (`Guid?` / `OrderStatus?`) + the null-safe `projectToResponse`
 *  projection match the nullable read-model row (python-parity).  The
 *  correlation field (`source: "id"`) stays non-nullable (the NOT NULL key). */
export function wireFieldType(f: WireField): TypeIR {
  if (f.source === "id" || f.type.kind === "optional") return f.type;
  return { kind: "optional", inner: f.type };
}

// ---------------------------------------------------------------------------
// Fold dispatch
// ---------------------------------------------------------------------------

/** Emit one `INotificationHandler<TEvent>` per projection fold.  No-op when the
 *  context declares no projection (byte-identical). */
export function emitProjectionDispatch(
  ctx: EnrichedBoundedContextIR,
  ns: string,
  out: Map<string, string>,
): void {
  const subs = deriveEventSubscriptions(ctx.channels, ctx.workflows, ctx.projections);
  for (const s of subs) {
    if (!s.projection) continue;
    const proj = ctx.projections.find((p) => p.name === s.projection);
    if (!proj) continue;
    const on = proj.handlers.find((h) => h.event === s.event && h.param === s.param);
    if (!on) continue;
    const cls = projectionHandlerClass(proj, on);
    out.set(`Application/Workflows/${cls}.cs`, renderProjectionFoldHandler(cls, proj, on, ns));
  }
}

function projectionHandlerClass(proj: ProjectionIR, on: ProjectionOnIR): string {
  return `${upperFirst(proj.name)}On${upperFirst(on.event)}Handler`;
}

/** The pure fold: load-or-allocate the row for the event's key, apply each `:=`
 *  as `state.<Prop> = <expr>`, SaveChanges.  The correlation `:=` is skipped
 *  (the immutable key, seeded at allocation). */
function renderProjectionFoldHandler(
  className: string,
  proj: ProjectionIR,
  on: ProjectionOnIR,
  ns: string,
): string {
  const corr = proj.correlationField as string;
  const corrPascal = upperFirst(corr);
  const rowCls = projectionRowClass(proj);
  const usings = new Set<string>();
  // Routing key: the `by <expr>` value (event param → `notification`), else the
  // event field name-matching the correlation field (the omitted-`by` rule).
  const keyExpr = on.correlation
    ? renderExprWithEventParam(on.correlation, on.param)
    : `notification.${corrPascal}`;
  if (on.correlation) collectCsExprUsings(on.correlation, usings, ns);
  const assignLines: string[] = [];
  for (const step of foldSteps(proj, on)) {
    for (const line of renderProjectionFoldStep(step, on, usings, ns)) assignLines.push(line);
  }
  // A tenant-scoped fold (`fold-tenancy.ts`) reads the event's tenant from its
  // metadata — the dispatching frame's event origin — keys the row by it and
  // stamps it on allocation.  An event with no tenant has no tenant's row.
  const tenancy = foldTenancyFor(proj);
  const cols = tenancy ? foldTenantColumns(tenancy) : undefined;
  const tenantProp = cols ? upperFirst(cols.tenant.field) : "";
  const originLines = cols
    ? `        var __origin = global::${ns}.Auth.User.CurrentEventOrigin();
` +
      `        var __tenant = __origin?.Tenant;
` +
      `        if (__tenant is null) return;
`
    : "";
  const findPred = cols
    ? `x => x.${tenantProp} == __tenant && x.${corrPascal} == __key`
    : `x => x.${corrPascal} == __key`;
  // A fresh row: the key, the tenant, and each column's starting value
  // (`foldRowSeeds`); every other column starts null.
  const seed = [
    `${corrPascal} = __key`,
    ...(cols ? [`${tenantProp} = __tenant`] : []),
    ...foldRowSeeds(proj).map(
      (sd) => `${upperFirst(sd.field.name)} = ${csRowSeed(sd, on, usings, ns)}`,
    ),
  ].join(", ");
  const extraUsings = sortedCsUsings(usings);
  return (
    `// Auto-generated.
using System.Threading;
using System.Threading.Tasks;${extraUsings.length > 0 ? "\n" + extraUsings.join("\n") : ""}
using Mediator;
using ${ns}.Domain.Events;
using ${ns}.Domain.Ids;
using ${ns}.Domain.ValueObjects;
using ${ns}.Domain.Enums;
using ${ns}.Infrastructure.Persistence.Projections;

namespace ${ns}.Application.Workflows;

// Read-model fold via the domain IReadModelStore port, NOT
// the concrete AppDbContext.  FindAsync returns the EF change-TRACKED row, so
// the ` +
    "`state.<Prop> = …; SaveChangesAsync()`" +
    ` upsert persists unchanged;
// the EF adapter delegates to the same scoped DbContext.
public sealed class ${className} : INotificationHandler<${on.event}>
{
    private readonly global::${ns}.Domain.Common.IReadModelStore<${rowCls}> _readModel;
    public ${className}(global::${ns}.Domain.Common.IReadModelStore<${rowCls}> readModel) => _readModel = readModel;

    public async ValueTask Handle(${on.event} notification, CancellationToken cancellationToken)
    {
${originLines}        var __key = ${keyExpr};
        var state = await _readModel.FindAsync(${findPred}, cancellationToken);
        if (state is null)
        {
            state = new ${rowCls} { ${seed} };
            _readModel.Add(state);
        }
${assignLines.length > 0 ? assignLines.join("\n") + "\n" : ""}        await _readModel.SaveChangesAsync(cancellationToken);
    }
}
`
  );
}

/** A fresh row's starting value for one column. */
function csRowSeed(sd: FoldRowSeed, on: ProjectionOnIR, usings: Set<string>, ns: string): string {
  if (sd.kind === "default") {
    collectCsExprUsings(sd.expr, usings, ns);
    return renderExprWithEventParam(sd.expr, on.param, undefined, "state");
  }
  switch (sd.zero) {
    case "int":
      return "0";
    case "decimal":
    case "money":
      return "0m";
    case "bool":
      return "false";
    case "string":
      return `""`;
    case "list":
      return "new()";
    default: {
      const _exhaustive: never = sd.zero;
      return _exhaustive;
    }
  }
}

/** One fold step (`foldSteps`) as C# against the read-model `state` row. */
function renderProjectionFoldStep(
  step: FoldStep,
  on: ProjectionOnIR,
  usings: Set<string>,
  ns: string,
): string[] {
  const expr = (e: Parameters<typeof collectCsExprUsings>[0]): string => {
    collectCsExprUsings(e, usings, ns);
    return renderExprWithEventParam(e, on.param, undefined, "state");
  };
  switch (step.kind) {
    case "set":
      return [`        state.${upperFirst(step.field)} = ${expr(step.value)};`];
    case "let":
      // `let`-names may collide with a C# keyword; escape consistently with the
      // matching `refKind: "let"` use sites in `render-expr.ts`.
      return [`        var ${escapeCsharpIdent(step.name)} = ${expr(step.expr)};`];
    case "accumulate": {
      // The column is nullable and a row written before its column was
      // seeded holds null, so the running value materialises first.
      const prop = `state.${upperFirst(step.field)}`;
      return [`        ${prop} = (${prop} ?? 0) ${step.op} ${expr(step.value)};`];
    }
    case "append": {
      const prop = `state.${upperFirst(step.field)}`;
      return [`        ${prop} ??= new();`, `        ${prop}.Add(${expr(step.value)});`];
    }
    case "remove-all": {
      const prop = `state.${upperFirst(step.field)}`;
      return [
        `        ${prop} ??= new();`,
        `        ${prop}.RemoveAll(__x => Equals(__x, ${expr(step.value)}));`,
      ];
    }
    default: {
      const _exhaustive: never = step;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Read routes
// ---------------------------------------------------------------------------

/** Emit the `<Proj>Response` DTOs + the `<Ctx>ProjectionsController`.  No-op
 *  when the context declares no projection (byte-identical). */
export function emitProjectionReads(
  ctx: EnrichedBoundedContextIR,
  ns: string,
  out: Map<string, string>,
  options?: { routePrefix?: string; usingDapper?: boolean },
): void {
  // FOLDED (materialized) projections only — the event-folded read model with a
  // physical `<Proj>Row` table.  Query-time projections (read-path-architecture.md
  // rev.13) have no read-model row; they are served by `emitQueryProjections`.
  const folded = ctx.projections.filter(isMaterializedProjection);
  if (folded.length === 0) return;
  for (const proj of folded) {
    out.set(
      `Application/Workflows/${upperFirst(proj.name)}Response.cs`,
      renderProjectionResponseDto(proj, ctx, ns),
    );
  }
  out.set(
    `Api/${ctx.name}ProjectionsController.cs`,
    renderProjectionsController(ctx, ns, options?.routePrefix, !!options?.usingDapper),
  );
}

/** The `<Proj>Response` record — the projection wireShape projected to wire
 *  types, non-key fields nullable (partial read model). */
function renderProjectionResponseDto(
  proj: ProjectionIR,
  ctx: EnrichedBoundedContextIR,
  ns: string,
): string {
  const params = (proj.wireShape ?? [])
    .map((f) =>
      dtoParam(wireType(wireFieldType(f), ctx, "response"), upperFirst(f.name), "response"),
    )
    .join(", ");
  return `// Auto-generated.
using System;
using System.ComponentModel.DataAnnotations;
using ${ns}.Domain.ValueObjects;
using ${ns}.Domain.Enums;

namespace ${ns}.Application.Workflows;

public sealed record ${upperFirst(proj.name)}Response(${params});
`;
}

/** One controller per context exposing every projection as GET
 *  projections/<snake> + /<snake>/{key}, projecting each read-model row through
 *  the projection wireShape.
 *
 *  Persistence-gated (`usingDapper`, mirrors `emitWorkflowInstanceReads`): the EF
 *  path reads the EF-mapped `<Proj>Row` DbSet off the concrete `AppDbContext`;
 *  the Dapper path reads the `<Proj>Row` table with raw Npgsql SQL into a private
 *  `Row` DTO + `Map` to the same read-model POCO — the `wireShape` projection,
 *  operationIds, and route paths stay identical, so cross-backend OpenAPI parity
 *  holds. */
function renderProjectionsController(
  ctx: EnrichedBoundedContextIR,
  ns: string,
  routePrefix?: string,
  usingDapper = false,
): string {
  const className = `${ctx.name}ProjectionsController`;
  const route = `${routePrefix ?? ""}projections`;
  const usings = new Set<string>();
  const blocks: string[] = [];
  // Dapper reads through NpgsqlDataSource with raw SQL: each projection SELECTs
  // its read-model table into a private `<T>DbRow` + `Map<T>` to the POCO (the
  // same `dapperProjectionColumns` shape the fold store persists — M-T6.9).
  const rowMapDecls: string[] = [];
  // Set when any projection's gate reads the principal — the controller then
  // takes `ICurrentUserAccessor` alongside its persistence handle.
  let needsCurrentUser = false;
  for (const proj of ctx.projections.filter(isMaterializedProjection)) {
    const slug = snake(proj.name);
    const T = upperFirst(proj.name);
    const dbSet = projectionRowDbSet(proj);
    const shape = proj.wireShape ?? [];
    const corr = shape.find((f) => f.source === "id");
    const corrName = upperFirst(proj.correlationField as string);
    const targetName = corr && corr.type.kind === "id" ? corr.type.targetName : "";
    // The `{key}` param binds the correlation id's CLR value type (Guid / int /
    // long / string), so Swashbuckle emits the matching param schema — parity
    // with the other backends by construction.
    const corrClr = csIdValueClrType();
    const proj_ = (rowVar: string): string =>
      shape
        .map((f) => projectToResponse(`${rowVar}.${upperFirst(f.name)}`, wireFieldType(f), ctx))
        .join(", ");
    let listBody: string;
    let byIdBody: string;
    // Every read of a scoped fold applies its read scope (`fold-tenancy.ts`):
    // the row's tenant column equals the request principal's claim.
    const tenancy = foldTenancyFor(proj);
    const floor = tenancy ? foldFloorTerms(tenancy) : [];
    if (floor.length > 0) {
      usings.add(`${ns}.Auth`);
      needsCurrentUser = true;
    }
    const scopeLocals = floor
      .map(
        (t, i) =>
          `        var __scope${i} = System.Convert.ToString(_currentUser.User.${upperFirst(t.claim)}, System.Globalization.CultureInfo.InvariantCulture);\n`,
      )
      .join("");
    const efScope = floor.map((t, i) => `r.${upperFirst(t.field)} == __scope${i}`);
    const sqlScope = floor.map((t, i) => `${sqlIdent(t.column)} = @scope${i}`);
    const sqlScopeArgs = floor.map((_, i) => `scope${i} = __scope${i}`);
    if (usingDapper) {
      const cols = dapperProjectionColumns(proj);
      const pkCol = snake(proj.correlationField as string);
      const listWhere = sqlScope.length > 0 ? ` WHERE ${sqlScope.join(" AND ")}` : "";
      const listArgs = sqlScopeArgs.length > 0 ? `, new { ${sqlScopeArgs.join(", ")} }` : "";
      const keyWhere = [`${sqlIdent(pkCol)} = @key`, ...sqlScope].join(" AND ");
      const keyArgs = ["key", ...sqlScopeArgs].join(", ");
      const table = projectionRowTable(proj);
      const pocoFqn = `global::${ns}.Infrastructure.Persistence.Projections.${projectionRowClass(proj)}`;
      const rowCls = `${T}DbRow`;
      const mapFn = `Map${T}`;
      rowMapDecls.push(
        `    private sealed class ${rowCls}\n    {\n` +
          cols
            .map(
              (c) =>
                `        public ${c.rowCs} ${c.col} { get; set; }${c.nullable ? "" : " = default!;"}`,
            )
            .join("\n") +
          `\n    }\n` +
          `    private static ${pocoFqn} ${mapFn}(${rowCls} r) => new()\n    {\n` +
          cols.map((c) => `        ${c.stateProp} = ${c.hydrate},`).join("\n") +
          `\n    };`,
      );
      const selCols = cols.map((c) => sqlIdent(c.col)).join(", ");
      listBody =
        scopeLocals +
        `        await using var conn = await _db.OpenConnectionAsync();\n` +
        `        var rows = (await conn${CS.Dapper}.QueryAsync<${rowCls}>(new CommandDefinition("SELECT ${selCols} FROM ${sqlIdent(table)}${listWhere}"${listArgs}))).Select(${mapFn});\n` +
        `        return Ok(rows.Select(x => new ${T}Response(${proj_("x")})));\n`;
      byIdBody =
        scopeLocals +
        `        await using var conn = await _db.OpenConnectionAsync();\n` +
        `        var __row = await conn${CS.Dapper}.QuerySingleOrDefaultAsync<${rowCls}>(new CommandDefinition("SELECT ${selCols} FROM ${sqlIdent(table)} WHERE ${keyWhere}", new { ${keyArgs} }));\n` +
        // M-T6.31 — raise the shared carrier instead of `NotFound()`, so the app's
        // one 404 producer (`DomainExceptionFilter`) renders the envelope.  See
        // `dotnetNotFoundThrow`.
        `        if (__row is null) ${dotnetNotFoundThrow(ns, T, "key")}\n` +
        `        var x = ${mapFn}(__row);\n` +
        `        return Ok(new ${T}Response(${proj_("x")}));\n`;
    } else {
      const efWhere = efScope.length > 0 ? `.Where(r => ${efScope.join(" && ")})` : "";
      listBody =
        scopeLocals +
        `        var rows = await _db.${dbSet}${CS.EfCore}.AsNoTracking()${efWhere}.ToListAsync();\n` +
        `        return Ok(rows.Select(x => new ${T}Response(${proj_("x")})));\n`;
      byIdBody =
        scopeLocals +
        `        var __key = new ${targetName}Id(key);\n` +
        `        var x = await _db.${dbSet}${CS.EfCore}.AsNoTracking().FirstOrDefaultAsync(r => ${[`r.${corrName} == __key`, ...efScope].join(" && ")});\n` +
        `        if (x is null) ${dotnetNotFoundThrow(ns, T, "key")}\n` +
        `        return Ok(new ${T}Response(${proj_("x")}));\n`;
    }
    // Authorization gate (authorization.md) — the folded read model's twin of
    // the query-time projection's gate in `query-projection-emit.ts`: a
    // `currentUser`-only predicate evaluated BEFORE the read, throwing
    // `ForbiddenException` (→ 403 via the DomainExceptionFilter).  It guards
    // BOTH routes; on the by-key route it runs before the lookup, so a caller
    // who fails it cannot learn whether the key exists.
    const gate = proj.query?.requires;
    if (gate) {
      collectCsExprUsings(gate, usings, ns);
      usings.add(`${ns}.Domain.Common`); // ForbiddenException
      if (exprUsesCurrentUser(gate)) {
        usings.add(`${ns}.Auth`); // ICurrentUserAccessor
        needsCurrentUser = true;
      }
    }
    const gateLines = gate
      ? (exprUsesCurrentUser(gate) ? `        var currentUser = _currentUser.User;\n` : "") +
        `        if (!(${renderCsExpr(gate)})) throw new ForbiddenException(${JSON.stringify(
          `Forbidden: projection ${proj.name}`,
        )});\n`
      : "";
    const forbiddenAttr = gate
      ? `    ${csProblemResponseAttr(wireStatus("forbidden", ctx.structuralErrorStatuses), "")}\n`
      : "";
    blocks.push(
      `    [HttpGet("${slug}")]\n` +
        `    [ProducesResponseType(typeof(IEnumerable<${T}Response>), 200)]\n` +
        forbiddenAttr +
        `    public async Task<IActionResult> List${T}()\n` +
        `    {\n` +
        gateLines +
        listBody +
        `    }\n` +
        `    [HttpGet("${slug}/{key}")]\n` +
        `    [ProducesResponseType(typeof(${T}Response), 200)]\n` +
        forbiddenAttr +
        `    ${csProblemResponseAttr(wireStatus("not-found", ctx.structuralErrorStatuses), "")}\n` +
        `    public async Task<IActionResult> Get${T}(${corrClr} key)\n` +
        `    {\n` +
        gateLines +
        byIdBody +
        `    }\n`,
    );
  }
  const extraUsings = sortedCsUsings(usings);
  const persistenceUsings = CS_PERSISTENCE_USINGS;
  const dbFieldType = usingDapper ? CS.NpgsqlDataSource : "AppDbContext";
  const ctorField = needsCurrentUser
    ? `    private readonly ${dbFieldType} _db;\n` +
      `    private readonly ICurrentUserAccessor _currentUser;\n` +
      `    public ${className}(${dbFieldType} db, ICurrentUserAccessor currentUser)\n` +
      `    {\n        _db = db;\n        _currentUser = currentUser;\n    }`
    : `    private readonly ${dbFieldType} _db;\n    public ${className}(${dbFieldType} db) => _db = db;`;
  const memberDecls = usingDapper && rowMapDecls.length > 0 ? `${rowMapDecls.join("\n")}\n\n` : "";
  return `// Auto-generated.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
${persistenceUsings}${extraUsings.length > 0 ? "\n" + extraUsings.join("\n") : ""}
using ${ns}.Application.Workflows;
using ${ns}.Domain.Ids;
using ${ns}.Domain.ValueObjects;
using ${ns}.Domain.Enums;
using ${ns}.Infrastructure.Persistence;

namespace ${ns}.Api;

[ApiController]
[Route("${route}")]
public sealed class ${className} : ControllerBase
{
${ctorField}

${memberDecls}${blocks.join("\n")}
}
`;
}

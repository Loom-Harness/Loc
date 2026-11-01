import { type PolymorphicRead, polymorphicReadFor } from "../../../ir/enrich/read-scope.js";
import type {
  AggregateIR,
  EnrichedAggregateIR,
  EnrichedBoundedContextIR,
} from "../../../ir/types/loom-ir.js";
import type { AggPool } from "../../../ir/util/inheritance.js";
import { lines } from "../../../util/code-builder.js";
import { lowerFirst, plural, upperFirst } from "../../../util/naming.js";
import { routeSegmentFor } from "../../../util/storage-names.js";
import { csIdValueClrType, projectEntityExpr } from "../dto-mapping.js";
import { efSetName } from "../ef-read-source.js";
import { csProducesProblem } from "../wire-policy-cs.js";
import { csPagedQueryParams, dotnetNotFoundThrow } from "./common.js";
// The polymorphic base read (aggregate-inheritance.md): a read of an abstract
// base returns every row as its real subtype, filtered by each subtype's own
// restrictions, in ONE global `Id` order, paged globally.  Rendered from the
// `polymorphicReadFor` fact.
//
//   - TPH (`sharedTable`): ONE query over `DbSet<Base>`.  The root's own
//     filters and every concrete's type-guarded ones (`!(x is Car) || …`) are
//     all registered on the root entity type, so EF applies each to exactly
//     the rows it governs — nothing here re-states a restriction.  The row
//     materialises as its concrete CLR type off the `kind` discriminator.
//   - TPC (`ownTable`): the base owns no table (`Ignore<Base>()`), so the
//     reader merges each concrete repository's own read — each under its own
//     entity type's filters, hydrated by the loader that knows its tree — in
//     `Id` order, then pages the merge.
//
// Read-only: writes go through the per-concrete repositories.

/** True when a polymorphic reader is emitted for `base`: it has a read home
 *  (`polymorphicReadFor`).  A TPH reader queries the root `DbSet` on EF and the
 *  shared table directly on Dapper (`dapper-base-reader.ts`).  Program.cs
 *  registers exactly these. */
export function emitsBaseReader(base: AggregateIR, pool: AggPool): boolean {
  return !!polymorphicReadFor(base, pool);
}

/** One concrete of the read, with its enriched node. */
interface Variant {
  agg: EnrichedAggregateIR;
  tag: string;
}

function variantsOf(read: PolymorphicRead, ctx: EnrichedBoundedContextIR): Variant[] {
  return read.variants.flatMap((v) => {
    const agg = ctx.aggregates.find((a) => a.name === v.aggregate);
    return agg ? [{ agg, tag: v.tag }] : [];
  });
}

/** True when the read is served over HTTP: every concrete's own `all` read is
 *  ungated (no `requires`, so no `denyByDefault` gate either) and no concrete
 *  masks a field — otherwise the base route would bypass that gate or mask. */
export function routesPolymorphicRead(
  read: PolymorphicRead,
  ctx: EnrichedBoundedContextIR,
): boolean {
  return read.variants.every((v) => {
    const concrete = ctx.aggregates.find((a) => a.name === v.aggregate);
    const all = ctx.repositories
      .find((r) => r.aggregateName === v.aggregate)
      ?.finds.find((f) => f.name === "all");
    return !!concrete && !!all && !all.requires && !concrete.fields.some((f) => f.maskUnless);
  });
}

/** The read-only `I<Base>Repository` interface (Domain layer). */
export function renderBaseReaderInterface(
  base: EnrichedAggregateIR,
  read: PolymorphicRead,
  ns: string,
): string {
  const B = base.name;
  return (
    lines(
      "// Auto-generated.",
      "using System.Collections.Generic;",
      "using System.Threading;",
      "using System.Threading.Tasks;",
      `using ${ns}.Domain.Common;`,
      `using ${ns}.Domain.Ids;`,
      "",
      `namespace ${ns}.Domain.${plural(B)};`,
      "",
      `// Read-only polymorphic reader for the abstract base ${B}: every row as its`,
      "// concrete subtype, under each subtype's own restrictions, in Id order.",
      `public interface I${B}Repository`,
      "{",
      read.layout === "sharedTable"
        ? `    Task<${B}?> GetByIdAsync(${B}Id id, CancellationToken cancellationToken = default);`
        : `    Task<IReadOnlyList<${B}>> FindAllAsync(CancellationToken cancellationToken = default);`,
      `    Task<Paged<${B}>> FindPageAsync(int page, int pageSize, CancellationToken cancellationToken = default);`,
      "}",
    ) + "\n"
  );
}

/** The `<Base>Repository` implementation (Infrastructure layer). */
export function renderBaseReaderImpl(
  base: EnrichedAggregateIR,
  read: PolymorphicRead,
  ctx: EnrichedBoundedContextIR,
  ns: string,
): string {
  return read.layout === "sharedTable"
    ? renderTphBaseReaderImpl(base, ns)
    : renderTpcBaseReaderImpl(base, variantsOf(read, ctx), ns);
}

const PAGE_LINES = [
  "        var __totalPages = pageSize > 0 ? (int)System.Math.Ceiling((double)__total / pageSize) : 0;",
];

/** TPH: one query over the root set; EF applies every root-hosted filter. */
function renderTphBaseReaderImpl(base: EnrichedAggregateIR, ns: string): string {
  const B = base.name;
  const set = efSetName(B);
  return (
    lines(
      "// Auto-generated.",
      "using System.Linq;",
      "using System.Threading;",
      "using System.Threading.Tasks;",
      "using Microsoft.EntityFrameworkCore;",
      `using ${ns}.Domain.${plural(B)};`,
      `using ${ns}.Domain.Common;`,
      `using ${ns}.Domain.Ids;`,
      `using ${ns}.Infrastructure.Persistence;`,
      "",
      `namespace ${ns}.Infrastructure.Repositories;`,
      "",
      `public sealed class ${B}Repository : I${B}Repository`,
      "{",
      "    private readonly AppDbContext _db;",
      "",
      `    public ${B}Repository(AppDbContext db)`,
      "    {",
      "        _db = db;",
      "    }",
      "",
      `    public async Task<${B}?> GetByIdAsync(${B}Id id, CancellationToken cancellationToken = default)`,
      "    {",
      `        return await _db.${set}.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, cancellationToken);`,
      "    }",
      "",
      `    public async Task<Paged<${B}>> FindPageAsync(int page, int pageSize, CancellationToken cancellationToken = default)`,
      "    {",
      `        var __total = await _db.${set}.CountAsync(cancellationToken);`,
      ...PAGE_LINES,
      `        var __items = await _db.${set}.AsNoTracking().OrderBy(x => x.Id).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(cancellationToken);`,
      `        return new Paged<${B}>(__items, page, pageSize, __total, __totalPages);`,
      "    }",
      "}",
    ) + "\n"
  );
}

/** TPC: each concrete repository's own read, merged in `Id` order. */
function renderTpcBaseReaderImpl(
  base: EnrichedAggregateIR,
  variants: readonly Variant[],
  ns: string,
): string {
  const B = base.name;
  const field = (c: EnrichedAggregateIR): string => `_${lowerFirst(c.name)}Repo`;
  const ctorParam = (c: EnrichedAggregateIR): string => `${lowerFirst(c.name)}Repo`;
  const concretes = variants.map((v) => v.agg);
  const concreteUsings = [
    ...new Set(concretes.map((c) => `using ${ns}.Domain.${plural(c.name)};`)),
  ].sort();
  return (
    lines(
      "// Auto-generated.",
      "using System;",
      "using System.Collections.Generic;",
      "using System.Linq;",
      "using System.Threading;",
      "using System.Threading.Tasks;",
      `using ${ns}.Domain.${plural(B)};`,
      `using ${ns}.Domain.Common;`,
      ...concreteUsings,
      "",
      `namespace ${ns}.Infrastructure.Repositories;`,
      "",
      `public sealed class ${B}Repository : I${B}Repository`,
      "{",
      ...concretes.map((c) => `    private readonly I${c.name}Repository ${field(c)};`),
      "",
      `    public ${B}Repository(${concretes
        .map((c) => `I${c.name}Repository ${ctorParam(c)}`)
        .join(", ")})`,
      "    {",
      ...concretes.map((c) => `        ${field(c)} = ${ctorParam(c)};`),
      "    }",
      "",
      `    public async Task<IReadOnlyList<${B}>> FindAllAsync(CancellationToken cancellationToken = default)`,
      "    {",
      `        var result = new List<(IComparable Key, ${B} Row)>();`,
      ...concretes.map(
        (c) =>
          `        result.AddRange((await ${field(c)}.All(cancellationToken)).Select(x => ((IComparable)x.Id.Value, (${B})x)));`,
      ),
      "        return result.OrderBy(r => r.Key).Select(r => r.Row).ToList();",
      "    }",
      "",
      `    public async Task<Paged<${B}>> FindPageAsync(int page, int pageSize, CancellationToken cancellationToken = default)`,
      "    {",
      "        var __all = await FindAllAsync(cancellationToken);",
      "        var __total = __all.Count;",
      ...PAGE_LINES,
      "        var __items = __all.Skip((page - 1) * pageSize).Take(pageSize).ToList();",
      `        return new Paged<${B}>(__items, page, pageSize, __total, __totalPages);`,
      "    }",
      "}",
    ) + "\n"
  );
}

/** `Api/<Bases>Controller.cs` — `GET /api/<bases>` (paged, tagged items) and,
 *  under TPH, `GET /api/<bases>/{id}` (one tagged row; 404 when absent or
 *  hidden by a restriction).  Each item is `{ "type": "<Concrete>", …that
 *  concrete's own by-id wire body }` (the tagged-union wire, payloads.md). */
export function renderBaseController(
  base: EnrichedAggregateIR,
  read: PolymorphicRead,
  ctx: EnrichedBoundedContextIR,
  ns: string,
  routePrefix: string,
): string {
  const B = base.name;
  const variants = variantsOf(read, ctx);
  const route = `${routePrefix}${routeSegmentFor(B)}`;
  const [pageParam, pageSizeParam] = csPagedQueryParams();
  const idClr = csIdValueClrType(base.idValueType);
  // Most-derived arm first is moot (every concrete is a leaf), but a C#
  // `switch` over type patterns must still name each concrete once.
  const arms = variants.map(
    (v, i) =>
      `        ${v.agg.name} __c${i} => Tagged(${JSON.stringify(v.tag)}, ${projectEntityExpr(`__c${i}`, v.agg, ctx)}),`,
  );
  const responseUsings = [
    ...new Set(
      variants.flatMap((v) => [
        `using ${ns}.Domain.${plural(v.agg.name)};`,
        `using ${ns}.Application.${plural(v.agg.name)}.Responses;`,
      ]),
    ),
  ];
  return (
    lines(
      "// Auto-generated.",
      "using System;",
      "using System.Linq;",
      "using System.Text.Json;",
      "using System.Text.Json.Nodes;",
      "using System.Threading.Tasks;",
      "using Microsoft.AspNetCore.Mvc;",
      "using Microsoft.Extensions.Options;",
      `using ${ns}.Domain.${plural(B)};`,
      ...responseUsings,
      `using ${ns}.Domain.Common;`,
      `using ${ns}.Domain.Ids;`,
      `using ${ns}.Domain.ValueObjects;`,
      `using ${ns}.Domain.Enums;`,
      "",
      `namespace ${ns}.Api;`,
      "",
      "[ApiController]",
      `[Route("${route}")]`,
      `public sealed class ${plural(upperFirst(B))}Controller : ControllerBase`,
      "{",
      `    private readonly I${B}Repository _repo;`,
      "    private readonly JsonSerializerOptions _json;",
      `    public ${plural(upperFirst(B))}Controller(I${B}Repository repo, IOptions<JsonOptions> json) { _repo = repo; _json = json.Value.JsonSerializerOptions; }`,
      "",
      "    [HttpGet]",
      "    [ProducesResponseType(typeof(Paged<JsonObject>), 200)]",
      csProducesProblem("field-invalid"),
      `    public async Task<ActionResult<Paged<JsonObject>>> All${B}(${pageParam}, ${pageSizeParam})`,
      "    {",
      "        var result = await _repo.FindPageAsync(page, pageSize, HttpContext.RequestAborted);",
      "        return Ok(new Paged<JsonObject>(result.Items.Select(ToWire).ToList(), result.Page, result.PageSize, result.Total, result.TotalPages));",
      "    }",
      ...(read.layout === "sharedTable"
        ? [
            "",
            '    [HttpGet("{id}")]',
            "    [ProducesResponseType(typeof(JsonObject), 200)]",
            csProducesProblem("not-found"),
            csProducesProblem("field-invalid"),
            `    public async Task<ActionResult<JsonObject>> Get${B}ById([FromRoute] ${idClr} id)`,
            "    {",
            `        var found = await _repo.GetByIdAsync(new ${B}Id(id), HttpContext.RequestAborted);`,
            `        if (found is null) ${dotnetNotFoundThrow(ns, B, "id")}`,
            "        return Ok(ToWire(found));",
            "    }",
          ]
        : []),
      "",
      `    private JsonObject ToWire(${B} row) => row switch`,
      "    {",
      ...arms,
      `        _ => throw new InvalidOperationException($"unmapped ${B} subtype {row.GetType().Name}"),`,
      "    };",
      "",
      "    /// The concrete's own wire body with the `type` tag first.",
      "    private JsonObject Tagged(string type, object response)",
      "    {",
      "        var body = JsonSerializer.SerializeToNode(response, response.GetType(), _json)!.AsObject();",
      '        var tagged = new JsonObject { ["type"] = type };',
      "        foreach (var (key, value) in body.ToList())",
      "        {",
      "            body.Remove(key);",
      "            tagged[key] = value;",
      "        }",
      "        return tagged;",
      "    }",
      "}",
    ) + "\n"
  );
}

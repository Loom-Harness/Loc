// The Dapper polymorphic base read for a TPH (`sharedTable`) hierarchy — the
// raw-SQL rendering of the `polymorphicReadFor` fact (src/ir/enrich/read-scope.ts).
//
// A read of an abstract base returns every row as its real subtype, filtered by
// each subtype's own restrictions, in ONE global `id` order, paged globally.
// Concatenating the concretes' own reads gets all three wrong (the order and the
// page are per subtype, and a subtype whose filter is forgotten serves the rows
// it hides), so the base reads the shared table ONCE:
//
//   SELECT <union of the concretes' columns> FROM <base table>
//   WHERE <the root's restrictions> AND (kind <> 'Car' OR <Car's own predicate>) …
//   ORDER BY id LIMIT @__take OFFSET @__offset
//
// plus a `COUNT(*)` under the same WHERE for the page's `total`.  Each row
// carries its `kind`; `reader.GetRowParser<BaseRow>(type)` switches the row
// parser per `kind`, so a `Car` row hydrates through `CarRow` (its own columns)
// and a `Truck` row through `TruckRow`.  A concrete whose aggregate is not a
// flat row (contained parts, `X id[]` references, a document / embedded shape)
// cannot hydrate from its root row alone: its ids are collected in order and
// loaded through its own repository's `FindManyByIdsAsync`, which applies the
// same scope.
//
// The restrictions are rendered once into the generated `<Base>Scope` helper
// (`Polymorphic`), the same discipline as the per-aggregate scope helper
// (dapper-scope.ts): no statement here spells a `kind` or capability predicate.
//
// The `I<Base>Repository` port and the routed `<Bases>Controller` are the shared
// ones (`base-reader.ts`): `GET /api/<bases>?page=&pageSize=` (the paged envelope
// of tagged rows) and `GET /api/<bases>/{id}`.

import { type PolymorphicRead, polymorphicReadFor } from "../../../ir/enrich/read-scope.js";
import type {
  AggregateIR,
  EnrichedAggregateIR,
  EnrichedBoundedContextIR,
  ExprIR,
} from "../../../ir/types/loom-ir.js";
import { lines } from "../../../util/code-builder.js";
import { escapeCsharpIdent, lowerFirst, plural } from "../../../util/naming.js";
import {
  claimGuidHelperLines,
  collectFilterPrincipalRefs,
  columnsOf,
  dapperAggregateTable,
  idTypes,
  principalFields,
  sqlIdent,
  whereToSql,
} from "./dapper.js";
import { csSqlLiteral, scopeMarker } from "./dapper-scope.js";
import { dapperOpenConn } from "./dapper-session.js";
import { csStateHolderOf } from "./state-holder.js";

const AMBIENT = "RequestContext.Current!.CurrentUser!";

interface ConcreteShape {
  agg: EnrichedAggregateIR;
  /** The row-hydration columns, or undefined when the concrete cannot hydrate from its root row. */
  flat?: ReturnType<typeof columnsOf>;
}

/** The `<Base>Repository` implementation (Infrastructure layer). */
export function renderDapperTphBaseReaderImpl(
  base: EnrichedAggregateIR,
  concretes: readonly EnrichedAggregateIR[],
  ctx: EnrichedBoundedContextIR,
  ns: string,
  isFlat: (agg: EnrichedAggregateIR) => boolean,
): string {
  const read = polymorphicReadFor(base, ctx.aggregates) as PolymorphicRead;
  const table = sqlIdent(dapperAggregateTable(base.name));
  const idClass = `${base.name}Id`;
  const idCs = idTypes(base.idValueType).cs;

  const shapes: ConcreteShape[] = concretes.map((agg) => ({
    agg,
    ...(isFlat(agg) ? { flat: columnsOf(agg, false, idClass) } : {}),
  }));
  const flats = shapes.filter((s) => s.flat);
  const delegated = shapes.filter((s) => !s.flat);

  // The union of every flat concrete's columns (id and kind lead).
  const colNames: string[] = [];
  for (const s of flats) {
    for (const c of s.flat!) if (c.col !== "id" && !colNames.includes(c.col)) colNames.push(c.col);
  }
  const colList = ["id", "kind", ...colNames].map((c) => sqlIdent(c)).join(", ");

  // ── the scope: the root's restrictions + each concrete's own, kind-guarded ──
  const exprs: ExprIR[] = [];
  const sqls: string[] = [];
  for (const r of read.restrictions) {
    if (!r.predicate) continue;
    exprs.push(r.predicate);
    sqls.push(whereToSql(r.predicate, { agg: base, table: dapperAggregateTable(base.name) }));
  }
  for (const g of read.subtypeRestrictions) {
    const declared = (ctx.aggregates.find((a) => a.name === g.restriction.declaredOn) ??
      base) as AggregateIR;
    exprs.push(g.restriction.predicate!);
    sqls.push(
      `(kind <> '${g.discriminator.replace(/'/g, "''")}' OR ${whereToSql(g.restriction.predicate!, {
        agg: declared as EnrichedAggregateIR,
        table: dapperAggregateTable(base.name),
      })})`,
    );
  }
  const scopeClass = `${base.name}Scope`;
  const where = sqls.length > 0 ? ` WHERE ${scopeMarker(scopeClass, "Polymorphic")}` : "";
  const andWhere = sqls.length > 0 ? ` AND ${scopeMarker(scopeClass, "Polymorphic")}` : "";
  const refs = collectFilterPrincipalRefs(exprs);
  const princ = principalFields(refs, AMBIENT);
  const princSuffix = princ.length > 0 ? `, ${princ.join(", ")}` : "";
  const princObj = princ.length > 0 ? `new { ${princ.join(", ")} }` : "null";

  const delegateField = (s: ConcreteShape): string => `_${lowerFirst(s.agg.name)}Repo`;
  const usings = [
    ...new Set([
      `using ${ns}.Domain.${plural(base.name)};`,
      ...concretes.map((c) => `using ${ns}.Domain.${plural(c.name)};`),
    ]),
  ].sort();

  const rowClasses = flats.flatMap((s) => [
    "",
    `    private sealed class ${s.agg.name}Row : BaseRow`,
    "    {",
    ...s
      .flat!.filter((c) => c.col !== "id")
      .map(
        (c) =>
          `        public ${c.rowCs} ${escapeCsharpIdent(c.col)} { get; set; }${c.rowCs === "string" ? " = default!;" : ""}`,
      ),
    "    }",
  ]);
  const mapArms = flats.map(
    (s) =>
      `        ${s.agg.name}Row r => ${s.agg.name}._Create(new ${csStateHolderOf(s.agg.name)}\n        {\n${s
        .flat!.map((c) => `            ${c.stateProp} = ${c.hydrate},`)
        .join("\n")}\n        }),`,
  );
  const parserArms = flats.map(
    (s) =>
      `            ["${s.agg.name}"] = reader.GetRowParser<BaseRow>(typeof(${s.agg.name}Row)),`,
  );
  const pendingKinds = delegated.map((s) => `"${s.agg.name}"`);

  const delegateLoads = delegated.flatMap((s) => [
    `        if (pending.TryGetValue("${s.agg.name}", out var __${lowerFirst(s.agg.name)}Slots))`,
    "        {",
    `            var __loaded = await ${delegateField(s)}.FindManyByIdsAsync(__${lowerFirst(s.agg.name)}Slots.Select(x => new ${idClass}(x.Id)).ToList(), cancellationToken);`,
    "            var __byId = __loaded.ToDictionary(x => x.Id.Value);",
    `            foreach (var (index, id) in __${lowerFirst(s.agg.name)}Slots)`,
    "                if (__byId.TryGetValue(id, out var found)) items[index] = found;",
    "        }",
  ]);

  const body = lines(
    "// Auto-generated.  Dapper persistence (persistence: dapper).",
    "using System;",
    "using System.Collections.Generic;",
    "using System.Linq;",
    "using System.Threading;",
    "using System.Threading.Tasks;",
    "using Dapper;",
    "using Npgsql;",
    ...usings,
    `using ${ns}.Domain.Ids;`,
    `using ${ns}.Domain.Enums;`,
    `using ${ns}.Domain.ValueObjects;`,
    `using ${ns}.Domain.Common;`,
    "",
    `namespace ${ns}.Infrastructure.Repositories;`,
    "",
    `public sealed class ${base.name}Repository : I${base.name}Repository`,
    "{",
    "    private readonly NpgsqlDataSource _db;",
    ...delegated.map((s) => `    private readonly I${s.agg.name}Repository ${delegateField(s)};`),
    "",
    `    public ${base.name}Repository(NpgsqlDataSource db${delegated
      .map((s) => `, I${s.agg.name}Repository ${lowerFirst(s.agg.name)}Repo`)
      .join("")})`,
    "    {",
    "        _db = db;",
    ...delegated.map((s) => `        ${delegateField(s)} = ${lowerFirst(s.agg.name)}Repo;`),
    "    }",
    "",
    "    private abstract class BaseRow",
    "    {",
    `        public ${idCs} id { get; set; }${idCs === "string" ? " = default!;" : ""}`,
    "        public string kind { get; set; } = default!;",
    "    }",
    ...rowClasses,
    "",
    // One flat concrete makes every arm the same derived type; the base return type is the contract.
    '    [System.Diagnostics.CodeAnalysis.SuppressMessage("Performance", "CA1859:Use concrete types when possible for improved performance", Justification = "The reader returns the polymorphic base.")]',
    `    private static ${base.name}? MapRow(BaseRow row) => row switch`,
    "    {",
    ...mapArms,
    "        _ => null,",
    "    };",
    "",
    "    // Reads the open result set into domain objects in row order.  The row parser is",
    "    // switched per row on `kind`; a kind that cannot hydrate from its root row is",
    "    // loaded afterwards through its own repository, under that repository's scope.",
    `    private ${delegated.length > 0 ? "" : "static "}async Task<List<${base.name}>> ReadAsync(System.Data.Common.DbDataReader reader, CancellationToken cancellationToken)`,
    "    {",
    `        var parsers = new Dictionary<string, Func<System.Data.Common.DbDataReader, BaseRow>>`,
    "        {",
    ...parserArms,
    "        };",
    '        var kindIx = reader.GetOrdinal("kind");',
    ...(delegated.length > 0 ? ['        var idIx = reader.GetOrdinal("id");'] : []),
    `        var items = new List<${base.name}?>();`,
    ...(delegated.length > 0
      ? [`        var pending = new Dictionary<string, List<(int Index, ${idCs} Id)>>();`]
      : []),
    "        while (await reader.ReadAsync(cancellationToken))",
    "        {",
    "            var kind = reader.GetString(kindIx);",
    "            if (parsers.TryGetValue(kind, out var parse))",
    "            {",
    "                items.Add(MapRow(parse(reader)));",
    "                continue;",
    "            }",
    ...(delegated.length > 0
      ? [
          `            if (${pendingKinds.map((k) => `kind == ${k}`).join(" || ")})`,
          "            {",
          `                if (!pending.TryGetValue(kind, out var slots)) pending[kind] = slots = new List<(int Index, ${idCs} Id)>();`,
          `                slots.Add((items.Count, reader.Get${idCs === "Guid" ? "Guid" : idCs === "string" ? "String" : idCs === "long" ? "Int64" : "Int32"}(idIx)));`,
          "                items.Add(null);",
          "            }",
        ]
      : []),
    "        }",
    ...delegateLoads,
    "        return items.Where(x => x is not null).Select(x => x!).ToList();",
    "    }",
    "",
    `    public async Task<${base.name}?> GetByIdAsync(${idClass} id, CancellationToken cancellationToken = default)`,
    "    {",
    `        ${dapperOpenConn(ns)}`,
    `        await using var reader = (System.Data.Common.DbDataReader)await conn.ExecuteReaderAsync(new CommandDefinition(${csSqlLiteral(`SELECT ${colList} FROM ${table} WHERE id = @id${andWhere}`)}, new { id = id.Value${princSuffix} }, cancellationToken: cancellationToken));`,
    "        return (await ReadAsync(reader, cancellationToken)).FirstOrDefault();",
    "    }",
    "",
    `    public async Task<Paged<${base.name}>> FindPageAsync(int page, int pageSize, CancellationToken cancellationToken = default)`,
    "    {",
    `        ${dapperOpenConn(ns)}`,
    `        var total = await conn.ExecuteScalarAsync<int>(new CommandDefinition(${csSqlLiteral(`SELECT COUNT(*) FROM ${table}${where}`)}, ${princObj}, cancellationToken: cancellationToken));`,
    "        var totalPages = pageSize > 0 ? (int)System.Math.Ceiling((double)total / pageSize) : 0;",
    `        await using var reader = (System.Data.Common.DbDataReader)await conn.ExecuteReaderAsync(new CommandDefinition(${csSqlLiteral(`SELECT ${colList} FROM ${table}${where} ORDER BY id LIMIT @__take OFFSET @__offset`)}, new { __take = pageSize, __offset = (page - 1) * pageSize${princSuffix} }, cancellationToken: cancellationToken));`,
    `        return new Paged<${base.name}>(await ReadAsync(reader, cancellationToken), page, pageSize, total, totalPages);`,
    "    }",
    ...claimGuidHelperLines(refs),
    "}",
    ...(sqls.length > 0
      ? [
          "",
          "/// <summary>The read scope of this aggregate: the polymorphic base's — the root's restrictions and",
          "/// each subtype's own, kind-guarded; rendered once from the IR read fact.</summary>",
          `internal static class ${scopeClass}`,
          "{",
          `    public const string Polymorphic = "${sqls.join(" AND ")}";`,
          "}",
        ]
      : []),
  );
  return `${body}\n`;
}

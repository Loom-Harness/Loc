import { readSortFor } from "../../ir/enrich/read-scope.js";
// spec-emit — reified retrievals as Ardalis `Specification<T>` objects (the
// query *bundle*: where + sort). The headline reified-criteria payoff on
// .NET: a `retrieval` becomes a constructed Specification consumed by the
// repository via `.WithSpecification(spec)`, rather than a hand-inlined LINQ
// chain.
//
// EF-Core-only: Ardalis.Specification.EntityFrameworkCore evaluates these
// against `IQueryable`; the Dapper persistence axis has no `IQueryable`, so it
// keeps rendering SQL fragments (the csproj gates the Ardalis dependency on
// `persistence: efcore`).
//
// The spec holds where + sort; call-site `page` (offset/limit) stays LINQ on
// the spec-filtered query in the repository method (`Skip`/`Take`). When the
// `where` is exactly a named, eligible criterion the spec consumes that
// criterion's `ToExpression`; otherwise it inlines the predicate.

import type { BoundedContextIR, EnrichedAggregateIR, RetrievalIR } from "../../ir/types/loom-ir.js";
import { refCollectionFieldName } from "../../ir/util/ref-collection.js";
import { walkExprDeep } from "../../ir/util/walk.js";
import { lines } from "../../util/code-builder.js";
import { escapeCsharpIdent, plural, upperFirst } from "../../util/naming.js";
import { canEmitToExpressionFor, quantifies, refsCurrentUser } from "./criteria-emit.js";
import { csLocalNamer } from "./local-names.js";
import {
  AMBIENT_CURRENT_USER,
  collectCsExprUsings,
  renderCsExpr,
  renderCsType,
} from "./render-expr.js";

/** The C# class name for a retrieval's Ardalis specification. */
export function specClassName(retrievalName: string): string {
  return `${upperFirst(retrievalName)}Spec`;
}

/** The shared `IQueryable<T>.ApplyPaging(page)` extension — applies the
 *  call-site `(offset, limit)` page to a spec-filtered query, keeping the
 *  `Skip`/`Take` out of every `Run<Name>Async`.  Returns `IQueryable<T>` so
 *  materialisation (`.ToListAsync`) stays explicit at the call site (and so
 *  the name can't be confused with the project's `Paged<T>` result wrapper).
 *  Emitted once per project when any retrieval exists. */
export function renderPagingExtension(ns: string): string {
  return lines(
    "// Auto-generated.",
    "using System.Linq;",
    "",
    `namespace ${ns}.Infrastructure.Persistence;`,
    "",
    "/// <summary>Applies a call-site (offset, limit) page to a query.</summary>",
    "internal static class QueryablePagingExtensions",
    "{",
    "    public static IQueryable<T> ApplyPaging<T>(this IQueryable<T> query, (int? offset, int? limit)? page)",
    "    {",
    "        if (page is { } p)",
    "        {",
    "            if (p.offset is { } off) query = query.Skip(off);",
    "            if (p.limit is { } lim) query = query.Take(lim);",
    "        }",
    "        return query;",
    "    }",
    "}",
  );
}

export function emitRetrievalSpecs(
  agg: EnrichedAggregateIR,
  retrievals: RetrievalIR[],
  ctx: BoundedContextIR,
  ns: string,
  out: Map<string, string>,
): void {
  for (const r of retrievals) {
    out.set(`Domain/${plural(agg.name)}/${specClassName(r.name)}.cs`, renderSpec(r, agg, ctx, ns));
  }
}

/** Does retrieval `r`'s `where` test a REFERENCE-collection membership
 *  (`this.<refColl>.contains(x)` over an `X id[]` field)?  The field is not a
 *  column: EF `Ignore`s it and stores it in the join entity, so the only
 *  translatable form is the `_db.<JoinDbSet>.Any(...)` subquery — which needs
 *  the DbContext.  A Domain-layer specification has none, so such a `where` is
 *  applied by the EF repository's `Run<Name>Async` instead
 *  ({@link retrievalWhereInRepository}); the spec keeps only the sort. */
export function retrievalWhereInRepository(r: RetrievalIR, agg: EnrichedAggregateIR): boolean {
  // An `exists` quantifier is the same case: its subquery reads another entity
  // set through the DbContext.
  if (quantifies(r.where)) return true;
  let found = false;
  walkExprDeep(r.where, (e) => {
    if (
      e.kind === "method-call" &&
      e.member === "contains" &&
      e.receiverType.kind === "array" &&
      e.receiverType.element.kind === "id" &&
      e.args.length === 1
    ) {
      const field = refCollectionFieldName(e.receiver);
      if (field && agg.associations.some((a) => a.fieldName === field)) found = true;
    }
  });
  return found;
}

/** The repository-side `.Where(x => …)` of a retrieval whose `where` reads a
 *  join table (see {@link retrievalWhereInRepository}). */
export function retrievalRepositoryWhere(r: RetrievalIR, agg: EnrichedAggregateIR): string {
  const x = csLocalNamer(r.params.map((p) => p.name))("x");
  const refsPrincipal = refsCurrentUser(r.where);
  return `.Where(${x} => ${renderCsExpr(r.where, {
    thisName: x,
    agg,
    efQuery: true,
    currentUserExpr: refsPrincipal ? AMBIENT_CURRENT_USER : undefined,
  })})`;
}

function renderSpec(
  r: RetrievalIR,
  agg: EnrichedAggregateIR,
  ctx: BoundedContextIR,
  ns: string,
): string {
  if (retrievalWhereInRepository(r, agg)) return renderSortOnlySpec(r, agg, ns);
  const reified = !!(r.criterionRef && canEmitToExpressionFor(r.criterionRef.name, ctx, agg.name));
  // A retrieval whose `where` references the principal (`currentUser.<field>`,
  // e.g. a tenancy criterion) is built once inside the `Specification<T>`
  // constructor — a static position with no request-scoped `currentUser` local.
  // Resolve it through the same ambient accessor the EF query-filter capability
  // filters use (`AMBIENT_CURRENT_USER`), so the principal has one source on the
  // whole backend; without this the inlined predicate names an unbound
  // `currentUser` and the spec fails to compile (CS0103). The reified branch
  // never hits this — `canEmitToExpressionFor` excludes principal criteria, so
  // they fall to the inline path here, where the binding lives.
  const refsPrincipal = !reified && refsCurrentUser(r.where);
  // The predicate lambda's parameter yields to a same-named retrieval param,
  // which the predicate reads (`x => x.Name == x` would compare the row to itself).
  const x = csLocalNamer(r.params.map((p) => p.name))("x");
  const wherePredicate = reified
    ? `new ${upperFirst(r.criterionRef!.name)}Criterion(${r
        .criterionRef!.args.map((a) => renderCsExpr(a, { thisName: "x", agg }))
        .join(", ")}).ToExpression()`
    : `${x} => ${renderCsExpr(r.where, { thisName: x, agg, currentUserExpr: refsPrincipal ? AMBIENT_CURRENT_USER : undefined })}`;

  const usings = new Set<string>([
    "Ardalis.Specification",
    `${ns}.Domain.Enums`,
    `${ns}.Domain.ValueObjects`,
    `${ns}.Domain.Ids`,
  ]);
  if (reified) usings.add(`${ns}.Domain.Criteria`);
  // The ambient accessor (`RequestContext`) lives in `<ns>.Domain.Common`;
  // import it only when the predicate actually resolves the principal.
  if (refsPrincipal) usings.add(`${ns}.Domain.Common`);
  collectCsExprUsings(r.where, usings, ns);

  const ctorParams = r.params
    .map((p) => `${renderCsType(p.type)} ${escapeCsharpIdent(p.name)}`)
    .join(", ");
  return lines(
    "// Auto-generated.",
    ...[...usings].map((u) => `using ${u};`),
    "",
    // The aggregate type lives in this same namespace (Domain/<Plural>), so
    // no extra using is needed to reference it.
    `namespace ${ns}.Domain.${plural(agg.name)};`,
    "",
    `public sealed class ${specClassName(r.name)} : Specification<${agg.name}>`,
    "{",
    `    public ${specClassName(r.name)}(${ctorParams})`,
    "    {",
    `        Query.Where(${wherePredicate})${orderByChain(r)};`,
    "    }",
    "}",
  );
}

/** The specification of a retrieval whose `where` the repository applies —
 *  the sort alone, so it takes no parameters. */
function renderSortOnlySpec(r: RetrievalIR, agg: EnrichedAggregateIR, ns: string): string {
  return lines(
    "// Auto-generated.",
    "using Ardalis.Specification;",
    "",
    `namespace ${ns}.Domain.${plural(agg.name)};`,
    "",
    "/// <summary>The sort of the retrieval; its filter reads a join table, so the",
    "/// repository applies it against the DbContext.</summary>",
    `public sealed class ${specClassName(r.name)} : Specification<${agg.name}>`,
    "{",
    `    public ${specClassName(r.name)}()`,
    "    {",
    `        Query${orderByChain(r)};`,
    "    }",
    "}",
  );
}

/** `.OrderBy(x => x.A).ThenByDescending(x => x.B)` for a retrieval's sort
 *  terms plus the `id` tie-break, or `.OrderBy(x => x.Id)` when unsorted
 *  (`readSortFor`) — Ardalis's builder mirrors LINQ's names, so
 *  this is the same chain `find-emit.ts:orderByClauseFor` produces. Only the
 *  first path segment is used (a direct column), matching validateRetrievals. */
function orderByChain(r: RetrievalIR): string {
  // The lambda parameter yields to a same-named retrieval param, as the
  // `where` lambda does (a param `x` would otherwise be shadowed).
  const x = csLocalNamer(r.params.map((p) => p.name))("x");
  return readSortFor(r.sort)
    .map((s, i) => {
      const col = upperFirst(s.path[0]!.name);
      const method =
        i === 0
          ? s.direction === "desc"
            ? "OrderByDescending"
            : "OrderBy"
          : s.direction === "desc"
            ? "ThenByDescending"
            : "ThenBy";
      return `.${method}(${x} => ${x}.${col})`;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// The .NET backend's importable BCL / package symbols, as `ref()` markers.
// Interpolate one — `${CS.Regex}.IsMatch(…)` — and the unit's finalizer
// (`DotnetOutputMap` → `finalizeCsUnit`) spells it and derives its `using`.
// A namespace entry (`CS.EfCore`) marks an extension-method call and spells as
// nothing: write it immediately before the call it enables.
// ---------------------------------------------------------------------------

import { csNameRef, csNsRef, csProjectRef, csRef, csUsing } from "../_imports/dotnet.js";

export const CS = {
  Regex: csRef("System.Text.RegularExpressions", "Regex"),
  CultureInfo: csRef("System.Globalization", "CultureInfo"),
  DateTimeStyles: csRef("System.Globalization", "DateTimeStyles"),
  NumberStyles: csRef("System.Globalization", "NumberStyles"),
  Expression: csRef("System.Linq.Expressions", "Expression"),
  Task: csRef("System.Threading.Tasks", "Task"),
  CancellationToken: csRef("System.Threading", "CancellationToken"),
  DateTime: csRef("System", "DateTime"),
  IsolationLevel: csRef("System.Data", "IsolationLevel"),
  ILogger: csRef("Microsoft.Extensions.Logging", "ILogger"),
  /** `[property: JsonRequired]` on an operation-request record param. */
  JsonRequired: csRef("System.Text.Json.Serialization", "JsonRequired"),
  Linq: csNsRef("System.Linq"),
  /** Dapper's `IDbConnection` extensions (`QueryAsync`, `ExecuteAsync`). */
  Dapper: csNsRef("Dapper"),
  /** EF Core's `IQueryable` / `DbContext` extensions (`ToListAsync`, …). */
  EfCore: csNsRef("Microsoft.EntityFrameworkCore"),
  NpgsqlDataSource: csRef("Npgsql", "NpgsqlDataSource"),
  NpgsqlCommand: csRef("Npgsql", "NpgsqlCommand"),
} as const;

/** The types every generated project declares for itself that a domain type
 *  may be named like, each with its namespace below the root namespace.  The
 *  units outside that namespace name them through {@link CS_NAME};
 *  `ProblemDetailsError` is named only inside its own, and the log formatter
 *  (`DOTNET_RUNTIME.jsonLineFormatter`) only fully qualified from Program.cs. */
export const CS_PROJECT_TYPE_HOME = {
  AggregateNotFoundException: "Domain.Common",
  DisallowedException: "Domain.Common",
  DomainException: "Domain.Common",
  ForbiddenException: "Domain.Common",
  RequestContext: "Domain.Common",
  WireFormatException: "Domain.Common",
  HttpMetrics: "Observability",
  JsonLineFormatter: "Observability",
  ProblemDetailsError: "Api",
} as const;

const project = <N extends keyof typeof CS_PROJECT_TYPE_HOME>(name: N): string =>
  csProjectRef(CS_PROJECT_TYPE_HOME[name], name);

/** Types the emitters spell by simple name in units whose `using`s they write
 *  by hand — BCL types and the types the project generates for itself.  Each
 *  is spelled bare, or `global::`-qualified where a domain type of the
 *  project takes the name (`_imports/dotnet.ts`); none derives a `using`. */
export const CS_NAME = {
  DateTime: csNameRef("System", "DateTime"),
  Array: csNameRef("System", "Array"),
  Exception: csNameRef("System", "Exception"),
  ProblemDetails: csNameRef("Microsoft.AspNetCore.Mvc", "ProblemDetails"),
  AggregateNotFoundException: project("AggregateNotFoundException"),
  DisallowedException: project("DisallowedException"),
  DomainException: project("DomainException"),
  ForbiddenException: project("ForbiddenException"),
  RequestContext: project("RequestContext"),
  WireFormatException: project("WireFormatException"),
  HttpMetrics: project("HttpMetrics"),
} as const;

/** BCL namespaces whose `using` is derived from a `ref` in the text rather
 *  than collected — a sorted header reserves each one a slot at its sorted
 *  position, so a derived line lands where a collected one used to. */
const DERIVED_NAMESPACES = ["System.Text.RegularExpressions", "System.Globalization"] as const;

/** A header's `using` lines in ASCII order: one per collected namespace, plus
 *  a `csUsing` slot at its sorted position for each derived namespace that was
 *  not collected (it renders iff the unit references that namespace). */
export function sortedCsUsings(
  collected: Iterable<string>,
  /** More derived namespaces this header reserves a sorted slot for. */
  slots: readonly string[] = [],
): string[] {
  const have = new Set(collected);
  return [...new Set([...have, ...DERIVED_NAMESPACES, ...slots])]
    .sort()
    .map((n) => (have.has(n) ? `using ${n};` : csUsing(n)));
}

/** The persistence-adapter header block: Dapper + Npgsql on the Dapper
 *  adapter, EF Core otherwise — each line rendered iff the unit's text calls
 *  into it. */
export const CS_PERSISTENCE_USINGS = [
  csUsing("Dapper"),
  csUsing("Npgsql"),
  csUsing("Microsoft.EntityFrameworkCore"),
].join("\n");

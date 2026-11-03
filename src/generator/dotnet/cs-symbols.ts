// ---------------------------------------------------------------------------
// The .NET backend's importable BCL / package symbols, as `ref()` markers.
// Interpolate one — `${CS.Regex}.IsMatch(…)` — and the unit's finalizer
// (`DotnetOutputMap` → `finalizeCsUnit`) spells it and derives its `using`.
// A namespace entry (`CS.EfCore`) marks an extension-method call and spells as
// nothing: write it immediately before the call it enables.
// ---------------------------------------------------------------------------

import { csNsRef, csRef, csUsing } from "../_imports/dotnet.js";

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

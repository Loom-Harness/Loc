// The Dapper read scope — ONE generated `<Agg>Scope` helper per aggregate.
//
// Dapper has no global query filter and no discriminator mapping, so every
// statement that reads or writes an aggregate's rows must spell its `kind`
// scope and its capability / tenancy / deny predicates by hand.  Spelled at
// each statement, the same predicate appears ~8 times per repository and a
// statement that forgets one serves rows the others hide.  Instead the
// restrictions are rendered ONCE, from the `readScope` IR fact
// (`src/ir/enrich/read-scope.ts` — the same fact the drizzle and EF adapters
// consume), into a generated static class:
//
//   internal static class CraneScope
//   {
//       public const string KindLiteral = "'Crane'";                     // TPH writes
//       public const string Where = "kind = 'Crane' AND (NOT archived)"; // a plain read
//       public const string WhereIgnoringAll = "kind = 'Crane'";         // `ignoring *`
//       public static string Runtime(FilterBypass bypass) { … }           // a runtime `ignoring`
//   }
//
// and every statement in the repository concatenates the member it needs
// (`"… WHERE id = @id AND " + CraneScope.Where`).  The `ignoring` clause of a
// declared find is static, so each distinct clause is one more constant; a
// retrieval's arrives at runtime, so `Runtime` takes it.  The `kind` scope is
// never bypassable (a type mapping, not a query filter); a `deny` carve-out and
// a bare `filter` are not either — only a capability-contributed predicate is.
//
// This module is the only place in the Dapper adapter that reads the filter
// arrays or the discriminator; `test/generator/dotnet/dapper-read-scope-census`
// pins that.

import {
  type ReadBypass,
  readDiscriminator,
  readFilterRestrictions,
  readScopeFor,
} from "../../../ir/enrich/read-scope.js";
import type { EnrichedAggregateIR, ExprIR } from "../../../ir/types/loom-ir.js";

/** The `ignoring` clause of one read, as `FindIR` / a projection query carries it. */
export type DapperBypass = { bypassAll?: boolean; bypassCaps?: string[] };

/** One predicate-carrying restriction, its SQL rendered. */
interface ScopePart {
  sql: string;
  expr: ExprIR;
  /** The capability that contributed it; the target of an `ignoring <Cap>`. */
  capability: string | undefined;
  /** True when some `ignoring` clause can drop it. */
  bypassable: boolean;
}

/** SQL-text markers: a reference to a `<Agg>Scope` member inside a SQL string
 *  that is later turned into a C# expression by {@link csSqlLiteral} /
 *  {@link csSqlInterpolated}. */
const MARK_OPEN = "\u27e6";
const MARK_CLOSE = "\u27e7";
const MARK_RE = /\u27e6([^\u27e7]+)\u27e7/g;

/** The marker for `<Agg>Scope.<member>`. */
export function scopeMarker(className: string, member: string): string {
  return `${MARK_OPEN}${className}.${member}${MARK_CLOSE}`;
}

/** A C# string EXPRESSION for SQL `text` whose scope markers become
 *  concatenated `<Agg>Scope` members: `"… AND " + CraneScope.Where`.  Text
 *  without a marker is the plain quoted literal. */
export function csSqlLiteral(text: string): string {
  const out: string[] = [];
  let last = 0;
  for (const m of text.matchAll(MARK_RE)) {
    const before = text.slice(last, m.index);
    if (before) out.push(`"${before}"`);
    out.push(m[1]!);
    last = m.index + m[0].length;
  }
  const rest = text.slice(last);
  if (rest || out.length === 0) out.push(`"${rest}"`);
  return out.join(" + ");
}

/** The body of a C# `$"…"` literal for SQL `text`: scope markers become
 *  `{<Agg>Scope.<member>}` interpolation holes. */
export function csSqlInterpolated(text: string): string {
  return text.replace(MARK_RE, (_m, member: string) => `{${member}}`);
}

export interface DapperScope {
  /** The generated helper class, `<Agg>Scope`. */
  className: string;
  /** True when the aggregate has any restriction at all (a `kind` scope or a predicate). */
  scoped: boolean;
  /** The marker for the TPH `kind` literal (`'Crane'`) — a write site's value.  Empty off TPH. */
  kindLiteral: string;
  /** ` AND kind = '<Concrete>'` for a write that addresses a row by id (a delete), or ""
   *  off TPH: a write is scoped by the type mapping alone, never by a read restriction,
   *  so a concrete's repository can't rewrite or delete a sibling's row. */
  andWriteKind(): string;
  /** `<table>.kind = '<Concrete>'` — the same write scope, qualified, for a
   *  conflict-update guard where an unqualified `kind` would be ambiguous with `excluded.kind`. */
  writeKindOn(table: string): string;
  /** ` AND <scope>` / ` WHERE <scope>` for a read carrying `bypass`, or "" when
   *  nothing applies.  `existingWhere` says whether the statement already has a WHERE. */
  andScope(existingWhere: boolean, bypass?: DapperBypass): string;
  /** The predicates a read carrying `bypass` still applies — the base of its principal-claim binding. */
  keptExprs(bypass?: DapperBypass): ExprIR[];
  /** Every declared predicate, bypass not applied. */
  declaredExprs: readonly ExprIR[];
  /** The runtime-bypass tail: a marker for `<Agg>Scope.Runtime(<bypassVar>)`, "" when unscoped. */
  runtimeTail(bypassVar: string): string;
  /** The generated helper class, or [] when the aggregate is unscoped. */
  renderClass(): string[];
}

/** Build the scope helper of one aggregate.
 *
 *  `pool` is the aggregate's context pool (the read fact resolves the `extends`
 *  chain through it); `renderSql` renders one predicate to Postgres SQL and
 *  throws outside the Dapper subset — a thrown predicate is surfaced loudly,
 *  never dropped (half-applying a soft-delete / tenant filter would be a
 *  correctness hole). */
export function buildDapperScope(
  agg: EnrichedAggregateIR,
  pool: readonly EnrichedAggregateIR[],
  renderSql: (e: ExprIR) => string,
): DapperScope {
  const className = `${agg.name}Scope`;
  const full = readScopeFor(agg, pool);
  const discriminator = readDiscriminator(full);
  const kindLiteralSql = discriminator ? `'${discriminator.replace(/'/g, "''")}'` : "";
  const kindSql = discriminator ? `kind = ${kindLiteralSql}` : null;

  const rendered = new Map<ExprIR, string>();
  const parts: ScopePart[] = readFilterRestrictions(full).map((r) => {
    let sql: string;
    try {
      sql = renderSql(r.predicate);
    } catch {
      throw new Error(
        `dapper: capability filter on '${agg.name}' is outside the Dapper SQL subset; ` +
          `use 'persistence: efcore' or simplify the predicate.`,
      );
    }
    rendered.set(r.predicate, sql);
    return { sql, expr: r.predicate, capability: r.capability, bypassable: r.bypassable };
  });

  const bypassKey = (bypass?: DapperBypass): string => {
    if (bypass?.bypassAll) return "All";
    const caps = [...new Set(bypass?.bypassCaps ?? [])].sort();
    return caps.length > 0 ? `_${caps.join("_")}` : "";
  };
  const memberFor = (bypass?: DapperBypass): string =>
    `Where${bypassKey(bypass) ? `Ignoring${bypassKey(bypass)}` : ""}`;
  const asReadBypass = (bypass?: DapperBypass): ReadBypass | undefined =>
    bypass ? { bypassAll: bypass.bypassAll, bypassCaps: bypass.bypassCaps } : undefined;

  /** The conjuncts a read carrying `bypass` applies, in application order. */
  const conjuncts = (bypass?: DapperBypass): { sqls: string[]; exprs: ExprIR[] } => {
    const scope = readScopeFor(agg, pool, { ignoring: asReadBypass(bypass) });
    const filters = readFilterRestrictions(scope);
    return {
      sqls: [...(kindSql ? [kindSql] : []), ...filters.map((r) => rendered.get(r.predicate)!)],
      exprs: filters.map((r) => r.predicate),
    };
  };

  /** The members the repository actually referenced — only those are emitted. */
  const used = new Map<string, string>();
  const memberSql = (bypass?: DapperBypass): string | null => {
    const sql = conjuncts(bypass).sqls.join(" AND ");
    if (!sql) return null;
    used.set(memberFor(bypass), sql);
    return memberFor(bypass);
  };
  let usesKindLiteral = false;
  let usesRuntime = false;
  let usesWriteKind = false;
  let usesKindOf = false;

  const scoped = kindSql !== null || parts.length > 0;
  return {
    className,
    scoped,
    get kindLiteral() {
      if (!discriminator) return "";
      usesKindLiteral = true;
      return scopeMarker(className, "KindLiteral");
    },
    andScope(existingWhere, bypass) {
      const member = memberSql(bypass);
      return member
        ? `${existingWhere ? " AND " : " WHERE "}${scopeMarker(className, member)}`
        : "";
    },
    andWriteKind() {
      if (!discriminator) return "";
      usesWriteKind = true;
      return ` AND ${scopeMarker(className, "Kind")}`;
    },
    writeKindOn(table) {
      if (!discriminator) return "";
      usesKindOf = true;
      return scopeMarker(className, `KindOf("${table}")`);
    },
    keptExprs: (bypass) => conjuncts(bypass).exprs,
    declaredExprs: parts.map((p) => p.expr),
    runtimeTail(bypassVar) {
      if (!scoped) return "";
      usesRuntime = true;
      return scopeMarker(className, `Runtime(${bypassVar})`);
    },
    renderClass() {
      if (!scoped) return [];
      const body: string[] = [];
      if (usesKindLiteral && discriminator) {
        body.push(`    public const string KindLiteral = "${kindLiteralSql}";`);
      }
      if (usesWriteKind && kindSql) body.push(`    public const string Kind = "${kindSql}";`);
      if (usesKindOf && discriminator) {
        body.push(
          `    public static string KindOf(string table) => table + ".kind = ${kindLiteralSql}";`,
        );
      }
      for (const [member, sql] of used) {
        body.push(`    public const string ${member} = "${sql}";`);
      }
      if (usesRuntime) {
        // A retrieval's `ignoring` clause arrives at RUNTIME (the `FilterBypass`
        // a workflow's inline `Repo.run(...) ignoring …` binds), so the tail is
        // decided per call: the `kind` scope and a non-bypassable conjunct
        // always apply, a capability predicate unless the caller names it.
        const adds = [
          ...(kindSql ? [`        parts.Add("${kindSql}");`] : []),
          ...parts.map((p) => {
            const guard = !p.bypassable
              ? ""
              : p.capability != null
                ? `if (!bypass.All && bypass.Capabilities?.Contains(${JSON.stringify(p.capability)}) != true) `
                : `if (!bypass.All) `;
            return `        ${guard}parts.Add("${p.sql}");`;
          }),
        ];
        body.push(
          "    public static string Runtime(FilterBypass bypass)",
          "    {",
          "        var parts = new List<string>();",
          ...adds,
          '        return parts.Count > 0 ? " AND " + string.Join(" AND ", parts) : "";',
          "    }",
        );
      }
      return [
        "",
        "/// <summary>The read scope of this aggregate — rendered once from the IR read fact;",
        "/// every statement in the repository splices a member instead of spelling the predicate.</summary>",
        `internal static class ${className}`,
        "{",
        ...body,
        "}",
      ];
    },
  };
}

/** The predicates a `shape: document` read applies, in application order.  A
 *  document aggregate persists as one jsonb blob, so its filters evaluate in
 *  process over the rehydrated instance instead of in SQL — but they are the same
 *  restrictions of the same read-scope fact, so they come from it, not from the
 *  raw filter arrays. */
export function documentReadPredicates(
  agg: EnrichedAggregateIR,
  pool: readonly EnrichedAggregateIR[],
): ExprIR[] {
  return readFilterRestrictions(readScopeFor(agg, pool)).map((r) => r.predicate);
}

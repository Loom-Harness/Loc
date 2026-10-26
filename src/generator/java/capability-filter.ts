// ---------------------------------------------------------------------------
// Java capability-filter triage — the "pay for what you use" hybrid for
// selective filter bypass (`ignoring <Cap>` / `ignoring *`,
// capability-emission-dedup.md §11.6).
//
// Java installs a NON-PRINCIPAL `filter <expr>` capability via Hibernate's
// `@SQLRestriction` — a STATIC always-on WHERE fragment on the entity, applied
// to every SELECT (the HasQueryFilter analog).  `@SQLRestriction` is unbypassable
// by design (Hibernate javadoc: "always applied and cannot be disabled"), so a
// capability some read `ignoring`s cannot stay there.  The idiomatic resolution
// is to TRIAGE each capability
// per aggregate at codegen:
//
//   - A capability NEVER bypassed on an aggregate stays in `@SQLRestriction`
//     (always-on, zero cost, zero change — covers JPQL + by-id + lazy).
//   - A capability that IS bypassed by some read is PROMOTED: its predicate(s)
//     are REMOVED from `@SQLRestriction` and emitted as a bypassable Hibernate
//     named filter (`@FilterDef(name=X, autoEnabled = true, applyToLoadByKey =
//     true)` + `@Filter(name=X, condition=<sql>)`).  `autoEnabled` reproduces
//     the always-on semantics with no interceptor; `applyToLoadByKey` keeps
//     by-id/lazy loads filtered.  At a bypassing read the repository impl wraps
//     the query body with `session.disableFilter(X)` / `enableFilter(X)`.
//   - A bare (non-capability, `contextFilterOrigins[i] === undefined`) filter is
//     NEVER bypassable, so it stays in `@SQLRestriction` always.
//
// PRINCIPAL (tenancy) filters are excluded from this module: they can't ride
// `@SQLRestriction` (no static principal), so they are AND-ed into the per-query
// JPQL in `emit/repository.ts`; their bypass is handled there by omitting the
// conjunct (exactly like node), keyed on `contextFilterOrigins`.  The same rule
// runs IN-APP in `emit/document-store.ts` (a jsonb blob has no queryable
// columns, so every predicate — principal or not — is a stream `.filter`).
// This paragraph described the intent before it described the code: until
// M-T6.54 F18 both of those sites ANDed the principal conjunct unconditionally,
// so `find … ignoring tenantOwned` silently kept returning only the caller's
// tenant while the validator listed `java` as honoring the bypass.  Keep the claim and the
// code together — `test/generator/java/generator-java-find-bypass-principal.test.ts`
// asserts the ABSENCE of the conjunct per surface, which is the only assertion
// shape that can see a retained one.
//
// The triage is a DERIVED fact (read-decls × `contextFilterOrigins`), computed
// here at codegen — never stamped on the IR.  The bypass SET (capability names)
// rides the IR (`FindIR`/the `repo-run` stmt); the predicate identity
// is derived in this emitter.
// ---------------------------------------------------------------------------

import {
  type ReadRestriction,
  readFilterRestrictions,
  readScopeFor,
} from "../../ir/enrich/read-scope.js";
import type {
  AggregateIR,
  BoundedContextIR,
  ExprIR,
  WorkflowStmtIR,
} from "../../ir/types/loom-ir.js";
import { exprUsesCurrentUser, isQueryTimeProjection } from "../../ir/types/loom-ir.js";
import {
  isTphBase,
  isTphConcrete,
  tableOwnerName,
  tphConcretesOf,
} from "../../ir/util/inheritance.js";
import { renderSqlRestriction } from "./render-sql-restriction.js";

/** A read's capability filter-bypass spec (`ignoring <Cap>` / `ignoring *`),
 *  carried by capability NAME on `FindIR` / the repo-run stmt.
 *  Named caps match `AggregateIR.contextFilterOrigins`; a filter with an
 *  `undefined` origin (bare/hand-written) is never bypassable. */
export interface FilterBypass {
  bypassAll?: boolean;
  bypassCaps?: string[];
}

/** True when the capability named `cap` is dropped by `bypass`
 *  (`ignoring *` drops every capability filter; a named `ignoring <Cap>`
 *  drops only the matching capability). */
export function bypassDrops(cap: string, bypass: FilterBypass | undefined): boolean {
  if (!bypass) return false;
  if (bypass.bypassAll) return true;
  return (bypass.bypassCaps ?? []).includes(cap);
}

/** The distinct NON-PRINCIPAL capability names that contribute a filter to
 *  `agg` (its `contextFilterOrigins`, minus the `undefined` bare-filter slots
 *  and any principal-referencing predicate).  A capability appears once even if
 *  it contributes several filters.  Principal filters are excluded — they ride
 *  the repository's per-query JPQL, not `@SQLRestriction`. */
function nonPrincipalCapabilityOrigins(agg: AggregateIR): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const filters = agg.contextFilters ?? [];
  const origins = agg.contextFilterOrigins ?? [];
  filters.forEach((pred, i) => {
    const o = origins[i];
    if (o == null || exprUsesCurrentUser(pred)) return;
    if (!seen.has(o)) {
      seen.add(o);
      out.push(o);
    }
  });
  return out;
}

/** Collect the `ignoring`-bearing inline `Repo.findAll`/`run` reads in a
 *  workflow-statement body (descends into `for-each` + `if-let` bodies),
 *  pairing each bypass spec with the aggregate it targets. */
function collectRepoRunBypasses(
  stmts: readonly WorkflowStmtIR[],
  out: { aggName: string; bypass: FilterBypass }[],
): void {
  for (const s of stmts) {
    if (s.kind === "repo-run" && (s.bypassAll || (s.bypassCaps?.length ?? 0) > 0)) {
      out.push({
        aggName: s.aggName,
        bypass: { bypassAll: s.bypassAll, bypassCaps: s.bypassCaps },
      });
    }
    if (s.kind === "for-each") collectRepoRunBypasses(s.body, out);
    if (s.kind === "if-let") {
      collectRepoRunBypasses(s.thenBody, out);
      collectRepoRunBypasses(s.elseBody ?? [], out);
    }
  }
}

/** Every `ignoring`-bearing read of `agg` in `ctx` — repository finds, views
 *  over the aggregate, and inline repo-runs in workflow bodies — as a list of
 *  bypass specs. */
function bypassesForAggregate(agg: AggregateIR, ctx: BoundedContextIR): FilterBypass[] {
  const bypasses: FilterBypass[] = [];
  for (const repo of ctx.repositories) {
    if (repo.aggregateName !== agg.name) continue;
    for (const f of repo.finds) {
      if (f.bypassAll || (f.bypassCaps?.length ?? 0) > 0) {
        bypasses.push({ bypassAll: f.bypassAll, bypassCaps: f.bypassCaps });
      }
    }
  }
  const repoRuns: { aggName: string; bypass: FilterBypass }[] = [];
  for (const wf of ctx.workflows) {
    for (const c of wf.creates) collectRepoRunBypasses(c.statements, repoRuns);
    for (const h of wf.handlers ?? []) collectRepoRunBypasses(h.statements, repoRuns);
    for (const on of wf.subscriptions ?? []) collectRepoRunBypasses(on.statements, repoRuns);
  }
  for (const r of repoRuns) {
    if (r.aggName === agg.name) bypasses.push(r.bypass);
  }
  // A query-time projection's `ignoring` bypasses its `from` source aggregate's
  // filters through the synthesised source find — so it PROMOTES the cap too.
  for (const p of ctx.projections ?? []) {
    const q = p.query;
    if (!isQueryTimeProjection(p) || q?.source !== agg.name) continue;
    if (q.bypassAll || (q.bypassCaps?.length ?? 0) > 0) {
      bypasses.push({ bypassAll: q.bypassAll, bypassCaps: q.bypassCaps });
    }
  }
  return bypasses;
}

/** The NON-PRINCIPAL capabilities PROMOTED on `agg` — those a `find` /
 *  inline `Repo.run` read in the context bypasses (its `bypassCaps` names the
 *  cap, or `bypassAll`).  This is the §11.6 triage: a promoted capability leaves
 *  the always-on `@SQLRestriction` and is emitted as a bypassable `@Filter`
 *  instead.  Returns the promoted-cap NAMES (a subset of `agg`'s non-principal
 *  capability-filter origins), deduped and ordered by first contribution. */
export function promotedCapabilities(agg: AggregateIR, ctx: BoundedContextIR): string[] {
  const origins = nonPrincipalCapabilityOrigins(agg);
  if (origins.length === 0) return [];
  const bypasses = bypassesForAggregate(agg, ctx);
  return origins.filter((cap) => bypasses.some((b) => bypassDrops(cap, b)));
}

/** The UNION bypass spec per retrieval name, drawn from the inline
 *  `Repo.run(<Retrieval>(…)) ignoring …` call-sites in `ctx`'s workflows that
 *  hit `aggName`.  A retrieval's `run<Name>` impl method is SHARED across
 *  call-sites, so its disable set must cover EVERY site's bypass: `bypassAll` if
 *  any site bypasses all, else the union of the named caps.  Empty map when no
 *  inline read of `aggName` carries an `ignoring` clause. */
export function inlineRunBypassesByRetrieval(
  ctx: BoundedContextIR,
  aggName: string,
): Map<string, FilterBypass> {
  const runs: { aggName: string; bypass: FilterBypass; retrievalName?: string }[] = [];
  const collect = (stmts: readonly WorkflowStmtIR[]): void => {
    for (const s of stmts) {
      if (s.kind === "repo-run" && (s.bypassAll || (s.bypassCaps?.length ?? 0) > 0)) {
        runs.push({
          aggName: s.aggName,
          bypass: { bypassAll: s.bypassAll, bypassCaps: s.bypassCaps },
          retrievalName: s.retrievalName,
        });
      }
      if (s.kind === "for-each") collect(s.body);
      if (s.kind === "if-let") {
        collect(s.thenBody);
        collect(s.elseBody ?? []);
      }
    }
  };
  for (const wf of ctx.workflows) {
    for (const c of wf.creates) collect(c.statements);
    for (const h of wf.handlers ?? []) collect(h.statements);
    for (const on of wf.subscriptions ?? []) collect(on.statements);
  }
  const acc = new Map<string, { bypassAll: boolean; caps: Set<string> }>();
  for (const r of runs) {
    if (r.aggName !== aggName || !r.retrievalName) continue;
    const cur = acc.get(r.retrievalName) ?? { bypassAll: false, caps: new Set<string>() };
    if (r.bypass.bypassAll) cur.bypassAll = true;
    for (const c of r.bypass.bypassCaps ?? []) cur.caps.add(c);
    acc.set(r.retrievalName, cur);
  }
  const out = new Map<string, FilterBypass>();
  for (const [name, v] of acc) {
    out.set(name, v.bypassAll ? { bypassAll: true } : { bypassCaps: [...v.caps] });
  }
  return out;
}

/** Wrap a repository-impl read body in `session.disableFilter`/`enableFilter`
 *  for the promoted capabilities `caps` (the §11.6 bypass site).  The body is a
 *  single statement — `return jpa.<method>(...);` — that must run with those
 *  Hibernate named filters DISABLED, then the filters are RE-ARMED in a
 *  `finally` so the rest of the session keeps the always-on semantics.  When
 *  `caps` is empty the body is returned unwrapped.  Indentation: the caller's
 *  body lines are already indented to the method-body level (8 spaces). */
export function wrapWithFilterBypass(caps: readonly string[], bodyLines: string[]): string[] {
  if (caps.length === 0) return bodyLines;
  const disables = caps.map((c) => `        __session.disableFilter(${JSON.stringify(c)});`);
  const enables = caps.map((c) => `            __session.enableFilter(${JSON.stringify(c)});`);
  return [
    `        var __session = em.unwrap(org.hibernate.Session.class);`,
    ...disables,
    `        try {`,
    ...bodyLines.map((l) => `    ${l}`),
    `        } finally {`,
    ...enables,
    `        }`,
  ];
}

// ---------------------------------------------------------------------------
// Where an aggregate's static restrictions live, and what a read bypasses.
//
// Hibernate applies a restriction declared on a SINGLE_TABLE subclass only to
// queries OF that subclass — `from Vehicle` and `find(Vehicle.class, id)` skip
// it — and refuses `@SQLRestriction` on a subclass outright.  So every
// restriction of a TPH hierarchy is hosted on its ROOT entity: the root's own
// unguarded, each concrete's own guarded by its discriminator
// (`(kind <> 'Car' or (<fragment>))`), straight off the `readScope` fact.  A
// TPH concrete hosts nothing.  A flat aggregate or a TPC concrete hosts its
// own `readScope` restrictions.
//
// Within the host, the §11.6 triage above decides the annotation: a capability
// some read `ignoring`s becomes an auto-enabled, by-key `@FilterDef`/`@Filter`
// (named after the capability; a TPH subtype's after `<Concrete>_<cap>`), the
// rest — never-bypassed capabilities, bare filters, denies — ride
// `@SQLRestriction`.  Under TPH a capability bypassed by ANY read of the
// hierarchy is promoted on every member that carries it, so the base's reads
// and each concrete's reads disable named filters that exist.
//
// Principal (tenancy) predicates are not static SQL, so they stay out of both
// annotations (see the module header).
// ---------------------------------------------------------------------------

/** One bypassable Hibernate named filter an entity hosts. */
export interface HostedFilter {
  /** The `@FilterDef` / `@Filter` name — what `disableFilter` names. */
  name: string;
  /** The capability whose `ignoring` disables the filter. */
  cap: string;
  /** The SQL condition, already discriminator-guarded for a TPH subtype. */
  condition: string;
  /** The TPH concrete this filter narrows (its discriminator), or undefined
   *  for a filter over every row the host maps. */
  kind?: string;
}

/** The static restrictions one JPA entity class hosts. */
export interface RestrictionHost {
  /** The `@SQLRestriction` conjuncts, joined with ` and ` when rendered. */
  sqlRestriction: string[];
  /** The promoted capabilities' named filters, in declaration order. */
  filters: HostedFilter[];
}

const EMPTY_HOST: RestrictionHost = { sqlRestriction: [], filters: [] };

/** True for a restriction a static SQL fragment can carry. */
function isStaticRestriction(r: ReadRestriction): r is ReadRestriction & { predicate: ExprIR } {
  return r.predicate !== undefined && !exprUsesCurrentUser(r.predicate);
}

/** The TPH root a concrete shares its table with, or undefined. */
function tphRootOf(agg: AggregateIR, pool: readonly AggregateIR[]): AggregateIR | undefined {
  if (!isTphConcrete(agg, pool)) return undefined;
  const owner = tableOwnerName(agg, pool);
  return pool.find((a) => a.name === owner);
}

/** Every capability some read of the hierarchy rooted at `root` bypasses. */
function hierarchyPromoted(root: AggregateIR, ctx: BoundedContextIR): Set<string> {
  const members = [root, ...tphConcretesOf(root, ctx.aggregates)];
  return new Set(members.flatMap((m) => promotedCapabilities(m, ctx)));
}

/** The restrictions the JPA entity for `agg` declares.  Empty for a TPH
 *  concrete (its root hosts them) and for an abstract base that maps no table
 *  of its own (a TPC `@MappedSuperclass`, an intermediate TPH base). */
export function restrictionHostFor(agg: AggregateIR, ctx: BoundedContextIR): RestrictionHost {
  const pool = ctx.aggregates;
  if (isTphConcrete(agg, pool)) return EMPTY_HOST;
  const tphRoot = isTphBase(agg, pool);
  if (agg.isAbstract && !tphRoot) return EMPTY_HOST;
  const promoted = tphRoot ? hierarchyPromoted(agg, ctx) : new Set(promotedCapabilities(agg, ctx));
  const scope = readScopeFor(agg, pool);
  const sqlRestriction: string[] = [];
  const byName = new Map<string, { filter: Omit<HostedFilter, "condition">; conds: string[] }>();
  const addFilter = (name: string, cap: string, cond: string, kind?: string): void => {
    const cur = byName.get(name) ?? { filter: { name, cap, ...(kind ? { kind } : {}) }, conds: [] };
    cur.conds.push(cond);
    byName.set(name, cur);
  };
  for (const r of readFilterRestrictions(scope)) {
    if (!isStaticRestriction(r)) continue;
    const frag = renderSqlRestriction(r.predicate);
    if (r.capability !== undefined && promoted.has(r.capability)) {
      addFilter(r.capability, r.capability, frag);
    } else sqlRestriction.push(frag);
  }
  // A concrete's own static fragments, grouped per concrete so each guard
  // wraps the conjunction once.
  const guardedStatic = new Map<string, string[]>();
  for (const { discriminator, restriction: r } of scope.subtypeRestrictions) {
    if (!isStaticRestriction(r)) continue;
    const frag = renderSqlRestriction(r.predicate);
    if (r.capability !== undefined && promoted.has(r.capability)) {
      addFilter(`${discriminator}_${r.capability}`, r.capability, frag, discriminator);
    } else {
      guardedStatic.set(discriminator, [...(guardedStatic.get(discriminator) ?? []), frag]);
    }
  }
  for (const [kind, frags] of guardedStatic) {
    sqlRestriction.push(kindGuarded(kind, frags));
  }
  const filters = [...byName.values()].map(
    ({ filter, conds }): HostedFilter => ({
      ...filter,
      condition: filter.kind ? kindGuarded(filter.kind, conds) : conds.join(" and "),
    }),
  );
  return { sqlRestriction, filters };
}

/** A subtype's fragments over the shared table, constraining only its rows. */
function kindGuarded(kind: string, frags: readonly string[]): string {
  return `(kind <> '${kind}' or (${frags.join(" and ")}))`;
}

/** True when a read of `reader` runs under a static restriction its entity
 *  host declares.  Such a by-id read must go through a query: a primary-key
 *  `find` of a row the session already holds returns that instance without
 *  running SQL, so neither `@SQLRestriction` nor a `@Filter` is consulted. */
export function hasStaticRestriction(reader: AggregateIR, ctx: BoundedContextIR): boolean {
  const host = restrictionHostFor(tphRootOf(reader, ctx.aggregates) ?? reader, ctx);
  return host.sqlRestriction.length > 0 || host.filters.length > 0;
}

/** The named filters a read of `reader` runs under, by capability: its host's
 *  filters that reach `reader`'s rows — all of them for the host itself; for a
 *  TPH concrete, the root's unguarded ones and its own guarded ones.  A read
 *  `ignoring` a capability disables exactly that capability's names. */
export function bypassFilterNames(
  reader: AggregateIR,
  ctx: BoundedContextIR,
): ReadonlyMap<string, readonly string[]> {
  const root = tphRootOf(reader, ctx.aggregates);
  const host = restrictionHostFor(root ?? reader, ctx);
  const out = new Map<string, string[]>();
  for (const f of host.filters) {
    if (root && f.kind !== undefined && f.kind !== reader.name) continue;
    out.set(f.cap, [...(out.get(f.cap) ?? []), f.name]);
  }
  return out;
}

/** The named filters a read with `bypass` disables, in host declaration
 *  order.  Empty when the read bypasses nothing promoted. */
export function bypassedFilterNames(
  names: ReadonlyMap<string, readonly string[]>,
  bypass: FilterBypass | undefined,
): string[] {
  if (names.size === 0 || !bypass) return [];
  return [...names].flatMap(([cap, ns]) => (bypassDrops(cap, bypass) ? [...ns] : []));
}

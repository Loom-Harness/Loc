// -------------------------------------------------------------------------
// Per-persistence-adapter find-predicate capability descriptor.
//
// Platform-neutral (it lives at IR level so `ir/validate` — which may not
// import `generator/` — can gate find/`filter`/retrieval predicates against
// the selected adapter's SQL-lowerable subset).  Each backend's relational
// adapter lowers a DIFFERENT subset of the queryable expression
// sublanguage to SQL; a predicate outside the selected adapter's subset
// either throws at generate time or emits a runtime-broken stub:
//
//   - MikroORM (`src/generator/typescript/emit/mikroorm.ts` whereToMikroFilter)
//       throws "mikroorm v1: this find's predicate is not yet supported".
//   - Dapper   (`src/generator/dotnet/emit/dapper.ts` whereToSql)
//       emits a `NotImplementedException` stub body.
//   - Drizzle  (`src/generator/typescript/repository-find-predicate.ts`)
//       lowers `null`, and every caller of `lowerToDrizzle` on a find /
//       retrieval / criterion path turns that into a LOUD generation-time
//       throw ("… could not lower to Drizzle, but the validator should have
//       caught this") — no TODO-comment stub survives to the generated tree.
//
// EF Core (`efcore`) lowers the RICHEST subset — exactly the queryable
// sublanguage admitted by `firstNonQueryableNode` (this.<field> compared to
// literal / param / enum, `&&`/`||`/`!` combinations, `currentUser.<field>`,
// `this.<refColl>.contains(x)`).  It is the "fully lowerable" baseline; the
// other three adapters are described here as NARROWINGS of it (which of those
// queryable shapes each one CANNOT lower).  Drizzle (the default node adapter)
// matches the baseline, so it has no narrowing.
//
// This is a GATE descriptor only — it describes what each adapter rejects so
// the validator can fail fast.  It does NOT extend any lowerer.
// -------------------------------------------------------------------------

import type { ExprIR } from "../types/loom-ir.js";

/** The persistence adapters that lower a `find` / `filter` / retrieval
 *  predicate to SQL.  Mirrors the `persistence:` selector spellings the
 *  deployable carries (`src/platform/*`); only the relational adapters
 *  appear here. */
export type FindPredicateAdapter = "efcore" | "drizzle" | "dapper" | "mikroorm";

/** A capability descriptor: given a predicate ALREADY known to be in the
 *  fully-lowerable (EF Core) queryable subset, return a short label for the
 *  first node THIS narrower adapter cannot lower — or null when the whole
 *  predicate is within the adapter's subset.
 *
 *  The predicate is assumed to already be queryable (anything richer has
 *  been rejected upstream by `firstNonQueryableNode`), so each descriptor
 *  only walks the structural arms the queryable subset admits (paren / unary
 *  `!` / binary compare+`&&`/`||` / `this.*` member / refs / literals /
 *  `this.<refColl>.contains`) and flags the shapes that ARE queryable but
 *  NOT lowerable by the given adapter. */
export type FindPredicateCapability = (e: ExprIR) => string | null;

// (`isCurrentUserMember` lived here.  It flagged `currentUser.<field>` as a
// MikroORM narrowing, on the stated reason that the adapter has "no principal
// accessor on the find path".  That reason was never true — `filterValue` has
// always rendered `requireCurrentUser().<claim>` — and the narrowing survived
// because the REAL defect was one layer out: the find METHOD did not declare
// the trailing `currentUser: User` parameter the Hono route passes it, so the
// generated project failed with TS2554 rather than anything this descriptor
// could name.  The three MikroORM repository variants that omitted it now
// declare it, like the drizzle repository and the adapter's own event-sourced
// variant always have, and the narrowing is gone.)

// (`isBareBooleanColumn`, `isQueryableIntrinsicCall` and the `COMPARE_OPS`
// table lived here.  They existed for one reader — `MIKROORM_SUBSET`'s
// structural walk over every queryable shape — and went with it when that walk
// shrank to the single remaining narrowing below.  A future narrowing re-adds
// the ones it needs; leaving them behind would be a vocabulary with no
// consumer, which is how a stale narrowing survives its own fix.)

const FULL_SUBSET: FindPredicateCapability = () => null;

/** Dapper (`whereToSql`): comparisons, `&&`/`||`, unary `!`, `this.<field>`,
 *  params, this-prop / enum-value refs, literals, `currentUser.<claim>`
 *  (lowered to a `@__cu_<claim>` param bound from the ambient request
 *  principal — same accessor the capability-filter path uses), AND
 *  `this.<refColl>.contains(x)` membership (lowered to an
 *  EXISTS join subquery correlated on the owner row's `id`, the raw-SQL mirror
 *  of EF's `_db.<JoinDbSet>.Any(...)`).  Dapper now matches the full queryable
 *  subset, so it narrows nothing versus the EF Core / drizzle baseline. */
const DAPPER_SUBSET: FindPredicateCapability = FULL_SUBSET;

/** MikroORM (`whereToMikroFilter`): comparisons (`col <op> value` — in EITHER
 *  operand order; `value <op> col` is commuted with its operator mirrored by
 *  `src/ir/util/comparison-operands.ts`, since a FilterQuery has no left-hand
 *  value position), bare
 *  boolean columns (`this.active` → `{ active: true }`), unary `!` (NOT — via
 *  FilterQuery `$not` / a `false` boolean entry), `&&` / `||` of predicate
 *  positions, `currentUser.<field>` principal references, the authorization /
 *  tenancy sentinels, queryable scalar intrinsics (`this.name.trim()`,
 *  `this.path.startsWith(p)`) through `raw()` SQL fragments, AND
 *  `this.<refColl>.contains(x)` membership (an `id in (select <ownerFk> from
 *  <joinTable> where <targetFk> = ?)` raw fragment — the FilterQuery mirror of
 *  Dapper's EXISTS subquery; see `containsMembershipFragment` in
 *  `src/generator/typescript/emit/mikroorm-filter.ts` for why the membership is
 *  spelled UNCORRELATED rather than as an EXISTS).
 *
 *  ONE narrowing is left, and it is SMALLER than the one it replaces: a
 *  membership whose ARGUMENT is a column rather than a bindable value
 *  (`where o.tags.contains(o.id)` — reachable only from a query-time
 *  projection `where`, which has no parameters to bind).  The join-table
 *  subquery binds its target as a parameter on every adapter, so a column there
 *  has nowhere to go.
 *
 *  The recorded reason for the OLD, wider narrowing — "needs a correlated join
 *  the adapter emits nowhere" — was a claim about the EXISTS spelling, not
 *  about the adapter: an uncorrelated `id in (select …)` says the same thing,
 *  and is what the drizzle twin emits.
 *
 *  NOTE, and it is not this adapter's: the column-argument shape is equally
 *  unlowerable on DRIZZLE, where it is not refused but CRASHES codegen
 *  ("internal: where-clause for projection 'X' could not lower to Drizzle") —
 *  a bare `platform: node` deployable carries no `persistence:` selector, so
 *  this gate never runs for it.  Recorded as its own ledger row; widening this
 *  descriptor would not reach it. */
const MIKROORM_SUBSET: FindPredicateCapability = (e) => {
  const walk = (n: ExprIR): string | null => {
    const inner = n.kind === "paren" ? n.inner : n;
    if (inner.kind === "binary") return walk(inner.left) ?? walk(inner.right);
    if (inner.kind === "unary") return walk(inner.operand);
    if (isColumnArgMembership(inner))
      return (
        "'this.<refColl>.contains(<column>)' — the join-table subquery binds its " +
        "target as a parameter, so a column argument has nowhere to bind"
      );
    return null;
  };
  return walk(e);
};

/** `this.<refColl>.contains(x)` where `x` is a COLUMN of the same row rather
 *  than a bindable value.  A parameter, a literal, an enum value or a
 *  `currentUser.<claim>` all bind; a `this.<field>` / alias member does not. */
function isColumnArgMembership(e: ExprIR): boolean {
  if (
    e.kind !== "method-call" ||
    e.member !== "contains" ||
    e.receiverType.kind !== "array" ||
    e.receiverType.element.kind !== "id" ||
    e.args.length !== 1
  )
    return false;
  const arg = e.args[0]!;
  const inner = arg.kind === "paren" ? arg.inner : arg;
  if (inner.kind === "ref") return inner.refKind === "this-prop";
  return inner.kind === "member" && inner.receiver.kind === "this";
}

const CAPABILITIES: Record<FindPredicateAdapter, FindPredicateCapability> = {
  // EF Core lowers the full queryable subset (the baseline).
  efcore: FULL_SUBSET,
  // Drizzle (default node adapter) matches the EF Core subset.
  drizzle: FULL_SUBSET,
  dapper: DAPPER_SUBSET,
  mikroorm: MIKROORM_SUBSET,
};

/** Recognised relational find-predicate adapters. */
export function isFindPredicateAdapter(name: string): name is FindPredicateAdapter {
  return name === "efcore" || name === "drizzle" || name === "dapper" || name === "mikroorm";
}

/** Return a short label for the first node in `predicate` that the given
 *  adapter cannot lower to SQL, or null when the whole predicate is within
 *  the adapter's subset.  `predicate` is assumed to already be in the
 *  fully-lowerable queryable subset (gated by `firstNonQueryableNode`); this
 *  applies only the per-adapter NARROWING. */
export function firstUnlowerableForAdapter(
  predicate: ExprIR,
  adapter: FindPredicateAdapter,
): string | null {
  return CAPABILITIES[adapter](predicate);
}

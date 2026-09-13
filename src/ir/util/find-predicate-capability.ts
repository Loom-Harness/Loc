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

import { intrinsicFor } from "../../util/intrinsics.js";
import type { ExprIR, TypeIR } from "../types/loom-ir.js";

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

/** `this.<refColl>.contains(x)` — the membership-over-a-reference-collection
 *  shape `firstNonQueryableNode` admits.  Every relational adapter now lowers
 *  it (EF Core `Any(...)`, Dapper + drizzle an EXISTS / `inArray` join
 *  subquery, MikroORM an uncorrelated `id in (select …)` raw fragment), so
 *  this predicate no longer decides a narrowing BY ITSELF — it only selects
 *  the nodes whose ARGUMENT `isColumnArgMembership` then judges. */
function isContainsMembership(e: ExprIR): boolean {
  return (
    e.kind === "method-call" &&
    e.member === "contains" &&
    e.receiverType.kind === "array" &&
    e.receiverType.element.kind === "id"
  );
}

/** A bare boolean column standing alone in a boolean position (`filter
 *  this.isActive` / `filter !this.isDeleted`).  EF Core / Drizzle lower it to
 *  `col = true`; MikroORM lowers it to `{ active: true }` — but a NON-boolean
 *  bare member (`filter this.name`) is not the same thing and must not be
 *  emitted as `{ name: true }`, which is why this checks the member TYPE. */
function isBareBooleanColumn(e: ExprIR): boolean {
  const isBool = (t: TypeIR | undefined): boolean => t?.kind === "primitive" && t.name === "bool";
  if (e.kind === "member" && e.receiver.kind === "this") return isBool(e.memberType);
  if (e.kind === "ref" && e.refKind === "this-prop") return isBool(e.type);
  return false;
}

/** A `queryable` scalar intrinsic over a primitive receiver
 *  (`this.name.trim()`, `this.path.startsWith(p)`).  The catalogue's
 *  `queryable` flag is the shared source of truth for the set every SQL
 *  renderer must cover, and `intrinsic-completeness.test.ts` gates that each
 *  renderer's table is exhaustive against it — so accepting the flag here
 *  cannot outrun any single adapter's table. */
function isQueryableIntrinsicCall(e: ExprIR): boolean {
  return (
    e.kind === "method-call" &&
    e.receiverType.kind === "primitive" &&
    intrinsicFor(e.receiverType.name, e.member)?.queryable === true
  );
}

const COMPARE_OPS: ReadonlySet<string> = new Set(["==", "!=", "<", "<=", ">", ">="]);

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
  const NOT_SUPPORTED =
    "MikroORM v1 lowers comparisons (col <op> value), bare boolean columns, unary '!', &&/||, queryable intrinsics, principal references and refColl membership";
  const COLUMN_ARG =
    "'this.<refColl>.contains(<column>)' — the join-table subquery binds its " +
    "target as a parameter, so a column argument has nowhere to bind";
  /** The membership arm, shared by both positions.  Membership itself LOWERS
   *  now; only a column ARGUMENT is out of reach.  Keeping this one function
   *  is what stops the two positions from drifting apart — the reason the
   *  value position existed in the first place. */
  const judgeMembership = (n: ExprIR): string | null =>
    isColumnArgMembership(n) ? COLUMN_ARG : null;
  // Walk a PREDICATE position.  Comparisons / `&&` / `||` / `!` / bare boolean
  // columns are valid here.
  const walkPredicate = (n: ExprIR): string | null => {
    const inner = n.kind === "paren" ? n.inner : n;
    if (inner.kind === "binary") {
      if (inner.op === "&&" || inner.op === "||") {
        return walkPredicate(inner.left) ?? walkPredicate(inner.right);
      }
      if (COMPARE_OPS.has(inner.op)) {
        // A comparison — its operands are values, not predicates; only the
        // adapter-wide rejected shapes can hide there.
        return walkValue(inner.left) ?? walkValue(inner.right);
      }
      return `arithmetic '${inner.op}' — ${NOT_SUPPORTED}`;
    }
    if (inner.kind === "unary" && inner.op === "!") return walkPredicate(inner.operand);
    // Authorization/tenancy sentinels — BOTH lower.  `deny` is the always-false
    // FilterQuery contradiction `$and: [{ id: null }, { id: { $ne: null } }]`
    // (the twin of Dapper's `1 = 0`); the `deep`/`global` SCOPE sentinel is the
    // descendant-or-self subtree predicate, rendered through a `raw()`
    // FilterQuery key because the operator vocabulary has no prefix test.
    if (inner.kind === "authz-filter") return null;
    if (isContainsMembership(inner)) return judgeMembership(inner);
    if (isBareBooleanColumn(inner)) return null;
    // A bool-returning queryable intrinsic standing alone in a PREDICATE
    // position (`filter this.path.startsWith(p)`).  The FilterQuery vocabulary
    // has no function-call position, so it lowers through a `raw()` fragment —
    // `starts_with(path, ?)`, the same Postgres call the drizzle twin makes.
    if (isQueryableIntrinsicCall(inner)) return null;
    return `${inner.kind} — ${NOT_SUPPORTED}`;
  };
  // Walk a comparison OPERAND (value) position — only the adapter-wide
  // rejected shapes matter here.
  const walkValue = (n: ExprIR): string | null => {
    const inner = n.kind === "paren" ? n.inner : n;
    if (isContainsMembership(inner)) return judgeMembership(inner);
    return null;
  };
  return walkPredicate(e);
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

// `policy {}` level rules and row rules → each aggregate's read and write scope
// (D-SHARING).
//
// Per aggregate and per access, visibility composes as
//
//     scope   = default ∨ rule₁ ∨ rule₂ ∨ …          (then `deny` ANDs on top)
//     default = ⋁ᵢ (whenᵢ ∧ levelᵢ) ∨ (¬(when₁ ∨ … ∨ whenₙ) ∧ local)
//
// with no level rule the default is `local`, and a level rule without `when`
// admits every caller, so its `¬…` arm vanishes.  `local` is the tenant floor
// the `tenantOwned` capability contributes; `own` is that floor AND
// `this.createdBy == currentUser.id`.  A level rule REPLACES the default for
// the callers its `when` admits (an OR of `local` and `own` would just be
// `local`), and callers no `when` admits keep `local`.
//
// READ: the composite replaces the `tenantOwned` entry of `contextFilters` (on
// the registry, its self-scope entry) in place, keeping its origin, so an
// `ignoring` clause drops the whole tenant scope exactly as it dropped the bare
// floor.
//
// WRITE: `writeScopeFilter` is the read composite AND the write composite, so a
// row a read rule opens is still out of write reach unless a write rule (or the
// write default) admits it — which is why an aggregate with any read row rule
// gets an explicit write scope even when it declares no write rule — and a row
// a write rule names is writable only while it is also readable.
//
// `when` conditions are principal terms (`currentUser.role == "clerk"`); the
// negated fallback arm is pushed down to its leaves (`==` ↔ `!=`, De Morgan),
// the shape every backend's principal-term renderer already decides per
// request.  An aggregate in an inheritance hierarchy is left untouched — its
// scope is hosted on the root, and phase ⑦ refuses the rule
// (`loom.policy-scope-inheritance-unsupported`).  Byte-neutral for every
// aggregate whose rules are only unconditional `allow [write] local`.

import type {
  AggregateIR,
  EnrichedBoundedContextIR,
  EnrichedSubdomainIR,
  ExprIR,
  PolicyLevel,
  SystemIR,
  TypeIR,
} from "../types/loom-ir.js";
import { TENANCY_SELF_SCOPE_ORIGIN, TENANT_OWNED_CAPABILITY } from "../util/tenant-stance.js";

/** The creator column `own` compares — `auditable`'s `createdBy`. */
export const OWN_CREATOR_FIELD = "createdBy";

const BOOL: TypeIR = { kind: "primitive", name: "bool" };
const USER_SHAPE: TypeIR = { kind: "entity", name: "__User__" };

interface LevelArm {
  level: PolicyLevel;
  when?: ExprIR;
}

export function applyPolicyScopes(m: EnrichedSubdomainIR, sys: SystemIR): EnrichedSubdomainIR {
  const any = m.contexts.some(
    (c) =>
      (c.policyRowRules ?? []).length > 0 ||
      [...(c.policyReadLevels ?? []), ...(c.policyWriteLevels ?? [])].some(
        (l) => l.level !== "local" || l.when !== undefined,
      ),
  );
  if (!any) return m;
  const userIdType = sys.user?.fields.find((f) => f.name === "id")?.type ?? {
    kind: "primitive",
    name: "string",
  };
  return { ...m, contexts: m.contexts.map((ctx) => composeContext(ctx, userIdType)) };
}

function composeContext(ctx: EnrichedBoundedContextIR, userIdType: TypeIR) {
  const rows = ctx.policyRowRules ?? [];
  const readLevels = ctx.policyReadLevels ?? [];
  const writeLevels = ctx.policyWriteLevels ?? [];
  return {
    ...ctx,
    aggregates: ctx.aggregates.map((agg) => {
      const readRows = rows.filter((r) => r.aggregate === agg.name && r.access === "read");
      const writeRows = rows.filter((r) => r.aggregate === agg.name && r.access === "write");
      const readArms = readLevels.filter((l) => l.aggregate === agg.name);
      const writeArms = writeLevels.filter((l) => l.aggregate === agg.name);
      const shaping = (arms: readonly LevelArm[]) =>
        arms.some((a) => a.level !== "local" || a.when !== undefined);
      const readShaped = readRows.length > 0 || shaping(readArms);
      const writeShaped = readShaped || writeRows.length > 0 || shaping(writeArms);
      if (!writeShaped) return agg;
      if (agg.isAbstract || agg.extendsAggregate) return agg;
      // Idempotent: every aggregate this pass composes leaves with a write
      // scope (and only `deny`, which runs after it, sets one otherwise), so a
      // second enrichment finds the composite in place and keeps it.
      if (agg.writeScopeFilter !== undefined) return agg;
      // The default is the tenant floor, or — on the registry — its derived
      // self-scope (the org rows a caller may read, e.g. to switch into one).
      const slot = [TENANT_OWNED_CAPABILITY, TENANCY_SELF_SCOPE_ORIGIN]
        .map((o) => agg.contextFilterOrigins.indexOf(o))
        .find((i) => i >= 0);
      if (slot === undefined) return agg;
      const floor = agg.contextFilters[slot]!;
      const own = ownTerm(agg, floor, userIdType);
      const compose = (arms: readonly LevelArm[], extra: readonly ExprIR[]): ExprIR =>
        anyOf([levelDefault(arms, floor, own), ...extra]);
      const read = compose(
        readArms,
        readRows.map((r) => r.where),
      );
      const write = compose(
        writeArms,
        writeRows.map((r) => r.where),
      );
      const filters = [...agg.contextFilters];
      filters[slot] = read;
      return {
        ...agg,
        contextFilters: filters,
        // A writable row is a readable one.  Most backends AND the read scope
        // into the command load anyway; the Ecto load swaps the read
        // restrictions for the write scope, so the write scope carries the
        // read composite itself whenever the two differ.
        writeScopeFilter: sameExpr(read, write) ? write : allOf([read, write]),
      };
    }),
  };
}

/** `⋁ᵢ (whenᵢ ∧ levelᵢ) ∨ (¬(when₁ ∨ …) ∧ local)`, simplified: no arms ⇒
 *  `local`; an unconditional arm drops the fallback. */
function levelDefault(arms: readonly LevelArm[], floor: ExprIR, own: ExprIR | undefined): ExprIR {
  if (arms.length === 0) return floor;
  const levelExpr = (l: PolicyLevel): ExprIR => (l === "own" ? (own ?? floor) : floor);
  const terms = arms.map((a) =>
    a.when ? allOf([paren(a.when), levelExpr(a.level)]) : levelExpr(a.level),
  );
  const conds = arms.map((a) => a.when);
  if (conds.every((c): c is ExprIR => c !== undefined)) {
    terms.push(allOf([...conds.map(negate), floor]));
  }
  return anyOf(terms);
}

/** The `own` predicate: the floor AND `this.createdBy == currentUser.id`, or
 *  undefined when the aggregate has no creator column (phase ⑦ refuses the
 *  rule — `loom.policy-own-no-creator`). */
function ownTerm(agg: AggregateIR, floor: ExprIR, userIdType: TypeIR): ExprIR | undefined {
  const creator = agg.fields.find((f) => f.name === OWN_CREATOR_FIELD);
  if (!creator) return undefined;
  const mine: ExprIR = {
    kind: "binary",
    op: "==",
    left: {
      kind: "member",
      receiver: { kind: "this" },
      member: OWN_CREATOR_FIELD,
      receiverType: { kind: "entity", name: agg.name },
      memberType: creator.type,
    },
    right: {
      kind: "member",
      receiver: { kind: "ref", name: "currentUser", refKind: "current-user", type: USER_SHAPE },
      member: "id",
      receiverType: USER_SHAPE,
      memberType: userIdType,
    },
    leftType: creator.type,
    rightType: userIdType,
    resultType: BOOL,
  };
  return allOf([floor, mine]);
}

function sameExpr(a: ExprIR, b: ExprIR): boolean {
  const strip = (_k: string, v: unknown) => (_k === "origin" ? undefined : v);
  return JSON.stringify(a, strip) === JSON.stringify(b, strip);
}

function paren(e: ExprIR): ExprIR {
  return e.kind === "paren" ? e : { kind: "paren", inner: e };
}

function join(op: "&&" | "||", terms: readonly ExprIR[]): ExprIR {
  return terms.map(paren).reduce((left, right) => ({
    kind: "binary",
    op,
    left,
    right,
    leftType: BOOL,
    rightType: BOOL,
    resultType: BOOL,
  }));
}

function allOf(terms: readonly ExprIR[]): ExprIR {
  return terms.length === 1 ? terms[0]! : join("&&", terms);
}

function anyOf(terms: readonly ExprIR[]): ExprIR {
  return terms.length === 1 ? terms[0]! : join("||", terms);
}

/** `¬e` pushed down to its leaves, so a negated caller condition stays a
 *  combination of principal terms: `==` ↔ `!=`, De Morgan over `&&` / `||`,
 *  `!!e` = `e`.  Any other shape (phase ⑦ refuses it in a `when`) keeps a
 *  plain `!`. */
function negate(e: ExprIR): ExprIR {
  if (e.kind === "paren") return negate(e.inner);
  if (e.kind === "unary" && e.op === "!") return e.operand;
  if (e.kind === "literal" && e.lit === "bool")
    return { ...e, value: e.value === "true" ? "false" : "true" };
  if (e.kind === "binary") {
    if (e.op === "==") return { ...e, op: "!=" };
    if (e.op === "!=") return { ...e, op: "==" };
    if (e.op === "&&") return anyOf([negate(e.left), negate(e.right)]);
    if (e.op === "||") return allOf([negate(e.left), negate(e.right)]);
  }
  return { kind: "unary", op: "!", operand: paren(e) };
}

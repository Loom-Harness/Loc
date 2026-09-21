import type { Aggregate, BoundedContext, Expression } from "../../language/generated/ast.js";
import { CAPABILITIES_TAG, FILTER_ORIGIN_TAG } from "../../util/capability-tag.js";
import type { ContextStampIR, ExprIR } from "../types/loom-ir.js";
import { criterionRefOf, lowerExpr } from "./lower-expr.js";
import type { Env } from "./lower-types.js";

/** A lowered capability-filter predicate plus, when the source expression is
 *  *exactly* one named `criterion` reference, that reference (mirrors
 *  `FindIR.criterionRef`) — so reifying backends can call the criterion's
 *  module-level predicate fn instead of re-inlining its body.  `capabilityOrigin`
 *  carries the name of the capability that contributed this filter (set by the
 *  expander on the spliced `FilterDecl`), or `undefined` for a hand-written /
 *  context-level bare filter — the provenance the `ignoring <Cap>` bypass
 *  surface resolves against. */
export interface FilterEntry {
  predicate: ExprIR;
  criterionRef?: { name: string; args: ExprIR[] };
  capabilityOrigin?: string;
}

/** A `FilterDecl` AST node carries its `expr` plus, when spliced from a
 *  capability, the transient origin tag. */
interface FilterDeclLike {
  expr: Expression;
  [FILTER_ORIGIN_TAG]?: string;
}

function filterEntry(m: FilterDeclLike, env: Env): FilterEntry {
  return {
    predicate: lowerExpr(m.expr, env),
    criterionRef: criterionRefOf(m.expr, env),
    capabilityOrigin: m[FILTER_ORIGIN_TAG],
  };
}

// ---------------------------------------------------------------------------
// Capability collection — reads structurally from `members[]` (no side
// tables).  Context-level capabilities, when present, are appended
// first.  Lowering is pure concatenation; the validator layer is
// responsible for any per-aggregate override semantics.
// ---------------------------------------------------------------------------

export interface ContextLevelCapabilities {
  /** Context-level filter DECLARATIONS — propagate to every aggregate in the
   *  context, and are lowered ONCE PER AGGREGATE (see below). */
  filterDecls: FilterDeclLike[];
  /** Context-level stamp DECLARATIONS — same, for stamps. */
  stampDecls: StampDeclLike[];
}

export const EMPTY_CONTEXT_CAPABILITIES: ContextLevelCapabilities = Object.freeze({
  filterDecls: [],
  stampDecls: [],
}) as ContextLevelCapabilities;

/** Scan a BoundedContext's members for FilterDecl/StampDecl nodes.  Context-
 * level filters/stamps apply to every aggregate inside (there is no
 * capability-scoped `for "<name>"` qualifier — a capability co-locates its own
 * filter/stamp).  Context-level `implements <Cap>` is applied by the expander
 * (it splices the capability into each aggregate), so there is nothing to
 * lower here.
 *
 * The AST nodes are carried UNLOWERED on purpose.  A context's env binds no
 * `this`, so lowering here typed `this.<field>` against nothing: `context Sales
 * { filter !this.isDeleted }` reached every aggregate with the ref's `type`
 * defaulted rather than resolved, on an `isDeleted: bool` column.  Nothing read
 * the type, so the emitters were right and the defect was invisible — until a
 * validator read it and reported "'this.isDeleted' (string) has no truth
 * value", naming a type the field never had.  `LoomModel` promises every ref
 * arrives resolved (`docs/technical.md`), so the lowering moves to
 * `collectFilters` / `collectStamps`, which run in the AGGREGATE's env. */
export function collectContextLevelCapabilities(ctx: BoundedContext): ContextLevelCapabilities {
  const filterDecls: FilterDeclLike[] = [];
  const stampDecls: StampDeclLike[] = [];
  for (const m of ctx.members ?? []) {
    if (m.$type === "FilterDecl") filterDecls.push(m as unknown as FilterDeclLike);
    else if (m.$type === "StampDecl") stampDecls.push(m as unknown as StampDeclLike);
  }
  return { filterDecls, stampDecls };
}

export function collectFilters(
  agg: Aggregate,
  env: Env,
  ctxCaps: ContextLevelCapabilities,
): FilterEntry[] {
  const own = (agg.members ?? [])
    .filter((m) => m.$type === "FilterDecl")
    .map((m) => filterEntry(m as unknown as FilterDeclLike, env));
  // The context-level decls lower HERE, in this aggregate's env, so their
  // `this.<field>` refs resolve against the columns they will actually run
  // against — see `collectContextLevelCapabilities`.
  const inherited = ctxCaps.filterDecls.map((m) => filterEntry(m, env));
  return [...inherited, ...own];
}

export function collectStamps(
  agg: Aggregate,
  env: Env,
  ctxCaps: ContextLevelCapabilities,
): ContextStampIR[] {
  const own = (agg.members ?? [])
    .filter((m) => m.$type === "StampDecl")
    .map((m) => lowerStampDecl(m as unknown as StampDeclLike, env));
  const inherited = ctxCaps.stampDecls.map((m) => lowerStampDecl(m, env));
  return [...inherited, ...own];
}

/** The typed capabilities an aggregate implements — read from the transient
 * annotation the expander records for every `with <Cap>` / `implements <Cap>`
 * application (aggregate- and context-scope).  Deduped + sorted for a
 * deterministic order.  Capability application has already spliced the
 * fields/filter/stamp; this is the surviving identity record. */
export function collectCapabilities(agg: Aggregate): string[] {
  const names = (agg as { [CAPABILITIES_TAG]?: string[] })[CAPABILITIES_TAG] ?? [];
  return [...new Set(names)].sort();
}

/** Resolve the `ignoring`-clause grammar fields (`bypassAll` flag, `bypass`
 *  bare-ID list) on a read node (FindDecl / View / PostfixChain) into the
 *  IR's `{ bypassAll?, bypassCaps? }` shape (named-filter-bypass.md §11).
 *  Returns an empty object when neither is set, so it spreads cleanly into a
 *  read IR without polluting it.  Capability names stay as authored strings —
 *  resolution against the aggregate's implemented capabilities / contributed
 *  filters happens in the IR validator, not here (the IR carries the resolved
 *  *names*; the EF-filter identity is derived per backend). */
export function resolveBypass(node: { bypassAll?: boolean; bypass?: string[] }): {
  bypassAll?: boolean;
  bypassCaps?: string[];
} {
  if (node.bypassAll) return { bypassAll: true };
  const caps = node.bypass ?? [];
  return caps.length > 0 ? { bypassCaps: [...caps] } : {};
}

/** Shape we rely on from a `StampDecl` AST node.  Local alias so the
 * import surface stays narrow. */
interface StampDeclLike {
  event: "onCreate" | "onUpdate";
  assignments: Array<{ target: { head: string }; value?: Expression }>;
}

function lowerStampDecl(s: StampDeclLike, env: Env): ContextStampIR {
  // The grammar's `stamp <event> { <assign>* }` produces a sequence
  // of `AssignOrCallStmt` nodes whose LValue is a single-segment
  // path (the target field name) and whose value is the assigned
  // expression.  Both sides are lowered through the existing
  // operation-body pipeline.  Stamps with chained / multi-segment
  // targets (`this.foo.bar`) are flagged by the validator.
  return {
    event: s.event === "onCreate" ? "create" : "update",
    assignments: s.assignments.map((a) => ({
      field: a.target.head,
      value: a.value ? lowerExpr(a.value, env) : (lowerExpr(undefined, env) as never),
    })),
  };
}

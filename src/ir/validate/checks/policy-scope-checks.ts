// Row rules, `when` and `own` (D-SHARING) — the checks that keep every rule
// compilable into the one read / write scope predicate enrichment composes
// (`src/ir/enrich/policy-scopes.ts`).
//
//   loom.policy-unknown-aggregate         a row rule's target is not an aggregate
//                                         of the context (`#read` / `#write`)
//   loom.policy-target-not-tenant-owned   …or is neither `with tenantOwned` nor
//                                         the tenant registry: an unscoped
//                                         aggregate's default is already every
//                                         row, so a rule would add nothing
//   loom.policy-row-not-queryable         the `where` is not a query predicate;
//                                         `#no-row` when it never reads the row
//   loom.policy-when-not-caller-only      a `when` reads anything but the caller
//   loom.policy-own-no-creator            `own` on an aggregate with no `createdBy`
//   loom.policy-scope-inheritance-unsupported
//                                         a composing rule on a hierarchy member
//   loom.policy-row-cycle                 aggregates whose read scopes reach each
//                                         other through `exists`
//
// Policy-function call cycles are refused at the AST (`loom.policy-fn-cycle`).

import { diagMessage } from "../../../diagnostics/messages.js";
import { OWN_CREATOR_FIELD } from "../../enrich/policy-scopes.js";
import type {
  AggregateIR,
  BoundedContextIR,
  ExprIR,
  PolicyReadLevelIR,
  SystemIR,
} from "../../types/loom-ir.js";
import { principalTerm } from "../../util/principal-term.js";
import { hasTenantOwned, TENANCY_SELF_SCOPE_ORIGIN } from "../../util/tenant-stance.js";
import { walkExprDeep } from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";
import { firstNonQueryablePredicate, firstUnknownColumnRef } from "./shared.js";

export function validatePolicyScopes(sys: SystemIR, diags: LoomDiagnostic[]): void {
  for (const mod of sys.subdomains) {
    for (const ctx of mod.contexts) {
      checkRowRules(ctx, diags);
      checkLevels(ctx, diags);
      checkScopeCycles(ctx, diags);
    }
  }
}

function push(diags: LoomDiagnostic[], ctx: BoundedContextIR, code: string, message: string): void {
  diags.push({
    severity: "error",
    code,
    message,
    source: `${ctx.name}/policy`,
    origin: ctx.origin,
  });
}

function inHierarchy(agg: AggregateIR): boolean {
  return agg.isAbstract === true || agg.extendsAggregate !== undefined;
}

function checkRowRules(ctx: BoundedContextIR, diags: LoomDiagnostic[]): void {
  for (const rule of ctx.policyRowRules ?? []) {
    const p = { name: ctx.name, source: rule.source, aggregate: rule.aggregate };
    const agg = ctx.aggregates.find((a) => a.name === rule.aggregate);
    if (!agg) {
      push(
        diags,
        ctx,
        "loom.policy-unknown-aggregate",
        rule.access === "write"
          ? diagMessage("loom.policy-unknown-aggregate#write", p)
          : diagMessage("loom.policy-unknown-aggregate#read", p),
      );
      continue;
    }
    if (!hasTenantOwned(agg) && !agg.contextFilterOrigins.includes(TENANCY_SELF_SCOPE_ORIGIN)) {
      push(
        diags,
        ctx,
        "loom.policy-target-not-tenant-owned",
        diagMessage("loom.policy-target-not-tenant-owned#row", p),
      );
      continue;
    }
    if (inHierarchy(agg)) {
      push(
        diags,
        ctx,
        "loom.policy-scope-inheritance-unsupported",
        diagMessage("loom.policy-scope-inheritance-unsupported", p),
      );
      continue;
    }
    const why =
      firstNonQueryablePredicate(rule.where, { admitPrincipalTerms: true }) ??
      unresolvedRef(rule.where) ??
      firstUnknownColumnRef(rule.where, agg, ctx, { allowSelfId: true })?.text;
    if (why) {
      push(
        diags,
        ctx,
        "loom.policy-row-not-queryable",
        diagMessage("loom.policy-row-not-queryable", {
          source: rule.source,
          why: why.startsWith("this.") ? `'${why}' is not a field of '${agg.name}'` : why,
        }),
      );
      continue;
    }
    if (!readsRow(rule.where)) {
      push(
        diags,
        ctx,
        "loom.policy-row-not-queryable",
        diagMessage("loom.policy-row-not-queryable#no-row", {
          source: rule.source,
        }),
      );
    }
  }
}

function checkLevels(ctx: BoundedContextIR, diags: LoomDiagnostic[]): void {
  const levels: PolicyReadLevelIR[] = [
    ...(ctx.policyReadLevels ?? []),
    ...(ctx.policyWriteLevels ?? []),
  ];
  for (const rule of levels) {
    const agg = ctx.aggregates.find((a) => a.name === rule.aggregate);
    // Unknown / not tenant-owned targets are reported by the level checks.
    if (!agg || !hasTenantOwned(agg)) continue;
    const p = { source: rule.source, aggregate: rule.aggregate };
    if ((rule.level !== "local" || rule.when) && inHierarchy(agg)) {
      push(
        diags,
        ctx,
        "loom.policy-scope-inheritance-unsupported",
        diagMessage("loom.policy-scope-inheritance-unsupported", p),
      );
      continue;
    }
    if (rule.when) {
      const why = notCallerOnly(rule.when);
      if (why)
        push(
          diags,
          ctx,
          "loom.policy-when-not-caller-only",
          diagMessage("loom.policy-when-not-caller-only", {
            source: rule.source,
            why,
          }),
        );
    }
    if (rule.level === "own" && !agg.fields.some((f) => f.name === OWN_CREATOR_FIELD)) {
      push(diags, ctx, "loom.policy-own-no-creator", diagMessage("loom.policy-own-no-creator", p));
    }
  }
}

/** Why `e` is not a caller-only condition, or null when it is one: principal
 *  terms (`currentUser.role == "clerk"`) and boolean literals combined with
 *  `&&` / `||` / `!` / parentheses. */
function notCallerOnly(e: ExprIR): string | null {
  if (e.kind === "paren") return notCallerOnly(e.inner);
  if (e.kind === "unary" && e.op === "!") return notCallerOnly(e.operand);
  if (e.kind === "literal" && e.lit === "bool") return null;
  if (e.kind === "binary" && (e.op === "&&" || e.op === "||"))
    return notCallerOnly(e.left) ?? notCallerOnly(e.right);
  if (principalTerm(e)) return null;
  let rowRead = false;
  walkExprDeep(e, (x) => {
    if (x.kind === "this" || x.kind === "exists" || (x.kind === "ref" && x.refKind === "this-prop"))
      rowRead = true;
  });
  return rowRead ? "it reads the row" : (unresolvedRef(e) ?? "it is not a claim comparison");
}

/** A reference lowering could not resolve — a field of a row with no row in
 *  scope, or a policy function reached through a cycle. */
function unresolvedRef(e: ExprIR): string | null {
  let name: string | null = null;
  walkExprDeep(e, (x) => {
    if (name === null && x.kind === "ref" && x.refKind === "unknown") name = x.name;
  });
  return name === null ? null : `'${name}' does not resolve here`;
}

/** True when the predicate reads the filtered row (a column of `this`). */
function readsRow(e: ExprIR): boolean {
  let hit = false;
  walkExprDeep(e, (x) => {
    if (x.kind === "this" || (x.kind === "ref" && x.refKind === "this-prop")) hit = true;
  });
  return hit;
}

/** `exists` edges between the context's read scopes: each subquery carries the
 *  quantified aggregate's own scope, so a cycle never closes when rendered. */
function checkScopeCycles(ctx: BoundedContextIR, diags: LoomDiagnostic[]): void {
  const edges = new Map<string, Set<string>>();
  for (const agg of ctx.aggregates) {
    const out = new Set<string>();
    for (const f of [
      ...(agg.contextFilters ?? []),
      ...(agg.writeScopeFilter ? [agg.writeScopeFilter] : []),
    ]) {
      walkExprDeep(f, (x) => {
        if (x.kind === "exists") out.add(x.aggregate);
      });
    }
    edges.set(agg.name, out);
  }
  const reported = new Set<string>();
  for (const start of edges.keys()) {
    const path = findCycle(start, edges);
    if (!path) continue;
    const key = [...path].sort().join(",");
    if (reported.has(key)) continue;
    reported.add(key);
    push(
      diags,
      ctx,
      "loom.policy-row-cycle",
      diagMessage("loom.policy-row-cycle", {
        cycle: path.map((n) => `'${n}'`).join(" → "),
      }),
    );
  }
}

function findCycle(start: string, edges: Map<string, Set<string>>): string[] | null {
  const stack: { node: string; path: string[] }[] = [{ node: start, path: [start] }];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const { node, path } = stack.pop()!;
    for (const next of edges.get(node) ?? []) {
      if (next === start) return [...path, start];
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push({ node: next, path: [...path, next] });
    }
  }
  return null;
}

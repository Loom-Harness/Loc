// `policy {}` block rules → the context's policy IR (tenancy.md, D-SHARING).
//
// A pure structural projection: composing the rules into each aggregate's read
// and write scope is enrichment (`policy-scopes.ts`), and every target /
// queryability / caller-only check is phase ⑦.
//
//   read X requires G                  → PolicyReadGateIR   (bare context env)
//   deny [write] on X                  → PolicyDenyIR
//   allow [write] <level> on X [when C] → PolicyRead/WriteLevelIR (C in the bare
//                                         context env: no row is in scope, so a
//                                         row field fails to resolve and phase ⑦
//                                         reports it)
//   allow [write] on X as x where P    → PolicyRowRuleIR    (P in X's scope, `x`
//                                         resolved to the filtered row `this`)

import type { Aggregate, BoundedContext, PolicyReadRule } from "../../language/generated/ast.js";
import { isAggregate, isPolicyDecl } from "../../language/generated/ast.js";
import type {
  ExprIR,
  PolicyDenyIR,
  PolicyLevel,
  PolicyReadGateIR,
  PolicyReadLevelIR,
  PolicyRowRuleIR,
  PolicyWriteLevelIR,
} from "../types/loom-ir.js";
import { mapExprChildren } from "../util/walk.js";
import { lowerExpr } from "./lower-expr.js";
import { cstText, type Env, inAggregate, withLocal } from "./lower-types.js";
import { originFor } from "./origin.js";

export interface LoweredPolicy {
  policyReadLevels: PolicyReadLevelIR[];
  policyWriteLevels: PolicyWriteLevelIR[];
  policyRowRules: PolicyRowRuleIR[];
  policyDenies: PolicyDenyIR[];
  policyReadGates: PolicyReadGateIR[];
}

export function lowerPolicyRules(ctx: BoundedContext, env: Env): LoweredPolicy {
  const out: LoweredPolicy = {
    policyReadLevels: [],
    policyWriteLevels: [],
    policyRowRules: [],
    policyDenies: [],
    policyReadGates: [],
  };
  for (const m of ctx.members) {
    if (!isPolicyDecl(m)) continue;
    for (const r of m.rules) lowerRule(r, ctx, env, out);
  }
  return out;
}

function lowerRule(r: PolicyReadRule, ctx: BoundedContext, env: Env, out: LoweredPolicy): void {
  // `read X requires G` — who may read X.  The gate runs before any row is
  // loaded, so it lowers in the bare context env.
  if (r.effect === "read") {
    if (r.gate) {
      out.policyReadGates.push({
        aggregate: r.target,
        gate: lowerExpr(r.gate, env),
        source: `read ${r.target} requires ${cstText(r.gate)}`,
        origin: originFor(r),
      });
    }
    return;
  }
  const verb = r.verb ? `${r.verb} ` : "";
  // `deny [write] on X` — the deny-wins carve-out, all-or-nothing at the
  // aggregate.  Enrichment applies it after every allow.
  if (r.effect === "deny") {
    out.policyDenies.push({
      aggregate: r.target,
      access: r.verb === "write" ? "write" : "read",
      source: `deny ${verb}on ${r.target}`,
    });
    return;
  }
  // Any other head word is `loom.policy-unknown-rule` (AST phase).
  if (r.effect !== "allow") return;
  const access = r.verb === "write" ? "write" : "read";
  if (r.row && r.binding) {
    const agg = ctx.members.find((m): m is Aggregate => isAggregate(m) && m.name === r.target);
    // An unknown target lowers in the bare env; phase ⑦ reports the target.
    const aggEnv = agg ? inAggregate(env, agg) : env;
    const rowEnv = withLocal(aggEnv, r.binding, "row", {
      kind: "entity",
      name: r.target,
      declKind: "aggregate",
    });
    out.policyRowRules.push({
      aggregate: r.target,
      access,
      binding: r.binding,
      where: rowAsThis(lowerExpr(r.row, rowEnv), r.binding),
      source: `allow ${verb}on ${r.target} as ${r.binding} where ${cstText(r.row)}`,
    });
    return;
  }
  // A removed level (`deep` / `global`) is `loom.policy-level-removed` (AST).
  if (r.level !== "local" && r.level !== "own") return;
  const level: PolicyLevel = r.level;
  const when = r.when ? lowerExpr(r.when, env) : undefined;
  const source = `allow ${verb}${level} on ${r.target}${r.when ? ` when ${cstText(r.when)}` : ""}`;
  const rule = { aggregate: r.target, level, ...(when ? { when } : {}), source };
  if (access === "write") out.policyWriteLevels.push(rule);
  else out.policyReadLevels.push(rule);
}

/** The rule's `as <row>` binding IS the filtered row: rewrite every reference
 *  to it into `this`, so the predicate is an ordinary row filter every
 *  backend's filter renderer already compiles.  An inner `exists … as <same
 *  name>` rebinds the name, so the rewrite stops at it. */
function rowAsThis(e: ExprIR, binding: string): ExprIR {
  if (e.kind === "ref" && e.refKind === "row" && e.name === binding) return { kind: "this" };
  if (e.kind === "exists" && e.binding === binding) return e;
  return mapExprChildren(e, (c) => rowAsThis(c, binding));
}

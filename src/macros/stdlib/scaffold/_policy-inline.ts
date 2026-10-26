// Inline named `policy` references in a gate the scaffold COPIES onto a page.
//
// A workflow header (`workflow w requires CanManageStaff() { … }`) or a
// `policy { read T requires IsStaff() }` gate is propagated onto the scaffolded
// instance / List pages so the nav entry matches the route it reads.  On the
// server the reference is inlined at the gate (`inlinePolicyFn`,
// `src/ir/lower/lower-expr.ts`) — but a page lives in a `ui`, outside every
// context, so the page-gate lowering has no context to find the policy in and
// the copied `CanManageStaff()` stays a free `call`.  The browser cannot
// evaluate a call, so `loom.page-gate-not-client-evaluable` refused the copy
// even when the policy's body (`currentUser.permissions.contains(…)`) is
// exactly the client-evaluable subset (claims eval D9).
//
// The macro knows the context the gate came from, so it inlines here, at copy
// time — "macros emit final AST": `unfold` ejects the real predicate, not a
// name the page cannot resolve.  Semantics match `inlinePolicyFn`: the body
// with each parameter replaced by its call argument, sibling policy
// references inlined in turn, a cycle left as the bare reference (reported by
// `loom.policy-fn-cycle` on the declaration).  Each inlined body is wrapped in
// parentheses so it keeps its precedence in the host expression.  A body that
// is genuinely not client-evaluable stays so after inlining, and the page-gate
// diagnostic still refuses it.

import {
  type BoundedContext,
  type Expression,
  isPolicyDecl,
  type PolicyDecl,
} from "../../../language/generated/ast.js";
import { cloneExpr } from "../../api/index.js";

type Node = Record<string, unknown> & { $type: string };

function isNode(v: unknown): v is Node {
  return !!v && typeof v === "object" && typeof (v as Node).$type === "string";
}

/** The context an AST node sits in, if any. */
function enclosingContext(node: unknown): BoundedContext | undefined {
  let cur = node as { $type?: string; $container?: unknown } | undefined;
  while (cur) {
    if (cur.$type === "BoundedContext") return cur as unknown as BoundedContext;
    cur = cur.$container as typeof cur;
  }
  return undefined;
}

/** The function-form policies declared in `ctx`, by name. */
function policyFunctions(ctx: BoundedContext): Map<string, PolicyDecl> {
  const out = new Map<string, PolicyDecl>();
  for (const m of ctx.members) {
    if (m.$type !== "PolicyDecl") continue;
    const p = m as PolicyDecl;
    if (p.name && p.returnType !== undefined && p.body) out.set(p.name, p);
  }
  return out;
}

/**
 * A copy of `gate` (written inside `owner`'s context) with every named-policy
 * reference replaced by its inlined body.  A plain clone when the context
 * declares no policy functions or the gate references none.
 */
export function cloneGateInliningPolicies(gate: Expression, owner: unknown): Expression {
  const ctx = enclosingContext(owner);
  const policies = ctx ? policyFunctions(ctx) : new Map<string, PolicyDecl>();
  if (policies.size === 0) return cloneExpr(gate);
  const rewritten = rewrite(gate, policies, new Map(), []) as Expression;
  // `cloneExpr` rebuilds the Langium bookkeeping ($container / origin) for
  // the plain-object tree the rewrite produced.
  return cloneExpr(rewritten);
}

/** A structural copy of `v` (bookkeeping dropped) with policy references
 *  inlined and `subst` parameter names replaced. */
function rewrite(
  v: unknown,
  policies: Map<string, PolicyDecl>,
  subst: Map<string, unknown>,
  stack: string[],
): unknown {
  if (Array.isArray(v)) return v.map((x) => rewrite(x, policies, subst, stack));
  if (!v || typeof v !== "object") return v;
  const o = v as Record<string, unknown>;
  if (typeof o.$refText === "string") return { $refText: o.$refText, ref: undefined };
  if (!isNode(o)) return { ...o };

  // A parameter of the policy being inlined → its (already rewritten) argument.
  if (o.$type === "NameRef" && typeof o.name === "string" && subst.has(o.name)) {
    return subst.get(o.name);
  }
  // `P(args)` — a policy call at the head of a one-suffix chain.
  if (o.$type === "PostfixChain") {
    const head = o.head as Node | undefined;
    const suffixes = (o.suffixes as Node[] | undefined) ?? [];
    const call = suffixes[0];
    if (
      head?.$type === "NameRef" &&
      typeof head.name === "string" &&
      !subst.has(head.name) &&
      suffixes.length === 1 &&
      call?.$type === "CallSuffix" &&
      !o.bypassAll &&
      !(o.bypass as unknown[] | undefined)?.length
    ) {
      const inlined = inlineCall(
        policies.get(head.name),
        (call.args as Node[] | undefined) ?? [],
        policies,
        subst,
        stack,
      );
      if (inlined) return inlined;
    }
  }
  // A bare reference to a parameterless policy (`IsManager`).
  if (o.$type === "NameRef" && typeof o.name === "string") {
    const p = policies.get(o.name);
    if (p && (p.params?.length ?? 0) === 0) {
      const inlined = inlineCall(p, [], policies, subst, stack);
      if (inlined) return inlined;
    }
  }
  // A lambda parameter shadows a substituted name inside its body.
  let inner = subst;
  if (o.$type === "Lambda" && typeof o.param === "string" && subst.has(o.param)) {
    inner = new Map(subst);
    inner.delete(o.param);
  }
  const out: Record<string, unknown> = { $type: o.$type };
  for (const [k, val] of Object.entries(o)) {
    if (k.startsWith("$")) continue;
    out[k] = rewrite(val, policies, inner, stack);
  }
  return out;
}

/** `( <body with params substituted> )`, or `undefined` to keep the call as
 *  written (unknown name, arity mismatch, a cycle). */
function inlineCall(
  policy: PolicyDecl | undefined,
  args: Node[],
  policies: Map<string, PolicyDecl>,
  subst: Map<string, unknown>,
  stack: string[],
): Node | undefined {
  const name = policy?.name;
  if (!policy?.body || !name) return undefined;
  if (stack.includes(name)) return undefined;
  const params = policy.params ?? [];
  if (args.length !== params.length) return undefined;
  const bound = new Map<string, unknown>();
  const named = args.some((a) => typeof a.name === "string" && a.name.length > 0);
  for (let i = 0; i < params.length; i++) {
    const pname = String(params[i]!.name);
    const arg = named ? args.find((a) => a.name === pname) : args[i];
    if (!arg) return undefined;
    // Arguments are written in the CALLER's scope: rewrite them there.
    bound.set(pname, rewrite(arg.value, policies, subst, stack));
  }
  return {
    $type: "ParenExpr",
    inner: rewrite(policy.body, policies, bound, [...stack, name]),
  };
}

/** The gate of the context's `policy { read <aggName> requires … }` rule — the
 *  one place an author says who may read the aggregate.  First rule wins, as in
 *  enrichment (a second is `loom.policy-duplicate-target`). */
export function policyReadGate(ctx: BoundedContext, aggName: string): Expression | undefined {
  for (const m of ctx.members) {
    if (!isPolicyDecl(m)) continue;
    for (const r of m.rules) {
      if (r.effect === "read" && r.target === aggName && r.gate) return r.gate;
    }
  }
  return undefined;
}

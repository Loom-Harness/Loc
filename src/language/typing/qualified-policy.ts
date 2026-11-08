// A function-form `policy` reached from a bounded context other than the one
// declaring it — bare (`P(args)`) or qualified with its context
// (`Ctx.P(args)`).  Policies are context-local (ruling D9, docs/decisions.md),
// so neither spelling resolves.  The qualified one is the shape an author
// reaches for first when trying to share a policy, so the typing pass and the
// `loom.policy-out-of-scope` validator must agree on exactly which chains it
// covers.  Typing such a call `bool` keeps the gate's own `'requires' must be
// of type 'bool'` error out of the way, leaving the named diagnostic as the
// only one.
//
// The search covers the whole compilation unit (the `DeclIndex`, which spans
// the import closure), not only the calling document: context names are
// unique across the workspace, so a policy declared in another file is always
// in another context, and a scan of one document would let that call through
// to lowering, which finds no policy to inline and emits a call to a function
// no backend defines.

import { type AstNode, AstUtils } from "langium";
import { type BoundedContext, isBoundedContext, type PolicyDecl } from "../generated/ast.js";
import type { DeclIndex } from "./decl-index.js";

export interface OutOfScopePolicy {
  decl: PolicyDecl;
  declaredIn: BoundedContext;
  usedIn: BoundedContext;
}

/** The first function-form policy `name` the unit declares in a context other
 *  than `usedIn` (and, when `qualifier` is given, in the context of that
 *  name).  `undefined` when there is none. */
export function policyInOtherContext(
  index: DeclIndex,
  name: string,
  usedIn: BoundedContext,
  qualifier?: string,
): OutOfScopePolicy | undefined {
  for (const decl of index.findAll("policy", name)) {
    if (decl.returnType === undefined) continue;
    const declaredIn = AstUtils.getContainerOfType(decl, isBoundedContext);
    if (!declaredIn || declaredIn === usedIn) continue;
    if (qualifier !== undefined && declaredIn.name !== qualifier) continue;
    return { decl, declaredIn, usedIn };
  }
  return undefined;
}

/** The policy a qualified call `qualifier.name(args)` names when `qualifier` is
 *  a bounded context OTHER than the one enclosing `at` and that context
 *  declares a function-form policy `name` — in any document of the unit. */
export function qualifiedOutOfScopePolicyCall(
  index: DeclIndex,
  qualifier: string,
  name: string,
  at: AstNode,
): OutOfScopePolicy | undefined {
  const usedIn = AstUtils.getContainerOfType(at, isBoundedContext);
  if (!usedIn || usedIn.name === qualifier) return undefined;
  return policyInOtherContext(index, name, usedIn, qualifier);
}

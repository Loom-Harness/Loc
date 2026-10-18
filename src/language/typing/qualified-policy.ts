// `Ctx.Policy(args)` — a function-form `policy` named through ANOTHER bounded
// context.  Policies are context-local (ruling D9, docs/decisions.md), so this
// spelling never resolves; it is the shape an author reaches for first when
// trying to share one, so the typing pass and the `loom.policy-out-of-scope`
// validator must agree on exactly which chains it covers.  Typing such a call
// `bool` keeps the gate's own `'requires' must be of type 'bool'` error out of
// the way, leaving the named diagnostic as the only one.

import { type AstNode, AstUtils } from "langium";
import {
  type BoundedContext,
  isBoundedContext,
  isPolicyDecl,
  type PolicyDecl,
} from "../generated/ast.js";

/** The policy a qualified call `qualifier.name(args)` names when `qualifier` is
 *  a bounded context OTHER than the one enclosing `at` and that context
 *  declares a function-form policy `name`.  Same-document only, like the bare
 *  form: a context declared in another file is not visible from here. */
export function qualifiedOutOfScopePolicyCall(
  qualifier: string,
  name: string,
  at: AstNode,
): { decl: PolicyDecl; declaredIn: BoundedContext; usedIn: BoundedContext } | undefined {
  const usedIn = AstUtils.getContainerOfType(at, isBoundedContext);
  if (!usedIn || usedIn.name === qualifier) return undefined;
  for (const node of AstUtils.streamAllContents(AstUtils.findRootNode(at))) {
    if (!isBoundedContext(node) || node.name !== qualifier) continue;
    for (const m of node.members) {
      if (isPolicyDecl(m) && m.returnType !== undefined && m.name === name) {
        return { decl: m, declaredIn: node, usedIn };
      }
    }
  }
  return undefined;
}

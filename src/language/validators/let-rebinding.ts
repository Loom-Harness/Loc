// A `let` binds a name once per body: it may not rebind an earlier `let` of its
// block or an enclosing one, nor a parameter of the enclosing callable.  Java
// and C# refuse a local that redeclares or shadows another local or parameter
// (`variable x is already defined`, CS0128 / CS0136) and TypeScript a second
// `const x` in one block (TS2451), so a rebinding emits code its own target
// rejects.  A `let` named like a MEMBER is fine: the member stays reachable
// through `this`.
//
// The scope walk is lexical over the AST: from the `let`, every earlier
// sibling statement of each enclosing statement list, up to and including the
// parameters of the first enclosing node that declares any.

import { type AstNode, AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import { isLetStmt, isParameter, type LetStmt, type Model } from "../generated/ast.js";

export function checkLetRebindings(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    if (!isLetStmt(node)) continue;
    const prior = priorBinding(node);
    if (!prior) continue;
    accept(
      "error",
      diagMessage("loom.duplicate-let", {
        name: node.name,
        what: isLetStmt(prior) ? "an earlier `let`" : "a parameter",
      }),
      { node, property: "name", code: "loom.duplicate-let" },
    );
  }
}

/** The `let` or parameter the binding `stmt` would rebind, if any. */
function priorBinding(stmt: LetStmt): AstNode | undefined {
  for (let node: AstNode = stmt; node.$container; node = node.$container) {
    const owner = node.$container;
    const list: unknown = node.$containerProperty
      ? Reflect.get(owner, node.$containerProperty)
      : undefined;
    if (Array.isArray(list) && node.$containerIndex !== undefined) {
      for (const sib of list.slice(0, node.$containerIndex))
        if (isLetStmt(sib) && sib.name === stmt.name) return sib;
    }
    const params: unknown = Reflect.get(owner, "params");
    if (Array.isArray(params) && params.some(isParameter)) {
      return params.find((p) => isParameter(p) && p.name === stmt.name);
    }
  }
  return undefined;
}

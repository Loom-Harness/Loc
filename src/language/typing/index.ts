// The single typing pass (M-T5.44) — public surface.
//
// `typingSession(models)` elaborates a whole compilation unit once and
// answers `typeAt(node)` for every expression in it. Design:
// docs/new-plan/missions/M-T5.44-single-typing-pass-design.md.

import type { AstNode } from "langium";
import type { BinaryChain, Model, TypeRef } from "../generated/ast.js";
import { DeclIndex } from "./decl-index.js";
import { Elaborator, type Fold, type Scope } from "./elaborate.js";
import type { Ty } from "./ty.js";

export { DeclIndex } from "./decl-index.js";
export type { Fold } from "./elaborate.js";
export type { RecordShape, Ty, UnknownCause } from "./ty.js";
export { toTypeIR, tyKey } from "./ty.js";

export interface TypingSession {
  readonly index: DeclIndex;
  /** The synthesized type of an expression (or, for a postfix suffix, the
   *  receiver type after it); undefined for a node the pass never reached. */
  typeAt(node: AstNode): Ty | undefined;
  /** The node's OWN type, before any context coerced it (`typeAt` is the
   *  elaborated one: a promoted literal, a retargeted enum value). */
  synthAt(node: AstNode): Ty | undefined;
  /** A type reference, resolved (unlinked macro-built refs by name). */
  resolveType(t: TypeRef): Ty;
  /** A binary chain's elaborated fold steps. */
  foldsAt(chain: BinaryChain): readonly Fold[] | undefined;
  /** The scope in force at a statement / expression root. */
  scopeAt(node: AstNode): Scope | undefined;
  /** The binding `name` denotes at `node` (the nearest scoped ancestor's
   *  scope): a lexical binding, else a member of the enclosing record. */
  bindingAt(node: AstNode, name: string): { ty: Ty; origin: AstNode } | undefined;
  /** An assignment / call target's receiver chain: `this`'s type, then the
   *  type after each data segment. */
  lvalueStepsAt(lv: AstNode): readonly Ty[] | undefined;
}

export function typingSession(models: readonly Model[]): TypingSession {
  const index = new DeclIndex(models);
  const elab = new Elaborator(index);
  elab.run();
  return {
    index,
    typeAt: (node) => elab.elaborated.get(node) ?? elab.types.get(node),
    synthAt: (node) => elab.types.get(node),
    foldsAt: (chain) => elab.folds.get(chain),
    resolveType: (t) => elab.resolveType(t, undefined),
    scopeAt: (node) => elab.scopes.get(node),
    lvalueStepsAt: (lv) => elab.lvalueChains.get(lv),
    bindingAt: (node, name) => {
      for (let n: AstNode | undefined = node; n; n = n.$container) {
        const scope = elab.scopes.get(n);
        if (scope) return elab.envBinding(name, scope);
      }
      return undefined;
    },
  };
}

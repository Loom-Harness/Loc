// The single typing pass (M-T5.44) — public surface.
//
// `typingSession(models)` elaborates a whole compilation unit once and
// answers `typeAt(node)` for every expression in it. Design:
// docs/new-plan/missions/M-T5.44-single-typing-pass-design.md.

import type { AstNode } from "langium";
import type { Model } from "../generated/ast.js";
import { DeclIndex } from "./decl-index.js";
import { Elaborator, type Scope } from "./elaborate.js";
import type { Ty } from "./ty.js";

export { DeclIndex } from "./decl-index.js";
export type { RecordShape, Ty, UnknownCause } from "./ty.js";
export { toTypeIR, tyKey } from "./ty.js";

export interface TypingSession {
  readonly index: DeclIndex;
  /** The synthesized type of an expression (or, for a postfix suffix, the
   *  receiver type after it); undefined for a node the pass never reached. */
  typeAt(node: AstNode): Ty | undefined;
  /** The scope in force at a statement / expression root. */
  scopeAt(node: AstNode): Scope | undefined;
}

export function typingSession(models: readonly Model[]): TypingSession {
  const index = new DeclIndex(models);
  const elab = new Elaborator(index);
  elab.run();
  return {
    index,
    typeAt: (node) => elab.types.get(node),
    scopeAt: (node) => elab.scopes.get(node),
  };
}

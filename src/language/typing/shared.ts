// The one place a consumer gets the typing session for a node (M-T5.44 §D8).
//
// Sessions are a MEMO of a pure function of the linked AST: keyed by the AST
// root, so a reparsed document (a fresh root object) can never read a stale
// session; and dropped wholesale whenever the workspace changes
// (`invalidateTyping`, wired to `DocumentBuilder.onUpdate` in `ddd-module.ts`),
// because an edit to one document can change a by-name lookup in another.
// Nothing is stamped onto AST or IR nodes.

import { type AstNode, AstUtils } from "langium";
import type { Model } from "../generated/ast.js";
import { type TypingSession, typingSession } from "./index.js";

let sessions = new WeakMap<AstNode, TypingSession>();

/** The session typing `node`'s document. Validators and lowering both type per
 *  document today (cross-document names resolve as they did before the pass);
 *  widening to the import closure is design §D5's, measured in its own slice. */
export function typingFor(node: AstNode): TypingSession {
  const root = AstUtils.findRootNode(node);
  let s = sessions.get(root);
  if (!s) {
    s = typingSession([root as Model]);
    sessions.set(root, s);
  }
  return s;
}

/** Drop every session (the workspace changed). */
export function invalidateTyping(): void {
  sessions = new WeakMap();
}

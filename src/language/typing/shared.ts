// The one place a consumer gets the typing session for a node (M-T5.47 §D8).
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

/** How to find the other documents of a root's import closure, keyed by the
 *  root itself (`registerTypingRoot`, called by `createDddServices` as each
 *  document is parsed).  Keyed weakly by the root, so a dropped document or
 *  services instance (one per unit test, one per toolkit `validate()` call) is
 *  collectable.  A list of `WeakRef`s to each workspace would not be: every
 *  `deref()` pins its target until the microtask queue drains, and a run of
 *  awaited `validate()` calls never drains it — each call kept every earlier
 *  call's services alive, ~6 MB apiece. */
const composedRootsOf = new WeakMap<Model, (root: Model) => Model[] | undefined>();

/** Bind a freshly parsed root to its workspace: `composed(root)` returns the
 *  other roots of `root`'s import closure, or `undefined` when `root` is no
 *  longer one of the workspace's documents. */
export function registerTypingRoot(
  root: Model,
  composed: (root: Model) => Model[] | undefined,
): void {
  composedRootsOf.set(root, composed);
}

function composedFor(root: Model): Model[] {
  return composedRootsOf.get(root)?.(root) ?? [];
}

/** The session typing `node`'s document. Validators and lowering both type per
 *  document today (cross-document names resolve as they did before the pass);
 *  widening to the import closure is design §D5's, measured in its own slice. */
export function typingFor(node: AstNode): TypingSession {
  const root = AstUtils.findRootNode(node);
  let s = sessions.get(root);
  if (!s) {
    s = typingSession([root as Model], composedFor(root as Model));
    sessions.set(root, s);
  }
  return s;
}

/** Drop every session (the workspace changed). */
export function invalidateTyping(): void {
  sessions = new WeakMap();
}

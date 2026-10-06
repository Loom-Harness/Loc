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

/** The workspaces a document can belong to, each with how to find the other
 *  documents of a root's import closure (`registerTypingWorkspace`, called by
 *  `createDddServices`).  Held weakly: a dropped services instance (one per
 *  unit test) must not be kept alive by its registration. */
const workspaces: WeakRef<object>[] = [];
const composedRootsOf = new WeakMap<object, (root: Model) => Model[] | undefined>();

/** Register a workspace: `composed(root)` returns the other roots of `root`'s
 *  import closure, or `undefined` when `root` is not one of its documents. */
export function registerTypingWorkspace(
  key: object,
  composed: (root: Model) => Model[] | undefined,
): void {
  for (let i = workspaces.length - 1; i >= 0; i--) {
    if (!workspaces[i]?.deref()) workspaces.splice(i, 1);
  }
  workspaces.push(new WeakRef(key));
  composedRootsOf.set(key, composed);
}

function composedFor(root: Model): Model[] {
  for (const ref of workspaces) {
    const key = ref.deref();
    const found = key ? composedRootsOf.get(key)?.(root) : undefined;
    if (found) return found;
  }
  return [];
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

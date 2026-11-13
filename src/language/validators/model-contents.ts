// One flattened walk per document, shared by every check in a validation run.
//
// `DddValidator.check` runs ~70 model-level checks in sequence, and ~80 of
// their loops walk the whole document AST (`streamAllContents(model)`).  A full
// walk costs 1–2 ms on a 1,000-line model, so re-walking the same tree was the
// bulk of AST validation.  Inside one run the AST is immutable — macro
// expansion has already happened and checks only read — so the node list is
// computed once per document root and replayed as a `Stream`: the same nodes in
// the same document order, so every check sees exactly what a fresh walk would
// and emits the same diagnostics in the same order.
//
// The cache exists only while `withModelContentsCache` is on the stack.  A call
// outside a run (a unit test invoking a check directly, any other tool) gets a
// fresh walk, and so does a non-root node, so a list can never outlive the run
// that built it or describe a subtree it was not built for.

import { type AstNode, AstUtils, type Stream, stream } from "langium";

let active: Map<AstNode, readonly AstNode[]> | undefined;

/** Every node below `root` in document order — `AstUtils.streamAllContents`,
 *  served from the current validation run's cache when `root` is a document
 *  root. */
export function modelContents(root: AstNode): Stream<AstNode> {
  if (active === undefined || root.$container !== undefined) {
    return AstUtils.streamAllContents(root);
  }
  let nodes = active.get(root);
  if (nodes === undefined) {
    nodes = AstUtils.streamAllContents(root).toArray();
    active.set(root, nodes);
  }
  return stream(nodes);
}

/** Run `fn` with the per-run contents cache enabled.  `fn` must be
 *  synchronous: the cache is module state, cleared when `fn` returns.  A
 *  nested call reuses the enclosing run's cache. */
export function withModelContentsCache<T>(fn: () => T): T {
  if (active !== undefined) return fn();
  active = new Map();
  try {
    return fn();
  } finally {
    active = undefined;
  }
}

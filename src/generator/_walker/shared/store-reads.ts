// The `<Store>.<field>` reads inside one expression — shared by the frontend
// shells that hoist a `derived` binding.
//
// WHY IT IS SHARED.  A derived's initialiser renders a store read as the
// shell's hoisted selector local (`const count = useCart((s) => s.count)` on
// React, `const count = $derived(cart.count)` on Svelte), and `storeLocalFor`
// QUALIFIES that local (`cartCount`) when the bare member name collides with
// one of the page's own bindings.  The shell's store wiring reserves the FULL
// derived-name set when it picks those names, but a derived's own walk context
// only knows the derived seen SO FAR — so for a member whose name matches a
// LATER (or the CURRENT) derived the two sides disagree and the use site names
// a local nothing declared.  Folding the colliding names in needs exactly this
// list, on every shell that hoists derived bindings; React had it privately,
// Svelte re-derived nothing and emitted `const count = $derived(count);` (F50).

import type { ExprIR } from "../../../ir/types/loom-ir.js";
import { walkExprDeep } from "../../../ir/util/walk.js";

/** The `<Store>.<field>` reads inside an expression, in encounter order. */
export function collectStoreReads(expr: ExprIR): Array<{ store: string; member: string }> {
  const out: Array<{ store: string; member: string }> = [];
  walkExprDeep(expr, (e) => {
    if (e.kind === "ref" && e.refKind === "store-field" && e.storeName) {
      out.push({ store: e.storeName, member: e.name });
    }
  });
  return out;
}

/** The subset of `derivedNames` a store read in `expr` collides with and that
 *  the walk has NOT yet seen — the names a derived's own context has to fold
 *  in so `storeLocalFor` picks the same local the shell's store wiring will. */
export function collidingDerivedNames(
  expr: ExprIR,
  derivedNames: ReadonlySet<string>,
  seenDerived: ReadonlySet<string>,
): string[] {
  return collectStoreReads(expr)
    .map((r) => r.member)
    .filter((m) => derivedNames.has(m) && !seenDerived.has(m));
}

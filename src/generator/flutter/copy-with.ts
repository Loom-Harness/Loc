// The immutable nested-write fold, shared by the two Flutter write paths.
//
// Dart wire models are immutable and carry a generated `copyWith`
// (`dart-model-emit.ts`), so a write into a nested field rebuilds every level
// above it, inside-out.  Two call sites need exactly that fold with different
// roots:
//
//   riverpod-emit.ts  `nestedCopyWith` — the NOTIFIER-method path, rooted at
//                     `state`: `state = state.copyWith(draft: state.draft.copyWith(zip: z))`
//   flutter-target.ts `renderNestedStateWrite` — the WALKER seam, which hands
//                     the rebuilt value to the root field's setter:
//                     `notifier.setDraft(state.draft.copyWith(zip: z))`
//
// It lives in its own leaf because `riverpod-emit.ts` imports `flutter-target.ts`
// (for `flutterTarget`), so the seam cannot import back without a cycle.

/** Rebuild `receiver` with `path` set to `value`, inside-out.
 *
 *  `copyWithChain("state.order", ["shipping", "zip"], "v")` →
 *  `state.order.copyWith(shipping: state.order.shipping.copyWith(zip: v))`.
 *  An empty `path` is the identity (`value`) — the caller is writing the
 *  receiver itself. */
export function copyWithChain(receiver: string, path: readonly string[], value: string): string {
  let expr = value;
  for (let i = path.length - 1; i >= 0; i--) {
    const target = i === 0 ? receiver : `${receiver}.${path.slice(0, i).join(".")}`;
    expr = `${target}.copyWith(${path[i]}: ${expr})`;
  }
  return expr;
}

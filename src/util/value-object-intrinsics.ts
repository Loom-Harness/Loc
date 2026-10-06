/**
 * The value-object member intrinsics — the one name every value object answers
 * without declaring it.
 *
 * `<vo>.equals(other)` is VALUE equality, the defining property of a value
 * object.  The language layer types it (`(other: Self): bool`, see
 * `type-system.ts` / `validators/types.ts`) and the IR layer lowers it to the
 * ordinary `binary ==` node over two value-object operands
 * (`ir/lower/lower-expr.ts`), so it renders through each backend's existing
 * value-equality `==` leaf: python `==` (frozen-dataclass `__eq__`), java
 * `Objects.equals` (record `equals`), .NET record `==`, elixir `==` (struct /
 * map structural equality), node `.equals(…)` (the field-wise method every VO
 * class emits).  It is a pure name catalogue, shared by `language/` and `ir/`
 * without a layering back-edge.
 *
 * A value object that DECLARES its own member named `equals` keeps it — the
 * intrinsic only answers when the name is otherwise absent.
 */
export const VALUE_OBJECT_EQUALS = "equals";

/** The display signature of `<vo>.equals` for diagnostics and completion, in
 *  the scalar-intrinsic catalogue's shape (`(params): ret`, the member name is
 *  prefixed by the caller). */
export function valueObjectEqualsSignature(voName: string): string {
  return `(other: ${voName}): bool`;
}

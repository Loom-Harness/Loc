import type { ExprIR, TypeIR } from "../../ir/types/loom-ir.js";

// ---------------------------------------------------------------------------
// A value collection a Java entity OWNS (`tags: string[]`, `rates: Money[]` —
// not a containment) must hold a MUTABLE list, because domain code appends to
// it in place: `tags += t` renders `this.tags.add(t)`.  Every list Java code
// can hand the field is a candidate for being immutable — a list literal
// renders `List.of(…)`, a collection op renders `.stream()…toList()`, a
// generated domain test passes `List.of(…)` straight to `create`/`update` —
// and `.add` on any of them throws UnsupportedOperationException.  So each
// write of such a field COPIES into an `ArrayList` instead of aliasing what
// it was given; that also keeps the entity from sharing the caller's list.
//
// Containment collections (`lines: Line[]`, element kind `entity`) are left
// alone: they are Hibernate-managed `@OneToMany` bags whose identity the
// persistence context tracks, so they are filled with `addAll`, never
// reassigned.
// ---------------------------------------------------------------------------

/** True for a non-nullable value collection (`T[]`, `T` not an entity). */
export function isOwnedValueList(t: TypeIR): boolean {
  return t.kind === "array" && t.element.kind !== "entity";
}

/** True for a nullable value collection (`T[]?`). */
export function isOptionalOwnedValueList(t: TypeIR): boolean {
  return t.kind === "optional" && isOwnedValueList(t.inner);
}

/** The right-hand side for a write of `rendered` (the Java spelling of
 *  `value`) into a field of `type`: a mutable copy for an owned value list,
 *  `rendered` unchanged otherwise.  A nullable list is copied only when the
 *  value is a list LITERAL — any other expression may be `null`, which
 *  `new ArrayList<>(null)` would turn into an NPE. */
export function mutableListWrite(type: TypeIR, value: ExprIR, rendered: string): string {
  if (isOwnedValueList(type) || (isOptionalOwnedValueList(type) && value.kind === "list")) {
    return `new java.util.ArrayList<>(${rendered})`;
  }
  return rendered;
}

/** The assignment of factory parameter `name` into a field of `type`, with
 *  `fallback` (the omission value, or none) applied when the caller passed
 *  `null`.  An owned value list — nullable or not — is copied; the copy is
 *  guarded by the same `!= null` test the fallback already needs. */
export function factoryFieldWrite(
  type: TypeIR,
  name: string,
  fallback: string | undefined,
): string {
  if (isOwnedValueList(type) || isOptionalOwnedValueList(type)) {
    const copy = `new java.util.ArrayList<>(${name})`;
    return `${name} != null ? ${copy} : ${fallback ?? "null"}`;
  }
  return fallback === undefined ? name : `${name} != null ? ${name} : ${fallback}`;
}

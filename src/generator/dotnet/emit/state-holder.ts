// The .NET rehydration-holder type name (F-015, #2922).
//
// Every emitted aggregate / entity-part class carries a NESTED init-only
// holder that the persistence adapters fill and pass to `_Create(…)`:
//
//     public sealed class __State { public OrderId Id { get; init; } … }
//     public static Order _Create(__State s) { … }
//
// It used to be spelled `State`, which collided with the model:
// `aggregate Thing { state: string }` emits `public string State { get; }` on
// the SAME class, so the generated `Thing.cs` failed to compile twice —
//
//     Thing.cs(16,19): error CS0102: The type 'Thing' already contains a
//                      definition for 'State'
//     Thing.cs(55,23): error CS0542: 'State': member names cannot be the same
//                      as their enclosing type      (the `State` slot INSIDE
//                                                    the `State` holder)
//
// — while `state` is a documented, legal Loom soft-keyword field name
// (docs/language.md demonstrates it), so the DSL side is right and the emitter
// must move.  The holder is a pure internal detail: no wire field, no JSON
// property, no reflection — renaming it is invisible outside generated code.
//
// The name is CLASS-proof, not `state`-proof.  Every C# member the entity
// emitter derives from a model field is `upperFirst(field.name)`, and
// `upperFirst` leaves a leading `_` alone (`upperFirst("_state") === "_state"`),
// so no field name can be cased INTO a leading-underscore identifier.  A
// collision would require a Loom field literally spelled `__State` — whereas
// `State`, `Data`, `Init`, `Values`, `Snapshot` and every other bare PascalCase
// candidate is one plausible field name away from the same defect.
//
// One exported constant so the declaration site (`emit/entity.ts`) and every
// construction site (`emit/dapper.ts`, `render-expr.ts`) cannot drift apart.

/** Nested rehydration-holder type name, e.g. `Order.__State`. */
export const CS_STATE_HOLDER = "__State";

/** `<Type>.__State` — the holder as named from OUTSIDE the entity class. */
export function csStateHolderOf(typeName: string): string {
  return `${typeName}.${CS_STATE_HOLDER}`;
}

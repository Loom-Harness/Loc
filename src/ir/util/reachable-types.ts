// Transitive reachable-type collection over the IR's structural types.
//
// Several schema/DTO emitters (the React per-aggregate api module, the
// Hono route + workflow schema blocks) emit a named schema for each value
// object and enum they reference — `<Vo>Schema`, `<Enum>Schema`.  A value
// object's schema is itself `z.object({ <field>: <fieldType>Schema, … })`,
// so it references the schema of EACH field's type.  An emitter that
// collected only the types named directly on the aggregate / workflow
// surface — but not the types reached THROUGH a value object's fields —
// would emit a `<Vo>Schema` whose body references an undeclared
// `<Enum>Schema` (e.g. `Address.country: Country` pulling in `Country`),
// which the bundler rejects with "CountrySchema is not defined".
//
// `collectReachableTypes` walks the seed types and, for every value object
// it reaches, descends into that VO's own field types — the transitive
// closure that matches what the emitted `<Vo>Schema` bodies reference.
// Pure IR traversal: consumed downward by the generators, no back-edge.

import type { BoundedContextIR, FieldIR, TypeIR, ValueObjectIR } from "../types/loom-ir.js";

/**
 * The value-object DECLARATIONS an emitter for this context may have to
 * materialise: the context's own (root shared-kernel VOs already folded in at
 * enrichment) plus the ones declared in sibling contexts of the same system.
 *
 * A cross-context reference — `aggregate Payment { paid: Money }` in context
 * Beta against `valueobject Money` in context Alpha — is legal and lowers to
 * `{ kind: "valueobject", name: "Money" }` like any other, but the declaration
 * never enters Beta's `valueObjects`.  An emitter that resolved "which VOs does
 * this file declare" against `ctx.valueObjects` alone therefore emitted a file
 * REFERENCING `MoneyResponse` / `MoneySchema` and DECLARING nothing — an
 * undefined type at the target compiler.
 *
 * This is a POOL, not an emission list: callers still pass it through
 * `collectReachableTypes` and keep only what the aggregate's own wire surface
 * actually reaches, so an unreferenced sibling VO is never emitted.  Own names
 * shadow (`siblingValueObjects` is built already excluding them).
 */
export function valueObjectPool(ctx: BoundedContextIR): ReadonlyArray<ValueObjectIR> {
  const siblings = ctx.siblingValueObjects;
  return siblings && siblings.length > 0 ? [...ctx.valueObjects, ...siblings] : ctx.valueObjects;
}

/** `valueObjectPool` as the `name → fields` map the flattening emitters want
 *  (JPA / EF column names, request→domain constructors, projection state).
 *  Their `undefined` branch is silent too: EF emits `OwnsOne<Money>(x => x.Paid,
 *  o => { })` with no column names, and Java emits `new Money()` against a
 *  two-arg record. */
export function valueObjectFieldLookup(
  ctx: BoundedContextIR,
): ReadonlyMap<string, readonly FieldIR[]> {
  return new Map(valueObjectPool(ctx).map((v) => [v.name, v.fields] as const));
}

/** Resolve one `valueobject` name against `valueObjectPool` — the lookup every
 *  emitter that asks "is this field type a value object, and what are its
 *  fields?" should use.  `ctx.valueObjects.find(...)` alone silently answers
 *  "no" for a cross-context VO, and each caller's `undefined` branch is a
 *  DEGRADED fallback (a single text input for a whole money object, a
 *  `String(value)` page-object fill), not an error — so the miss is invisible
 *  until the generated project is run. */
export function findValueObjectInScope(
  ctx: BoundedContextIR,
  name: string,
): ValueObjectIR | undefined {
  return (
    ctx.valueObjects.find((v) => v.name === name) ??
    ctx.siblingValueObjects?.find((v) => v.name === name)
  );
}

export interface ReachableTypes {
  /** Names of every value object reachable from the seeds (directly or
   *  through another value object's fields). */
  valueObjects: Set<string>;
  /** Names of every enum reachable from the seeds (directly or through a
   *  value object's fields). */
  enums: Set<string>;
}

export function collectReachableTypes(
  seeds: Iterable<TypeIR>,
  valueObjects: ReadonlyArray<ValueObjectIR>,
): ReachableTypes {
  const voByName = new Map(valueObjects.map((v) => [v.name, v]));
  const vos = new Set<string>();
  const enums = new Set<string>();
  // Value objects whose own fields we still have to descend into.
  const pending: string[] = [];

  const visit = (t: TypeIR): void => {
    if (t.kind === "valueobject") {
      if (!vos.has(t.name)) {
        vos.add(t.name);
        pending.push(t.name);
      }
    } else if (t.kind === "enum") {
      enums.add(t.name);
    } else if (t.kind === "array") {
      visit(t.element);
    } else if (t.kind === "optional") {
      visit(t.inner);
    }
  };

  for (const t of seeds) visit(t);
  // Closure: a reached VO's emitted schema references the schema of each
  // of its fields, so those field types are themselves reachable.
  while (pending.length > 0) {
    const vo = voByName.get(pending.pop()!);
    if (!vo) continue;
    for (const f of vo.fields) visit(f.type);
  }

  return { valueObjects: vos, enums };
}

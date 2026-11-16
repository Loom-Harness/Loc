// A stored value object is its LEAF columns (D-ONE-SCHEMA).
//
// The shared phase-⑨ `MigrationsIR` flattens a value-object field into one
// column per leaf, named by joining the snake-cased field chain with `_`
// (`offer: Offer { price: Money { amount } }` → `offer_price_amount`).  Every
// persistence mapping that reads or writes such a field — an aggregate row, a
// contained part, a folded projection row, a workflow's state row — derives the
// same leaves here, so a mapping cannot drift away from the columns the
// migrations create.  `test/system/value-object-columns-census.test.ts` checks
// every leaf this returns against the `voGroup` columns of the shared schema.
//
// A value-object COLLECTION is not flattened here: it is a child table keyed by
// `(parent_fk, ordinal)` (`valueCollectionsFor`, `ir/util/value-collections.ts`).

import { snake } from "../../util/naming.js";
import type { TypeIR } from "../types/loom-ir.js";
import {
  findValueObjectInScope,
  type ScopeEnum,
  type ScopeValueObject,
  type TypeScope,
} from "../util/reachable-types.js";

/** The value objects a leaf derivation may have to look through. */
export type ValueObjectScope = TypeScope<ScopeEnum, ScopeValueObject>;

/** One leaf column behind a value-object field. */
export interface VoLeaf {
  /** The `_`-joined field chain (`st_atTime`) — the row PROP name the node
   *  mappings declare. */
  readonly prop: string;
  /** The column the shared schema names for it (`st_at_time`). */
  readonly column: string;
  /** The nested path from the value-object field down (`["atTime"]`). */
  readonly path: readonly string[];
  /** The leaf's own domain type, with `optional` already unwrapped. */
  readonly type: TypeIR;
  /** True when the leaf's COLUMN is nullable — its own `T?`, or an optional
   *  ancestor (the field itself included when it is optional). */
  readonly nullable: boolean;
  /** True when an ANCESTOR is optional, so an in-memory read hops with `?.`.
   *  A leaf that is merely optional ITSELF sits on a present object. */
  readonly viaOptional: boolean;
}

/** `t` with a single `optional` layer removed, and whether one was there. */
function unwrap(t: TypeIR): { inner: TypeIR; optional: boolean } {
  return t.kind === "optional" ? { inner: t.inner, optional: true } : { inner: t, optional: false };
}

/** Is this field's type a value object (through an `optional`) whose
 *  declaration is in scope?  A value-object collection is not. */
export function isFlattenedValueObject(t: TypeIR, scope: ValueObjectScope): boolean {
  const { inner } = unwrap(t);
  return inner.kind === "valueobject" && !!findValueObjectInScope(scope, inner.name);
}

/** The leaf columns a value-object field flattens into, in declaration order.
 *  Empty when `t` is not a value object in scope, so a non-empty result is the
 *  "this field is flattened" test.  A nested value object whose declaration is
 *  not in scope is one leaf named for its field.  An empty `prop` names the
 *  columns of a value-object collection's child table, which carry no field
 *  prefix (`street`, `geo_lat`). */
export function voLeaves(prop: string, t: TypeIR, scope: ValueObjectScope): VoLeaf[] {
  return leavesOf(prop, snake(prop), t, scope);
}

function leavesOf(prop: string, column: string, t: TypeIR, scope: ValueObjectScope): VoLeaf[] {
  const { inner, optional } = unwrap(t);
  if (inner.kind !== "valueobject") return [];
  const vo = findValueObjectInScope(scope, inner.name);
  if (!vo) return [];
  return vo.fields.flatMap((f): VoLeaf[] => {
    const { inner: fi, optional: fo } = unwrap(f.type);
    const selfOptional = fo || !!f.optional;
    const childProp = prop ? `${prop}_${f.name}` : f.name;
    const childColumn = column ? `${column}_${snake(f.name)}` : snake(f.name);
    const nested = leavesOf(childProp, childColumn, fi, scope);
    if (nested.length > 0) {
      return nested.map((l) => ({
        ...l,
        path: [f.name, ...l.path],
        nullable: l.nullable || optional || selfOptional,
        viaOptional: l.viaOptional || optional || selfOptional,
      }));
    }
    return [
      {
        prop: childProp,
        column: childColumn,
        path: [f.name],
        type: fi,
        nullable: optional || selfOptional,
        viaOptional: optional,
      },
    ];
  });
}

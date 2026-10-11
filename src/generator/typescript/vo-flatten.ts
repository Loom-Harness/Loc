// A value-object field FLATTENED into the read-model columns that hold it.
//
// A `valueobject` field on a folded projection's row (or a workflow's saga
// state) is not one column: the shared phase-⑨ `MigrationsIR` spreads it into
// one column per leaf, named by joining the field chain with `_`.  Both node
// adapters agree on that layout and on the row PROP names —
// `drizzleColumnLinesForName` (`emit/schema.ts`) recurses as
// `${fieldName}_${voField.name}`, and `columnsForType`
// (`emit/mikroorm-entities.ts`) as `${prop}_${sub.name}` — so
// `st: Stamp { atTime, who }` lands as `st_atTime` / `st_who` on the row and
// `st_at_time` / `st_who` in the DDL.
//
// The read model's WIRE shape is the other way round: the response DTO declares
// the value object NESTED (`st: StampSchema`), which is the spelling java's
// `StampResponse` and .NET's / python's response records publish too.  So a read
// model carrying a value object needs the two halves to meet — the fold writes
// the leaves, the read route rebuilds the nest — and BOTH halves have to derive
// the same leaf names or they miss each other silently.  They derive them here.
//
// Before this existed, the node folded-projection emitter did neither: the fold
// assigned the whole domain value to a prop the row does not have (`state.st =
// e.st`, TS2339) and the response schema named a `<Vo>Schema` nothing declared
// (TS2304).  Both are compile errors in the GENERATED project, on a `.ddd` that
// validates `0 error(s)` — so the tree was emitted, and only a build of it could
// notice.  `test/generator/hono/projection-valueobject-row.test.ts` pins the leaf
// names against the columns the two adapters actually emit, so this derivation
// cannot drift away from the layout it is mirroring.

import type { EnrichedBoundedContextIR, TypeIR } from "../../ir/types/loom-ir.js";
import { findValueObjectInScope } from "../../ir/util/reachable-types.js";

/** One leaf column behind a value-object field. */
export interface VoLeaf {
  /** The row PROP holding it (`st_atTime`) — the `_`-joined field chain. */
  readonly prop: string;
  /** The nested wire path from the value-object field down (`["atTime"]`). */
  readonly path: readonly string[];
  /** The leaf's own domain type, with `optional` already unwrapped. */
  readonly type: TypeIR;
  /** True when the leaf's COLUMN is nullable — its own `T?`, or an optional
   *  ancestor.  Drives the null guard a column conversion needs. */
  readonly nullable: boolean;
  /** True when an ANCESTOR is optional, so the in-memory read has to hop with
   *  `?.`.  A leaf that is merely optional ITSELF sits on a present object and
   *  reads with a plain `.` — conflating the two emitted a needless `?.`. */
  readonly viaOptional: boolean;
}

/** `t` with a single `optional` layer removed, and whether one was there. */
function unwrap(t: TypeIR): { inner: TypeIR; optional: boolean } {
  return t.kind === "optional" ? { inner: t.inner, optional: true } : { inner: t, optional: false };
}

/** Is this field's type a value object (through an `optional`)?  A value-object
 *  COLLECTION is not: it rides one jsonb column, so it has no leaf props. */
export function isFlattenedValueObject(t: TypeIR, ctx: EnrichedBoundedContextIR): boolean {
  const { inner } = unwrap(t);
  return inner.kind === "valueobject" && !!findValueObjectInScope(ctx, inner.name);
}

/** The leaf columns a value-object field flattens into, in declaration order.
 *  Empty when `t` is not a flattened value object — so a caller can use a
 *  non-empty result as the "this field needs nesting" test and keep every other
 *  field on its existing single-prop path.
 *
 *  Recurses through a nested value object exactly as the two column emitters do;
 *  a value object whose declaration is not in scope falls back to one prop (the
 *  same fallback both of them take). */
export function voLeaves(prop: string, t: TypeIR, ctx: EnrichedBoundedContextIR): VoLeaf[] {
  const { inner, optional } = unwrap(t);
  if (inner.kind !== "valueobject") return [];
  const vo = findValueObjectInScope(ctx, inner.name);
  if (!vo) return [];
  return vo.fields.flatMap((f): VoLeaf[] => {
    const { inner: fi, optional: fo } = unwrap(f.type);
    const selfOptional = fo || f.optional;
    const childProp = `${prop}_${f.name}`;
    const nested = voLeaves(childProp, fi, ctx);
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
        path: [f.name],
        type: fi,
        nullable: optional || selfOptional,
        viaOptional: optional,
      },
    ];
  });
}

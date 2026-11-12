// The zero value a saga's or event-sourced workflow's state starts from.  A
// fresh instance (the allocate on first event, the command route's create, a
// fold from an empty stream) seeds the correlation key from the routing key and
// every REQUIRED state field with a typed zero, because each is a NOT NULL
// column or a non-nullable property.  Which fields need a zero, and what kind of
// zero each type takes, is one decision; how a backend spells `0`, today's date
// or an enum's first member is its own spelling table.

import type {
  BoundedContextIR,
  FieldIR,
  TypeIR,
  ValueObjectIR,
  WorkflowIR,
} from "../types/loom-ir.js";
import { enumPool, valueObjectPool } from "../util/reachable-types.js";

/** The kind of zero a state field of some type takes. */
export type StateZero =
  | { kind: "int" }
  | { kind: "long" }
  | { kind: "decimal" }
  | { kind: "money" }
  | { kind: "bool" }
  /** The current instant. */
  | { kind: "datetime" }
  /** Today's calendar date. */
  | { kind: "date" }
  | { kind: "json" }
  /** Every other primitive (string, guid, …): the empty string. */
  | { kind: "text"; name: string }
  | { kind: "array" }
  /** `first` is the enum's first declared member, when the enum resolves. */
  | { kind: "enum"; name: string; first: string | undefined }
  /** `fields` lists each field's zero (`undefined` for an optional one), when
   *  the value object resolves and is not already being expanded. */
  | {
      kind: "valueobject";
      name: string;
      fields: { name: string; zero: StateZero | undefined }[] | undefined;
    }
  | { kind: "id"; type: Extract<TypeIR, { kind: "id" }> }
  /** Anything else (an entity reference, a union, …): no typed zero. */
  | { kind: "none" };

/** The zero `t` takes, `T?` unwrapped to `T`.  Enums and value objects resolve
 *  against `ctx`'s own and sibling declarations when `ctx` is given. */
export function stateZero(
  t: TypeIR,
  ctx?: Pick<BoundedContextIR, "enums" | "valueObjects" | "siblingEnums" | "siblingValueObjects">,
  seen: ReadonlySet<string> = new Set(),
): StateZero {
  const inner = t.kind === "optional" ? t.inner : t;
  switch (inner.kind) {
    case "primitive":
      switch (inner.name) {
        case "int":
        case "long":
        case "decimal":
        case "money":
        case "bool":
        case "datetime":
        case "date":
        case "json":
          return { kind: inner.name };
        default:
          return { kind: "text", name: inner.name };
      }
    case "array":
      return { kind: "array" };
    case "enum": {
      const first = ctx
        ? enumPool(ctx as BoundedContextIR).find((e) => e.name === inner.name)?.values[0]
        : undefined;
      return { kind: "enum", name: inner.name, first };
    }
    case "valueobject": {
      const vo: ValueObjectIR | undefined =
        ctx && !seen.has(inner.name)
          ? valueObjectPool(ctx as BoundedContextIR).find((v) => v.name === inner.name)
          : undefined;
      const nested = new Set([...seen, inner.name]);
      return {
        kind: "valueobject",
        name: inner.name,
        fields: vo?.fields.map((f) => ({
          name: f.name,
          zero: isOptionalField(f) ? undefined : stateZero(f.type, ctx, nested),
        })),
      };
    }
    case "id":
      return { kind: "id", type: inner };
    default:
      return { kind: "none" };
  }
}

/** True when the field may be absent: declared optional or typed `T?`. */
function isOptionalField(f: Pick<FieldIR, "optional" | "type">): boolean {
  return f.optional || f.type.kind === "optional";
}

/** The state fields a fresh instance must seed with a zero: every
 *  non-correlation field that is neither declared optional nor typed `T?`. */
export function requiredStateFields(
  wf: Pick<WorkflowIR, "stateFields" | "correlationField">,
): FieldIR[] {
  return (wf.stateFields ?? []).filter(
    (f) => f.name !== wf.correlationField && !isOptionalField(f),
  );
}

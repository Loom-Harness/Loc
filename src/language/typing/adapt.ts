// `toDddType` — the single pass's answer, in the language layer's legacy
// `DddType` vocabulary (M-T5.44 §D2). A validator not yet migrated keeps the
// exact view it has today: a union reads as its head variant and a generic
// carrier as its argument (what `resolveTypeRef` gives), and the record shapes
// `DddType` cannot express (workflow / projection state, resource handles,
// stores) read as `unknown`, the value those validators already stand down on.
// Deleted with `DddType` in the final slice.

import type { DddType } from "../type-system.js";
import type { Ty } from "./ty.js";

export function toDddType(t: Ty): DddType {
  const s = t.sensitivity ? { sensitivity: t.sensitivity } : {};
  switch (t.kind) {
    case "primitive":
      return { kind: "primitive", name: t.name, ...s };
    case "id":
      return t.target && (t.target.$type === "Aggregate" || t.target.$type === "EntityPart")
        ? { kind: "id", target: t.target as never, ...s }
        : { kind: "unknown", ...s };
    case "enum":
      return t.ref && !t.candidates
        ? { kind: "enum", ref: t.ref, ...s }
        : { kind: "unknown", ...s };
    case "valueobject":
      return t.ref ? { kind: "valueobject", ref: t.ref, ...s } : { kind: "unknown", ...s };
    case "record":
      switch (t.shape.of) {
        case "aggregate":
          return { kind: "aggregate", ref: t.shape.ref, ...s };
        case "part":
          return { kind: "entity", ref: t.shape.ref, ...s };
        case "event":
        case "payload":
          return { kind: "payload", ref: t.shape.ref, ...s };
        case "principal":
          return t.shape.ref
            ? { kind: "userclaim", ref: t.shape.ref, ...s }
            : { kind: "unknown", ...s };
        default:
          return { kind: "unknown", ...s };
      }
    case "array":
      return { kind: "array", element: toDddType(t.element), ...s };
    case "optional":
      return { kind: "optional", inner: toDddType(t.inner), ...s };
    case "union":
      return t.variants[0] ? toDddType(t.variants[0]) : { kind: "unknown", ...s };
    case "generic":
      return toDddType(t.arg);
    case "action":
      return t.arg ? { kind: "action", arg: toDddType(t.arg), ...s } : { kind: "action", ...s };
    case "slot":
    case "any":
    case "never":
    case "unknown":
      return { kind: t.kind, ...s } as DddType;
    case "none":
      return { kind: "unknown", ...s };
    default: {
      const _exhaustive: never = t;
      return _exhaustive;
    }
  }
}

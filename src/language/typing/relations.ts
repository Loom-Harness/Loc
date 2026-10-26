// The type relations the validators judge with — equality, assignability,
// comparability, the ternary join — and the one printer for a type in a
// diagnostic. They are defined here, over the single pass's `Ty`, and nowhere
// else: a second copy over a second type vocabulary is how a union came to be
// judged as its first variant.

import type { PrimitiveName, SensitivityTags } from "../../ir/types/loom-ir.js";
import { type Ty, tyKey } from "./ty.js";

/** `none` is the unit variant only an `option` builds, so a two-variant union
 *  carrying it prints the way it was written. */
function optionArg(t: Ty & { kind: "union" }): Ty | undefined {
  if (t.variants.length !== 2) return undefined;
  const [a, b] = t.variants as [Ty, Ty];
  if (b.kind === "none" && a.kind !== "none") return a;
  if (a.kind === "none" && b.kind !== "none") return b;
  return undefined;
}

export function typeToString(t: Ty): string {
  const base = ((): string => {
    switch (t.kind) {
      case "primitive":
        return t.name;
      case "id":
        return `${t.name} id`;
      case "enum":
      case "valueobject":
        return t.name;
      case "record":
        switch (t.shape.of) {
          case "principal":
            return "currentUser";
          default:
            return t.shape.ref.name;
        }
      case "array":
        return `${typeToString(t.element)}[]`;
      case "optional":
        return `${typeToString(t.inner)}?`;
      case "union": {
        const arg = optionArg(t);
        return arg ? `${typeToString(arg)} option` : t.variants.map(typeToString).join(" or ");
      }
      case "generic":
        return `${typeToString(t.arg)} ${t.ctor}`;
      case "action":
        return t.arg ? `action(${typeToString(t.arg)})` : "action";
      case "none":
      case "slot":
      case "any":
      case "never":
      case "unknown":
        return t.kind;
      default: {
        const _exhaustive: never = t;
        return _exhaustive;
      }
    }
  })();
  return t.sensitivity && t.sensitivity.length > 0 ? `${base}!{${t.sensitivity.join(",")}}` : base;
}

/** The declaration a nominal type names, when it resolved. Two unresolved
 *  names compare by spelling. */
function sameDecl(a: object | undefined, b: object | undefined, an: string, bn: string): boolean {
  return a !== undefined && b !== undefined ? a === b : an === bn;
}

/** Structural identity. Sensitivity is a flow property `isAssignable` layers
 *  on top, not part of identity; `any` is equal to everything. */
export function typesEqual(a: Ty, b: Ty): boolean {
  if (a.kind === "any" || b.kind === "any") return true;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "primitive":
      return a.name === (b as typeof a).name;
    case "id": {
      const o = b as typeof a;
      return sameDecl(a.target, o.target, a.name, o.name);
    }
    case "enum":
    case "valueobject": {
      const o = b as typeof a;
      return sameDecl(a.ref, o.ref, a.name, o.name);
    }
    case "record": {
      const o = (b as typeof a).shape;
      return a.shape.of === o.of && a.shape.ref === o.ref;
    }
    case "array":
      return typesEqual(a.element, (b as typeof a).element);
    case "optional":
      return typesEqual(a.inner, (b as typeof a).inner);
    case "generic": {
      const o = b as typeof a;
      return a.ctor === o.ctor && typesEqual(a.arg, o.arg);
    }
    case "union": {
      // Identity is the variant SET (`A or B` is `B or A`).
      const keys = (u: typeof a) => [...new Set(u.variants.map(tyKey))].sort().join("|");
      return keys(a) === keys(b as typeof a);
    }
    case "action":
    case "none":
    case "slot":
    case "never":
    case "unknown":
      return true;
    default: {
      const _exhaustive: never = a;
      return _exhaustive;
    }
  }
}

/** An aggregate or entity part crossing a transport boundary takes its wire
 *  shape: the synthesized `response <Name>Response` record of its API read
 *  fields (D4, handle in process, wire at the boundary). A read handler declared
 *  `: OrderResponse` returns the loaded `Order`; the transport projects it,
 *  element-wise through `[]` and `?` (`Order[]` → `OrderResponse[]`). */
function isWireProjection(value: Ty, target: Ty): boolean {
  if (value.kind === "array" && target.kind === "array")
    return isWireProjection(value.element, target.element);
  if (value.kind === "optional" && target.kind === "optional")
    return isWireProjection(value.inner, target.inner);
  if (value.kind === "record" && target.kind === "optional")
    return isWireProjection(value, target.inner);
  if (value.kind !== "record" || target.kind !== "record") return false;
  if (value.shape.of !== "aggregate" && value.shape.of !== "part") return false;
  if (target.shape.of !== "payload") return false;
  const p = target.shape.ref;
  return p.kind === "response" && p.name === `${value.shape.ref.name}Response`;
}

/** An enum value several enums declare (`candidates`) fits whichever of them
 *  the context names. */
function enumCandidateFits(value: Ty, target: Ty): boolean {
  if (value.kind !== "enum" || target.kind !== "enum" || !value.candidates) return false;
  return target.ref !== undefined && value.candidates.includes(target.ref);
}

/** `guid` and `string` are a compatible pair for comparison / assignment. A
 *  guid is a string-shaped scalar (its literals are string literals), and
 *  Loom's own tenancy infrastructure bridges the two: `tenantOwned` stamps a
 *  `guid` `currentUser.<claim>` into a `string tenantId` column and filters
 *  `this.tenantId == currentUser.<claim>`. */
function guidStringBridge(a: PrimitiveName, b: PrimitiveName): boolean {
  return (a === "guid" && b === "string") || (a === "string" && b === "guid");
}

/** Does a value of type `value` fit a slot of type `target`?
 *
 *  - the `null` literal (`never` / `never?`) fits any `T?`, and a bare `T`
 *    that fits the inner type wraps into it; a `T?` value fits a `U?` slot
 *    only when its own inner type fits (`int? := string?` stays an error);
 *  - numeric widening `int → long → decimal`, the guid/string bridge;
 *  - the empty list literal (`never[]`) fits any list;
 *  - an aggregate or part fits its `<Name>Response` wire record;
 *  - a union value fits only when EVERY variant does — a value that may be
 *    `NotFound` does not fit an `Order` slot; a union slot takes a value that
 *    fits one of its variants. `none` is a variant like any other: `null` is
 *    not an `option`'s absent case.
 *
 *  Sensitivity narrowing (`string!{pii}` → `string`) is allowed here and
 *  reported separately by `sensitivityNarrows`. */
export function isAssignable(value: Ty, target: Ty): boolean {
  if (typesEqual(value, target)) return true;
  if (value.kind === "any" || target.kind === "any") return true;
  if (enumCandidateFits(value, target)) return true;
  if (isWireProjection(value, target)) return true;
  if (value.kind === "union") return value.variants.every((v) => isAssignable(v, target));
  if (target.kind === "union") return target.variants.some((v) => isAssignable(value, v));
  if (target.kind === "optional") {
    return (
      value.kind === "never" ||
      isAssignable(value, target.inner) ||
      (value.kind === "optional" &&
        (value.inner.kind === "never" || isAssignable(value.inner, target.inner)))
    );
  }
  if (value.kind === "array" && target.kind === "array" && value.element.kind === "never")
    return true;
  if (value.kind === "primitive" && target.kind === "primitive") {
    if (value.name === "int" && (target.name === "long" || target.name === "decimal")) return true;
    if (value.name === "long" && target.name === "decimal") return true;
    if (guidStringBridge(value.name, target.name)) return true;
  }
  return false;
}

/** May `a` and `b` meet in `== != < <= > >=`? The same primitive; two numerics
 *  in the `int / long / decimal` chain (money is closed: only with money); the
 *  same enum, `X id` or value object; `T?` against `T`; the `null` literal
 *  against anything; a union against what one of its variants compares with. */
export function comparable(a: Ty, b: Ty): boolean {
  if (a.kind === "any" || b.kind === "any") return true;
  if (a.kind === "never" || b.kind === "never") return true;
  if (typesEqual(a, b)) return true;
  if (enumCandidateFits(a, b) || enumCandidateFits(b, a)) return true;
  if (a.kind === "primitive" && b.kind === "primitive") {
    const numeric = (n: PrimitiveName) => n === "int" || n === "long" || n === "decimal";
    if (numeric(a.name) && numeric(b.name)) return true;
    if (guidStringBridge(a.name, b.name)) return true;
  }
  if (a.kind === "optional") return comparable(a.inner, b);
  if (b.kind === "optional") return comparable(a, b.inner);
  if (a.kind === "union") return a.variants.some((v) => comparable(v, b));
  if (b.kind === "union") return b.variants.some((v) => comparable(a, v));
  return false;
}

/** The type a ternary `cond ? a : b` produces: the more general branch when one
 *  fits the other (`int`/`long` ⇒ `long`, `T`/`T?` ⇒ `T?`), `T?` when one
 *  branch is the `null` literal, else `undefined` — the branches share no
 *  supertype and the ternary validator reports it. Sensitivity is not merged
 *  here; the caller attaches both branches' tags. */
export function ternaryJoin(a: Ty, b: Ty): Ty | undefined {
  if (a.kind === "unknown") return a;
  if (b.kind === "unknown") return b;
  if (isAssignable(a, b)) return b;
  if (isAssignable(b, a)) return a;
  const isNullish = (t: Ty): boolean =>
    t.kind === "never" || (t.kind === "optional" && t.inner.kind === "never");
  const opt = (t: Ty): Ty => (t.kind === "optional" ? t : { kind: "optional", inner: t });
  if (isNullish(a)) return opt(b);
  if (isNullish(b)) return opt(a);
  return undefined;
}

/** Is `sub` ⊆ `sup`? An absent set is empty. */
export function tagsSubset(
  sub: SensitivityTags | undefined,
  sup: SensitivityTags | undefined,
): boolean {
  if (!sub || sub.length === 0) return true;
  if (!sup || sup.length === 0) return false;
  return sub.every((t) => sup.includes(t));
}

/** The tags `value` carries that `target` does not — a sensitive value flowing
 *  into a less-sensitive slot. Permitted by `isAssignable`; the validator warns
 *  at the flow boundary so the drop is visible. `undefined` when nothing drops. */
export function sensitivityNarrows(value: Ty, target: Ty): SensitivityTags | undefined {
  if (tagsSubset(value.sensitivity, target.sensitivity)) return undefined;
  const dropped = (value.sensitivity ?? []).filter((t) => !target.sensitivity?.includes(t));
  return dropped.length === 0 ? undefined : (Object.freeze(dropped.sort()) as SensitivityTags);
}

// Which Loom types have a FRONTEND prop / extern-signature spelling — the one
// source of truth behind two emitters and one validator gate (§18 sentinels).
//
// Two shared frontend emitters map a declared type to its TypeScript spelling:
//
//   `_frontend/component-prop-type.ts`  a `component Badge(level: int)`'s props
//                                       interface (React / Vue / Svelte /
//                                       Angular all emit the same TS)
//   `_frontend/extern-functions.ts`     a `function fmt(x): T extern from "…"`
//                                       signature file, the contract the
//                                       author's own module is typechecked
//                                       against
//
// Both were written with a `default: throw new Error("unsupported primitive …")`
// arm, on the explicit reasoning that emitting `any`/`string` would silently
// void the contract the hatch exists to enforce.  That reasoning is right — and
// the arms are REACHABLE on `.ddd` that `ddd parse` calls clean.  Measured on
// this tree, one `.ddd` per row, each reported `0 error(s), 0 warning(s)` and
// then died mid-generate with a raw stack trace and no `loom.*` code:
//
//   component Price(amount: money)     `component prop: unsupported primitive 'money'.`
//   component Doc(file: File)          `component prop: unsupported primitive 'File'.`
//   component Ship(at: Address)        `component prop: unsupported type kind 'valueobject'.`
//   function fmt(m: money): string …   `extern function: unsupported primitive 'money' in signature.`
//
// None of the four is a user mistake: each is a perfectly ordinary declared
// type that the frontend prop layer has not been taught to carry.  `money`
// rides the wire as a decimal STRING and is re-parsed into a `Decimal` in the
// api modules (`moneySchema`), `File` has a fixed `FileRef` object shape, and a
// `valueobject` has a wire DTO of its own — so all three are portable work, not
// impossibilities.  Until that work lands they are refused with a code at phase
// ⑦, and the emitters keep their throws as internal floors naming it.

import type { TypeIR } from "../types/loom-ir.js";

/** Primitives with a component-prop / extern-signature TS spelling.  Mirrors
 *  the `case` arms of `componentPropTsType` / `wireTsType`; kept here so the
 *  validator and the two emitters cannot drift (pinned by
 *  `test/ir/frontend-prop-type-support.test.ts`). */
export const FRONTEND_PROP_PRIMITIVES: ReadonlySet<string> = new Set([
  "int",
  "long",
  "decimal",
  "bool",
  "string",
  "datetime",
  "guid",
  "json",
]);

/** Type KINDS a component prop / extern signature can spell.  `slot` and
 *  `action` are handled one level up by `paramPropTsType` (they are param-shaped
 *  markers, not data), so they are admitted here only as a bare param type —
 *  which is why the walk below unwraps `optional` before asking. */
const FRONTEND_PROP_KINDS: ReadonlySet<TypeIR["kind"]> = new Set([
  "primitive",
  "entity",
  "id",
  "enum",
  "array",
  "optional",
]);

/** The first unspellable thing in a type, described the way the emitters'
 *  throws describe it (`primitive 'money'` / `type kind 'valueobject'`), or
 *  `undefined` when the whole type is spellable.  Recurses into `array` /
 *  `optional` exactly as the emitters do. */
export function unsupportedFrontendPropType(t: TypeIR): string | undefined {
  if (t.kind === "primitive") {
    return FRONTEND_PROP_PRIMITIVES.has(t.name) ? undefined : `primitive '${t.name}'`;
  }
  if (t.kind === "array") return unsupportedFrontendPropType(t.element);
  if (t.kind === "optional") return unsupportedFrontendPropType(t.inner);
  return FRONTEND_PROP_KINDS.has(t.kind) ? undefined : `type kind '${t.kind}'`;
}

/** The param-level question: the same walk, but admitting the two marker kinds
 *  a `component` parameter may carry (`slot`, `action(T)`), and looking INSIDE
 *  an action's argument type — `paramPropTsType` spells the callback as
 *  `(arg: <T>) => void`, so `T` still has to be spellable. */
export function unsupportedFrontendParamType(t: TypeIR): string | undefined {
  const inner = t.kind === "optional" ? t.inner : t;
  if (inner.kind === "slot") return undefined;
  if (inner.kind === "action") {
    return inner.arg ? unsupportedFrontendPropType(inner.arg) : undefined;
  }
  return unsupportedFrontendPropType(t);
}

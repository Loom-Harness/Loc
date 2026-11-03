// ---------------------------------------------------------------------------
// Model-identity i18n keys — the ONE constructor of the catalog key and English
// default for text a user sees about a model element.
//
// A model fact (an aggregate's name, a field's label, an enum value's label) is
// keyed by WHAT it names, not by where it is shown:
//
//   <Ctx>.<Type>.<facet>[.<member>]
//
//   facet      what                         English default
//   name.one   the type's singular name      humanize(Type)
//   name.other the type's plural name        humanize(plural(Type))
//   field      a field / containment / input humanize(member)
//   op         an operation / create / ...   humanize(member)
//   value      an enum value                 humanize(member)
//   rule       a declared rule               humanize(member)
//   message    a declared error's message    humanize(Type)
//
// The fixed facet segment keeps a member from ever colliding with another
// facet (a field called `name` is `Task.field.name`, never `Task.name.*`).  A
// type declared outside any bounded context (a root-level enum or value object)
// files under the reserved `_system` namespace (`src/i18n/namespace.ts`).
//
// Every producer of these keys — the `label(…)` / `plural(…)` lowering, the
// scaffold macros' defaults, the walker's implicit sites (form labels, enum
// options, submit buttons) and the catalog extraction — goes through this
// module, so the key a page emits and the key the catalog carries cannot drift.
// ---------------------------------------------------------------------------

import { humanize, plural } from "./naming.js";

/** Namespace of a type declared outside every bounded context. */
export const SYSTEM_TEXT_NS = "_system";

/** The facet segment of an identity key. */
export type ModelTextFacet =
  | "name.one"
  | "name.other"
  | "field"
  | "op"
  | "value"
  | "rule"
  | "message";

/** What an identity key names: the owning context (`undefined` = system level),
 *  the type, the facet and — for a member facet — the member. */
export interface ModelTextRef {
  readonly ctx: string | undefined;
  readonly type: string;
  readonly facet: ModelTextFacet;
  readonly member?: string;
}

/** A resolved identity key with its English default. */
export interface ModelTextEntry {
  readonly key: string;
  readonly defaultText: string;
}

/** The facets that name a member of the type (and so carry `member`). */
const MEMBER_FACETS: ReadonlySet<ModelTextFacet> = new Set(["field", "op", "value", "rule"]);

/** The catalog key of a model fact: `<Ctx>.<Type>.<facet>[.<member>]`. */
export function modelTextKey(ref: ModelTextRef): string {
  const ns = ref.ctx ?? SYSTEM_TEXT_NS;
  const base = `${ns}.${ref.type}.${ref.facet}`;
  if (!MEMBER_FACETS.has(ref.facet)) return base;
  if (ref.member === undefined)
    throw new Error(`model-text-key: facet "${ref.facet}" needs a member`);
  return `${base}.${ref.member}`;
}

/** The English default of a model fact, derived from its identifiers. */
export function modelTextDefault(ref: ModelTextRef): string {
  switch (ref.facet) {
    case "name.one":
    case "message":
      return humanize(ref.type);
    case "name.other":
      return humanize(plural(ref.type));
    case "field":
    case "op":
    case "value":
    case "rule":
      return humanize(ref.member ?? "");
  }
}

/** Key and English default together — what an emitter or the catalog needs. */
export function modelTextEntry(ref: ModelTextRef): ModelTextEntry {
  return { key: modelTextKey(ref), defaultText: modelTextDefault(ref) };
}

/** True when `key` is a model-identity key (as opposed to a page-scoped
 *  content-hash key or a `chrome.*` key) — i.e. its third segment is a facet. */
export function isModelTextKey(key: string): boolean {
  const parts = key.split(".");
  if (parts.length < 3) return false;
  const facet = parts[2]!;
  if (facet === "name") return parts.length === 4 && (parts[3] === "one" || parts[3] === "other");
  if (facet === "message") return parts.length === 3;
  return MEMBER_FACETS.has(facet as ModelTextFacet) && parts.length === 4;
}

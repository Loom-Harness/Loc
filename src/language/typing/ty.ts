// The single typing pass's type representation (M-T5.44, design:
// docs/new-plan/missions/M-T5.44-single-typing-pass-design.md §D2–D3).
//
// `Ty` is AST-anchored like the language layer's `DddType`, because the LSP,
// go-to-definition and sensitivity all need the declaration rather than its
// name. It adds what only the IR layer could express before: unions, the
// `option` none, the generic carriers, and one `record` kind whose `shape`
// says what the record IS (aggregate, part, event, payload, workflow,
// projection, principal, resource handle, store). `unknown` is never a
// placeholder standing in for a type: it carries the reason no type exists.
//
// `toTypeIR` is the total projection onto the IR's name-keyed `TypeIR`, the
// only way lowering obtains a type once a construct family has cut over.

import type {
  GenericCtorName,
  IdValueType,
  PrimitiveName,
  SensitivityTags,
  TypeIR,
} from "../../ir/types/loom-ir.js";
import type {
  Aggregate,
  EntityPart,
  EnumDecl,
  EventDecl,
  PayloadDecl,
  Projection,
  Resource,
  Store,
  UserBlock,
  ValueObject,
  Workflow,
} from "../generated/ast.js";

/** What a `record` type is a record OF. */
export type RecordShape =
  | { of: "aggregate"; ref: Aggregate }
  | { of: "part"; ref: EntityPart }
  | { of: "event"; ref: EventDecl }
  | { of: "payload"; ref: PayloadDecl }
  | { of: "workflow"; ref: Workflow }
  | { of: "projection"; ref: Projection }
  /** The authentication principal (`currentUser`). `ref` is undefined when the
   *  compilation unit declares no `user { }` block. */
  | { of: "principal"; ref: UserBlock | undefined }
  /** An ambient resource handle (`files`, `jobs`, an api binding). */
  | { of: "resource"; ref: Resource }
  | { of: "store"; ref: Store };

/** Why a node has no type. Every `unknown` names one, so a census can count
 *  them by cause and #3133's gate can refuse the ones that reach codegen. */
export type UnknownCause =
  /** A name resolved to nothing in scope. */
  | "unresolved-name"
  /** The receiver kind has no member of that name. */
  | "unresolved-member"
  /** A type reference did not resolve (unlinked and not found by name). */
  | "unresolved-type"
  /** No typing rule covers this construct (a gap in this pass). */
  | "no-rule"
  /** A lambda typed without a context that gives its parameter a type. */
  | "contextual-lambda"
  /** Operands outside every operator rule (`string * bool`, `money * money`). */
  | "ill-typed-operands"
  /** A self- or mutually-recursive binding. */
  | "cycle"
  /** The node sits under a parse error. */
  | "parse-broken"
  /** The name denotes a declaration, not a value: the head of
   *  `Orders.getById(…)`, `Order.create(…)`, `Text(…)`, `Sales.Order.byId(…)`.
   *  The chain as a whole has a type; its head name has none. */
  | "not-a-value";

export type Ty = (
  | { kind: "primitive"; name: PrimitiveName }
  | { kind: "id"; target: Aggregate | EntityPart | Workflow | Projection | undefined; name: string }
  /** `candidates` (two or more) marks a bare enum value several enums at the
   *  same level declare: AMBIGUOUS until an expected type picks one (`ref` is
   *  then only the first candidate). Lowering keeps the ambiguity until a use
   *  site's expected type resolves it; unmigrated validators read it as
   *  `unknown`, as they always have. */
  | { kind: "enum"; ref: EnumDecl | undefined; name: string; candidates?: EnumDecl[] }
  | { kind: "valueobject"; ref: ValueObject | undefined; name: string }
  | { kind: "record"; shape: RecordShape }
  | { kind: "array"; element: Ty }
  | { kind: "optional"; inner: Ty }
  | { kind: "union"; variants: Ty[] }
  | { kind: "none" }
  | { kind: "generic"; ctor: GenericCtorName; arg: Ty }
  | { kind: "slot" }
  | { kind: "action"; arg?: Ty }
  | { kind: "any" }
  | { kind: "never" }
  | { kind: "unknown"; cause: UnknownCause }
) & { sensitivity?: SensitivityTags };

export const Ty = {
  prim: (name: PrimitiveName): Ty => ({ kind: "primitive", name }),
  array: (element: Ty): Ty => ({ kind: "array", element }),
  opt: (inner: Ty): Ty => ({ kind: "optional", inner }),
  record: (shape: RecordShape): Ty => ({ kind: "record", shape }),
  unknown: (cause: UnknownCause): Ty => ({ kind: "unknown", cause }),
  never: { kind: "never" } as Ty,
  none: { kind: "none" } as Ty,
  /** A union, flattened (nested unions fold into the parent) and NOT deduped —
   *  duplicate variants are an authoring error a validator reports, so they
   *  must survive (the IR's `canonicalUnion` rule). */
  union: (variants: Ty[]): Ty => {
    const flat: Ty[] = [];
    for (const v of variants) {
      if (v.kind === "union") flat.push(...v.variants);
      else flat.push(v);
    }
    return { kind: "union", variants: flat };
  },
};

export function isPrim(t: Ty, ...names: PrimitiveName[]): boolean {
  return t.kind === "primitive" && (names.length === 0 || names.includes(t.name));
}

/** The name a record shape carries in the IR's `entity{name}` marker. */
const PRINCIPAL_SHAPE_NAME = "__User__";
const RESOURCE_HANDLE_SHAPE_NAME = "__ResourceHandle";

function recordName(shape: RecordShape): string {
  switch (shape.of) {
    case "principal":
      return PRINCIPAL_SHAPE_NAME;
    case "resource":
      return RESOURCE_HANDLE_SHAPE_NAME;
    default:
      return shape.ref.name;
  }
}

/** Merge tag sets into one canonical (sorted, unique) set; undefined when clean. */
export function mergeTags(...sets: (SensitivityTags | undefined)[]): SensitivityTags | undefined {
  const all = new Set<string>();
  for (const s of sets) for (const t of s ?? []) all.add(t);
  return all.size === 0 ? undefined : [...all].sort();
}

export function withTags(t: Ty, tags: SensitivityTags | undefined): Ty {
  if (!tags || tags.length === 0) return t;
  return { ...t, sensitivity: mergeTags(t.sensitivity, tags) };
}

// ---------------------------------------------------------------------------
// The projection onto TypeIR (design §D3) — total, no lookups.
// ---------------------------------------------------------------------------

/** `unknown` projects to `primitive string` DURING CUTOVER ONLY — the IR's
 *  historical fallback, kept so emitted bytes stay identical; the count of
 *  nodes taking this arm is what the slice-4 ratchet pins shrink-only. */
export function toTypeIR(t: Ty): TypeIR {
  const s = t.sensitivity ? { sensitivity: t.sensitivity } : {};
  switch (t.kind) {
    case "primitive":
      return { kind: "primitive", name: t.name, ...s };
    case "id":
      return { kind: "id", targetName: t.name, valueType: "guid" as IdValueType, ...s };
    case "enum":
      return { kind: "enum", name: t.name, ...s };
    case "valueobject":
      return { kind: "valueobject", name: t.name, ...s };
    case "record":
      return { kind: "entity", name: recordName(t.shape), ...s };
    case "array":
      return { kind: "array", element: toTypeIR(t.element), ...s };
    case "optional":
      return { kind: "optional", inner: toTypeIR(t.inner), ...s };
    case "union":
      return { kind: "union", variants: t.variants.map(toTypeIR), ...s };
    case "none":
      return { kind: "none", ...s };
    case "generic":
      return { kind: "genericInstance", ctor: t.ctor, arg: toTypeIR(t.arg), ...s };
    case "slot":
      return { kind: "slot", ...s };
    case "action":
      return t.arg ? { kind: "action", arg: toTypeIR(t.arg), ...s } : { kind: "action", ...s };
    case "any":
    case "never":
    case "unknown":
      return { kind: "primitive", name: "string", ...s };
    default: {
      const _exhaustive: never = t;
      return _exhaustive;
    }
  }
}

/** A compact, comparable key for a type — the differential's (and #3125's)
 *  shared key space. Records key as `rec:<name>` whatever their shape (the IR
 *  cannot tell them apart); sensitivity is not part of the key. */
export function tyKey(t: Ty): string {
  switch (t.kind) {
    case "primitive":
      return `p:${t.name}`;
    case "id":
      return `id:${t.name}`;
    case "enum":
      return `enum:${t.name}`;
    case "valueobject":
      return `vo:${t.name}`;
    case "record":
      return `rec:${recordName(t.shape)}`;
    case "array":
      return `[${tyKey(t.element)}]`;
    case "optional":
      return `${tyKey(t.inner)}?`;
    case "union":
      return `union(${t.variants.map(tyKey).join("|")})`;
    case "generic":
      return `${t.ctor}<${tyKey(t.arg)}>`;
    case "action":
      return t.arg ? `action(${tyKey(t.arg)})` : "action";
    case "none":
    case "slot":
    case "any":
    case "never":
      return t.kind;
    case "unknown":
      return "unknown";
    default: {
      const _exhaustive: never = t;
      return _exhaustive;
    }
  }
}

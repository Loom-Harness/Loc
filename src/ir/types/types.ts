import type { OriginRef } from "./origin.js";

/** Base of every IR node that can point back at the `.ddd` source it came
 *  from (src/ir/types/origin.ts).  Lowering sets `origin` from the node's
 *  CST span or its macro call site, so an IR-phase diagnostic about the node
 *  prints `path:line:col` and `--sourcemap` maps generated regions back to
 *  it.  It is absent on nodes built without a source: enrichment-derived
 *  nodes, synthesized expressions, and hand-built IR in tests.  Consumers
 *  treat a missing origin as "no location", never as an error.  A type
 *  alias, not an interface: the IR unions intersect with it and stay
 *  assignable to `Record<string, unknown>`. */
export type Sourced = {
  origin?: OriginRef;
};

export type PrimitiveName =
  | "int"
  | "long"
  | "decimal"
  | "money"
  | "string"
  | "bool"
  /** A CALENDAR date — year, month, day; no time-of-day, no offset.  Wire
   *  form is the ISO-8601 calendar date `"2026-01-01"`; Postgres `date`.
   *  Distinct from `datetime` so a value west of UTC never shifts a day. */
  | "date"
  | "datetime"
  | "guid"
  /** Opaque JSON blob — interior is not modelled by Loom.  Maps to
   *  JSONB / jsonb / `Map` per backend; a leaf in `wireShape` (never
   *  expanded or structurally diffed).  See
   *  `https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/document-and-json-hierarchies.md` (Option 1,
   *  D-DOCUMENT-AXIS). */
  | "json"
  /** A file attachment — a leaf primitive (like `json`), passive/wire-only:
   *  NO arithmetic, operators, or expression semantics.  Its wire shape is a
   *  FIXED typed object `{ url: string, key: string, contentType: string,
   *  size: int }` (a `FileRef`), and it is stored as a JSONB / jsonb column
   *  exactly like `json` (never expanded or structurally diffed in
   *  `wireShape`).  The bytes themselves live in object storage (an
   *  `objectStore` data source — `s3` / `localDisk`); the column carries only
   *  the reference.  A File-bearing aggregate requires its host deployable to
   *  bind an `objectStore` (`loom.file-field-needs-object-storage`). */
  | "File"
  /** An ABSOLUTE span of time (A5 temporal, https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/plans/stdlib.md) — fixed
   *  millisecond width per unit, so it renders uniformly on every backend.
   *  EXPRESSION-ONLY: not in the grammar's `PrimitiveType`
   *  rule, so it can never appear in field / param / wire position — it only
   *  arises from the `days(n)`/`hours(n)`/`minutes(n)` constructors and the
   *  temporal arithmetic rules (`datetime - datetime`, `duration ±
   *  duration`, `duration * int`).  Calendar-relative offsets (`months`,
   *  `years`) are deliberately excluded — no fixed width, so they would
   *  break the uniform translation.  Deliberately NOT in `PRIMITIVES` below
   *  (that list feeds user-facing type pickers; a type you cannot write does
   *  not belong in one). */
  | "duration";

/** Canonical ordering for UI surfaces that enumerate primitives —
 *  playground type picker, docs tables, completion provider, future
 *  tooling.  Keeps related primitives adjacent (numeric block,
 *  money-after-decimal so the precision contrast is visible, scalars
 *  last) so the dropdown reads top-to-bottom by "most user-facing
 *  first."  Sourced from here, not duplicated per-consumer, so a
 *  future primitive addition shows up everywhere without touching
 *  N call sites. */
export const PRIMITIVES: readonly PrimitiveName[] = [
  "string",
  "int",
  "long",
  "decimal",
  "money",
  "bool",
  "date",
  "datetime",
  "guid",
  "json",
  "File",
] as const;

/** Information-flow sensitivity tags carried by a value's type.  See
 * `https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/sensitivity-and-compliance.md`.  Mirror of
 * `SensitivityTags` in `src/language/type-system.ts`; kept as a sorted,
 * unique `readonly string[]` so the IR remains JSON-serialisable for
 * `.loom/wire-spec.json`. */
export type SensitivityTags = readonly string[];

/** Base of every `TypeIR` arm: the information-flow sensitivity tags a
 *  value's type carries (sorted, unique).  Absent when the type carries no
 *  tags — the common case; consumers read absent as "no tags", never as an
 *  error.  A type alias, like `Sourced`, so `TypeIR` stays assignable to
 *  `Record<string, unknown>`. */
export type Sensitive = {
  sensitivity?: SensitivityTags;
};

/** Canonical type-discriminated union for every type that appears in
 *  the IR — primitives, ids, enums, value objects, entities, arrays,
 *  optionals, and the UI-only `slot` marker.
 *
 *  Switch-dispatch convention for the `"slot"` arm: sites that consume
 *  a type as wire / schema / source-code (backend renderers, migrations
 *  builder, wire-spec, OpenAPI schema, Zod schema) MUST `throw` — the
 *  validator (`checkSlotTypePosition`) guarantees `slot` never reaches
 *  a storage / wire position, so encountering it there is a bug.
 *  Sites that produce display strings (mermaid, loomsnap,
 *  structural-print, playground inspector) return the literal
 *  `"slot"` so editors and diagnostics still read sensibly when a
 *  slot-typed component param surfaces in a label.  React's
 *  `propType` recognises the variant and emits `ReactNode`.
 *
 *  The `"id"` arm is an `X id` reference to an aggregate or entity part.
 *  Every identity is a guid — there is no per-aggregate id value type, so
 *  backends spell an id's underlying scalar (column, wire format, CLR/Java
 *  type) as their guid form unconditionally. */
export type TypeIR = (
  | { kind: "primitive"; name: PrimitiveName }
  | { kind: "id"; targetName: string }
  | { kind: "enum"; name: string }
  | { kind: "valueobject"; name: string }
  | { kind: "entity"; name: string }
  | { kind: "array"; element: TypeIR }
  | { kind: "optional"; inner: TypeIR }
  /** Carrier-bounded generic payload instantiation — `customer paged`,
   *  `event envelope` (payload-transport-layer.md, P3).  `ctor` names a
   *  blessed stdlib shape (see `src/ir/stdlib/generics.ts`); `arg` is the
   *  single carrier type argument.  Nesting is left-associative postfix:
   *  `string envelope paged` lowers to
   *  `genericInstance(paged, genericInstance(envelope, primitive string))`.
   *  P3a represents this in the IR but blocks emission at IR-validate; P3b
   *  monomorphizes each distinct instance into a concrete payload. */
  | { kind: "genericInstance"; ctor: GenericCtorName; arg: TypeIR }
  /** Discriminated union (payload-transport-layer.md, P4) — both the named
   *  form (`payload Foo = A | B`) and the anonymous `or` form (`A or B` in any
   *  type position) lower to this.  `variants` is the source-order variant
   *  list, each a distinct carrier type; identity is structural on the
   *  variant *set* (associative-commutative — see `unionVariantKey`), so
   *  `A or B` and `B or A` are the same type.  The wire form is tagged by a
   *  per-variant discriminator (the `type` field — see P4 emission); P4a
   *  represents this in the IR but blocks emission at IR-validate. */
  | { kind: "union"; variants: TypeIR[] }
  /** The unit variant of an `option` (payload-transport-layer.md, P4):
   *  `T option` lowers to `union[T, none]`.  Carries no payload; on the wire
   *  it is the tagged-empty variant.  A blessed nullary marker (like `slot`),
   *  not an author-writable type — it only ever appears inside an option's
   *  union. */
  | { kind: "none" }
  /** Element-shaped param marker — only valid on a `component`'s
   *  parameter list.  Values flow as JSX (any walker expression) from
   *  the caller's scope into the component body; a bare ref to a
   *  slot-typed param renders the caller's expression at that
   *  position.  See `docs/page-metamodel.md`. */
  | { kind: "slot" }
  /** Function-valued param marker — `slot`'s behavioural sibling
   *  (extern-component-escape-hatch.md, Tier 2).  Only valid on a
   *  `component`'s parameter list; the caller passes a (block-body)
   *  lambda walked + hoisted in the caller's scope, and the React
   *  props type gains `(arg: TWire) => void`.  `arg` is the declared
   *  callback argument type; undefined for a bare zero-arg `action`. */
  | { kind: "action"; arg?: TypeIR }
) &
  Sensitive;

/** The blessed closed set of generic-payload **record** carriers.  Kept in
 *  lockstep with the record arms of the `GenericCtor` grammar rule and the
 *  stdlib registry in `src/ir/stdlib/generics.ts`.  The grammar's third ctor,
 *  `option`, is a *union* carrier: `T option` lowers straight to
 *  `union[T, none]` rather than a `genericInstance`, so it never appears here.
 *
 *  `paged` / `envelope` are AUTHOR-WRITTEN (`customer paged`) and monomorphize
 *  to a named `PayloadIR` record.  `provenanced` is the odd one out: it has no
 *  grammar arm at all — nobody writes `int provenanced` as a *type*, they write
 *  `total: int provenanced` as a field MODIFIER — and the enrichment pass
 *  synthesizes the instance into `wireShape` from `FieldIR.provenanced`
 *  (`wireTypeForField`, `src/ir/enrich/wire-projection.ts`).  It is also
 *  rendered STRUCTURALLY (an inline `{ value, lineage }` object) rather than
 *  monomorphized to a named DTO, so it never reaches
 *  `monomorphizeGenericInstances`. */
export type GenericCtorName = "paged" | "provenanced";

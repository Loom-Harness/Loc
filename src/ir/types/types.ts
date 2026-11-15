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

/** The sensitivity tags a property declares with `sensitive(...)` — sorted,
 *  unique, JSON-serialisable.  A field fact (`FieldIR.sensitivity`), never a
 *  type fact: no `TypeIR` carries tags, so the typing pass and every type
 *  comparison stay tag-free, and the one consumer (the redacted `inspect`)
 *  reads the field. */
export type SensitivityTags = readonly string[];

/** The payload-family discriminator.  `payload` is the umbrella; `event` /
 *  `command` / `query` / `response` / `error` are subtypes carrying the same
 *  structural-record wire contract.  `event` also has its own declaration
 *  surface (`EventDecl`), projected into the unified `payloads` view at
 *  lowering time; the rest parse via `PayloadDecl`. */
export type PayloadKind = "payload" | "event" | "command" | "query" | "response" | "error";

/** Which declaration an `entity` `TypeIR` names.
 *  - `aggregate` / `part` — an aggregate root or one of its entity parts;
 *  - a `PayloadKind` — a payload-family record or named union;
 *  - `workflow` — a workflow's state record (`create(…): Fulfillment`);
 *  - `projection` — a projection row;
 *  - `principal` — the authentication principal (`currentUser`);
 *  - `synthetic` — a compiler-made shape with no declaration (a resource
 *    handle, a store, a test client's request / tagged / created record, the
 *    audit-history change row). */
export type EntityDeclKind =
  | "aggregate"
  | "part"
  | "workflow"
  | "projection"
  | PayloadKind
  | "principal"
  | "synthetic";

const PAYLOAD_KINDS: ReadonlySet<EntityDeclKind> = new Set<PayloadKind>([
  "payload",
  "event",
  "command",
  "query",
  "response",
  "error",
]);

/** True when an `entity` names a payload-family record (any `PayloadKind`). */
export function isPayloadDeclKind(k: EntityDeclKind): k is PayloadKind {
  return PAYLOAD_KINDS.has(k);
}

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
export type TypeIR =
  | { kind: "primitive"; name: PrimitiveName }
  | { kind: "id"; targetName: string }
  | { kind: "enum"; name: string }
  | { kind: "valueobject"; name: string }
  /** A named record: an aggregate, an entity part, a workflow's state, a
   *  projection row, a payload-family record (`payload` / `event` /
   *  `command` / `query` / `response` / `error`), the authentication
   *  principal, or a compiler-synthesized shape.  `declKind` says which,
   *  resolved once in lowering, so a consumer switches on it instead of
   *  looking the name up again. */
  | { kind: "entity"; name: string; declKind: EntityDeclKind }
  | { kind: "array"; element: TypeIR }
  | { kind: "optional"; inner: TypeIR }
  /** Carrier-bounded generic payload instantiation — `Customer paged`.
   *  `ctor` names a blessed stdlib shape (see `src/ir/stdlib/generics.ts`);
   *  `arg` is the single carrier type argument.  Enrichment monomorphizes each
   *  distinct `paged` instance into a concrete payload the backends emit as a
   *  DTO; `provenanced` renders structurally. */
  | { kind: "genericInstance"; ctor: GenericCtorName; arg: TypeIR }
  /** Discriminated union (payload-transport-layer.md, P4) — both the named
   *  form (`payload Foo = A | B`) and the anonymous `or` form (`A or B` in any
   *  type position) lower to this.  `variants` is the source-order variant
   *  list, each a distinct carrier type; identity is structural on the
   *  variant *set* (associative-commutative — see `unionVariantKey`), so
   *  `A or B` and `B or A` are the same type.  The wire form is tagged by a
   *  per-variant discriminator (the `type` field) shared by every backend
   *  through `src/generator/_payload/union-wire.ts`. */
  | { kind: "union"; variants: TypeIR[] }
  /** The absent value.  `T option` (the deprecated spelling of `T?`) folds
   *  `union[T, none]`, which `canonicalUnion` collapses to `optional(T)`, so
   *  `none` survives only as a variant of a union of three or more.  A blessed
   *  nullary marker (like `slot`), not an author-writable type. */
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
  | { kind: "action"; arg?: TypeIR };

/** The blessed closed set of generic-payload **record** carriers, kept in
 *  lockstep with the stdlib registry in `src/ir/stdlib/generics.ts`.  The
 *  grammar's other ctors are not carriers: `T option` is the deprecated
 *  spelling of `T?`, and `T envelope` is refused and lowers as `T`.
 *
 *  `paged` is AUTHOR-WRITTEN (`Customer paged`) and monomorphizes to a named
 *  `PayloadIR` record.  `provenanced` is the odd one out: it has no
 *  grammar arm at all — nobody writes `int provenanced` as a *type*, they write
 *  `total: int provenanced` as a field MODIFIER — and the instance is
 *  synthesized onto a response row from `FieldIR.provenanced`
 *  (`responseWireFor`, `src/ir/util/response-wire.ts`).  It is also
 *  rendered STRUCTURALLY (an inline `{ value, lineage }` object) rather than
 *  monomorphized to a named DTO, so it never reaches
 *  `monomorphizeGenericInstances`. */
export type GenericCtorName = "paged" | "provenanced";

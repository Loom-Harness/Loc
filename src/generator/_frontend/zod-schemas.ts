// ---------------------------------------------------------------------------
// Frontend zod-schema emission — the framework-neutral half of the
// per-aggregate API module builders.  Shared by the React and Svelte
// generators: both emit byte-identical zod request/response/VO/enum/
// union schemas (the wire contract is framework-independent); only
// the data-fetching layer around them differs (React Query hooks vs
// svelte-query factories).  Extracted verbatim from
// src/generator/react/api-builder.ts.
// ---------------------------------------------------------------------------

import type { FormTextKind } from "../../ir/plan/form-text.js";
import { unionInstanceName } from "../../ir/stdlib/unions.js";
import type {
  AggregateIR,
  BoundedContextIR,
  EnumIR,
  InvariantIR,
  OperationIR,
  TypeIR,
  ValueObjectIR,
} from "../../ir/types/loom-ir.js";
import {
  peelCollection,
  peelNullable,
  type WirePrimitive,
  wireTypeInfo,
} from "../../ir/types/wire-types.js";
import {
  AUDIT_ENTRY_TYPE,
  AUDIT_FIELD_CHANGE_TYPE,
  auditEntryWireShape,
  auditFieldChangeWireShape,
} from "../../ir/util/audit-wire.js";
import type { ClassifyContext, SingleFieldPattern } from "../../ir/util/invariant-classify.js";
import {
  collectReachableTypes,
  enumPool,
  orderValueObjectsByDependency,
  valueObjectPool,
} from "../../ir/util/reachable-types.js";
import { UUID_WIRE_REGEX_LITERAL } from "../../util/uuid-wire.js";
import { PROVENANCED_REQUEST_ERROR, provenancedEntries } from "../_payload/provenanced-wire.js";
import {
  chainSingleFieldNative,
  orderSingleFieldPatterns,
  refineClauseFor,
  takeSingleFieldChain,
} from "../zod-refine.js";
import { typeBlankBlocks, typeFormText } from "./form-spec.js";

// ---------------------------------------------------------------------------
// Schema emission helpers
// ---------------------------------------------------------------------------

export function emitEnumSchema(e: {
  readonly name: string;
  readonly values: readonly string[];
}): string[] {
  const values = e.values.map((v) => `"${v}"`).join(", ");
  return [`export const ${e.name}Schema = z.enum([${values}]);`];
}

/** What a `<Vo>Schema` renders from: the value object's fields and the rules
 *  a client validates it against. */
export interface SchemaSource {
  readonly name: string;
  readonly fields: readonly { readonly name: string; readonly type: TypeIR }[];
  readonly invariants: readonly Pick<InvariantIR, "expr" | "guard" | "message">[];
}

export function emitValueObjectSchema(vo: SchemaSource): string[] {
  return emitObjectWithRefines(
    `${vo.name}Schema`,
    vo.fields.map((f) => ({
      name: f.name,
      base: valueObjectFieldZod(f.type),
      optional: isOptionalRequest(f.type),
    })),
    // The refine renderer reads `expr` / `guard` / `message` only.
    vo.invariants.map((inv) => ({ ...inv, source: "" })),
    new Set(vo.fields.map((f) => f.name)),
  );
}

// ---------------------------------------------------------------------------
// `z.object({ ... }).refine(...)` emitter shared by request / VO schemas.
//
// Splits invariants into two buckets:
//   1. recognised single-field shapes — absorbed into the inner field's
//      zod chain (`z.number().min(N)`, `z.string().length(N)`, etc.) so
//      the published JSON-Schema body shape stays correct.
//   2. everything else — emitted as `.refine((data) => ..., { path,
//      message })` chains on the object schema; RHF reads `path` to
//      surface the error inline next to the right input.
//
// Used by all three wire-validator emission sites (Create<Agg>Request,
// <Op>Request, <VO>Schema).  Response schemas don't get refines:
// responses come from a server that already enforced invariants.
// ---------------------------------------------------------------------------
export function emitObjectWithRefines(
  exportName: string,
  /** `optional`: the field may be absent, and its rules skip the absent value. */
  fields: { name: string; base: string; optional?: boolean }[],
  invariants: InvariantIR[],
  available: ReadonlySet<string>,
): string[] {
  const ctx: ClassifyContext = { available };
  const chainByField = new Map<string, SingleFieldPattern[]>();
  const remaining: InvariantIR[] = [];
  for (const inv of invariants) {
    const taken = inv.message ? null : takeSingleFieldChain(inv, ctx);
    if (taken) {
      const list = chainByField.get(taken.field) ?? [];
      list.push(taken.pattern);
      chainByField.set(taken.field, list);
    } else {
      remaining.push(inv);
    }
  }
  const refines = remaining
    .map((inv) => refineClauseFor(inv, ctx))
    .filter((s): s is string => s !== null);

  const out: string[] = [];
  out.push(`export const ${exportName} = z.object({`);
  for (const f of fields) {
    let schema = f.base;
    const patterns = chainByField.get(f.name);
    if (patterns) {
      for (const p of orderSingleFieldPatterns(patterns))
        schema = chainSingleFieldNative(schema, p, f.name, !!f.optional);
    }
    out.push(`  ${f.name}: ${schema},`);
  }
  out.push(`})${refines.join("")};`);
  return out;
}

/** Operation preconditions are the wire-translatable rules for an
 *  `<Op>Request`.  Lift each `precondition <expr>` statement to an
 *  `InvariantIR` so the same classification + refine pipeline
 *  handles it.  Other statement kinds (assigns / emits / etc.) don't
 *  contribute to wire validation. */
export function preconditionsAsInvariants(op: OperationIR): InvariantIR[] {
  const out: InvariantIR[] = [];
  for (const s of op.statements) {
    if (s.kind === "precondition") {
      out.push({ expr: s.expr, source: s.source, message: s.message });
    }
  }
  return out;
}

/** The zod name of the entity-history LIST response — what `history(id)`
 *  parses.  Exported so every client emitter names the same symbol. */
export const AUDIT_ENTRY_LIST_TYPE = `${AUDIT_ENTRY_TYPE}ListResponse`;

/** Client-side DTOs for the entity-history read (`GET /<agg>/{id}/history`,
 *  docs/audit.md).
 *
 *  Derived from `auditEntryWireShape()` / `auditFieldChangeWireShape()` — the
 *  same platform-neutral field list the backends serve — so the client cannot
 *  drift from the wire by hand-transcription.  ONE exception, and it is a
 *  narrowing not a divergence: the entry's `changes` is typed `json[]` in the
 *  wire shape because `TypeIR` has no nested-record leaf to say
 *  "array of AuditFieldChange" with, and a `z.array(z.unknown())` here would
 *  make `__c.field` an error in every frontend's `Timeline`.  The client
 *  substitutes the field-change schema for that one element type; the KEY SET
 *  is still the wire shape's.
 *
 *  Emitted per aggregate module (like every other DTO here) rather than into
 *  the shared lib: the modules are separate files, so the duplicate export
 *  costs nothing, and an aggregate with no audit trail emits neither schema. */
export function emitAuditEntrySchemas(): string[] {
  const out: string[] = [];
  out.push(`export const ${AUDIT_FIELD_CHANGE_TYPE} = z.object({`);
  for (const f of auditFieldChangeWireShape()) {
    out.push(`  ${f.name}: ${zodForResponse(f.type, f.optional)},`);
  }
  out.push(`});`);
  out.push(`export type ${AUDIT_FIELD_CHANGE_TYPE} = z.infer<typeof ${AUDIT_FIELD_CHANGE_TYPE}>;`);
  out.push(`export const ${AUDIT_ENTRY_TYPE} = z.object({`);
  for (const f of auditEntryWireShape()) {
    const zod =
      f.name === "changes"
        ? `z.array(${AUDIT_FIELD_CHANGE_TYPE})`
        : zodForResponse(f.type, f.optional);
    out.push(`  ${f.name}: ${zod},`);
  }
  out.push(`});`);
  out.push(`export type ${AUDIT_ENTRY_TYPE} = z.infer<typeof ${AUDIT_ENTRY_TYPE}>;`);
  out.push(`export const ${AUDIT_ENTRY_LIST_TYPE} = z.array(${AUDIT_ENTRY_TYPE});`);
  out.push(`export type ${AUDIT_ENTRY_LIST_TYPE} = z.infer<typeof ${AUDIT_ENTRY_LIST_TYPE}>;`);
  return out;
}

// ---------------------------------------------------------------------------
// Type → Zod helpers
// ---------------------------------------------------------------------------

// Form inputs hand back native JS types where Mantine has a typed
// primitive (number, boolean), and ISO strings for datetime — we use a
// plain <input type="datetime-local"> so values are easy to fill from
// Playwright tests.  JSON.stringify passes numbers and strings through
// untouched, so the request map is the same as response on most
// primitives — only money diverges (`moneySchema` inbound for the
// decimal.js parse chain; `moneySchema` outbound too because the
// response form already produces decimal-string JSON).

const REQUEST_PRIMITIVE: Record<WirePrimitive, string> = {
  // The parsed-text kinds: a form holds the typed text, and the schema parses
  // it by the form text rule (`src/ir/plan/form-text.ts`).
  int: formTextZod("int", false),
  long: formTextZod("long", false),
  decimal: formTextZod("decimal", false),
  money: formTextZod("money", false),
  string: "z.string()",
  bool: "z.boolean()",
  datetime: "z.string()",
  date: "z.string()",
  guid: "z.string()",
  json: "z.unknown()",
  // A `File` REQUEST field is `.nullable()` — a form starts with no file (a
  // null FileRef) and the user uploads to fill it (mirrors api-module.ts).
  // The RESPONSE File stays non-null: the server always returns a resolved ref.
  File: "z.object({ url: z.string(), key: z.string(), contentType: z.string(), size: z.number().int() }).nullable()",
  // A request never carries the history entry record (`loom.audit-entry-position`).
  AuditEntry: "z.never()",
};

const RESPONSE_PRIMITIVE: Record<WirePrimitive, string> = {
  int: "z.number().int()",
  long: "z.number().int()",
  decimal: "z.number()",
  money: "moneySchema",
  string: "z.string()",
  bool: "z.boolean()",
  datetime: "z.string()",
  date: "z.string()",
  guid: "z.string()",
  json: "z.unknown()",
  File: "z.object({ url: z.string(), key: z.string(), contentType: z.string(), size: z.number().int() })",
  // The entry schema `emitAuditEntrySchemas` defines.
  AuditEntry: AUDIT_ENTRY_TYPE,
};

/** The zod shape of a `Provenanced<T>` wire carrier (M-T6.12) — built from the
 *  carrier's member list so the key names and their order are the shape's, not
 *  this emitter's.  `lineage` is the shared `provLineageSchema` (`../lib/
 *  schemas`), nullish because a never-written field carries no lineage.
 *
 *  ```ts
 *  // total: int provenanced   →
 *  total: z.object({ value: z.number().int(), lineage: provLineageSchema.nullish() }),
 *  ```
 */
export function provenancedZod(valueZod: string): string {
  const members = provenancedEntries(valueZod, "provLineageSchema.nullish()")
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  return `z.object({ ${members} })`;
}

/** The request schema of a parsed-text kind: `formNumber("int")` /
 *  `formNumberOpt("int")` from `lib/form-text`, `moneyText` / `moneyTextOpt`
 *  from `lib/schemas`.  The optional one reads a blank as `null` (P-UI-6). */
export function formTextZod(kind: FormTextKind, optional: boolean): string {
  if (kind === "money") return optional ? "moneyTextOpt" : "moneyText";
  return `${optional ? "formNumberOpt" : "formNumber"}(${JSON.stringify(kind)})`;
}

/** A request field the client may omit: its rules skip the absent value. */
export function isOptionalRequest(t: TypeIR): boolean {
  return wireTypeInfo(t, "request").isNullable;
}

/** The parsed-text kind of a request type, optional wrapper peeled. */
function parsedTextKind(t: TypeIR): FormTextKind | undefined {
  return wireTypeInfo(t, "request").isCollection ? undefined : typeFormText(t);
}

export function zodForRequest(t: TypeIR): string {
  const info = wireTypeInfo(t, "request");
  if (info.isNullable) {
    const inner = peelNullable(t);
    const text = parsedTextKind(inner);
    if (text) return formTextZod(text, true);
    const base = `${zodForRequest(inner)}.nullish()`;
    // A cleared optional text-like input (a text box, a date, a picker or an
    // enum select left on "") means ABSENT: the form submits `null`, never
    // `""`.  The empty string is tried first, so an id's uuid pattern and an
    // enum's member list never see it.  Input and output types are unchanged —
    // `""` is already a string, and `null` is already allowed.
    return emptyIsAbsent(inner) ? `z.literal("").transform(() => null).or(${base})` : base;
  }
  if (info.isCollection) {
    const element = peelCollection(t);
    const text = parsedTextKind(element);
    // A list of numbers is refused at its field, not at an item no input shows.
    if (text && text !== "money") return `formNumberList(${JSON.stringify(text)})`;
    return `z.array(${zodForRequest(element)})`;
  }
  switch (info.refKind) {
    case "primitive":
      return REQUEST_PRIMITIVE[info.primitive!];
    case "id":
      // Mirrors the server's request-side rule (`zodFor` in the Hono
      // routes-builder): a reference is a uuid on the wire, so the FORM
      // validator says so too and the caller is told at the field instead of
      // by a server error.
      //
      // The mirror is the POINT, so it tracks the same shared shape the
      // backends validate (`UUID_WIRE_PATTERN`) rather than restating one.  A
      // form that refused an id the server accepts would report a field error
      // for a value that is in fact valid — the client-side twin of the
      // node/python 422-vs-404 split this constant was extracted to end.
      //
      // The pattern refuses the blank too, which is how a required reference
      // with nothing picked holds the submit (`formBlankBlocks`).
      return typeBlankBlocks(t) ? `z.string().regex(${UUID_WIRE_REGEX_LITERAL})` : "z.string()";
    case "enum":
    case "valueObject":
      return `${info.base}Schema`;
    case "entity":
      return "z.unknown()";
    case "provenanced":
      // Unreachable by construction: the carrier is stamped onto the RESPONSE
      // wire rows only (`responseWireFor`); a create/update input takes the
      // bare `T` — a caller supplies a value, never a lineage.
      throw new Error(PROVENANCED_REQUEST_ERROR);
  }
}

/** One value-object field's schema.  A value object is a form's nested value
 *  too (a sub-form, a dynamic row), so an optional text-like field reads an
 *  empty input as absent, exactly as a top-level request field does
 *  ({@link zodForRequest}); the server never sends `""` for an absent id, enum
 *  or date, so a read is unaffected. */
function valueObjectFieldZod(t: TypeIR): string {
  // A parsed-text kind holds the typed text in a form; a read's number or
  // money string parses through the same rule unchanged.
  const info = wireTypeInfo(t, "request");
  const text = parsedTextKind(info.isNullable ? peelNullable(t) : t);
  if (text) return formTextZod(text, info.isNullable);
  const base = zodForResponseInner(t);
  if (!info.isNullable) return base;
  return emptyIsAbsent(peelNullable(t)) ? `z.literal("").transform(() => null).or(${base})` : base;
}

/** An optional request field whose form input is text-like, so an empty
 *  input reads as absent. */
function emptyIsAbsent(t: TypeIR): boolean {
  const info = wireTypeInfo(t, "request");
  if (info.isCollection || info.isNullable) return false;
  if (info.refKind === "id" || info.refKind === "enum") return true;
  if (info.refKind !== "primitive") return false;
  const p = info.primitive;
  return p === "string" || p === "date" || p === "datetime" || p === "guid";
}

export function zodForResponse(t: TypeIR, optional: boolean): string {
  const z = zodForResponseInner(t);
  return optional ? `${z}.nullish()` : z;
}

export function zodForResponseInner(t: TypeIR): string {
  // Inline discriminated union (`A or B`) → its emitted `<Name>Schema` (the
  // schema is emitted per find return that uses it).
  if (t.kind === "union") return unionInstanceName(t.variants);
  const info = wireTypeInfo(t, "response");
  if (info.isNullable) return `${zodForResponseInner(peelNullable(t))}.nullish()`;
  if (info.isCollection) return `z.array(${zodForResponseInner(peelCollection(t))})`;
  switch (info.refKind) {
    case "primitive":
      return RESPONSE_PRIMITIVE[info.primitive!];
    case "id":
      return "z.string()";
    case "enum":
    case "valueObject":
      return `${info.base}Schema`;
    case "entity":
      return `${info.base}Response`;
    case "provenanced":
      return provenancedZod(zodForResponseInner(info.carried!));
  }
}

// Collect every value object and enum whose schema this aggregate's api
// module must declare.  Traversal is TRANSITIVE through value-object
// fields: an emitted `<VO>Schema = z.object({...})` references the schema
// of each field's type (`country: CountrySchema`), so a VO reached only
// through another VO — e.g. `Address.country` pulling in the `Country`
// enum — must be emitted too.  Without the closure those references
// resolve to undeclared variables at bundle time ("Can't find variable:
// CountrySchema").
export function collectUsedTypes(
  agg: AggregateIR,
  repo: { readonly finds: readonly { readonly params: readonly { type: TypeIR }[] }[] } | undefined,
  ctx: BoundedContextIR,
): { valueObjects: ValueObjectIR[]; enums: EnumIR[] } {
  const seeds = function* (): Generator<TypeIR> {
    for (const f of agg.fields) yield f.type;
    for (const d of agg.derived) yield d.type;
    for (const op of agg.operations) for (const p of op.params) yield p.type;
    for (const f of repo?.finds ?? []) for (const p of f.params) yield p.type;
    for (const part of agg.parts) {
      for (const f of part.fields) yield f.type;
      for (const d of part.derived) yield d.type;
    }
  };
  // POOL, not emission list: a `valueobject` declared in a SIBLING context and
  // referenced from this one is legal, and the per-aggregate module that
  // references it imports nothing from the declaring context's module — so the
  // schema has to be declared HERE or the bundle carries an undefined
  // `<Vo>Schema`.  The reachability filter below still keeps only what the
  // aggregate's own surface names.
  const pool = valueObjectPool(ctx);
  const { valueObjects, enums } = collectReachableTypes(seeds(), pool);
  return {
    // DEPENDENCY order, not pool order: these become `const <Vo>Schema = …`
    // bindings in one module, and a VO nested inside another VO must be
    // declared first or the reference is a temporal dead zone (TS2448 /
    // TS2454, and the react / vue / svelte builds fail).  Pool order put
    // CONTEXT-LOCAL value objects ahead of root-level (shared-kernel) ones,
    // which inverts exactly the shared-kernel-inside-a-local-VO case.
    valueObjects: orderValueObjectsByDependency(pool.filter((v) => valueObjects.has(v.name))),
    // `enumPool`, not `ctx.enums` — the same sibling-aware resolution the
    // value objects above get.  This list MINTS the module's
    // `const <E>Schema = z.enum([...])`, so filtering the context-local list
    // dropped the declaration of a cross-context enum while the schemas below
    // kept referencing it.  (The backend twin of this landed in #3033; the
    // pool it needs only exists on `main` as of that merge.)
    enums: enumPool(ctx).filter((e) => enums.has(e.name)),
  };
}

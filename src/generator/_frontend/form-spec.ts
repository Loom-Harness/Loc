import type { BoundedContextIR, ExprIR, OperationIR, TypeIR } from "../../ir/types/loom-ir.js";
import { operationFormParams } from "../../ir/util/op-gates.js";
import { isPagedAllRead } from "../../ir/util/paged-all.js";
import {
  type AnyTypeScope,
  enumPool,
  findValueObjectInScope,
} from "../../ir/util/reachable-types.js";

/** The closed set of input shapes a scaffolded form renders.  Optionality is a
 *  separate axis ({@link FormFieldSpec.optional}) except where it changes the
 *  input itself: an optional value object is an opt-in group and an optional
 *  reference is a clearable picker, so those are kinds of their own. */
export const FORM_FIELD_KINDS = [
  "string",
  "int",
  "decimal",
  "money",
  "bool",
  "date",
  "datetime",
  "file",
  "enum",
  "ref",
  "optionalRef",
  "valueObject",
  "optionalValueObject",
  "scalarArray",
  "enumArray",
  "refArray",
  "objectArray",
] as const;

export type FormFieldKind = (typeof FORM_FIELD_KINDS)[number];

/** Scalar element kinds a `scalarArray` carries. */
export type FormScalarKind = "string" | "int" | "decimal" | "money" | "bool" | "date" | "datetime";

/** What the form submits for a field the user left untouched or cleared.
 *  - `required` — the field has no absent state: an untouched input submits its
 *    {@link FormFieldSpec.zero}, a cleared one its kind's zero too (a cleared
 *    number is `0`), and the server decides whether that value is acceptable.
 *    The client never holds the submit because a required input is blank,
 *    except where there is no value to send at all ({@link formBlankBlocks}).
 *  - `null` — an optional field: an empty input, an unset picker, or a disabled
 *    optional group submits `null`, never `""` / `0` / a zero object.
 *  - `emptyArray` — a collection: no rows submits `[]`. */
export type FormAbsence = "required" | "null" | "emptyArray";

/** Where a field's initial value comes from.
 *  - `record` — an update / operation form opened on a loaded record seeds the
 *    field from the record's same-named, same-typed field (`field`).  A
 *    `provenanced` record field reads as its wire carrier `{ value, lineage }`,
 *    so `carrier` says the value is the carrier's `value`.
 *  - `default` — the declared `= <expr>` default (`expr`), when the target can
 *    evaluate it client-side; otherwise the target falls back to `zero`.
 *  - `zero` — the field's {@link FormFieldSpec.zero}. */
export type FormPrefill =
  | { from: "record"; field: string; carrier?: true }
  | { from: "default"; expr: ExprIR }
  | { from: "zero" };

/** A wire value, as a form field's zero: what an untouched field submits. */
export type FormZero =
  | null
  | string
  | number
  | boolean
  | readonly FormZero[]
  | { readonly [key: string]: FormZero };

/** Where a reference picker reads its options. */
export interface FormPickerSource {
  /** The referenced aggregate. */
  target: string;
  /** The target declares `derived display`, so options carry a label; without
   *  one the picker degrades to a free-text id input. */
  hasDisplay: boolean;
  /** The target's list read is a paged envelope (`{ items, … }`) rather than a
   *  bare array. */
  paged: boolean;
}

export interface FormFieldSpec {
  /** Wire key (the leaf name). */
  name: string;
  /** Dotted path from the form root (`vehicle.vin`). */
  path: string;
  kind: FormFieldKind;
  /** The declared type, optional wrapper included. */
  type: TypeIR;
  optional: boolean;
  absence: FormAbsence;
  /** The wire value the field submits when the user leaves it untouched, and
   *  the value its input starts on when nothing else seeds it: `""` for text,
   *  dates and a reference, `0` for a number, `"0"` for money (a wire string),
   *  `false` for a flag, an enum's first value, the children's zeros for a
   *  value object, `[]` for a collection, and `null` for an optional field or
   *  a file (nothing uploaded yet).  Every frontend starts its inputs here. */
  zero: FormZero;
  prefill: FormPrefill;
  /** The declared `= <expr>` default, whatever the prefill source — a form
   *  opened without the record falls back to it. */
  default?: ExprIR;
  /** `enum` / `enumArray`: the enum's name and values, declaration order. */
  enumName?: string;
  enumValues?: readonly string[];
  /** `ref` / `optionalRef` / `refArray`: the option source. */
  picker?: FormPickerSource;
  /** `valueObject` / `optionalValueObject` / `objectArray`: the value object's
   *  name and its fields (row fields for an array, paths relative to the row). */
  valueObject?: string;
  children?: FormFieldSpec[];
  /** `scalarArray`: the element's scalar kind. */
  elementKind?: FormScalarKind;
  /** The declared type has no form input of its own: a `string` field over a
   *  type that is not a string (an unresolved value object, a record), or a
   *  `scalarArray` whose element is not a scalar, enum or reference (a `File`, a
   *  record).  A target that refuses to fake such a field as text reads this. */
  opaque?: true;
}

export type FormSpecKind = "update" | "operation";

export interface FormSpec {
  kind: FormSpecKind;
  /** The aggregate the form posts to. */
  owner: string;
  /** The operation name. */
  operation: string;
  fields: FormFieldSpec[];
  /** Some field seeds from the loaded record, so the target must have the
   *  record in scope where the form's initial values are built. */
  prefillsFromRecord: boolean;
}

/** One render arm per field kind.  `Extract` narrows each arm's argument so a
 *  target reads only what its kind carries. */
export type FormFieldArms<R, C = void> = {
  [K in FormFieldKind]: (field: FormFieldSpec & { kind: K }, ctx: C) => R;
};

/** Dispatch a field to its arm. */
export function renderFormField<R, C>(field: FormFieldSpec, arms: FormFieldArms<R, C>, ctx: C): R {
  const arm = arms[field.kind] as (f: FormFieldSpec, c: C) => R;
  return arm(field, ctx);
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** The lookups a classification reads.  `formSpecEnvOf` builds them from a
 *  bounded context; a frontend whose form projection carries its own maps
 *  supplies them directly. */
export interface FormSpecEnv {
  /** The values of a resolvable enum, declaration order. */
  enumValues(name: string): readonly string[] | undefined;
  /** The fields of a resolvable value object. */
  valueObjectFields(
    name: string,
  ): readonly { name: string; type: TypeIR; optional?: boolean; default?: ExprIR }[] | undefined;
  /** The referenced aggregate declares `derived display`. */
  hasDisplay(aggregate: string): boolean;
  /** The aggregate's list read is a paged envelope. */
  isPaged(aggregate: string): boolean;
}

/** The env for forms over `ctx`'s types. */
export function formSpecEnvOf(
  ctx: AnyTypeScope,
  hasDisplay: (aggregate: string) => boolean,
  bcByAggregate?: ReadonlyMap<string, BoundedContextIR>,
): FormSpecEnv {
  return {
    enumValues: (name) => enumPool(ctx).find((e) => e.name === name)?.values,
    valueObjectFields: (name) => findValueObjectInScope(ctx, name)?.fields,
    hasDisplay,
    isPaged: (aggregate) => isPagedAllRead(aggregate, bcByAggregate),
  };
}

function peel(t: TypeIR): { inner: TypeIR; optional: boolean } {
  return t.kind === "optional" ? { inner: t.inner, optional: true } : { inner: t, optional: false };
}

function scalarKindOf(name: string): FormScalarKind | "file" {
  switch (name) {
    case "int":
    case "long":
      return "int";
    case "decimal":
      return "decimal";
    case "money":
      return "money";
    case "bool":
      return "bool";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "File":
      return "file";
    default:
      return "string";
  }
}

function pickerFor(target: string, env: FormSpecEnv): FormPickerSource {
  return { target, hasDisplay: env.hasDisplay(target), paged: env.isPaged(target) };
}

/** The kind of input a declared type renders as.  `optional` is the field's own
 *  optionality (a `FieldIR.optional` flag or an `optional` type wrapper). */
function formFieldKindOf(t: TypeIR, env: FormSpecEnv, optional = false): FormFieldKind {
  const { inner, optional: wrapped } = peel(t);
  const opt = optional || wrapped;
  switch (inner.kind) {
    case "primitive":
      return scalarKindOf(inner.name);
    case "id":
      return opt ? "optionalRef" : "ref";
    case "enum":
      return env.enumValues(inner.name) ? "enum" : "string";
    case "valueobject":
      if (!env.valueObjectFields(inner.name)) return "string";
      return opt ? "optionalValueObject" : "valueObject";
    case "array": {
      const el = peel(inner.element).inner;
      if (el.kind === "valueobject" && env.valueObjectFields(el.name)) return "objectArray";
      if (el.kind === "enum" && env.enumValues(el.name)) return "enumArray";
      if (el.kind === "id") return "refArray";
      if (el.kind === "primitive" && scalarKindOf(el.name) !== "file") return "scalarArray";
      return "scalarArray";
    }
    default:
      return "string";
  }
}

interface FieldInput {
  name: string;
  type: TypeIR;
  optional?: boolean;
  default?: ExprIR;
}

/** Build one field's spec.  `recordFields` maps a name to the record's field
 *  type when the form is opened on a loaded record (update / operation forms). */
export function formFieldSpec(
  f: FieldInput,
  env: FormSpecEnv,
  path: string = f.name,
  recordFields?: ReadonlyMap<string, TypeIR>,
): FormFieldSpec {
  const { inner, optional: wrapped } = peel(f.type);
  const optional = !!f.optional || wrapped;
  const kind = formFieldKindOf(f.type, env, optional);
  const absence: FormAbsence =
    inner.kind === "array" ? "emptyArray" : optional ? "null" : "required";
  const recordType = recordFields?.get(f.name);
  const prefill: FormPrefill =
    recordType && sameValueType(recordType, f.type)
      ? { from: "record", field: f.name }
      : f.default
        ? { from: "default", expr: f.default }
        : { from: "zero" };
  const spec: FormFieldSpec = {
    name: f.name,
    path,
    kind,
    type: f.type,
    optional,
    absence,
    zero: null,
    prefill,
    ...(f.default ? { default: f.default } : {}),
    ...(isOpaque(kind, inner) ? { opaque: true as const } : {}),
  };
  switch (kind) {
    case "enum":
    case "enumArray": {
      const name = enumNameOf(inner);
      const values = name ? env.enumValues(name) : undefined;
      if (name && values) {
        spec.enumName = name;
        spec.enumValues = values;
      }
      break;
    }
    case "ref":
    case "optionalRef":
    case "refArray": {
      const target = inner.kind === "id" ? inner.targetName : refTargetOf(inner);
      if (target) spec.picker = pickerFor(target, env);
      break;
    }
    case "valueObject":
    case "optionalValueObject":
    case "objectArray": {
      const voName =
        inner.kind === "valueobject"
          ? inner.name
          : inner.kind === "array"
            ? (peel(inner.element).inner as { name?: string }).name
            : undefined;
      const voFields = voName ? env.valueObjectFields(voName) : undefined;
      if (voName && voFields) {
        spec.valueObject = voName;
        spec.children = voFields.map((vf) =>
          formFieldSpec(
            { name: vf.name, type: vf.type, optional: vf.optional, default: vf.default },
            env,
            kind === "objectArray" ? vf.name : `${path}.${vf.name}`,
          ),
        );
      }
      break;
    }
    case "scalarArray": {
      const el = inner.kind === "array" ? peel(inner.element).inner : inner;
      const k = el.kind === "primitive" ? scalarKindOf(el.name) : "string";
      spec.elementKind = k === "file" ? "string" : k;
      break;
    }
    default:
      break;
  }
  spec.zero = zeroOf(spec);
  return spec;
}

/** The value an untouched field submits (see {@link FormFieldSpec.zero}). */
function zeroOf(f: FormFieldSpec): FormZero {
  if (f.absence === "emptyArray") return [];
  if (f.absence === "null") return null;
  switch (f.kind) {
    case "int":
    case "decimal":
      return 0;
    case "money":
      return "0";
    case "bool":
      return false;
    case "enum":
      return f.enumValues?.[0] ?? "";
    case "file":
      return null;
    case "valueObject":
      return Object.fromEntries((f.children ?? []).map((c) => [c.name, c.zero]));
    default:
      return "";
  }
}

/** The text an input cell holds for a scalar zero: `""` for an absent value,
 *  the number or flag spelled out (`"0"`, `"false"`), a string as itself.  A
 *  frontend whose form state is text (an all-string record, a text
 *  controller) starts its cell here. */
export function formZeroText(f: FormFieldSpec): string {
  const z = f.zero;
  if (z === null || typeof z === "object") return "";
  return String(z);
}

/** A required input that holds the submit while blank: a file (nothing
 *  uploaded is no value at all) and a reference (no row picked).  Every other
 *  required input submits its value, blank or not, and the server decides.
 *  Every frontend renders this one decision — a request schema that refuses
 *  the blank, a submit guard, a picker validator — and none re-derives it. */
export function formBlankBlocks(f: FormFieldSpec): boolean {
  return f.absence === "required" && (f.kind === "file" || f.kind === "ref");
}

/** The lookups a lone declared type needs to classify as a form input: none
 *  resolve, so only its scalar / reference shape and its optionality count. */
const BARE_ENV: FormSpecEnv = {
  enumValues: () => undefined,
  valueObjectFields: () => undefined,
  hasDisplay: () => false,
  isPaged: () => false,
};

/** {@link formBlankBlocks} for a schema that renders a declared type rather
 *  than a form field (a request schema's member). */
export function typeBlankBlocks(t: TypeIR): boolean {
  return formBlankBlocks(formFieldSpec({ name: "value", type: t }, BARE_ENV));
}

/** The kind fell back to a text input the type does not fit (see
 *  {@link FormFieldSpec.opaque}).  An unresolved enum stays a plain string. */
function isOpaque(kind: FormFieldKind, inner: TypeIR): boolean {
  if (kind === "string") return inner.kind !== "primitive" && inner.kind !== "enum";
  if (kind !== "scalarArray" || inner.kind !== "array") return false;
  const el = peel(inner.element).inner;
  if (el.kind === "primitive") return scalarKindOf(el.name) === "file";
  return el.kind !== "enum" && el.kind !== "id";
}

function enumNameOf(t: TypeIR): string | undefined {
  if (t.kind === "enum") return t.name;
  if (t.kind === "array") {
    const el = peel(t.element).inner;
    return el.kind === "enum" ? el.name : undefined;
  }
  return undefined;
}

function refTargetOf(t: TypeIR): string | undefined {
  if (t.kind !== "array") return undefined;
  const el = peel(t.element).inner;
  return el.kind === "id" ? el.targetName : undefined;
}

/** Two types carry the same value, optionality aside — the record field a
 *  same-named operation param prefills from.  A param may be optional where the
 *  field is required (or the reverse); the value still round-trips. */
function sameValueType(a: TypeIR, b: TypeIR): boolean {
  const x = peel(a).inner;
  const y = peel(b).inner;
  if (x.kind !== y.kind) return false;
  switch (x.kind) {
    case "primitive":
      return x.name === (y as typeof x).name;
    case "id":
      return x.targetName === (y as typeof x).targetName;
    case "enum":
    case "valueobject":
      return x.name === (y as typeof x).name;
    case "array":
      return sameValueType(x.element, (y as typeof x).element);
    default:
      return false;
  }
}

/** The record an operation form prefills from: the aggregate's fields. */
export interface FormRecordOwner {
  readonly name: string;
  readonly fields: readonly {
    readonly name: string;
    readonly type: TypeIR;
    readonly provenanced?: boolean;
  }[];
}

/** An operation as its form renders it: the params the form sends
 *  (`operationFormParams`), with their declared defaults. */
export interface FormOperation {
  readonly name: string;
  readonly formParams: readonly {
    readonly name: string;
    readonly type: TypeIR;
    readonly default?: ExprIR;
  }[];
}

/** A domain operation as its form renders it. */
export function formOperationOf(op: OperationIR): FormOperation {
  return { name: op.name, formParams: operationFormParams(op) };
}

/** An operation form.  A param named and typed like one of the aggregate's
 *  fields prefills from the loaded record, so an update form opens on the
 *  current values and a partial edit keeps every other field.  The form is an
 *  `update` form when every param prefills that way. */
export function operationFormSpec(
  agg: FormRecordOwner,
  op: FormOperation,
  env: FormSpecEnv,
): FormSpec {
  const recordFields = new Map<string, TypeIR>(agg.fields.map((f) => [f.name, f.type]));
  const carriers = new Set(agg.fields.filter((f) => f.provenanced).map((f) => f.name));
  const fields = op.formParams.map((p) => {
    const spec = formFieldSpec(p, env, p.name, recordFields);
    return spec.prefill.from === "record" && carriers.has(p.name)
      ? { ...spec, prefill: { ...spec.prefill, carrier: true as const } }
      : spec;
  });
  const fromRecord = fields.filter((f) => f.prefill.from === "record").length;
  return {
    kind: fields.length > 0 && fromRecord === fields.length ? "update" : "operation",
    owner: agg.name,
    operation: op.name,
    fields,
    prefillsFromRecord: fromRecord > 0,
  };
}

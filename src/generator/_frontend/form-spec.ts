import type {
  AggregateIR,
  BoundedContextIR,
  ExprIR,
  OperationIR,
  TypeIR,
} from "../../ir/types/loom-ir.js";
import { operationFormParams } from "../../ir/util/op-gates.js";
import { isPagedAllRead } from "../../ir/util/paged-all.js";
import { enumPool, findValueObjectInScope } from "../../ir/util/reachable-types.js";

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
 *  - `required` — the field has no absent state; the input always carries a value.
 *  - `null` — an optional field: an empty input, an unset picker, or a disabled
 *    optional group submits `null`, never `""` / `0` / a zero object.
 *  - `emptyArray` — a collection: no rows submits `[]`. */
export type FormAbsence = "required" | "null" | "emptyArray";

/** Where a field's initial value comes from.
 *  - `record` — an update / operation form opened on a loaded record seeds the
 *    field from the record's same-named, same-typed field (`field`).
 *  - `default` — the declared `= <expr>` default (`expr`), when the target can
 *    evaluate it client-side; otherwise the target falls back to `zero`.
 *  - `zero` — the kind's empty value (`null` for an optional field). */
export type FormPrefill =
  | { from: "record"; field: string }
  | { from: "default"; expr: ExprIR }
  | { from: "zero" };

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
  ctx: BoundedContextIR,
  aggregatesByName: ReadonlyMap<string, AggregateIR>,
  bcByAggregate?: ReadonlyMap<string, BoundedContextIR>,
): FormSpecEnv {
  return {
    enumValues: (name) => enumPool(ctx).find((e) => e.name === name)?.values,
    valueObjectFields: (name) => findValueObjectInScope(ctx, name)?.fields,
    hasDisplay: (aggregate) => !!aggregatesByName.get(aggregate)?.displayDerived,
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
  return spec;
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

/** An operation form.  A param named and typed like one of the aggregate's
 *  fields prefills from the loaded record, so an update form opens on the
 *  current values and a partial edit keeps every other field.  The form is an
 *  `update` form when every param prefills that way. */
export function operationFormSpec(agg: AggregateIR, op: OperationIR, env: FormSpecEnv): FormSpec {
  const recordFields = new Map<string, TypeIR>(agg.fields.map((f) => [f.name, f.type]));
  const fields = operationFormParams(op).map((p) => formFieldSpec(p, env, p.name, recordFields));
  const fromRecord = fields.filter((f) => f.prefill.from === "record").length;
  return {
    kind: fields.length > 0 && fromRecord === fields.length ? "update" : "operation",
    owner: agg.name,
    operation: op.name,
    fields,
    prefillsFromRecord: fromRecord > 0,
  };
}

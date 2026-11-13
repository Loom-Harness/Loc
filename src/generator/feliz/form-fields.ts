// Feliz form fields — the F# rendering of the shared form model.
//
// Every create / operation / workflow input is classified ONCE by
// `_frontend/form-spec.ts` (kind, optionality, enum values, picker, value-object
// children) and rendered here through `FELIZ_FORM_FIELD_ARMS` into the flat,
// all-string form record the MVU view binds.  This module never reads a field's
// `TypeIR` to decide what kind of input it is or whether it may be absent; the
// type reaches only the wire encoder (`wire-codec.ts`), which lifts the string
// cell back to its wire value.

import type { ExprIR, FieldIR, TypeIR } from "../../ir/types/loom-ir.js";
import { humanize, upperFirst } from "../../util/naming.js";
import {
  type FormFieldArms,
  type FormFieldSpec,
  type FormSpecEnv,
  formFieldSpec,
  renderFormField,
} from "../_frontend/form-spec.js";
import { fsIdent } from "./fs-ident.js";
import type { FelizFieldArray, FelizFormField, FelizInputKind, FelizRowField } from "./wire.js";
import { encodeExprFor } from "./wire-codec.js";

const felizText = (): FelizInputKind => "text";
const felizNumber = (): FelizInputKind => "number";

/** The Feliz input widget per form field kind.  A value object, an array of
 *  value objects or an opaque field is plain text here: value objects are
 *  flattened and value-object arrays become row groups before a cell is built. */
export const FELIZ_FORM_FIELD_ARMS: FormFieldArms<FelizInputKind> = {
  string: felizText,
  int: felizNumber,
  decimal: felizNumber,
  money: felizNumber,
  bool: () => "checkbox",
  // A calendar `date` renders a date picker; its string value is already
  // the wire's `YYYY-MM-DD`, so the form cell and the encoder stay strings.
  date: () => "date",
  datetime: felizText,
  // A `File` is not typeable: it renders a file picker whose pick uploads
  // (multipart POST /files) and whose RESULT — the `FileRef` — is what the
  // form submits.
  file: () => "file",
  enum: () => "select",
  ref: (f) => (f.picker?.hasDisplay ? "idselect" : "text"),
  optionalRef: (f) => (f.picker?.hasDisplay ? "idselect" : "text"),
  valueObject: felizText,
  optionalValueObject: felizText,
  scalarArray: felizText,
  // An enum / reference collection is a checkbox group over a comma-joined
  // cell (one box per option); a reference without a display stays a text box.
  enumArray: () => "checkgroup",
  refArray: (f) => (f.picker?.hasDisplay ? "checkgroup" : "text"),
  objectArray: felizText,
};

/** The lookup env the shared classifier reads, from the maps the Feliz form
 *  projection carries (it holds no bounded context).  A reference's target has
 *  a picker label exactly when `idLabels` names it. */
function felizSpecEnv(
  enumsByName: ReadonlyMap<string, string[]>,
  idLabels: ReadonlyMap<string, string>,
  vosByName: ReadonlyMap<string, readonly FieldIR[]>,
): FormSpecEnv {
  return {
    enumValues: (name) => enumsByName.get(name),
    valueObjectFields: (name) => vosByName.get(name),
    hasDisplay: (aggregate) => idLabels.has(aggregate),
    isPaged: () => false,
  };
}

const SCALAR_KINDS: ReadonlySet<FormFieldSpec["kind"]> = new Set([
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
]);

const ARRAY_KINDS: ReadonlySet<FormFieldSpec["kind"]> = new Set([
  "scalarArray",
  "enumArray",
  "refArray",
  "objectArray",
]);

/** A field the string form renders as ONE cell. */
function isScalar(f: FormFieldSpec): boolean {
  return !f.opaque && SCALAR_KINDS.has(f.kind);
}

/** A field the flat form renders: a scalar cell, a value object flattened into
 *  its scalar sub-fields, or a scalar / enum / reference collection (a
 *  comma-joined cell).  A value-object collection is a row group instead
 *  ({@link felizFieldArrays}). */
function isFlat(f: FormFieldSpec): boolean {
  if (f.opaque) return false;
  return (
    isScalar(f) ||
    f.kind === "valueObject" ||
    f.kind === "optionalValueObject" ||
    f.kind === "scalarArray" ||
    f.kind === "enumArray" ||
    f.kind === "refArray"
  );
}

/** How strictly a numeric cell's text must parse before the encoder converts
 *  it.  A numeric COLLECTION is a comma-separated list, which no single-value
 *  parse describes, so it is not marked. */
function numericOf(f: FormFieldSpec): "integral" | "fractional" | undefined {
  if (f.kind === "int") return "integral";
  if (f.kind === "decimal" || f.kind === "money") return "fractional";
  return undefined;
}

/** The BARE string a constant/enum `= default` seeds into the all-string Feliz
 *  form model (`Model.<field> = "<seed>"`), or `undefined` when the default is
 *  outside the client-evaluable subset (money/now/this-relative/ref → the field
 *  keeps its `emptyValue`).  The encoder parses the string back, so the seed is
 *  the value's raw string — the analogue of `renderDefaultSeed` for the
 *  JS-family frontends, minus the quoting. */
function felizDefaultString(e: ExprIR | undefined): string | undefined {
  if (!e) return undefined;
  if (e.kind === "literal") {
    // string / int / long / decimal / bool carry their value as the state
    // string; money / now / null need a runtime carrier or are ambient.
    if (["string", "int", "long", "decimal", "bool"].includes(e.lit)) return e.value;
    return undefined;
  }
  // `status: Status = Draft` — the enum member's wire form is its bare name.
  if (e.kind === "ref" && e.refKind === "enum-value") return e.name;
  return undefined;
}

/** Build one flat `FelizFormField` — the record field `wireName` (bound to an
 *  input), encoding to `jsonKey` (inside `objectKey`'s group when set).
 *  `optional` is the cell's absence: the field's own, or its opt-in group's. */
function buildField(
  formType: string,
  f: FormFieldSpec,
  wireName: string,
  optional: boolean,
  idLabels: ReadonlyMap<string, string>,
  objectKey?: string,
): FelizFormField {
  const inputKind = renderFormField(f, FELIZ_FORM_FIELD_ARMS, undefined);
  const enumValues =
    inputKind === "select" || (inputKind === "checkgroup" && f.kind === "enumArray")
      ? f.enumValues && [...f.enumValues]
      : undefined;
  const idTarget =
    inputKind === "idselect" || inputKind === "checkgroup" ? f.picker?.target : undefined;
  const isArray = ARRAY_KINDS.has(f.kind);
  // A REQUIRED enum defaults to its first value so the select and the string
  // state agree from the start (and the required guard passes); everything else
  // — text/number/checkbox, an idselect (its list loads at runtime), and an
  // OPTIONAL enum (empty = null) — is "".
  const emptyValue =
    felizDefaultString(f.default) ??
    (inputKind === "select" && !optional && enumValues && enumValues.length > 0
      ? enumValues[0]!
      : "");
  return {
    wireName,
    fsName: fsIdent(wireName),
    setMsg: `Set${formType}${upperFirst(wireName)}`,
    encodeExpr: encodeExprFor(f.type, `form.${fsIdent(wireName)}`, optional),
    inputKind,
    numeric: numericOf(f),
    // An array cell is a comma-separated list: empty is the empty list, a
    // legitimate value (the wire schema carries no minimum), never "unfilled".
    required: !optional && !isArray,
    enumValues,
    idTarget,
    idLabelField: idTarget ? (idLabels.get(idTarget) ?? "id") : undefined,
    objectKey,
    jsonKey: f.name,
    isArray,
    emptyValue,
  };
}

/** The flat form fields for a form of `formType` from a `{name, type,
 *  optional?, default?}` field/param list.  A value-object field (`address:
 *  Address`) is FLATTENED into one cell per scalar sub-field (`addressStreet`,
 *  `addressCity`) — the record stays flat and all-string, and the encoder
 *  re-nests them under the object key.  An optional value object is opt-in: a
 *  presence checkbox leads its sub-fields.  Inputs the flat form cannot render
 *  (a value-object collection, an opaque field) are left out; value-object
 *  collections become row groups ({@link felizFieldArrays}).  Reused by create,
 *  operation and workflow forms. */
export function felizFormFields(
  formType: string,
  inputs: readonly { name: string; type: TypeIR; optional?: boolean; default?: ExprIR }[],
  enumsByName: ReadonlyMap<string, string[]> = new Map(),
  idLabels: ReadonlyMap<string, string> = new Map(),
  vosByName: ReadonlyMap<string, readonly FieldIR[]> = new Map(),
): FelizFormField[] {
  const env = felizSpecEnv(enumsByName, idLabels, vosByName);
  return inputs
    .map((i) => formFieldSpec(i, env))
    .filter(isFlat)
    .flatMap((f) => {
      if (f.kind !== "valueObject" && f.kind !== "optionalValueObject") {
        return [buildField(formType, f, f.name, f.optional, idLabels)];
      }
      // A value object: one cell per SCALAR sub-field (`<field><Sub>`); nested
      // value objects and collections inside it are left out (one level).  An
      // opt-in group's absence relaxes every sub-field's `required`.
      const optIn = f.kind === "optionalValueObject";
      const presentCell = `${f.name}Present`;
      const subs = (f.children ?? []).filter(isScalar).map((sub) => {
        const cell = buildField(
          formType,
          sub,
          `${f.name}${upperFirst(sub.name)}`,
          optIn || sub.optional,
          idLabels,
          f.name,
        );
        // The group's optionality relaxes `required`, not the cell's starting
        // value: a sub-field that is itself a required enum starts at its first
        // value, so ticking the opt-in box submits a valid member.
        const start =
          optIn && !sub.optional && cell.inputKind === "select" && cell.enumValues?.length
            ? { ...cell, emptyValue: cell.enumValues[0]! }
            : cell;
        return optIn ? { ...start, presentCell: fsIdent(presentCell) } : start;
      });
      if (!optIn) return subs;
      // The sub-inputs mount (and the object is submitted) only while the
      // presence box is checked.
      const presence: FelizFormField = {
        ...buildField(
          formType,
          formFieldSpec({ name: f.name, type: { kind: "primitive", name: "bool" } }, env),
          presentCell,
          true,
          idLabels,
        ),
        presenceOf: f.name,
        encodeExpr: `Encode.bool (form.${fsIdent(presentCell)} = "true")`,
        required: false,
      };
      return [presence, ...subs];
    });
}

/** The dynamic-row `FelizFieldArray` of a value-object collection.  Only SCALAR
 *  sub-fields render — a nested value object / collection inside the row is
 *  left out (the flat form's one-level limit).  An `id` sub-field is a picker
 *  over the target's list, the same list a flat picker of that target reads. */
function felizFieldArray(
  formType: string,
  f: FormFieldSpec,
  idLabels: ReadonlyMap<string, string>,
): FelizFieldArray {
  const rowFields: FelizRowField[] = (f.children ?? []).filter(isScalar).map((sub) => {
    const kind = renderFormField(sub, FELIZ_FORM_FIELD_ARMS, undefined);
    // A `File` sub-field inside a dynamic ROW degrades to text: the row record
    // is all-string, and a real per-row picker needs an INDEXED upload `Cmd`
    // (one in flight per row).  The flat form renders a real picker.
    const rowFile = kind === "file";
    return {
      wireName: sub.name,
      fsName: fsIdent(sub.name),
      setMsg: `Set${formType}${upperFirst(f.name)}${upperFirst(sub.name)}`,
      // A reference picks from the target's list, like a flat picker; a
      // collection inside a row stays text.
      inputKind: kind === "checkgroup" || rowFile ? "text" : kind,
      ...(kind === "idselect" && sub.picker
        ? {
            idTarget: sub.picker.target,
            idLabelField: idLabels.get(sub.picker.target) ?? "id",
          }
        : {}),
      encodeExpr: rowFile
        ? `Encode.string row.${fsIdent(sub.name)}`
        : encodeExprFor(sub.type, `row.${sub.name}`, sub.optional),
      jsonKey: sub.name,
      enumValues: kind === "select" && sub.enumValues ? [...sub.enumValues] : undefined,
      required: !sub.optional,
      // A file cell degrades to text and encodes as a string — never numeric.
      numeric: rowFile ? undefined : numericOf(sub),
    };
  });
  const elementName = f.valueObject ?? f.name;
  const rowType = `${upperFirst(elementName)}Row`;
  return {
    fieldName: fsIdent(f.name),
    jsonKey: f.name,
    rowType,
    emptyRowBinding: `empty${rowType}`,
    elementName,
    label: humanize(f.name),
    addMsg: `Add${formType}${upperFirst(f.name)}`,
    removeMsg: `Remove${formType}${upperFirst(f.name)}`,
    rowFields,
  };
}

/** Every value-object collection of a field/param list as its dynamic-row
 *  `FelizFieldArray` — the complement of the flat {@link felizFormFields}. */
export function felizFieldArrays(
  formType: string,
  inputs: readonly { name: string; type: TypeIR; optional?: boolean }[],
  vosByName: ReadonlyMap<string, readonly FieldIR[]>,
  enumsByName: ReadonlyMap<string, string[]>,
  idLabels: ReadonlyMap<string, string>,
): FelizFieldArray[] {
  const env = felizSpecEnv(enumsByName, idLabels, vosByName);
  return inputs
    .map((i) => formFieldSpec(i, env))
    .filter((f) => f.kind === "objectArray")
    .map((f) => felizFieldArray(formType, f, idLabels));
}

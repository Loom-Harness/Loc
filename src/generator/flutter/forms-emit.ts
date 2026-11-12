// Flutter FORM projector — the Track B whole-primitive form overrides
// (`CreateForm` / `OperationForm` / `DestroyForm`).  The Dart analogue of
// Feliz's `wire.ts` form projection, but SELF-CONTAINED: instead of threading
// a Model/Msg/update/Api quadruple through the page shell, each form becomes a
// stand-alone `StatefulWidget` (its own `TextEditingController`s + a
// `GlobalKey<FormState>`) that POSTs/DELETEs over `package:http` and pops the
// route on success.  The view seam (`flutter-target.ts`) only names the widget
// (`CreateProductForm()` / `DiscountProductForm(id: id)` / `DeleteProductForm(id:
// id)`); this module emits the widget CLASS the reference resolves to, into one
// shared `lib/forms.dart`.
//
// Field introspection reuses the framework-neutral create-input contract
// (`createInputFields` off the enriched aggregate — the same set every backend's
// create surface consumes) and the op's declared params; the widget kind is
// derived purely from the wire `TypeIR` (mirroring Feliz's `inputKindFor`):
//   - string / guid / json        → `TextFormField`
//   - int / long                  → `TextFormField` (numeric keyboard, int parse)
//   - decimal                     → `TextFormField` (numeric keyboard, double parse)
//   - money                       → `TextFormField` (numeric keyboard); the
//                                   TEXT is submitted, never a parsed double
//   - bool                        → `SwitchListTile`
//   - enum (values resolvable)    → `DropdownButtonFormField`
//   - datetime                    → a `showDatePicker` field
//   - value object (resolvable)   → flattened into its scalar sub-fields
//   - id (foreign key)            → `DropdownButtonFormField` loaded at runtime
//                                   from `GET /<target-collection>` when the
//                                   target aggregate has a derived `display`
//                                   field (the option label); otherwise a raw id
//                                   `TextFormField` (matches the cross-frontend
//                                   `display`-gated id-select/id-text split).
//
// A SCALAR array (`tags: string[]` / `scores: int[]`) renders as a repeatable
// add/remove row list (one `TextEditingController` per row); an OBJECT array
// (`items: LineItem[]`) renders each row as a group of `TextFormField`s over the
// value object's scalar sub-fields (a `List<List<TextEditingController>>` in
// state), submitting a `{sub: value, …}` map per row.
// DEFERRED: a VO-array whose sub-fields aren't all text/numeric (bool / enum /
// datetime / nested), and enum/bool/datetime scalar element arrays, are dropped —
// but LOUDLY (M-A): each drop emits a `// TODO(flutter form-field): …` marker on
// the widget class (`FlutterFormSpec.dropped`) so the omission is visible in the
// Dart and counted by the parity lint, never silent.

import { createInputFields, isConstructible } from "../../ir/enrich/wire-projection.js";
import type {
  AggregateIR,
  EnrichedAggregateIR,
  EnrichedBoundedContextIR,
  ExprIR,
  FieldIR,
  InvariantIR,
  OperationIR,
  TypeIR,
  UiIR,
  WorkflowIR,
} from "../../ir/types/loom-ir.js";
import { modelTextContextOf } from "../../ir/util/model-text-owner.js";
import { operationFormParams } from "../../ir/util/op-gates.js";
import { enumPool, valueObjectPool } from "../../ir/util/reachable-types.js";
import { walkExprChildren } from "../../ir/util/walk.js";
import { emitsCommandRoute } from "../../ir/util/workflow-command-route.js";
import { lines } from "../../util/code-builder.js";
import { modelTextEntry } from "../../util/model-text-key.js";
import { humanize, lowerFirst, snake, upperFirst } from "../../util/naming.js";
import { routeSegmentFor } from "../../util/storage-names.js";
import {
  type FormFieldArms,
  type FormFieldSpec,
  type FormSpecEnv,
  formFieldSpec,
  operationFormSpec,
  renderFormField,
} from "../_frontend/form-spec.js";
import { sendsIfMatchPrecondition } from "../_frontend/occ.js";
import { sourceText } from "../_i18n/source-text.js";
import { chromeKey, chromeMessage, sentenceChromeName } from "../_walker/i18n-chrome.js";
import {
  type FormInputModelText,
  formInputModelText,
  opDefaultText,
  paramLabelOwner,
  workflowRunEntry,
} from "../_walker/model-text-sites.js";
import { STANDARD_AGG_OPS } from "../_walker/walker-core.js";
import { flutterHttpImport } from "./api-client.js";
import {
  type FlutterFieldRule,
  flutterValidatorMap,
  ruleGuards,
  validatorMessage,
} from "./form-validators.js";
import { dartStringLit } from "./i18n.js";
// ---------------------------------------------------------------------------
// Widget-name helpers — the ONE place the view seam and the class emitter agree
// on the generated widget class name.  A collision here (seam emits `X`, emitter
// emits `Y`) would be an unresolved-reference compile error, never silent.
// ---------------------------------------------------------------------------

/** `Product` → `CreateProductForm` (the create-form widget class). */
export function createFormWidgetName(aggregate: string): string {
  return `Create${upperFirst(aggregate)}Form`;
}

/** `Product` + `discount` → `DiscountProductForm` (the op-form widget class). */
export function operationFormWidgetName(aggregate: string, op: string): string {
  return `${upperFirst(op)}${upperFirst(aggregate)}Form`;
}

/** `Product` → `DeleteProductForm` (the destroy-form widget class). */
export function destroyFormWidgetName(aggregate: string): string {
  return `Delete${upperFirst(aggregate)}Form`;
}

/** `placeOrder` → `PlaceOrderWorkflowForm` (the workflow-run-form widget class). */
export function workflowFormWidgetName(workflow: string): string {
  return `${upperFirst(workflow)}WorkflowForm`;
}

// ---------------------------------------------------------------------------
// Field preparation
// ---------------------------------------------------------------------------

/** The Flutter input widget a form field renders as — derived purely from the
 *  wire `TypeIR`.  The form widget keeps text/number values in
 *  `TextEditingController`s and bool/enum/datetime in plain state fields. */
export type FlutterInputKind =
  | "text"
  | "number-int"
  | "number-double"
  | "bool"
  | "enum"
  | "datetime"
  | "file"
  | "fk-select"
  | "scalar-array"
  | "bool-array"
  | "enum-array"
  | "object-array";

/** One prepared form field — a scalar input the widget renders + submits. */
export interface FlutterFormField {
  /** Base field name (the aggregate/param field, or `<field><Sub>` for a
   *  flattened value-object sub-field) — drives the Dart state identifier. */
  wireName: string;
  /** JSON key this field encodes to — its own name, or the VO sub-field name
   *  (`amount`) inside its `objectKey` group. */
  jsonKey: string;
  /** Human label shown on the input's `InputDecoration.labelText`. */
  label: string;
  /** The label as a Dart EXPRESSION — a `t('<identity key>', '<default>')` call
   *  — when the ui is translatable and the input names a model fact; absent ⇒
   *  the literal {@link label}. */
  labelExpr?: string;
  /** For an enum input: each value's option label as a Dart expression. */
  optionExprs?: Readonly<Record<string, string>>;
  /** The widget kind derived from the type. */
  kind: FlutterInputKind;
  /** Whether the client MUST supply this field (required → validated). */
  required: boolean;
  /** For an `enum` field, the allowed values (rendered as dropdown items). */
  enumValues?: string[];
  /** `money` — the input is still a numeric `TextFormField`, but the SUBMIT
   *  value is the fixed-scale decimal STRING the wire carries
   *  (`money-scale.ts`, RS-12), not a bare JSON number the backend's
   *  `z.string()` request schema rejects. */
  money?: boolean;
  /** A calendar `date` — the same date picker a `datetime` renders, but the
   *  SUBMIT value is the picked day's `YYYY-MM-DD` (the wire form), never an
   *  instant a zone could move. */
  dateOnly?: boolean;
  /** When flattened OUT of value objects, the chain of JSON object keys it
   *  nests under, outermost first — `["cost"]` for a `cost: Money` expanded to
   *  `costAmount`/`costCurrency`, `["addr", "geo"]` for a `Geo` nested inside an
   *  `Addr`.  A PATH, not a single key: VO flattening is recursive, so the
   *  request body has to rebuild the same depth (`bodyAssembly`). */
  objectPath?: readonly string[];
  /** The opt-in groups (`optionalValueObject` fields) this leaf sits under,
   *  outermost first.  A group's leaves render and submit only while its
   *  presence switch is on; while off the value object submits `null`. */
  presence?: readonly FlutterPresenceGroup[];
  /** The field seeds from the loaded record (`widget.record`) in `initState` —
   *  its top-level operation param is named and typed like an aggregate field
   *  (`operationFormSpec` → `prefill.from === "record"`).  A flattened
   *  value-object leaf reads through its `objectPath`. */
  fromRecord?: true;
  /** Client-side rules derived from the aggregate's (or operation's)
   *  wire-translatable `invariant`s — M-T1.16 / ledger row
   *  `M-T1.16-invariant-validation-feliz-flutter`.  Empty/absent ⇒ the emitted
   *  `validator:` is byte-identical to the emptiness-and-parseability-only
   *  form.  Only TOP-LEVEL fields carry these: an invariant names an
   *  aggregate/operation field, never a value-object sub-field flattened out
   *  of one (`addrGeoLat`), whose rules live on the value object's own
   *  invariants and are enforced server-side. */
  rules?: FlutterFieldRule[];
  /** True in an i18n app: the field's validator messages are
   *  `t('<catalog code>', '<english>')` calls, evaluated when the validator
   *  runs, instead of English literals. */
  translateMessages?: boolean;
  /** For an `fk-select` field, the snake-plural collection path (`categories`)
   *  its option list loads from (`GET /<collection>`); the option label is the
   *  target's derived `display` field (falling back to the row's `id`). */
  fkCollection?: string;
  /** For a `scalar-array` field, the scalar kind of each element — drives the
   *  per-row keyboard + parse (a `string[]` submits the raw list; a numeric array
   *  parses each row). */
  elementKind?: "text" | "number-int" | "number-double";
  /** `money[]` — the elements submit as fixed-scale decimal strings. */
  elementMoney?: boolean;
  /** For an `object-array` field (`items: LineItem[]`), the value object's
   *  scalar sub-fields in order — each row is a group of cells, one per
   *  sub-field, and submits a `{sub: value, …}` map per row.  The cell kinds
   *  are the flat scalar ones: text/number cells are `TextFormField`s over a
   *  per-cell `TextEditingController`, and bool / enum / datetime cells hold
   *  their VALUE in the row slot directly (see `objectRowCell`). */
  elementName?: string;
  objectFields?: {
    jsonKey: string;
    label: string;
    /** {@link FlutterFormField.labelExpr}, for this cell. */
    labelExpr?: string;
    /** {@link FlutterFormField.optionExprs}, for this cell. */
    optionExprs?: Readonly<Record<string, string>>;
    kind: "text" | "number-int" | "number-double" | "bool" | "enum" | "datetime";
    /** `money` sub-field — submits as a fixed-scale decimal string. */
    money?: boolean;
    /** `date` sub-field — submits the picked day's `YYYY-MM-DD`. */
    dateOnly?: boolean;
    /** For an `enum` cell, the allowed values (the dropdown's items). */
    enumValues?: string[];
    /** Whether the sub-field is required (an enum cell then seeds row 0's
     *  value instead of starting null). */
    required?: boolean;
  }[];
}

/** A fully prepared form → everything `renderFormWidget` needs. */
export interface FlutterFormSpec {
  /** The generated widget class name (matches the view seam's reference). */
  widgetName: string;
  kind: "create" | "operation" | "destroy";
  /** The aggregate operated on (`Product`). */
  aggregate: string;
  /** Whether the widget takes a `required String id` ctor arg (op / destroy). */
  needsId: boolean;
  /** Fully-built request path (a Dart string-literal body, e.g. `/products` or
   *  `/products/${widget.id}/discount`). */
  pathExpr: string;
  /** The submit button's label (`Create Product` / `Discount` / `Delete
   *  Product`). */
  submitLabel: string;
  /** {@link submitLabel} as a Dart expression (`t('<identity key>', …)`) when
   *  the ui is translatable; absent ⇒ the literal. */
  submitExpr?: string;
  /** The prepared input fields (empty for a destroy form). */
  fields: FlutterFormField[];
  /** LOUD form-field drop markers (M-A).  One `// TODO(flutter form-field): …`
   *  comment line per input `prepareFields` could not render (nested-VO
   *  sub-field, mixed value-object array, enum/bool/datetime/id element array,
   *  unresolved value-object field).  Emitted into the widget class so the drop
   *  is visible in the generated Dart AND counted by the parity lint's
   *  `TODO_LINE` regex, rather than silent.  Empty for a fully rendered
   *  form. */
  dropped: string[];
  /** Whether this form styles its submit as a destructive (error-coloured)
   *  action (destroy forms). */
  destructive: boolean;
  /** Whether the submit sends the optimistic-concurrency `If-Match`
   *  precondition (`sendsIfMatchPrecondition` — a `versioned` aggregate's
   *  `update`).  The widget then takes an optional `expectedVersion` — the
   *  version of the record the call site has loaded — and quotes it into the
   *  header.  Left null (no loaded record at the call site) it sends no header,
   *  exactly like the JS clients' `ifMatch(undefined)`.  Optional so every
   *  other spec stays byte-identical. */
  ifMatch?: boolean;
  /** A `when`-gated operation's `can_<op>` probe provider (declared in
   *  `gates.dart`, see {@link renderGatesFile}).  The widget takes a `blocked`
   *  flag that disables its submit; the call site watches the provider.
   *  Absent for an ungated op: the widget is byte-identical. */
  gateProbe?: { provider: string };
  /** The widget takes an optional `record` (the loaded record's wire map) and
   *  seeds every {@link FlutterFormField.fromRecord} input from it, so an update
   *  form opens on the current values.  Absent for a form with no
   *  record-prefilled param: the widget is byte-identical. */
  takesRecord?: true;
}

/** One opt-in value-object group: the Dart state id of its presence flag, the
 *  JSON key path of the value object, and its switch label. */
interface FlutterPresenceGroup {
  /** The wire name (nest-qualified) the `_<id>Present` flag derives from. */
  id: string;
  path: readonly string[];
  label: string;
}

/** Whether an operation's form opens on a loaded record: some param is named
 *  and typed like an aggregate field (`operationFormSpec`).  Independent of the
 *  context the widget is built in, so the widget declaration and the call site
 *  that passes the record always agree. */
export function opFormTakesRecord(agg: AggregateIR, op: OperationIR): boolean {
  return operationFormSpec(agg, op, flutterSpecEnv(new Map(), new Map(), new Map()))
    .prefillsFromRecord;
}

/** The Riverpod provider of a `when`-gated op's `can_<op>` probe
 *  (`Task` + `complete` → `canCompleteTaskProvider`). */
export function canProbeProviderName(aggregate: string, op: string): string {
  return `can${upperFirst(op)}${upperFirst(aggregate)}Provider`;
}

/** Build one LOUD form-field drop marker (M-A) — a Dart line comment shaped so
 *  the parity lint's `TODO_LINE` regex (`/\/\/\s*(TODO\(flutter[^)]*\):[^\n]*)/`)
 *  counts it.  The paren group stays colon-free (`flutter form-field`); the colon
 *  comes right after it, and the human reason follows.  Naming the owning
 *  follow-up mission (M-B) keeps the deferral a reviewed decision, not a silent
 *  gap. */
function droppedMarker(field: string, reason: string): string {
  return `// TODO(flutter form-field): ${field} — ${reason} dropped (deferred, M-B)`;
}

/** Peel a single `optional` layer. */
function peel(t: TypeIR): TypeIR {
  return t.kind === "optional" ? t.inner : t;
}

/** The Dart `RegExp` a money input validates against — the exact grammar every
 *  backend's money request schema accepts (`money-scale.ts`, RS-12), so what
 *  passes here is what the wire accepts. */
const MONEY_TEXT_PATTERN = String.raw`RegExp(r'^-?\d+(\.\d+)?$')`;

/** `money` — a numeric input whose SUBMIT value is the decimal STRING the user
 *  typed, not a JSON number (`money-scale.ts`, RS-12). */
function isMoney(t: TypeIR): boolean {
  const b = peel(t);
  return b.kind === "primitive" && b.name === "money";
}

/** `date` — the date picker's value submits as its `YYYY-MM-DD` day. */
function isDateOnly(t: TypeIR): boolean {
  const b = peel(t);
  return b.kind === "primitive" && b.name === "date";
}

/** The picked `DateTime?` in its wire form: a `datetime` as the ISO instant, a
 *  `date` as the calendar day the picker chose (the picker returns that day at
 *  local midnight, so its first ten ISO characters ARE the day). */
function pickedWire(expr: string, dateOnly: boolean | undefined): string {
  return dateOnly ? `${expr}?.toIso8601String().substring(0, 10)` : `${expr}?.toIso8601String()`;
}

/** The Flutter input kind for a scalar wire type, or `undefined` when the type
 *  isn't a flat scalar the string/number/bool/enum/datetime form renders. */
function scalarInputKind(
  t: TypeIR,
  enumsByName: ReadonlyMap<string, string[]>,
  aggregatesByName: ReadonlyMap<string, EnrichedAggregateIR>,
): FlutterInputKind | undefined {
  const base = peel(t);
  if (base.kind === "enum") return enumsByName.has(base.name) ? "enum" : "text";
  // A foreign-key id → a runtime-loaded dropdown when the target has a derived
  // `display` field (the option label); otherwise a raw id text field (the same
  // `display`-gated split every other frontend makes).
  if (base.kind === "id")
    return aggregatesByName.get(base.targetName)?.displayDerived ? "fk-select" : "text";
  if (base.kind === "primitive") {
    switch (base.name) {
      case "int":
      case "long":
        return "number-int";
      case "decimal":
      case "money":
        return "number-double";
      case "bool":
        return "bool";
      // A calendar date rides the same picker; `dateOnly` changes what it submits.
      case "date":
      case "datetime":
        return "datetime";
      case "File":
        // A `File` field is the fixed `FileRef` wire object
        // (`{url,key,contentType,size}`) — NOT a string.  It renders as the same
        // pick → multipart `POST /files` → `FileRef` write-back the standalone
        // `FileUpload` page primitive ships (`pack.ts`), and submits the
        // `FileRef` map.  Falling through to `"text"` posts a bare `String`,
        // which every backend rejects with a 422.
        return "file";
      default:
        return "text"; // string, guid, json
    }
  }
  return undefined;
}

/** Build one flat `FlutterFormField`. */
function buildField(
  wireName: string,
  jsonKey: string,
  type: TypeIR,
  optional: boolean,
  kind: FlutterInputKind,
  enumsByName: ReadonlyMap<string, string[]>,
  objectPath?: readonly string[],
): FlutterFormField {
  const base = peel(type);
  const enumValues =
    kind === "enum" && base.kind === "enum" ? enumsByName.get(base.name) : undefined;
  const fkCollection =
    kind === "fk-select" && base.kind === "id" ? routeSegmentFor(base.targetName) : undefined;
  return {
    wireName,
    jsonKey,
    // A nested sub-field is labelled by its whole path (`addr geo lat`), so two
    // sub-fields with the same leaf name in sibling value objects stay tellable
    // apart on the form.
    label:
      objectPath && objectPath.length > 0 ? [...objectPath, jsonKey].join(" ") : humanize(wireName),
    kind,
    required: !optional,
    enumValues,
    money: isMoney(type) || undefined,
    dateOnly: isDateOnly(type) || undefined,
    objectPath,
    fkCollection,
  };
}

/** Prepare the form fields from a `{name, type, optional?}` input list.  A
 *  value-object field is FLATTENED into one field per scalar sub-field
 *  (`cost: Money` → `costAmount` / `costCurrency`); a scalar renders directly.
 *  Non-scalar / array / unresolvable-VO inputs are dropped (deferred) — but no
 *  longer SILENTLY: each drop pushes a LOUD `// TODO(flutter form-field): …`
 *  marker (M-A) alongside the rendered fields, so the omission is visible in the
 *  Dart and caught by the parity lint. */
function prepareFields(
  inputs: readonly { name: string; type: TypeIR; optional?: boolean }[],
  enumsByName: ReadonlyMap<string, string[]>,
  vosByName: ReadonlyMap<string, readonly FieldIR[]>,
  aggregatesByName: ReadonlyMap<string, EnrichedAggregateIR>,
  /** Recursion state — the value-object keys walked into so far (outermost
   *  first) and the Dart identifier prefix built from them.  Empty at the top
   *  level; `["addr"]` / `addr` one level into an `addr: Addr`. */
  nest: { path: readonly string[]; prefix: string; label: string } = {
    path: [],
    prefix: "",
    label: "",
  },
): { fields: FlutterFormField[]; dropped: string[] } {
  const out: FlutterFormField[] = [];
  const dropped: string[] = [];
  const env = flutterSpecEnv(enumsByName, vosByName, aggregatesByName);
  for (const f of inputs) {
    // Names are NEST-QUALIFIED: the Dart identifier prefixes the walked VO keys
    // (`addrGeoLat`), the drop marker uses the dotted source path (`addr.geo`),
    // and `objectPath` carries the keys so the request body re-nests.
    const r = renderFormField(formFieldSpec(f, env, f.name), FLUTTER_FORM_FIELD_ARMS, {
      input: f,
      wireName: nest.prefix ? `${nest.prefix}${upperFirst(f.name)}` : f.name,
      markerName: nest.label ? `${nest.label}.${f.name}` : f.name,
      objectPath: nest.path.length > 0 ? nest.path : undefined,
      fieldOptional: f.optional === true || f.type.kind === "optional",
      enumsByName,
      vosByName,
      aggregatesByName,
      nest,
    });
    out.push(...r.fields);
    dropped.push(...r.dropped);
  }
  return { fields: out, dropped };
}

/** The lookup env `formFieldSpec` classifies against, rebuilt from the maps the
 *  form projection already carries (it holds no bounded context). */
function flutterSpecEnv(
  enumsByName: ReadonlyMap<string, string[]>,
  vosByName: ReadonlyMap<string, readonly FieldIR[]>,
  aggregatesByName: ReadonlyMap<string, EnrichedAggregateIR>,
): FormSpecEnv {
  return {
    enumValues: (name) => enumsByName.get(name),
    valueObjectFields: (name) => vosByName.get(name),
    hasDisplay: (aggregate) => !!aggregatesByName.get(aggregate)?.displayDerived,
    isPaged: () => false,
  };
}

interface FlutterArmCtx {
  input: { name: string; type: TypeIR; optional?: boolean };
  wireName: string;
  markerName: string;
  objectPath: readonly string[] | undefined;
  fieldOptional: boolean;
  enumsByName: ReadonlyMap<string, string[]>;
  vosByName: ReadonlyMap<string, readonly FieldIR[]>;
  aggregatesByName: ReadonlyMap<string, EnrichedAggregateIR>;
  nest: { path: readonly string[]; prefix: string; label: string };
}

interface FlutterPrepared {
  fields: FlutterFormField[];
  dropped: string[];
}

/** A flat scalar input (or, when the type has no flat form, a drop marker). */
function flutterScalarArm(_f: FormFieldSpec, c: FlutterArmCtx): FlutterPrepared {
  const { input } = c;
  const kind = scalarInputKind(input.type, c.enumsByName, c.aggregatesByName);
  if (!kind) {
    // unresolved value-object / otherwise-unsupported scalar — deferred.
    const b = peel(input.type);
    const label = b.kind === "valueobject" ? `unresolved value-object ${b.name}` : b.kind;
    return { fields: [], dropped: [droppedMarker(c.markerName, `${label} field`)] };
  }
  return {
    fields: [
      buildField(
        c.wireName,
        input.name,
        input.type,
        c.fieldOptional,
        kind,
        c.enumsByName,
        c.objectPath,
      ),
    ],
    dropped: [],
  };
}

/** Value objects flatten RECURSIVELY: `addr: Addr { line, geo: Geo { lat,
 *  lng } }` becomes `addrLine` + `addrGeoLat` + `addrGeoLng`, each carrying its
 *  full `objectPath` so `bodyAssembly` rebuilds the same nesting on the wire. */
function flutterValueObjectArm(_f: FormFieldSpec, c: FlutterArmCtx): FlutterPrepared {
  const { input, nest } = c;
  const base = peel(input.type);
  const voFields = (base.kind === "valueobject" ? c.vosByName.get(base.name) : undefined) ?? [];
  const optIn = _f.kind === "optionalValueObject";
  const inner = prepareFields(
    voFields.map((sf) => ({
      name: sf.name,
      type: sf.type,
      // An opt-in group keeps each leaf's own optionality: the presence switch
      // is what makes the whole value object optional.
      optional: optIn ? sf.optional === true : c.fieldOptional || sf.optional === true,
    })),
    c.enumsByName,
    c.vosByName,
    c.aggregatesByName,
    {
      path: [...nest.path, input.name],
      prefix: nest.prefix ? `${nest.prefix}${upperFirst(input.name)}` : input.name,
      label: nest.label ? `${nest.label}.${input.name}` : input.name,
    },
  );
  if (!optIn) return inner;
  const group: FlutterPresenceGroup = {
    id: c.wireName,
    path: [...(c.objectPath ?? []), input.name],
    label: humanize(input.name),
  };
  return {
    fields: inner.fields.map((f) => ({ ...f, presence: [group, ...(f.presence ?? [])] })),
    dropped: inner.dropped,
  };
}

/** Array of value objects → each row is a group of the VO's sub-field CELLS.  A
 *  cell is any flat scalar the form already knows how to render — text / number
 *  (a `TextEditingController` in the row slot), bool (a checkbox), enum (a
 *  dropdown) or datetime (a date picker).  Only a sub-field with no flat form (a
 *  nested VO, an array, a File, an fk id) defers the whole array. */
function flutterObjectArrayArm(_f: FormFieldSpec, c: FlutterArmCtx): FlutterPrepared {
  const { input } = c;
  const base = peel(input.type);
  const elemBase = base.kind === "array" ? peel(base.element) : base;
  const voFieldsOfElem =
    elemBase.kind === "valueobject" ? c.vosByName.get(elemBase.name) : undefined;
  const objectFields: NonNullable<FlutterFormField["objectFields"]> = [];
  let allScalar = voFieldsOfElem !== undefined;
  for (const sub of voFieldsOfElem ?? []) {
    const k = scalarInputKind(sub.type, c.enumsByName, c.aggregatesByName);
    if (
      k === "text" ||
      k === "number-int" ||
      k === "number-double" ||
      k === "bool" ||
      k === "enum" ||
      k === "datetime"
    ) {
      const subBase = peel(sub.type);
      objectFields.push({
        jsonKey: sub.name,
        label: humanize(sub.name),
        kind: k,
        money: isMoney(sub.type) || undefined,
        dateOnly: isDateOnly(sub.type) || undefined,
        enumValues:
          k === "enum" && subBase.kind === "enum" ? c.enumsByName.get(subBase.name) : undefined,
        required: !(sub.optional === true || sub.type.kind === "optional") || undefined,
      });
    } else {
      allScalar = false;
      break;
    }
  }
  if (allScalar && objectFields.length > 0) {
    return {
      fields: [
        {
          wireName: c.wireName,
          jsonKey: input.name,
          label: humanize(input.name),
          kind: "object-array",
          required: !c.fieldOptional,
          elementName: elemBase.kind === "valueobject" ? elemBase.name : undefined,
          objectFields,
          objectPath: c.objectPath,
        },
      ],
      dropped: [],
    };
  }
  // A value-object array carrying a sub-field with no flat form — the whole
  // array defers, loudly.
  return {
    fields: [],
    dropped: [droppedMarker(c.markerName, "value-object array with a non-renderable sub-field")],
  };
}

/** Scalar array.  Text / numeric elements are a column of text rows; bool and
 *  enum elements are their own row editors (a checkbox / a dropdown per row).
 *  datetime / File / fk-id / unresolved element arrays stay deferred. */
function flutterScalarArrayArm(_f: FormFieldSpec, c: FlutterArmCtx): FlutterPrepared {
  const { input } = c;
  const base = peel(input.type);
  if (base.kind !== "array") return { fields: [], dropped: [] };
  const common = {
    wireName: c.wireName,
    jsonKey: input.name,
    label: humanize(input.name),
    required: !c.fieldOptional,
  };
  const elemKind = scalarInputKind(base.element, c.enumsByName, c.aggregatesByName);
  if (elemKind === "text" || elemKind === "number-int" || elemKind === "number-double") {
    return {
      fields: [
        {
          ...common,
          kind: "scalar-array",
          elementKind: elemKind,
          elementMoney: isMoney(base.element) || undefined,
          objectPath: c.objectPath,
        },
      ],
      dropped: [],
    };
  }
  if (elemKind === "bool") {
    return {
      fields: [{ ...common, kind: "bool-array", objectPath: c.objectPath }],
      dropped: [],
    };
  }
  if (elemKind === "enum") {
    const eb = peel(base.element);
    return {
      fields: [
        {
          ...common,
          kind: "enum-array",
          enumValues: eb.kind === "enum" ? c.enumsByName.get(eb.name) : undefined,
          objectPath: c.objectPath,
        },
      ],
      dropped: [],
    };
  }
  const eb = peel(base.element);
  const elemLabel =
    eb.kind === "enum"
      ? "enum"
      : eb.kind === "id"
        ? "id"
        : eb.kind === "primitive"
          ? eb.name
          : eb.kind;
  return { fields: [], dropped: [droppedMarker(c.markerName, `${elemLabel} element array`)] };
}

/** The Flutter arm per form field kind.  Every flat scalar kind shares one arm
 *  (the widget kind is read off the wire type); value objects flatten; arrays
 *  split by element. */
export const FLUTTER_FORM_FIELD_ARMS: FormFieldArms<FlutterPrepared, FlutterArmCtx> = {
  string: flutterScalarArm,
  int: flutterScalarArm,
  decimal: flutterScalarArm,
  money: flutterScalarArm,
  bool: flutterScalarArm,
  date: flutterScalarArm,
  datetime: flutterScalarArm,
  file: flutterScalarArm,
  enum: flutterScalarArm,
  ref: flutterScalarArm,
  optionalRef: flutterScalarArm,
  valueObject: flutterValueObjectArm,
  optionalValueObject: flutterValueObjectArm,
  scalarArray: flutterScalarArrayArm,
  enumArray: flutterScalarArrayArm,
  refArray: flutterScalarArrayArm,
  objectArray: flutterObjectArrayArm,
};

/** Enum name → values from a bounded context. */
function enumsFromBc(bc: EnrichedBoundedContextIR | undefined): Map<string, string[]> {
  const m = new Map<string, string[]>();
  if (bc) for (const e of enumPool(bc)) m.set(e.name, e.values);
  return m;
}

/** Value-object name → its fields, over the context's own declarations PLUS the
 *  sibling contexts' — a `valueobject` declared in another context and merely
 *  REFERENCED here resolves through `valueObjectPool` (see
 *  `BoundedContextIR.siblingValueObjects`).  Without it the form field silently
 *  became `// TODO(flutter form-field): … unresolved value-object … dropped`
 *  while the SAME VO on a same-context aggregate flattened into its
 *  `<field>Amount` / `<field>Currency` inputs. */
function vosFromBc(bc: EnrichedBoundedContextIR | undefined): Map<string, readonly FieldIR[]> {
  const m = new Map<string, readonly FieldIR[]>();
  if (bc) for (const vo of valueObjectPool(bc)) m.set(vo.name, vo.fields);
  return m;
}

// ---------------------------------------------------------------------------
// Spec builders
// ---------------------------------------------------------------------------

/** Attach the client-side rules an invariant set implies to the TOP-LEVEL
 *  fields that carry them, in place.  A field flattened out of a value object
 *  (`objectPath` non-empty) is skipped: an aggregate/operation invariant names
 *  the value-object FIELD (`cost`), never one of its sub-fields, so there is
 *  nothing to attach and a name collision (`amount` on two different VOs)
 *  would otherwise mis-attach.  `available` is the same field-name set the
 *  classifier is given, so a rule on a field the form does not render is
 *  refused at the gate rather than dropped here. */
function attachRules(
  fields: FlutterFormField[],
  invariants: readonly InvariantIR[],
  available: ReadonlySet<string>,
): void {
  const byField = flutterValidatorMap(invariants, available);
  if (byField.size === 0) return;
  for (const f of fields) {
    if (f.objectPath && f.objectPath.length > 0) continue;
    const rules = byField.get(f.wireName);
    if (rules && rules.length > 0) f.rules = rules;
  }
}

/** An operation's `precondition` statements as invariants — the same
 *  normalisation every wire-validator emitter does before classifying
 *  (`_i18n/validation-catalog.ts` does it verbatim). */
function preconditionsAsInvariants(op: OperationIR): InvariantIR[] {
  const out: InvariantIR[] = [];
  for (const st of op.statements) {
    if (st.kind === "precondition")
      out.push({ expr: st.expr, source: st.source, message: st.message });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Identity-keyed model text (i18n)
// ---------------------------------------------------------------------------

/** The translatable-ui switch the spec builders take: its presence means the
 *  ui ships `lib/i18n.dart`, so a form's labels, enum options and submit button
 *  render through `t(<identity key>, <default>)`; `contexts` resolve the key
 *  namespace.  Absent ⇒ every site keeps its literal English, byte-identical. */
export interface FlutterFormText {
  readonly contexts: readonly EnrichedBoundedContextIR[];
}

/** `t('<key>', '<default>')` — the Dart translation call for a model fact. */
function dartTranslate(key: string, defaultText: string): string {
  return `t(${dartStringLit(key)}, ${dartStringLit(sourceText(key, defaultText))})`;
}

/** Where a form's inputs come from, for keying their text by model identity. */
interface FormTextSource {
  readonly inputs: readonly { name: string; type: TypeIR }[];
  readonly ownerOf: (name: string) => string | undefined;
  readonly bc: EnrichedBoundedContextIR | undefined;
  readonly text: FlutterFormText;
}

function inputTextOf(
  src: FormTextSource,
  path: readonly string[],
  leaf: string,
  /** Label a flattened value-object leaf by its whole path (`Address Street`),
   *  each segment its own identity key — the translated twin of the literal
   *  `addr geo lat` label, which keeps two sibling value objects' same-named
   *  leaves tellable apart.  False: the leaf's own label alone. */
  joinPath = false,
): { labelExpr: string; optionExprs?: Record<string, string> } | undefined {
  const textOf = (p: readonly string[], l: string): FormInputModelText | undefined =>
    formInputModelText(src.inputs, p, l, src.ownerOf, src.bc, src.text.contexts);
  const t = textOf(path, leaf);
  if (!t) return undefined;
  const segments =
    joinPath && path.length > 0 ? path.map((k, i) => textOf(path.slice(0, i), k)) : [];
  const joined =
    segments.length > 0 && segments.every((s) => s !== undefined)
      ? [...segments, t].map((s) => dartTranslate(s!.key, s!.defaultText))
      : undefined;
  return {
    labelExpr: joined ? `[${joined.join(", ")}].join(' ')` : dartTranslate(t.key, t.defaultText),
    ...(t.enumOptions
      ? {
          optionExprs: Object.fromEntries(
            t.enumOptions.map((o) => [o.value, dartTranslate(o.key, o.defaultText)]),
          ),
        }
      : {}),
  };
}

/** Attach the identity-keyed label / option expressions to the prepared fields
 *  (and the cells of an object-array), in place.  A flattened value-object leaf
 *  resolves through its `objectPath`. */
function attachModelText(fields: FlutterFormField[], src: FormTextSource | undefined): void {
  if (!src) return;
  for (const f of fields) {
    f.translateMessages = true;
    const own = inputTextOf(src, f.objectPath ?? [], f.jsonKey, true);
    if (own) {
      f.labelExpr = own.labelExpr;
      if (own.optionExprs) f.optionExprs = own.optionExprs;
    }
    for (const sf of f.objectFields ?? []) {
      const cell = inputTextOf(src, [...(f.objectPath ?? []), f.jsonKey], sf.jsonKey);
      if (!cell) continue;
      sf.labelExpr = cell.labelExpr;
      if (cell.optionExprs) sf.optionExprs = cell.optionExprs;
    }
  }
}

/** The submit button's identity-keyed `<Agg>.op.<op>` text, or undefined. */
function opSubmitExpr(
  aggName: string,
  opName: string,
  bc: EnrichedBoundedContextIR | undefined,
  text: FlutterFormText | undefined,
): string | undefined {
  if (!text || !bc) return undefined;
  const e = modelTextEntry({
    ctx: modelTextContextOf(aggName, bc, text.contexts),
    type: aggName,
    facet: "op",
    member: opName,
  });
  return dartTranslate(e.key, e.defaultText);
}

/** A hand-built form sentence as a Dart `Text` widget: the catalog lookup in a
 *  translatable app, else the constant English literal. */
function sentenceText(translate: boolean, name: string): string {
  const english = chromeMessage(name);
  return translate
    ? `Text(${dartTranslate(chromeKey(name), english)})`
    : `const Text('${dartStr(english)}')`;
}

/** Build the `FlutterFormSpec` for a `CreateForm(of: agg)`. */
export function flutterCreateForm(
  agg: EnrichedAggregateIR,
  bc: EnrichedBoundedContextIR | undefined,
  aggregatesByName: ReadonlyMap<string, EnrichedAggregateIR>,
  text?: FlutterFormText,
): FlutterFormSpec {
  const inputs = createInputFields(agg);
  const { fields, dropped } = prepareFields(
    inputs,
    enumsFromBc(bc),
    vosFromBc(bc),
    aggregatesByName,
  );
  attachRules(fields, agg.invariants, new Set(inputs.map((i) => i.name)));
  attachModelText(fields, text && { inputs, ownerOf: () => agg.name, bc, text });
  const submitExpr = opSubmitExpr(agg.name, "create", bc, text);
  return {
    widgetName: createFormWidgetName(agg.name),
    kind: "create",
    aggregate: agg.name,
    needsId: false,
    pathExpr: `/${routeSegmentFor(agg.name)}`,
    submitLabel: opDefaultText(agg.name, "create"),
    ...(submitExpr ? { submitExpr } : {}),
    fields,
    dropped,
    destructive: false,
  };
}

/** Build the `FlutterFormSpec` for an `OperationForm(of: agg, op: op)`. */
export function flutterOperationForm(
  aggName: string,
  op: OperationIR,
  bc: EnrichedBoundedContextIR | undefined,
  aggregatesByName: ReadonlyMap<string, EnrichedAggregateIR>,
  /** The operated-on aggregate, when resolvable — its `invariant`s join the
   *  operation's own `precondition`s as the rule source, exactly as every wire
   *  validator composes them.  Optional so a call site that only has the name
   *  still type-checks; a missing aggregate means the preconditions alone are
   *  classified. */
  agg?: EnrichedAggregateIR,
  text?: FlutterFormText,
): FlutterFormSpec {
  // The masked merge-patch keys stay off the form (`operationFormParams`).
  const formParams = operationFormParams(op);
  const { fields, dropped } = prepareFields(
    formParams,
    enumsFromBc(bc),
    vosFromBc(bc),
    aggregatesByName,
  );
  const takesRecord = agg !== undefined && opFormTakesRecord(agg, op);
  if (agg && takesRecord) {
    const spec = operationFormSpec(
      agg,
      op,
      flutterSpecEnv(enumsFromBc(bc), vosFromBc(bc), aggregatesByName),
    );
    const seeded = new Set(
      spec.fields.filter((f) => f.prefill.from === "record").map((f) => f.name),
    );
    for (const f of fields) if (seeded.has(f.objectPath?.[0] ?? f.jsonKey)) f.fromRecord = true;
  }
  attachRules(
    fields,
    [...(agg?.invariants ?? []), ...preconditionsAsInvariants(op)],
    new Set(formParams.map((pp) => pp.name)),
  );
  attachModelText(
    fields,
    text && {
      inputs: formParams,
      ownerOf: (name) => (agg ? paramLabelOwner(agg, name) : undefined),
      bc,
      text,
    },
  );
  const submitExpr = opSubmitExpr(aggName, op.name, bc, text);
  const opPath = snake(op.routeSlug ?? op.name);
  return {
    widgetName: operationFormWidgetName(aggName, op.name),
    kind: "operation",
    aggregate: aggName,
    needsId: true,
    pathExpr: `/${routeSegmentFor(aggName)}/\${widget.id}/${opPath}`,
    submitLabel: humanize(op.name),
    ...(submitExpr ? { submitExpr } : {}),
    fields,
    dropped,
    destructive: false,
    ...(agg && sendsIfMatchPrecondition(agg, op) ? { ifMatch: true } : {}),
    ...(takesRecord ? { takesRecord: true as const } : {}),
    ...(op.when ? { gateProbe: { provider: canProbeProviderName(aggName, op.name) } } : {}),
  };
}

/** Build the `FlutterFormSpec` for a `DestroyForm(of: agg)`. */
function flutterDestroyForm(aggName: string, text?: FlutterFormText): FlutterFormSpec {
  // The delete button is the whole sentence `chrome.deleteEntity.<Agg>`, the one
  // every other frontend renders — not a "Delete " frame around the name.
  const name = sentenceChromeName("deleteEntity", aggName);
  const submitExpr = text ? dartTranslate(chromeKey(name), chromeMessage(name)) : undefined;
  return {
    widgetName: destroyFormWidgetName(aggName),
    kind: "destroy",
    aggregate: aggName,
    needsId: true,
    pathExpr: `/${routeSegmentFor(aggName)}/\${widget.id}`,
    submitLabel: chromeMessage(name),
    ...(submitExpr ? { submitExpr } : {}),
    fields: [],
    dropped: [],
    destructive: true,
  };
}

/** Build the `FlutterFormSpec` for a `WorkflowForm(runs: wf)`.  Structurally a
 *  create form — a plain POST of the workflow params as a JSON body — but the
 *  endpoint is the command route `/workflows/<wf>` (matching every backend's
 *  workflow-command emit).  Reuses the `"create"` widget shape (POST + body +
 *  `GlobalKey<FormState>`, no route id). */
export function flutterWorkflowForm(
  wf: WorkflowIR,
  bc: EnrichedBoundedContextIR | undefined,
  aggregatesByName: ReadonlyMap<string, EnrichedAggregateIR>,
  text?: FlutterFormText,
): FlutterFormSpec {
  const { fields, dropped } = prepareFields(
    wf.params,
    enumsFromBc(bc),
    vosFromBc(bc),
    aggregatesByName,
  );
  attachModelText(fields, text && { inputs: wf.params, ownerOf: () => wf.name, bc, text });
  const run = bc ? workflowRunEntry(wf.name, bc, text?.contexts ?? [bc]) : undefined;
  return {
    widgetName: workflowFormWidgetName(wf.name),
    kind: "create",
    aggregate: wf.name,
    needsId: false,
    pathExpr: `/workflows/${snake(wf.name)}`,
    submitLabel: run ? run.defaultText : opDefaultText(wf.name, "run"),
    ...(text && run ? { submitExpr: dartTranslate(run.key, run.defaultText) } : {}),
    fields,
    dropped,
    destructive: false,
  };
}

// ---------------------------------------------------------------------------
// Collection — scan a ui's pages for the form primitives they host
// ---------------------------------------------------------------------------

/** Direct child expressions of `e`, from the shared `never`-checked walker —
 *  every expression slot, including each `match` arm (where a scaffolded filter
 *  bar hosts both of its reads).  Lambda-block statements are action bodies,
 *  never a read or form host, so the statement channel is not followed. */
function exprChildren(e: ExprIR): ExprIR[] {
  const out: ExprIR[] = [];
  walkExprChildren(e, { expr: (c) => out.push(c) });
  return out;
}

/** The named-arg value of a call, or undefined. */
function namedArg(e: Extract<ExprIR, { kind: "call" }>, name: string): ExprIR | undefined {
  const names = e.argNames ?? [];
  const idx = names.indexOf(name);
  return idx >= 0 ? e.args[idx] : undefined;
}

/** Walk a page body, building a form spec for each hosted form primitive,
 *  deduped by widget name.  A form whose aggregate/op can't be resolved (or a
 *  non-constructible create) is skipped — the seam then emits a comment. */
function collectBodyForms(
  body: ExprIR,
  aggregatesByName: ReadonlyMap<string, EnrichedAggregateIR>,
  bcByAggregate: ReadonlyMap<string, EnrichedBoundedContextIR>,
  out: FlutterFormSpec[],
  seen: Set<string>,
  text?: FlutterFormText,
): void {
  const push = (spec: FlutterFormSpec): void => {
    if (seen.has(spec.widgetName)) return;
    seen.add(spec.widgetName);
    out.push(spec);
  };
  const pushOp = (agg: EnrichedAggregateIR, opName: string): void => {
    const op = agg.operations.find((o) => o.name === opName && o.visibility === "public");
    if (op)
      push(
        flutterOperationForm(
          agg.name,
          op,
          bcByAggregate.get(agg.name),
          aggregatesByName,
          agg,
          text,
        ),
      );
  };
  // Aggregate-typed bindings in scope, so the INSTANCE-QUALIFIED
  // `OperationForm { data.<op> }` the Detail scaffold emits inside its QueryView
  // `data:` lambda resolves to a widget here — without it the renderer resolved
  // the form (through the walker's `paramTypes`) while this collector emitted
  // nothing, and `lib/forms.dart` was missing the class the page names.
  //
  // Deliberately MORE permissive than the walker (it does not re-derive the
  // query's single/paged shape): an over-collected widget is an unused class in
  // a library file, a MISSING one is a Dart compile error.
  const walk = (e: ExprIR, scope: ReadonlyMap<string, EnrichedAggregateIR>): void => {
    let childScope = scope;
    if (e.kind === "call") {
      if (e.name === "CreateForm") {
        const ofArg = namedArg(e, "of");
        const agg = ofArg?.kind === "ref" ? aggregatesByName.get(ofArg.name) : undefined;
        if (agg && isConstructible(agg))
          push(flutterCreateForm(agg, bcByAggregate.get(agg.name), aggregatesByName, text));
      } else if (e.name === "OperationForm") {
        const ofArg = namedArg(e, "of");
        const opArg = namedArg(e, "op");
        const agg = ofArg?.kind === "ref" ? aggregatesByName.get(ofArg.name) : undefined;
        if (agg && opArg?.kind === "ref") {
          pushOp(agg, opArg.name);
        } else {
          const inst = (e.args ?? []).find((_, i) => !(e.argNames ?? [])[i]);
          const recv =
            inst?.kind === "member" && inst.receiver.kind === "ref"
              ? scope.get(inst.receiver.name)
              : undefined;
          if (recv && inst?.kind === "member") pushOp(recv, inst.member);
        }
      } else if (e.name === "DestroyForm") {
        const ofArg = namedArg(e, "of");
        const agg = ofArg?.kind === "ref" ? aggregatesByName.get(ofArg.name) : undefined;
        if (agg) push(flutterDestroyForm(agg.name, text));
      } else if (e.name === "QueryView") {
        const agg = queryViewAggregate(namedArg(e, "of"), aggregatesByName);
        const data = namedArg(e, "data");
        if (agg && data?.kind === "lambda" && data.param) {
          childScope = new Map([...scope, [data.param, agg]]);
        }
      }
    }
    for (const c of exprChildren(e)) walk(c, childScope);
  };
  walk(body, new Map());
}

/** The aggregate a `QueryView { of: … }` reads, by the same peel the shared
 *  walker's `singleAggregateOfQuery` uses: step past a method call's receiver
 *  and past a standard verb (`all` / `byId` / …) that is not itself a declared
 *  aggregate name. */
function queryViewAggregate(
  ofArg: ExprIR | undefined,
  aggregatesByName: ReadonlyMap<string, EnrichedAggregateIR>,
): EnrichedAggregateIR | undefined {
  if (!ofArg) return undefined;
  let recv = ofArg.kind === "method-call" ? ofArg.receiver : ofArg;
  if (
    recv.kind === "member" &&
    STANDARD_AGG_OPS.has(recv.member) &&
    !aggregatesByName.has(recv.member)
  ) {
    recv = recv.receiver;
  }
  const name = recv.kind === "member" ? recv.member : recv.kind === "ref" ? recv.name : undefined;
  return name ? aggregatesByName.get(name) : undefined;
}

/** Collect every form a single page hosts (drives the page's forms import). */
export function collectPageForms(
  body: ExprIR | undefined,
  aggregatesByName: ReadonlyMap<string, EnrichedAggregateIR>,
  bcByAggregate: ReadonlyMap<string, EnrichedBoundedContextIR>,
  i18n = false,
): FlutterFormSpec[] {
  if (!body) return [];
  const out: FlutterFormSpec[] = [];
  collectBodyForms(
    body,
    aggregatesByName,
    bcByAggregate,
    out,
    new Set(),
    i18n ? { contexts: [...new Set(bcByAggregate.values())] } : undefined,
  );
  return out;
}

/** Collect every distinct form a ui's pages host — deduped by widget name
 *  across the whole ui (the set emitted into `lib/forms.dart`). */
export function collectFlutterForms(
  ui: UiIR | undefined,
  aggregatesByName: ReadonlyMap<string, EnrichedAggregateIR>,
  bcByAggregate: ReadonlyMap<string, EnrichedBoundedContextIR>,
  i18n = false,
): FlutterFormSpec[] {
  if (!ui) return [];
  const out: FlutterFormSpec[] = [];
  const seen = new Set<string>();
  const text = i18n ? { contexts: [...new Set(bcByAggregate.values())] } : undefined;
  for (const page of ui.pages ?? []) {
    if (!page.body) continue;
    collectBodyForms(page.body, aggregatesByName, bcByAggregate, out, seen, text);
  }
  return out;
}

/** Walk a page body building a workflow-form spec per `WorkflowForm(runs: <wf>)`
 *  it hosts, deduped by widget name.  A `runs:` that doesn't resolve to a
 *  reachable workflow is skipped (the seam then emits a comment). */
function collectBodyWorkflowForms(
  body: ExprIR,
  workflowsByName: ReadonlyMap<string, WorkflowIR>,
  bcByWorkflow: ReadonlyMap<string, EnrichedBoundedContextIR>,
  aggregatesByName: ReadonlyMap<string, EnrichedAggregateIR>,
  out: FlutterFormSpec[],
  seen: Set<string>,
  text?: FlutterFormText,
): void {
  const walk = (e: ExprIR): void => {
    if (e.kind === "call" && e.name === "WorkflowForm") {
      const runsArg = namedArg(e, "runs");
      const wf = runsArg?.kind === "ref" ? workflowsByName.get(runsArg.name) : undefined;
      // An event-only saga has no command route (`emitsCommandRoute`) — no form widget.
      if (wf && emitsCommandRoute(wf) && !seen.has(workflowFormWidgetName(wf.name))) {
        seen.add(workflowFormWidgetName(wf.name));
        out.push(flutterWorkflowForm(wf, bcByWorkflow.get(wf.name), aggregatesByName, text));
      }
    }
    for (const c of exprChildren(e)) walk(c);
  };
  walk(body);
}

/** Collect every workflow-run form a single page hosts (drives the page's forms
 *  import alongside the aggregate forms). */
export function collectPageWorkflowForms(
  body: ExprIR | undefined,
  workflowsByName: ReadonlyMap<string, WorkflowIR>,
  bcByWorkflow: ReadonlyMap<string, EnrichedBoundedContextIR>,
  aggregatesByName: ReadonlyMap<string, EnrichedAggregateIR>,
  i18n = false,
): FlutterFormSpec[] {
  if (!body) return [];
  const out: FlutterFormSpec[] = [];
  collectBodyWorkflowForms(
    body,
    workflowsByName,
    bcByWorkflow,
    aggregatesByName,
    out,
    new Set(),
    i18n ? { contexts: [...new Set(bcByWorkflow.values())] } : undefined,
  );
  return out;
}

/** Collect every distinct workflow-run form a ui's pages host — deduped by
 *  widget name across the whole ui (appended to the `lib/forms.dart` set). */
export function collectFlutterWorkflowForms(
  ui: UiIR | undefined,
  workflowsByName: ReadonlyMap<string, WorkflowIR>,
  bcByWorkflow: ReadonlyMap<string, EnrichedBoundedContextIR>,
  aggregatesByName: ReadonlyMap<string, EnrichedAggregateIR>,
  i18n = false,
): FlutterFormSpec[] {
  if (!ui) return [];
  const out: FlutterFormSpec[] = [];
  const seen = new Set<string>();
  const text = i18n ? { contexts: [...new Set(bcByWorkflow.values())] } : undefined;
  for (const page of ui.pages ?? []) {
    if (!page.body) continue;
    collectBodyWorkflowForms(
      page.body,
      workflowsByName,
      bcByWorkflow,
      aggregatesByName,
      out,
      seen,
      text,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dart widget emission
// ---------------------------------------------------------------------------

/** The private Dart state identifier for a field (`name` → `_name`). */
function stateId(wireName: string): string {
  return `_${lowerFirst(wireName)}`;
}

/** The `TextEditingController` field name (`price` → `_priceController`). */
function ctrlId(wireName: string): string {
  return `${stateId(wireName)}Controller`;
}

/** The controller-list field name for a scalar-array field
 *  (`tags` → `_tagsControllers`) — one `TextEditingController` per row. */
function arrayCtrlsId(wireName: string): string {
  return `${stateId(wireName)}Controllers`;
}

/** The row-list field name for an object-array field (`items` → `_itemsRows`).
 *  Each row is a `List<dynamic>`, one slot per VO sub-field: a text / number
 *  cell holds its `TextEditingController`, a bool / enum / datetime cell holds
 *  the VALUE itself.  One heterogeneous list (rather than a controller list
 *  plus a parallel value list) keeps row add / remove a single operation and
 *  the cell index the same on both sides. */
function rowsId(wireName: string): string {
  return `${stateId(wireName)}Rows`;
}

/** The value-list field name for a bool / enum element array
 *  (`flags` → `_flagsValues`) — the non-text twin of `arrayCtrlsId`. */
function arrayValuesId(wireName: string): string {
  return `${stateId(wireName)}Values`;
}

/** True when the field is backed by a `TextEditingController`. */
function isTextBacked(f: FlutterFormField): boolean {
  return f.kind === "text" || f.kind === "number-int" || f.kind === "number-double";
}

/** Escape a bare label for a single-quoted Dart string literal. */
function dartStr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\$/g, "\\$");
}

/** The presence flag identifier of an opt-in group (`vehicle` → `_vehiclePresent`). */
function presenceId(g: FlutterPresenceGroup): string {
  return `${stateId(g.id)}Present`;
}

/** The distinct opt-in groups a form's fields sit under, in first-seen order. */
function presenceGroups(fields: readonly FlutterFormField[]): FlutterPresenceGroup[] {
  const seen = new Map<string, FlutterPresenceGroup>();
  for (const f of fields) for (const g of f.presence ?? []) if (!seen.has(g.id)) seen.set(g.id, g);
  return [...seen.values()];
}

/** The Dart condition under which a field is mounted ("" when ungrouped). */
function presenceCond(groups: readonly FlutterPresenceGroup[] | undefined): string {
  return (groups ?? []).map(presenceId).join(" && ");
}

/** The state field declarations for a form's non-text-backed inputs. */
function stateDecls(fields: readonly FlutterFormField[]): string[] {
  const out: string[] = presenceGroups(fields).map((g) => `  bool ${presenceId(g)} = false;`);
  for (const f of fields) {
    if (isTextBacked(f)) {
      out.push(`  final ${ctrlId(f.wireName)} = TextEditingController();`);
    } else if (f.kind === "bool") {
      out.push(`  bool ${stateId(f.wireName)} = false;`);
    } else if (f.kind === "enum") {
      const first =
        f.required && f.enumValues && f.enumValues.length > 0 ? f.enumValues[0] : undefined;
      out.push(`  String? ${stateId(f.wireName)}${first ? ` = '${dartStr(first)}'` : ""};`);
    } else if (f.kind === "datetime") {
      out.push(`  DateTime? ${stateId(f.wireName)};`);
    } else if (f.kind === "file") {
      // The uploaded `FileRef` (null until the user picks + the upload lands).
      out.push(`  FileRef? ${stateId(f.wireName)};`);
    } else if (f.kind === "fk-select") {
      out.push(`  String? ${stateId(f.wireName)};`);
      out.push(`  List<Map<String, dynamic>> ${optionsId(f.wireName)} = const [];`);
    } else if (f.kind === "scalar-array") {
      out.push(`  final List<TextEditingController> ${arrayCtrlsId(f.wireName)} = [];`);
    } else if (f.kind === "bool-array") {
      out.push(`  final List<bool> ${arrayValuesId(f.wireName)} = [];`);
    } else if (f.kind === "enum-array") {
      out.push(`  final List<String> ${arrayValuesId(f.wireName)} = [];`);
    } else if (f.kind === "object-array") {
      // `dynamic` slots — see `rowsId`: a text cell stores its controller, a
      // bool / enum / datetime cell stores its value.
      out.push(`  final List<List<dynamic>> ${rowsId(f.wireName)} = [];`);
    }
  }
  return out;
}

/** The options-list state identifier for an fk-select field
 *  (`category` → `_categoryOptions`). */
function optionsId(wireName: string): string {
  return `${stateId(wireName)}Options`;
}

/** The async loader-method name for an fk-select field
 *  (`category` → `_loadCategoryOptions`). */
function loaderId(wireName: string): string {
  return `_load${upperFirst(wireName)}Options`;
}

/** The Dart expression reading one flattened input's value out of the record's
 *  wire map `r` — through its value-object `objectPath`, null at any absent
 *  level. */
function recordLeaf(f: FlutterFormField, rowKey = f.jsonKey): string {
  let e = "r";
  for (const k of f.objectPath ?? []) e = `(${e}['${dartStr(k)}'] as Map<String, dynamic>?)`;
  return `${e}${(f.objectPath ?? []).length > 0 ? "?" : ""}['${dartStr(rowKey)}']`;
}

/** One object-array cell's initial slot value, read out of the row map `m`. */
function recordCell(sf: NonNullable<FlutterFormField["objectFields"]>[number]): string {
  const v = `m['${dartStr(sf.jsonKey)}']`;
  switch (sf.kind) {
    case "bool":
      return `${v} == true`;
    case "enum":
      return `${v} as String?`;
    case "datetime":
      return `DateTime.tryParse(${v}?.toString() ?? '')`;
    default:
      return `TextEditingController(text: ${v}?.toString() ?? '')`;
  }
}

/** The `initState` statements seeding the record-prefilled inputs from
 *  `widget.record` (empty when no input prefills).  The inverse of
 *  `fieldValueExpr`: each kind reads the same wire form it submits. */
function recordSeeds(fields: readonly FlutterFormField[]): string[] {
  const out: string[] = [];
  for (const g of presenceGroups(fields)) {
    if (!fields.some((f) => f.fromRecord && f.presence?.some((p) => p.id === g.id))) continue;
    let e = "r";
    for (const k of g.path) {
      e = `${e === "r" ? "r" : `(${e} as Map<String, dynamic>?)?`}['${dartStr(k)}']`;
    }
    out.push(`      ${presenceId(g)} = ${e} != null;`);
  }
  for (const f of fields) {
    if (!f.fromRecord) continue;
    const v = recordLeaf(f);
    const st = stateId(f.wireName);
    switch (f.kind) {
      case "text":
      case "number-int":
      case "number-double":
        out.push(`      ${ctrlId(f.wireName)}.text = ${v}?.toString() ?? '';`);
        break;
      case "bool":
        out.push(`      ${st} = ${v} == true;`);
        break;
      case "enum":
        out.push(`      ${st} = ${v} as String? ?? ${st};`);
        break;
      case "fk-select":
        out.push(`      ${st} = ${v} as String?;`);
        break;
      case "datetime":
        out.push(`      ${st} = DateTime.tryParse(${v}?.toString() ?? '');`);
        break;
      case "file":
        out.push(
          `      final ${st}Json = ${v};`,
          `      ${st} = ${st}Json is Map<String, dynamic> ? FileRef.fromJson(${st}Json) : null;`,
        );
        break;
      case "scalar-array":
        out.push(
          `      for (final e in (${v} as List? ?? const [])) { ${arrayCtrlsId(f.wireName)}.add(TextEditingController(text: e?.toString() ?? '')); }`,
        );
        break;
      case "bool-array":
        out.push(
          `      ${arrayValuesId(f.wireName)}.addAll((${v} as List? ?? const []).map((e) => e == true));`,
        );
        break;
      case "enum-array":
        out.push(
          `      ${arrayValuesId(f.wireName)}.addAll((${v} as List? ?? const []).map((e) => e.toString()));`,
        );
        break;
      case "object-array": {
        const cells = (f.objectFields ?? []).map(recordCell).join(", ");
        out.push(
          `      for (final e in (${v} as List? ?? const [])) { final m = e as Map<String, dynamic>; ${rowsId(f.wireName)}.add(<dynamic>[${cells}]); }`,
        );
        break;
      }
    }
  }
  return out.length === 0
    ? []
    : ["    final r = widget.record;", "    if (r != null) {", ...out, "    }"];
}

/** The `initState` + per-field loader methods for a form's fk-select inputs
 *  (empty when the form hosts none and seeds nothing from a record).  Each
 *  loader GETs `/<collection>`, unwraps the paged `{items}` envelope, and
 *  stores the rows as the dropdown options. */
function fkLoaders(fields: readonly FlutterFormField[]): string[] {
  const fks = fields.filter((f) => f.kind === "fk-select");
  const seeds = recordSeeds(fields);
  if (fks.length === 0 && seeds.length === 0) return [];
  const out: string[] = [
    "  @override",
    "  void initState() {",
    "    super.initState();",
    ...seeds,
    ...fks.map((f) => `    ${loaderId(f.wireName)}();`),
    "  }",
  ];
  for (const f of fks) {
    out.push(
      "",
      `  Future<void> ${loaderId(f.wireName)}() async {`,
      "    try {",
      `      final res = await http.get(apiUri('/${f.fkCollection}'));`,
      "      if (res.statusCode < 200 || res.statusCode >= 300) return;",
      "      final decoded = jsonDecode(res.body);",
      "      final raw = decoded is Map<String, dynamic> ? decoded['items'] : decoded;",
      "      if (raw is! List || !mounted) return;",
      "      setState(() {",
      `        ${optionsId(f.wireName)} = raw.whereType<Map<String, dynamic>>().toList();`,
      "      });",
      "    } catch (_) {",
      "      // A failed option load leaves the dropdown empty — never crashes the form.",
      "    }",
      "  }",
    );
  }
  return out;
}

/** The pick-and-upload method name for a `file` field
 *  (`avatar` → `_pickAvatar`). */
function pickerId(wireName: string): string {
  return `_pick${upperFirst(wireName)}`;
}

/** True when the form hosts at least one `file` input — drives the extra
 *  `file_picker` / `models.dart` imports and the `file_picker` pubspec dep. */
export function formHasFileField(spec: FlutterFormSpec): boolean {
  return spec.fields.some((f) => f.kind === "file");
}

/** True when ANY collected form hosts a `file` input.  The pubspec/Makefile
 *  gate: an in-form File field pulls `file_picker` exactly as a standalone
 *  `FileUpload` primitive does. */
export function formsUseFilePicker(forms: readonly FlutterFormSpec[]): boolean {
  return forms.some(formHasFileField);
}

/** The per-`file`-field pick + upload methods.  Each picks a file (with bytes —
 *  web needs `withData`), POSTs it as multipart to `/files`, and stores the
 *  returned `FileRef` in state.  Same contract as the standalone `FileUpload`
 *  page primitive (`pack.ts`), so both paths hit the one objectStore route. */
function filePickers(fields: readonly FlutterFormField[]): string[] {
  const out: string[] = [];
  for (const f of fields) {
    if (f.kind !== "file") continue;
    const st = stateId(f.wireName);
    out.push(
      "",
      `  Future<void> ${pickerId(f.wireName)}() async {`,
      "    final picked = await FilePicker.platform.pickFiles(withData: true);",
      "    if (picked == null || picked.files.isEmpty) return;",
      "    final pf = picked.files.single;",
      "    if (pf.bytes == null) return;",
      "    try {",
      "      final req = http.MultipartRequest('POST', apiUri('/files'))",
      "        ..files.add(http.MultipartFile.fromBytes('file', pf.bytes!, filename: pf.name));",
      "      final resp = await http.Response.fromStream(await req.send());",
      "      if (!mounted) return;",
      "      if (resp.statusCode >= 200 && resp.statusCode < 300) {",
      `        setState(() => ${st} = FileRef.fromJson(jsonDecode(resp.body) as Map<String, dynamic>));`,
      "      } else {",
      // Escaped template literal — the `${resp.statusCode}` stays Dart interp.
      `        setState(() => _error = ServerIssue.plain('Upload failed (\${resp.statusCode})'));`,
      "      }",
      "    } catch (e) {",
      "      if (mounted) setState(() => _error = ServerIssue.plain('$e'));",
      "    }",
      "  }",
    );
  }
  return out;
}

/** The `dispose` overrides for text-backed controllers + scalar-array
 *  controller lists. */
function disposeBody(fields: readonly FlutterFormField[]): string[] {
  const out = fields.filter(isTextBacked).map((f) => `    ${ctrlId(f.wireName)}.dispose();`);
  for (const f of fields) {
    if (f.kind === "scalar-array") {
      out.push(`    for (final c in ${arrayCtrlsId(f.wireName)}) c.dispose();`);
    } else if (f.kind === "object-array") {
      // Only the text cells own a controller (`rowsId`); a bool / enum /
      // datetime slot is a plain value with nothing to dispose.
      out.push(
        `    for (final row in ${rowsId(f.wireName)}) { for (final c in row) { if (c is TextEditingController) c.dispose(); } }`,
      );
    }
  }
  return out;
}

/** The Dart expression producing one field's submit value. */
function fieldValueExpr(f: FlutterFormField): string {
  const ctrl = `${ctrlId(f.wireName)}.text`;
  switch (f.kind) {
    case "text":
      return f.required ? ctrl : `${ctrl}.isEmpty ? null : ${ctrl}`;
    case "number-int":
      return f.required
        ? `int.tryParse(${ctrl})`
        : `${ctrl}.isEmpty ? null : int.tryParse(${ctrl})`;
    case "number-double": {
      // `money` submits THE TEXT THE USER TYPED, trimmed — the backend's
      // request schema is `z.string()` over `^-?\d+(\.\d+)?$` and it
      // quantizes at the `NUMERIC(19,4)` column, so the digits go out exactly
      // as entered.  Routing them through `double.tryParse` first (what this
      // did before M-T1.21) re-quantized every amount through a binary float
      // on the way to a field that is precise by definition.  `decimal` is the
      // control — it really is a JSON number, and stays one.
      if (f.money) {
        const trimmed = `${ctrl}.trim()`;
        return f.required ? trimmed : `${ctrl}.trim().isEmpty ? null : ${trimmed}`;
      }
      const parsed = `double.tryParse(${ctrl})`;
      return f.required ? parsed : `${ctrl}.isEmpty ? null : ${parsed}`;
    }
    case "bool":
      return stateId(f.wireName);
    case "enum":
      return stateId(f.wireName);
    case "fk-select":
      return stateId(f.wireName);
    case "datetime":
      return pickedWire(stateId(f.wireName), f.dateOnly);
    case "file":
      // The `{url,key,contentType,size}` object the backend's File column wants.
      return `${stateId(f.wireName)}?.toJson()`;
    case "scalar-array": {
      const ctrls = arrayCtrlsId(f.wireName);
      if (f.elementKind === "number-int") {
        return `${ctrls}.map((c) => int.tryParse(c.text)).whereType<int>().toList()`;
      }
      if (f.elementKind === "number-double") {
        // A `money[]` element carries the typed digits through unparsed, the
        // same rule the scalar arm above follows; a blank row drops out.
        return f.elementMoney
          ? `${ctrls}.map((c) => c.text.trim()).where((s) => s.isNotEmpty).toList()`
          : `${ctrls}.map((c) => double.tryParse(c.text)).whereType<double>().toList()`;
      }
      return `${ctrls}.map((c) => c.text).toList()`;
    }
    case "bool-array":
      // Already a `List<bool>`; copy so the submitted body never aliases the
      // live row state.
      return `${arrayValuesId(f.wireName)}.toList()`;
    case "enum-array":
      return `${arrayValuesId(f.wireName)}.toList()`;
    case "object-array": {
      const rows = rowsId(f.wireName);
      const entries = (f.objectFields ?? [])
        .map((sf, i) => `'${dartStr(sf.jsonKey)}': ${objectCellValueExpr(sf, i)}`)
        .join(", ");
      return `${rows}.map((row) => <String, dynamic>{${entries}}).toList()`;
    }
  }
}

/** One object-array CELL's submit value, read out of the row slot at `i`.
 *  Text / number cells hold a `TextEditingController` there and parse exactly
 *  like their flat twins (a `money` cell carries the typed digits through
 *  unparsed, RS-12); bool / enum / datetime cells hold the value itself. */
function objectCellValueExpr(
  sf: NonNullable<FlutterFormField["objectFields"]>[number],
  i: number,
): string {
  switch (sf.kind) {
    case "number-int":
      return `int.tryParse((row[${i}] as TextEditingController).text)`;
    case "number-double":
      return sf.money
        ? `(row[${i}] as TextEditingController).text.trim()`
        : `double.tryParse((row[${i}] as TextEditingController).text)`;
    case "bool":
      return `row[${i}] as bool`;
    case "enum":
      return `row[${i}] as String?`;
    case "datetime":
      return pickedWire(`(row[${i}] as DateTime?)`, sf.dateOnly);
    default:
      return `(row[${i}] as TextEditingController).text`;
  }
}

/** One level of the request body under construction — the fields written
 *  directly at this level, plus the nested object keys below it, in first-seen
 *  order so the emitted body follows the declaration order. */
interface BodyNode {
  /** The presence flag gating this object (`null` when absent), if opt-in. */
  presence?: string;
  fields: FlutterFormField[];
  children: Map<string, BodyNode>;
  order: string[];
}

function newBodyNode(): BodyNode {
  return { fields: [], children: new Map(), order: [] };
}

/** The request-body assembly (`final body = <String, dynamic>{ … };`).  Fields
 *  flattened out of value objects re-nest under their `objectPath` — a PATH, not
 *  one key, because VO flattening is recursive (`addr.geo.lat` →
 *  `{'addr': {'geo': {'lat': …}}}`).  The tree is built first, so sibling leaves
 *  and sub-objects at the same level land in ONE literal. */
function bodyAssembly(fields: readonly FlutterFormField[]): string[] {
  const root = newBodyNode();
  for (const f of fields) {
    let node = root;
    let depth = 0;
    for (const key of f.objectPath ?? []) {
      let child = node.children.get(key);
      if (!child) {
        child = newBodyNode();
        node.children.set(key, child);
        node.order.push(key);
      }
      node = child;
      depth++;
      const g = f.presence?.find((p) => p.path.length === depth);
      if (g) node.presence = presenceId(g);
    }
    node.fields.push(f);
  }
  const emit = (node: BodyNode, indent: string): string[] => {
    const out: string[] = [];
    for (const f of node.fields) {
      out.push(`${indent}'${dartStr(f.jsonKey)}': ${fieldValueExpr(f)},`);
    }
    for (const key of node.order) {
      const child = node.children.get(key)!;
      const gate = child.presence ? `${child.presence} ? ` : "";
      out.push(`${indent}'${dartStr(key)}': ${gate}<String, dynamic>{`);
      out.push(...emit(child, `${indent}  `));
      out.push(`${indent}}${child.presence ? " : null" : ""},`);
    }
    return out;
  };
  return ["    final body = <String, dynamic>{", ...emit(root, "      "), "    };"];
}

/** The `validator:` argument fragment for a text/number input (or "" when the
 *  field needs no validation). */
function validatorArg(f: FlutterFormField): string {
  // Rules derived from the aggregate's `invariant`s (M-T1.16).  When a field
  // has none the one-liner arrow forms below are emitted UNCHANGED — this is
  // the byte-identical floor, and the block-bodied closure only appears on a
  // field that actually carries a constraint.
  const guards = f.rules ?? [];
  // Each message is the English literal, or in an i18n app the catalog lookup
  // `t('<code>', '<english>')` — evaluated every time the validator runs.
  const tr = f.translateMessages === true;
  const required = validatorMessage(tr, "field.missing", "Required");
  if (f.kind === "text") {
    const extra = ruleGuards(guards, ["text"], tr);
    if (extra.length === 0) {
      return f.required
        ? `, validator: (v) => (v == null || v.trim().isEmpty) ? ${required} : null`
        : "";
    }
    const empty = f.required ? `return ${required};` : "return null;";
    return `, validator: (v) { final s = (v ?? '').trim(); if (s.isEmpty) { ${empty} } ${extra.join(" ")} return null; }`;
  }
  if (f.money) {
    // Money submits the typed text verbatim, so the validator has to be the
    // WIRE's own grammar rather than "does Dart parse this as a number":
    // `double.tryParse` accepts `1e5`, which the backend's
    // `^-?\d+(\.\d+)?$` schema rejects with a 422 the user cannot read.
    const ok = `${MONEY_TEXT_PATTERN}.hasMatch(v.trim())`;
    const badAmount = validatorMessage(tr, "field.type-mismatch", "Enter an amount");
    // A money invariant never passes `classifyForWire` (the classifier refuses
    // a money operand), so `guards` is empty here today; the parse guard below
    // keeps the shape honest if that ever widens.
    const extra = ruleGuards(guards, ["text", "number"], tr);
    if (extra.length === 0) {
      return f.required
        ? `, validator: (v) => (v == null || v.trim().isEmpty) ? ${required} : (${ok} ? null : ${badAmount})`
        : `, validator: (v) => (v == null || v.trim().isEmpty) ? null : (${ok} ? null : ${badAmount})`;
    }
    const emptyM = f.required ? `return ${required};` : "return null;";
    return (
      `, validator: (v) { final s = (v ?? '').trim(); if (s.isEmpty) { ${emptyM} } ` +
      `if (!${MONEY_TEXT_PATTERN}.hasMatch(s)) { return ${badAmount}; } ` +
      `final n = double.parse(s); ${extra.join(" ")} return null; }`
    );
  }
  const parse = f.kind === "number-int" ? "int.tryParse" : "double.tryParse";
  const badNumber = validatorMessage(tr, "field.type-mismatch", "Enter a number");
  // A numeric input binds BOTH locals, so a length/regex rule on it evaluates
  // too — the classifier can only produce one if the declared type allowed it.
  const extra = ruleGuards(guards, ["text", "number"], tr);
  if (extra.length === 0) {
    if (f.required) {
      return `, validator: (v) => (v == null || v.trim().isEmpty) ? ${required} : (${parse}(v) == null ? ${badNumber} : null)`;
    }
    return `, validator: (v) => (v == null || v.trim().isEmpty) ? null : (${parse}(v) == null ? ${badNumber} : null)`;
  }
  const emptyN = f.required ? `return ${required};` : "return null;";
  return (
    `, validator: (v) { final s = (v ?? '').trim(); if (s.isEmpty) { ${emptyN} } ` +
    `final n = ${parse}(s); if (n == null) { return ${badNumber}; } ${extra.join(" ")} return null; }`
  );
}

/** The presence switch of an opt-in value-object group. */
function presenceSwitch(g: FlutterPresenceGroup): string {
  const label = dartStr(g.label);
  const flag = presenceId(g);
  return `Semantics(label: '${label}', child: SwitchListTile(key: const ValueKey('${dartStr(g.path.join("."))}-present'), title: const Text('${label}'), value: ${flag}, onChanged: (v) => setState(() => ${flag} = v)))`;
}

/** The Flutter input widget for one field (a single build-children element). */
function fieldWidget(f: FlutterFormField): string {
  // A translated label is a runtime call, so nothing it feeds can be `const`.
  const label = f.labelExpr ?? `'${dartStr(f.label)}'`;
  const kw = f.labelExpr ? "" : "const ";
  const decoration = `${kw}InputDecoration(labelText: ${label})`;
  switch (f.kind) {
    case "text":
      return `TextFormField(controller: ${ctrlId(f.wireName)}, decoration: ${decoration}${validatorArg(f)})`;
    case "number-int":
    case "number-double":
      return `TextFormField(controller: ${ctrlId(f.wireName)}, keyboardType: TextInputType.number, decoration: ${decoration}${validatorArg(f)})`;
    case "bool":
      return `SwitchListTile(title: ${kw}Text(${label}), value: ${stateId(f.wireName)}, onChanged: (v) => setState(() => ${stateId(f.wireName)} = v))`;
    case "enum": {
      const items = (f.enumValues ?? [])
        .map(
          (v) =>
            `DropdownMenuItem(value: '${dartStr(v)}', child: Text(${f.optionExprs?.[v] ?? `'${dartStr(v)}'`}))`,
        )
        .join(", ");
      const itemsConst = f.optionExprs ? "" : "const ";
      const validator = f.required
        ? `, validator: (v) => v == null ? ${validatorMessage(f.translateMessages === true, "field.missing", "Required")} : null`
        : "";
      return `DropdownButtonFormField<String>(initialValue: ${stateId(f.wireName)}, decoration: ${decoration}, items: ${itemsConst}[${items}], onChanged: (v) => setState(() => ${stateId(f.wireName)} = v)${validator})`;
    }
    case "fk-select": {
      // Options load at runtime (`_<name>Options`); the label is the target's
      // derived `display` field, falling back to the row id.
      const items = `${optionsId(f.wireName)}.map((o) => DropdownMenuItem(value: o['id'] as String?, child: Text((o['display'] ?? o['id'] ?? '').toString()))).toList()`;
      const validator = f.required
        ? `, validator: (v) => v == null ? ${validatorMessage(f.translateMessages === true, "field.missing", "Required")} : null`
        : "";
      // A record-seeded id is held before its options load; the dropdown only
      // shows it once an option carries it (an unmatched `initialValue` asserts).
      const initial = f.fromRecord
        ? `${optionsId(f.wireName)}.any((o) => o['id'] == ${stateId(f.wireName)}) ? ${stateId(f.wireName)} : null`
        : stateId(f.wireName);
      return `DropdownButtonFormField<String>(initialValue: ${initial}, decoration: ${decoration}, isExpanded: true, items: ${items}, onChanged: (v) => setState(() => ${stateId(f.wireName)} = v)${validator})`;
    }
    case "file":
      // A pick button + the current selection.  Not a `FormField`, so the
      // required check rides in `_submit` (`requiredFileGuards`) rather than the
      // `Form`'s validator sweep.
      return (
        `Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Row(children: <Widget>[` +
        `OutlinedButton.icon(icon: const Icon(Icons.upload_file), label: ${kw}Text(${label}), onPressed: ${pickerId(f.wireName)}), ` +
        `const SizedBox(width: 12), ` +
        `Expanded(child: Text(${stateId(f.wireName)}?.key ?? 'No file selected', overflow: TextOverflow.ellipsis)), ` +
        `]))`
      );
    case "datetime":
      return `InkWell(onTap: () async { final picked = await showDatePicker(context: context, initialDate: ${stateId(f.wireName)} ?? DateTime.now(), firstDate: DateTime(2000), lastDate: DateTime(2100)); if (picked != null) setState(() => ${stateId(f.wireName)} = picked); }, child: InputDecorator(decoration: ${decoration}, child: Text(${pickedWire(stateId(f.wireName), f.dateOnly)} ?? 'Select date')))`;
    case "scalar-array": {
      const ctrls = arrayCtrlsId(f.wireName);
      const kbd =
        f.elementKind === "number-int" || f.elementKind === "number-double"
          ? "keyboardType: TextInputType.number, "
          : "";
      // A labelled column of add/remove rows — one TextFormField per controller,
      // a trailing "Add" button that appends a fresh controller.
      return (
        `Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[` +
        `Padding(padding: const EdgeInsets.only(top: 8, bottom: 4), child: Text(${label}, style: Theme.of(context).textTheme.labelLarge)), ` +
        `...${ctrls}.asMap().entries.map((entry) => Padding(padding: const EdgeInsets.only(bottom: 4), child: Row(children: <Widget>[` +
        `Expanded(child: TextFormField(controller: entry.value, ${kbd}decoration: const InputDecoration(isDense: true))), ` +
        `IconButton(icon: const Icon(Icons.remove_circle_outline), onPressed: () => setState(() => ${ctrls}.removeAt(entry.key).dispose())), ` +
        `]))), ` +
        `Align(alignment: Alignment.centerLeft, child: TextButton.icon(icon: const Icon(Icons.add), label: ${sentenceText(f.translateMessages === true, sentenceChromeName("addValue", f.jsonKey))}, onPressed: () => setState(() => ${ctrls}.add(TextEditingController())))), ` +
        `])`
      );
    }
    case "bool-array": {
      // A repeatable CHECKBOX row list — the bool twin of `scalar-array`'s text
      // rows.  Each row edits `_<name>Values[i]` in place.
      const vals = arrayValuesId(f.wireName);
      const row = `Expanded(child: Checkbox(value: entry.value, onChanged: (v) => setState(() => ${vals}[entry.key] = v ?? false)))`;
      return arrayEditor(
        label,
        vals,
        row,
        `${vals}.add(false)`,
        `${vals}.removeAt(entry.key)`,
        sentenceText(f.translateMessages === true, sentenceChromeName("addValue", f.jsonKey)),
      );
    }
    case "enum-array": {
      // A repeatable DROPDOWN row list.  A new row seeds the first declared
      // value, so the list never carries a null the wire would reject.
      const vals = arrayValuesId(f.wireName);
      const values = f.enumValues ?? [];
      const items = values
        .map((v) => `DropdownMenuItem(value: '${dartStr(v)}', child: Text('${dartStr(v)}'))`)
        .join(", ");
      const seed = values.length > 0 ? `'${dartStr(values[0]!)}'` : "''";
      const row =
        `Expanded(child: DropdownButtonFormField<String>(initialValue: entry.value, isExpanded: true, ` +
        `decoration: const InputDecoration(isDense: true), items: const [${items}], ` +
        `onChanged: (v) => setState(() => ${vals}[entry.key] = v ?? ${seed})))`;
      return arrayEditor(
        label,
        vals,
        row,
        `${vals}.add(${seed})`,
        `${vals}.removeAt(entry.key)`,
        sentenceText(f.translateMessages === true, sentenceChromeName("addValue", f.jsonKey)),
      );
    }
    case "object-array": {
      const rows = rowsId(f.wireName);
      const subs = f.objectFields ?? [];
      // One cell per VO sub-field, each reading its own slot in the row.
      const cells = subs.map((sf, i) => objectCellWidget(sf, i)).join(", ");
      const newRow = subs.map((sf) => newObjectCell(sf)).join(", ");
      return (
        `Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[` +
        `Padding(padding: const EdgeInsets.only(top: 8, bottom: 4), child: Text(${label}, style: Theme.of(context).textTheme.labelLarge)), ` +
        `...${rows}.asMap().entries.map((entry) { final row = entry.value; return Padding(padding: const EdgeInsets.only(bottom: 4), child: Row(children: <Widget>[` +
        `${cells}, ` +
        `IconButton(icon: const Icon(Icons.remove_circle_outline), onPressed: () => setState(() { final removed = ${rows}.removeAt(entry.key); for (final c in removed) { if (c is TextEditingController) c.dispose(); } })), ` +
        `])); }), ` +
        `Align(alignment: Alignment.centerLeft, child: TextButton.icon(icon: const Icon(Icons.add), label: ${sentenceText(f.translateMessages === true, sentenceChromeName("addItem", f.elementName ?? f.jsonKey))}, onPressed: () => setState(() => ${rows}.add(<dynamic>[${newRow}])))), ` +
        `])`
      );
    }
  }
}

/** The shared shape of a repeatable single-value row editor: a label, one row
 *  per element (built by `rowWidget`, which reads `entry.key` / `entry.value`),
 *  a remove button per row and a trailing "Add".  `scalar-array` keeps its own
 *  spelling (its rows are controller-backed); the bool / enum editors share
 *  this one so the two can't drift. */
function arrayEditor(
  label: string,
  listId: string,
  rowWidget: string,
  addExpr: string,
  removeExpr: string,
  addLabel: string,
): string {
  return (
    `Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[` +
    `Padding(padding: const EdgeInsets.only(top: 8, bottom: 4), child: Text(${label}, style: Theme.of(context).textTheme.labelLarge)), ` +
    `...${listId}.asMap().entries.map((entry) => Padding(padding: const EdgeInsets.only(bottom: 4), child: Row(children: <Widget>[` +
    `${rowWidget}, ` +
    `IconButton(icon: const Icon(Icons.remove_circle_outline), onPressed: () => setState(() => ${removeExpr})), ` +
    `]))), ` +
    `Align(alignment: Alignment.centerLeft, child: TextButton.icon(icon: const Icon(Icons.add), label: ${addLabel}, onPressed: () => setState(() => ${addExpr}))), ` +
    `])`
  );
}

/** One object-array CELL's widget, over the row slot at `i`.  Mirrors the flat
 *  scalar widgets, narrowed to a dense in-row form; `row` and `entry` are the
 *  locals the enclosing `.map` binds. */
function objectCellWidget(
  sf: NonNullable<FlutterFormField["objectFields"]>[number],
  i: number,
): string {
  const slot = `row[${i}]`;
  const lbl = sf.labelExpr ?? `'${dartStr(sf.label)}'`;
  switch (sf.kind) {
    case "bool":
      return (
        `Expanded(child: Row(mainAxisSize: MainAxisSize.min, children: <Widget>[` +
        `Checkbox(value: ${slot} as bool, onChanged: (v) => setState(() => ${slot} = v ?? false)), ` +
        `Flexible(child: Text(${lbl}, overflow: TextOverflow.ellipsis)), ` +
        `]))`
      );
    case "enum": {
      const items = (sf.enumValues ?? [])
        .map(
          (v) =>
            `DropdownMenuItem(value: '${dartStr(v)}', child: Text(${sf.optionExprs?.[v] ?? `'${dartStr(v)}'`}))`,
        )
        .join(", ");
      const itemsConst = sf.optionExprs ? "" : "const ";
      return (
        `Expanded(child: Padding(padding: const EdgeInsets.only(right: 4), child: ` +
        `DropdownButtonFormField<String>(initialValue: ${slot} as String?, isExpanded: true, ` +
        `decoration: InputDecoration(isDense: true, labelText: ${lbl}), items: ${itemsConst}[${items}], ` +
        `onChanged: (v) => setState(() => ${slot} = v))))`
      );
    }
    case "datetime":
      return (
        `Expanded(child: Padding(padding: const EdgeInsets.only(right: 4), child: ` +
        `InkWell(onTap: () async { final picked = await showDatePicker(context: context, initialDate: ${slot} as DateTime? ?? DateTime.now(), firstDate: DateTime(2000), lastDate: DateTime(2100)); if (picked != null) setState(() => ${slot} = picked); }, ` +
        `child: InputDecorator(decoration: InputDecoration(isDense: true, labelText: ${lbl}), child: Text(${pickedWire(`(${slot} as DateTime?)`, sf.dateOnly)} ?? 'Select date', overflow: TextOverflow.ellipsis)))))`
      );
    default: {
      const kbd =
        sf.kind === "number-int" || sf.kind === "number-double"
          ? "keyboardType: TextInputType.number, "
          : "";
      return (
        `Expanded(child: Padding(padding: const EdgeInsets.only(right: 4), child: ` +
        `TextFormField(controller: ${slot} as TextEditingController, ${kbd}decoration: InputDecoration(isDense: true, labelText: ${lbl}))))`
      );
    }
  }
}

/** The fresh slot a new object-array row carries for one cell — the mirror of
 *  `objectCellWidget`'s read, so the two agree on what lives in the slot. */
function newObjectCell(sf: NonNullable<FlutterFormField["objectFields"]>[number]): string {
  switch (sf.kind) {
    case "bool":
      return "false";
    case "enum":
      return sf.required && sf.enumValues && sf.enumValues.length > 0
        ? `'${dartStr(sf.enumValues[0]!)}'`
        : "null";
    case "datetime":
      return "null";
    default:
      return "TextEditingController()";
  }
}

/** The message of a required `File` input's guard: the whole sentence
 *  `chrome.fieldRequired.<input>`, a catalog lookup in a translatable app. */
function fileRequiredMessage(f: FlutterFormField): string {
  const name = sentenceChromeName("fieldRequired", f.jsonKey);
  const english = chromeMessage(name);
  return f.translateMessages === true
    ? dartTranslate(chromeKey(name), english)
    : `'${dartStr(english)}'`;
}

/** The required-file guards for a form's `file` inputs.  A `file` input is not a
 *  `FormField`, so the `Form`'s validator sweep never sees it — a required one is
 *  enforced here instead, with the same visible `_error` banner a failed request
 *  uses. */
function requiredFileGuards(fields: readonly FlutterFormField[]): string[] {
  const out: string[] = [];
  for (const f of fields) {
    if (f.kind !== "file" || !f.required) continue;
    const cond = presenceCond(f.presence);
    out.push(
      `    if (${cond ? `${cond} && ` : ""}${stateId(f.wireName)} == null) {`,
      `      setState(() => _error = ServerIssue.plain(${fileRequiredMessage(f)}));`,
      "      return;",
      "    }",
    );
  }
  return out;
}

/** The key a field's server error is filed under: the dot-path of the JSON
 *  pointer a 422 names it with (`/price/amount` → `price.amount`). */
function serverKey(f: FlutterFormField): string {
  return [...(f.objectPath ?? []), f.jsonKey].join(".");
}

/** The slot under a field where its rejected submit's message renders — a
 *  collection-`if`, so a field with no server error adds no widget. */
function serverFieldError(f: FlutterFormField): string {
  const key = `'${dartStr(serverKey(f))}'`;
  return (
    `if (_server?.fields[${key}] != null) Padding(padding: const EdgeInsets.only(bottom: 8), ` +
    `child: Text(_server!.fields[${key}]!.text, style: TextStyle(color: Theme.of(context).colorScheme.error))),`
  );
}

/** `ServerErrors` — a rejected submit, decoded from the backend's RFC 7807
 *  ProblemDetails.  Each `errors[]` entry whose JSON pointer names a field is
 *  filed under the field's dot-path (the form renders it under that field); a
 *  pointer-less entry, or the problem's `detail`/`title` when there is no
 *  `errors[]`, is the form-level message.  The Dart twin of the React
 *  projects' `apply-server-errors.ts`; emitted once into `lib/forms.dart`. */
export function serverErrorsDart(i18n: boolean): string {
  const text = i18n
    ? `    if (code.isEmpty) return message;
    try {
      return t(key, message, params);
    } catch (_) {
      return message;
    }`
    : "    return message;";
  // The two-step lookup: a refusal that concerns one aggregate names it in
  // `params.type`, and the catalog may carry that aggregate's own sentence.
  const keyGetter = i18n
    ? `

  /// The catalog key this refusal is localized by: its aggregate's own sentence
  /// (\`<type>.problem.<class>\`, the aggregate named by \`params.type\`) when the
  /// active catalog carries one, else its code.
  String get key {
    final type = params?['type'];
    if (type is String && code.startsWith('problem.') && hasMessage('$type.$code')) return '$type.$code';
    return code;
  }`
    : "";
  return `/// One refusal message: the catalog \`code\` the server sent ('' when there is
/// none), its English \`message\`, and the \`params\` its placeholders name.
class ServerIssue {
  const ServerIssue(this.code, this.message, [this.params]);
  const ServerIssue.plain(this.message) : code = '', params = null;

  final String code;
  final String message;
  final Map<String, Object>? params;

  /// The message in the active locale, computed when the form RENDERS.
  String get text {
${text}
  }${keyGetter}

  static Map<String, Object>? paramsOf(Object? raw) {
    if (raw is! Map) return null;
    return <String, Object>{for (final e in raw.entries) if (e.value != null) '\${e.key}': e.value as Object};
  }
}

/// A rejected submit, decoded from the backend's RFC 7807 ProblemDetails, decoded from the backend's RFC 7807 ProblemDetails:
/// field messages keyed by the dot-path of the JSON pointer naming the field,
/// and the form-level message.
class ServerErrors {
  const ServerErrors(this.fields, this.form);

  final Map<String, ServerIssue> fields;
  final ServerIssue? form;

  /// Decode a non-2xx response.
  static ServerErrors fromResponse(int status, String body) {
    Object? decoded;
    try {
      decoded = jsonDecode(body);
    } catch (_) {
      decoded = null;
    }
    final fields = <String, ServerIssue>{};
    ServerIssue? form;
    if (decoded is Map<String, dynamic>) {
      final entries = decoded['errors'];
      if (entries is List) {
        for (final entry in entries) {
          if (entry is! Map) continue;
          final message = entry['message'];
          if (message is! String || message.isEmpty) continue;
          final pointer = entry['pointer'];
          final path = pointer is String ? _pointerToPath(pointer) : '';
          final code = entry['code'];
          final issue = ServerIssue(code is String ? code : '', message, ServerIssue.paramsOf(entry['params']));
          if (path.isEmpty) {
            form ??= issue;
          } else {
            fields[path] = issue;
          }
        }
      }
      if (fields.isEmpty && form == null) {
        final detail = decoded['detail'];
        final title = decoded['title'];
        final code = decoded['code'];
        final english = (detail is String && detail.isNotEmpty)
            ? detail
            : ((title is String && title.isNotEmpty) ? title : null);
        if (english != null) {
          form = ServerIssue(code is String ? code : 'problem.internal', english, ServerIssue.paramsOf(decoded['params']));
        }
      }
    }
    if (fields.isEmpty && form == null) form = ServerIssue.plain('Request failed ($status)');
    return ServerErrors(fields, form);
  }

  /// The form-level message, or else a field message whose pointer names no
  /// field the form renders (\`rendered\`) — no rejection goes unseen.
  ServerIssue? formLevel(List<String> rendered) {
    if (form != null) return form;
    for (final entry in fields.entries) {
      if (!rendered.contains(entry.key)) return entry.value;
    }
    return null;
  }

  /// A JSON pointer (RFC 6901) as a dot-path; '' for the whole document.
  static String _pointerToPath(String pointer) {
    if (!pointer.startsWith('/')) return pointer;
    return pointer.substring(1).split('/').map((s) => s.replaceAll('~1', '/').replaceAll('~0', '~')).join('.');
  }
}`;
}

/** The `_submit` method for a fields-bearing (create / operation) form. */
function submitMethod(spec: FlutterFormSpec): string[] {
  // A param-less form has no field to point at: its rejection is all banner.
  const hasSlots = spec.fields.length > 0;
  const gate =
    spec.fields.length > 0 ? "    if (!(_formKey.currentState?.validate() ?? false)) return;" : "";
  return [
    "  Future<void> _submit() async {",
    ...(gate ? [gate] : []),
    ...requiredFileGuards(spec.fields),
    "    setState(() {",
    "      _submitting = true;",
    "      _error = null;",
    ...(hasSlots ? ["      _server = null;"] : []),
    "    });",
    ...bodyAssembly(spec.fields),
    "    try {",
    `      final res = await http.post(apiUri('${spec.pathExpr}'),`,
    // #27 / F-023 — a `versioned` update carries the loaded record's version as
    // a QUOTED entity-tag (RFC 9110 §8.8.3, the spelling every backend parses),
    // so a concurrent edit is refused (409/412) instead of silently overwritten.
    spec.ifMatch
      ? "          headers: {'Content-Type': 'application/json', if (widget.expectedVersion != null) 'If-Match': '\"${widget.expectedVersion}\"'},"
      : "          headers: const {'Content-Type': 'application/json'},",
    "          body: jsonEncode(body));",
    "      if (res.statusCode >= 200 && res.statusCode < 300) {",
    "        if (!mounted) return;",
    "        Navigator.of(context).pop();",
    "        return;",
    "      }",
    // A rejection lands at the fields its ProblemDetails pointers name; the
    // rest is the banner's form-level message.
    ...(hasSlots
      ? [
          "      final server = ServerErrors.fromResponse(res.statusCode, res.body);",
          "      setState(() {",
          "        _server = server;",
          "        _error = server.formLevel(_serverFields);",
          "      });",
        ]
      : [
          "      setState(() => _error = ServerErrors.fromResponse(res.statusCode, res.body).formLevel(const <String>[]));",
        ]),
    "    } catch (e) {",
    "      setState(() => _error = ServerIssue.plain('$e'));",
    "    } finally {",
    "      if (mounted) setState(() => _submitting = false);",
    "    }",
    "  }",
  ];
}

/** The `_submit` method for a destroy form (no fields, a DELETE). */
function destroySubmitMethod(spec: FlutterFormSpec): string[] {
  return [
    "  Future<void> _submit() async {",
    "    setState(() {",
    "      _submitting = true;",
    "      _error = null;",
    "    });",
    "    try {",
    `      final res = await http.delete(apiUri('${spec.pathExpr}'));`,
    "      if (res.statusCode >= 200 && res.statusCode < 300) {",
    "        if (!mounted) return;",
    "        Navigator.of(context).pop();",
    "        return;",
    "      }",
    // The problem's own sentence ("Order is still referenced …").
    "      setState(() => _error = ServerErrors.fromResponse(res.statusCode, res.body).formLevel(const <String>[]));",
    "    } catch (e) {",
    "      setState(() => _error = ServerIssue.plain('$e'));",
    "    } finally {",
    "      if (mounted) setState(() => _submitting = false);",
    "    }",
    "  }",
  ];
}

/** The submit button element for a form's build children. */
function submitButton(spec: FlutterFormSpec): string {
  const label = spec.submitExpr ?? `'${dartStr(spec.submitLabel)}'`;
  const kw = spec.submitExpr ? "" : "const ";
  const style = spec.destructive
    ? "style: ElevatedButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error, foregroundColor: Theme.of(context).colorScheme.onError), "
    : "";
  // The button itself can't be const (its `onPressed` closes over `_submit`), but
  // its literal-text child can.
  const guard = spec.gateProbe ? "(_submitting || widget.blocked)" : "_submitting";
  return `ElevatedButton(${style}onPressed: ${guard} ? null : _submit, child: ${kw}Text(${label}))`;
}

/** Emit one form widget class (a `StatefulWidget` + its `State`). */
export function renderFormWidget(spec: FlutterFormSpec): string {
  const w = spec.widgetName;
  const ctorArgs =
    spec.needsId || spec.gateProbe
      ? `{super.key, required this.id${spec.ifMatch ? ", this.expectedVersion" : ""}${spec.gateProbe ? ", this.blocked = false" : ""}${spec.takesRecord ? ", this.record" : ""}}`
      : "{super.key}";
  const idField = spec.needsId || spec.gateProbe ? ["  final String id;"] : [];
  // The loaded record's `version` (the `versioned` capability's synthetic `int`
  // token), threaded in by the call site for the `If-Match` precondition.
  if (spec.ifMatch) idField.push("  final int? expectedVersion;");
  // A `when`-gated op: the call site passes the `can_<op>` probe's verdict.
  if (spec.gateProbe) idField.push("  final bool blocked;");
  // The loaded record's wire map, seeding the inputs (`recordSeeds`).
  if (spec.takesRecord) idField.push("  final Map<String, dynamic>? record;");

  const errorBanner =
    "        if (_error != null)\n" +
    "          Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_error!.text, style: TextStyle(color: Theme.of(context).colorScheme.error))),";
  const emittedGroups = new Set<string>();
  const inputChildren = spec.fields.flatMap((f) => {
    const out: string[] = [];
    (f.presence ?? []).forEach((g, i) => {
      if (emittedGroups.has(g.id)) return;
      emittedGroups.add(g.id);
      const outer = presenceCond(f.presence?.slice(0, i));
      out.push(`        ${outer ? `if (${outer}) ` : ""}${presenceSwitch(g)},`);
    });
    const cond = presenceCond(f.presence);
    const gate = cond ? `if (${cond}) ` : "";
    out.push(`        ${gate}${fieldWidget(f)},`, `        ${gate}${serverFieldError(f)}`);
    return out;
  });
  const submitChild = `        ${submitButton(spec)},`;

  let buildBody: string[];
  if (spec.kind === "destroy") {
    buildBody = [
      "    return Column(",
      "      crossAxisAlignment: CrossAxisAlignment.start,",
      "      mainAxisSize: MainAxisSize.min,",
      "      children: <Widget>[",
      errorBanner,
      submitChild,
      "      ],",
      "    );",
    ];
  } else {
    buildBody = [
      "    return Form(",
      "      key: _formKey,",
      "      child: Column(",
      "        crossAxisAlignment: CrossAxisAlignment.start,",
      "        mainAxisSize: MainAxisSize.min,",
      "        children: <Widget>[",
      ...inputChildren.map((c) => `  ${c}`),
      `  ${errorBanner}`,
      `  ${submitChild}`,
      "        ],",
      "      ),",
      "    );",
    ];
  }

  const stateMembers: string[] = [];
  if (spec.kind !== "destroy") stateMembers.push("  final _formKey = GlobalKey<FormState>();");
  stateMembers.push(...stateDecls(spec.fields));
  stateMembers.push("  bool _submitting = false;");
  stateMembers.push("  ServerIssue? _error;");
  if (spec.kind !== "destroy" && spec.fields.length > 0) {
    // The last rejected submit, and the field keys this form renders a slot for.
    stateMembers.push("  ServerErrors? _server;");
    stateMembers.push(
      `  static const _serverFields = <String>[${spec.fields.map((f) => `'${dartStr(serverKey(f))}'`).join(", ")}];`,
    );
  }

  const initState = fkLoaders(spec.fields);
  const initStateBlock = initState.length > 0 ? ["", ...initState] : [];

  const dispose = disposeBody(spec.fields);
  const disposeOverride =
    dispose.length > 0
      ? ["", "  @override", "  void dispose() {", ...dispose, "    super.dispose();", "  }"]
      : [];

  const submit = spec.kind === "destroy" ? destroySubmitMethod(spec) : submitMethod(spec);
  const pickers = filePickers(spec.fields);

  return lines(
    // LOUD form-field drop markers (M-A) — Dart line comments, zero compile risk,
    // parseable by the parity lint.  Precede the class so the omission is visible
    // at the widget it belongs to.
    ...spec.dropped,
    `class ${w} extends StatefulWidget {`,
    ...idField,
    `  const ${w}(${ctorArgs});`,
    "",
    "  @override",
    `  State<${w}> createState() => _${w}State();`,
    "}",
    "",
    `class _${w}State extends State<${w}> {`,
    ...stateMembers,
    ...initStateBlock,
    ...disposeOverride,
    "",
    ...submit,
    ...pickers,
    "",
    "  @override",
    "  Widget build(BuildContext context) {",
    ...buildBody,
    "  }",
    "}",
  );
}

/** True when a rendered widget calls the generated translation runtime `t(…)`
 *  (the lookbehind keeps `Text(` / `.set(` / identifiers ending in `t` out). */
function callsTranslate(dart: string): boolean {
  return /(?<![\w.$])t\('/.test(dart);
}

/** Emit `lib/forms.dart` — every form widget a ui hosts.  Returns "" when the
 *  ui hosts no forms (the caller then emits no file). */
export function renderFormsFile(
  forms: readonly FlutterFormSpec[],
  /** True when the deployable authenticates its api calls — `auth: ui` against
   *  an `auth: required` target with a declared `user { }`.  The generated
   *  library then imports the credentialed `api_client.dart` drop-in instead of
   *  `package:http/http.dart`, which credentials EVERY call site at once
   *  (D-FLUTTER-BEARER).  False keeps the emitted bytes identical. */
  credentialed = false,
  /** True when the ui ships `lib/i18n.dart`: the server's refusals localize by
   *  code through its `t`. */
  i18n = false,
): string {
  if (forms.length === 0) return "";
  const blocks = forms.map(renderFormWidget);
  // A `file` input picks through `file_picker` and reifies the uploaded
  // `FileRef` from `models.dart`; a File-free form set keeps its old import
  // list byte-identical.
  const usesFile = formsUseFilePicker(forms);
  return `${lines(
    "// Form widgets — one self-contained StatefulWidget per CreateForm /",
    "// OperationForm / DestroyForm a ui hosts.  Each POSTs/DELETEs over",
    "// package:http and pops the route on success.  Generated by the Loom",
    "// Flutter target; do not edit.",
    "",
    "import 'dart:convert';",
    "",
    ...(usesFile ? ["import 'package:file_picker/file_picker.dart';"] : []),
    "import 'package:flutter/material.dart';",
    flutterHttpImport(credentialed),
    "",
    "import 'config.dart';",
    ...(i18n || blocks.some(callsTranslate) ? ["import 'i18n.dart';"] : []),
    ...(usesFile ? ["import 'models.dart';"] : []),
    "",
    ...blocks.flatMap((b, i) => (i === 0 ? [b] : ["", b])),
    "",
    serverErrorsDart(i18n),
  )}\n`;
}

/** `lib/gates.dart` — one Riverpod probe per `when`-gated public operation of
 *  the deployable's aggregates, over its `GET /<plural>/{id}/can_<op>`
 *  companion.  Every op trigger (`OperationForm` dialog, `Action` button)
 *  watches its probe, so it lives beside neither the forms nor the reads: a
 *  page with an `Action` and no form must still reach it.  `autoDispose`, so a
 *  page re-entered after a mutation re-queries rather than reading a stale
 *  verdict.  `""` when no operation is gated (no file is emitted). */
export function renderGatesFile(
  aggregates: readonly { name: string; operations: readonly OperationIR[] }[],
  credentialed = false,
): string {
  const blocks = aggregates.flatMap((agg) =>
    agg.operations
      .filter((op) => op.visibility === "public" && op.when)
      .map((op) => {
        const path = `/${routeSegmentFor(agg.name)}/$id/can_${snake(op.routeSlug ?? op.name)}`;
        return [
          `final ${canProbeProviderName(agg.name, op.name)} = FutureProvider.autoDispose.family<bool, String>((ref, id) async {`,
          `  final res = await http.get(apiUri('${path}'));`,
          "  if (res.statusCode != 200) {",
          `    throw Exception('GET ${path} failed (\${res.statusCode})');`,
          "  }",
          "  return (jsonDecode(res.body) as Map<String, dynamic>)['allowed'] == true;",
          "});",
        ].join("\n");
      }),
  );
  if (blocks.length === 0) return "";
  return `${lines(
    "// `can_<op>` probes — one per `when`-gated operation.  An op trigger",
    "// watches its probe and disables while it answers `allowed: false`.",
    "// Generated by the Loom Flutter target; do not edit.",
    "",
    "import 'dart:convert';",
    "",
    "import 'package:flutter_riverpod/flutter_riverpod.dart';",
    flutterHttpImport(credentialed),
    "",
    "import 'config.dart';",
    "",
    ...blocks.flatMap((b, i) => (i === 0 ? [b] : ["", b])),
  )}\n`;
}

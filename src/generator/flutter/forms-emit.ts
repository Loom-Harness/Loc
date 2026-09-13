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
  EnrichedAggregateIR,
  EnrichedBoundedContextIR,
  ExprIR,
  FieldIR,
  OperationIR,
  TypeIR,
  UiIR,
  WorkflowIR,
} from "../../ir/types/loom-ir.js";
import { lines } from "../../util/code-builder.js";
import { humanize, lowerFirst, plural, snake, upperFirst } from "../../util/naming.js";
import { STANDARD_AGG_OPS } from "../_walker/walker-core.js";

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
  /** When flattened OUT of value objects, the chain of JSON object keys it
   *  nests under, outermost first — `["cost"]` for a `cost: Money` expanded to
   *  `costAmount`/`costCurrency`, `["addr", "geo"]` for a `Geo` nested inside an
   *  `Addr`.  A PATH, not a single key: VO flattening is recursive, so the
   *  request body has to rebuild the same depth (`bodyAssembly`). */
  objectPath?: readonly string[];
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
  objectFields?: {
    jsonKey: string;
    label: string;
    kind: "text" | "number-int" | "number-double" | "bool" | "enum" | "datetime";
    /** `money` sub-field — submits as a fixed-scale decimal string. */
    money?: boolean;
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
    kind === "fk-select" && base.kind === "id" ? snake(plural(base.targetName)) : undefined;
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
  for (const f of inputs) {
    const base = peel(f.type);
    const fieldOptional = f.optional === true || f.type.kind === "optional";
    const voFields = base.kind === "valueobject" ? vosByName.get(base.name) : undefined;
    if (voFields) {
      // Value objects flatten RECURSIVELY: `addr: Addr { line, geo: Geo { lat,
      // lng } }` becomes `addrLine` + `addrGeoLat` + `addrGeoLng`, each carrying
      // its full `objectPath` so `bodyAssembly` rebuilds the same nesting on the
      // wire.  One level of flattening used to be the whole story, and a VO
      // inside a VO was dropped with a marker (ledger `flutter-form-field-drops`
      // entry 1) — a shape every other frontend renders.
      const sub = prepareFields(
        voFields.map((sf) => ({
          name: sf.name,
          type: sf.type,
          // A whole-VO optional makes every leaf under it optional.
          optional: fieldOptional || sf.optional === true,
        })),
        enumsByName,
        vosByName,
        aggregatesByName,
        {
          path: [...nest.path, f.name],
          prefix: nest.prefix ? `${nest.prefix}${upperFirst(f.name)}` : f.name,
          label: nest.label ? `${nest.label}.${f.name}` : f.name,
        },
      );
      out.push(...sub.fields);
      dropped.push(...sub.dropped);
      continue;
    }
    // Names are NEST-QUALIFIED: the Dart identifier prefixes the walked VO keys
    // (`addrGeoLat`), the drop marker uses the dotted source path (`addr.geo`),
    // and `objectPath` carries the keys so the request body re-nests.
    const wireName = nest.prefix ? `${nest.prefix}${upperFirst(f.name)}` : f.name;
    const markerName = nest.label ? `${nest.label}.${f.name}` : f.name;
    const objectPath = nest.path.length > 0 ? nest.path : undefined;
    // An array field (`tags: string[]` / `items: LineItem[]`) → a repeatable
    // add/remove row list.
    if (base.kind === "array") {
      const elemBase = peel(base.element);
      const voFieldsOfElem =
        elemBase.kind === "valueobject" ? vosByName.get(elemBase.name) : undefined;
      if (voFieldsOfElem) {
        // Array of value objects → each row is a group of the VO's sub-field
        // CELLS.  A cell is any flat scalar the form already knows how to
        // render — text / number (a `TextEditingController` in the row slot),
        // bool (a checkbox), enum (a dropdown) or datetime (a date picker).
        // Only a sub-field with no flat form (a nested VO, an array, a File, an
        // fk id) defers the whole array, which stays "never broken Dart".
        const objectFields: NonNullable<FlutterFormField["objectFields"]> = [];
        let allScalar = true;
        for (const sub of voFieldsOfElem) {
          const k = scalarInputKind(sub.type, enumsByName, aggregatesByName);
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
              enumValues:
                k === "enum" && subBase.kind === "enum" ? enumsByName.get(subBase.name) : undefined,
              required: !(sub.optional === true || sub.type.kind === "optional") || undefined,
            });
          } else {
            allScalar = false;
            break;
          }
        }
        if (allScalar && objectFields.length > 0) {
          out.push({
            wireName,
            jsonKey: f.name,
            label: humanize(f.name),
            kind: "object-array",
            required: !fieldOptional,
            objectFields,
            objectPath,
          });
        } else {
          // A value-object array carrying a sub-field with no flat form (a
          // nested value object, an array, a File, an fk id) — the whole array
          // defers, loudly.
          dropped.push(
            droppedMarker(markerName, "value-object array with a non-renderable sub-field"),
          );
        }
        continue;
      }
      // Scalar array.  Text / numeric elements are a column of text rows; bool
      // and enum elements are their own row editors (a checkbox / a dropdown
      // per row) — the `flags: bool[]` and `colors: Color[]` shapes that used to
      // defer.  datetime / File / fk-id element arrays stay deferred.
      const elemKind = scalarInputKind(base.element, enumsByName, aggregatesByName);
      if (elemKind === "text" || elemKind === "number-int" || elemKind === "number-double") {
        out.push({
          wireName,
          jsonKey: f.name,
          label: humanize(f.name),
          kind: "scalar-array",
          required: !fieldOptional,
          elementKind: elemKind,
          elementMoney: isMoney(base.element) || undefined,
          objectPath,
        });
      } else if (elemKind === "bool") {
        out.push({
          wireName,
          jsonKey: f.name,
          label: humanize(f.name),
          kind: "bool-array",
          required: !fieldOptional,
          objectPath,
        });
      } else if (elemKind === "enum") {
        const eb = peel(base.element);
        out.push({
          wireName,
          jsonKey: f.name,
          label: humanize(f.name),
          kind: "enum-array",
          required: !fieldOptional,
          enumValues: eb.kind === "enum" ? enumsByName.get(eb.name) : undefined,
          objectPath,
        });
      } else {
        const eb = peel(base.element);
        const elemLabel =
          eb.kind === "enum"
            ? "enum"
            : eb.kind === "id"
              ? "id"
              : eb.kind === "primitive"
                ? eb.name
                : eb.kind;
        dropped.push(droppedMarker(markerName, `${elemLabel} element array`));
      }
      continue;
    }
    const kind = scalarInputKind(f.type, enumsByName, aggregatesByName);
    if (!kind) {
      // unresolved value-object / otherwise-unsupported scalar — deferred.
      const b = peel(f.type);
      const label = b.kind === "valueobject" ? `unresolved value-object ${b.name}` : b.kind;
      dropped.push(droppedMarker(markerName, `${label} field`));
      continue;
    }
    out.push(buildField(wireName, f.name, f.type, fieldOptional, kind, enumsByName, objectPath));
  }
  return { fields: out, dropped };
}

/** Enum name → values from a bounded context. */
function enumsFromBc(bc: EnrichedBoundedContextIR | undefined): Map<string, string[]> {
  const m = new Map<string, string[]>();
  if (bc) for (const e of bc.enums) m.set(e.name, e.values);
  return m;
}

/** Value-object name → its fields from a bounded context. */
function vosFromBc(bc: EnrichedBoundedContextIR | undefined): Map<string, readonly FieldIR[]> {
  const m = new Map<string, readonly FieldIR[]>();
  if (bc) for (const vo of bc.valueObjects) m.set(vo.name, vo.fields);
  return m;
}

// ---------------------------------------------------------------------------
// Spec builders
// ---------------------------------------------------------------------------

/** Build the `FlutterFormSpec` for a `CreateForm(of: agg)`. */
export function flutterCreateForm(
  agg: EnrichedAggregateIR,
  bc: EnrichedBoundedContextIR | undefined,
  aggregatesByName: ReadonlyMap<string, EnrichedAggregateIR>,
): FlutterFormSpec {
  const { fields, dropped } = prepareFields(
    createInputFields(agg),
    enumsFromBc(bc),
    vosFromBc(bc),
    aggregatesByName,
  );
  return {
    widgetName: createFormWidgetName(agg.name),
    kind: "create",
    aggregate: agg.name,
    needsId: false,
    pathExpr: `/${snake(plural(agg.name))}`,
    submitLabel: `Create ${humanize(agg.name)}`,
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
): FlutterFormSpec {
  const { fields, dropped } = prepareFields(
    op.params,
    enumsFromBc(bc),
    vosFromBc(bc),
    aggregatesByName,
  );
  const opPath = snake(op.routeSlug ?? op.name);
  return {
    widgetName: operationFormWidgetName(aggName, op.name),
    kind: "operation",
    aggregate: aggName,
    needsId: true,
    pathExpr: `/${snake(plural(aggName))}/\${widget.id}/${opPath}`,
    submitLabel: humanize(op.name),
    fields,
    dropped,
    destructive: false,
  };
}

/** Build the `FlutterFormSpec` for a `DestroyForm(of: agg)`. */
export function flutterDestroyForm(aggName: string): FlutterFormSpec {
  return {
    widgetName: destroyFormWidgetName(aggName),
    kind: "destroy",
    aggregate: aggName,
    needsId: true,
    pathExpr: `/${snake(plural(aggName))}/\${widget.id}`,
    submitLabel: `Delete ${humanize(aggName)}`,
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
): FlutterFormSpec {
  const { fields, dropped } = prepareFields(
    wf.params,
    enumsFromBc(bc),
    vosFromBc(bc),
    aggregatesByName,
  );
  return {
    widgetName: workflowFormWidgetName(wf.name),
    kind: "create",
    aggregate: wf.name,
    needsId: false,
    pathExpr: `/workflows/${snake(wf.name)}`,
    submitLabel: `Run ${humanize(wf.name)}`,
    fields,
    dropped,
    destructive: false,
  };
}

// ---------------------------------------------------------------------------
// Collection — scan a ui's pages for the form primitives they host
// ---------------------------------------------------------------------------

/** Direct child expressions of `e` (expression positions only). */
function exprChildren(e: ExprIR): ExprIR[] {
  switch (e.kind) {
    case "member":
      return [e.receiver];
    case "method-call":
      return [e.receiver, ...e.args];
    case "call":
      return e.args;
    case "lambda":
      return e.body ? [e.body] : [];
    case "object":
    case "new":
      return e.fields.map((f) => f.value);
    case "list":
      return e.elements;
    case "paren":
      return [e.inner];
    case "unary":
      return [e.operand];
    case "binary":
      return [e.left, e.right];
    case "ternary":
      return [e.cond, e.then, e.otherwise];
    case "convert":
      return [e.value];
    default:
      return [];
  }
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
): void {
  const push = (spec: FlutterFormSpec): void => {
    if (seen.has(spec.widgetName)) return;
    seen.add(spec.widgetName);
    out.push(spec);
  };
  const pushOp = (agg: EnrichedAggregateIR, opName: string): void => {
    const op = agg.operations.find((o) => o.name === opName && o.visibility === "public");
    if (op) push(flutterOperationForm(agg.name, op, bcByAggregate.get(agg.name), aggregatesByName));
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
          push(flutterCreateForm(agg, bcByAggregate.get(agg.name), aggregatesByName));
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
        if (agg) push(flutterDestroyForm(agg.name));
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
): FlutterFormSpec[] {
  if (!body) return [];
  const out: FlutterFormSpec[] = [];
  collectBodyForms(body, aggregatesByName, bcByAggregate, out, new Set());
  return out;
}

/** Collect every distinct form a ui's pages host — deduped by widget name
 *  across the whole ui (the set emitted into `lib/forms.dart`). */
export function collectFlutterForms(
  ui: UiIR | undefined,
  aggregatesByName: ReadonlyMap<string, EnrichedAggregateIR>,
  bcByAggregate: ReadonlyMap<string, EnrichedBoundedContextIR>,
): FlutterFormSpec[] {
  if (!ui) return [];
  const out: FlutterFormSpec[] = [];
  const seen = new Set<string>();
  for (const page of ui.pages ?? []) {
    if (!page.body) continue;
    collectBodyForms(page.body, aggregatesByName, bcByAggregate, out, seen);
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
): void {
  const walk = (e: ExprIR): void => {
    if (e.kind === "call" && e.name === "WorkflowForm") {
      const runsArg = namedArg(e, "runs");
      const wf = runsArg?.kind === "ref" ? workflowsByName.get(runsArg.name) : undefined;
      if (wf && !seen.has(workflowFormWidgetName(wf.name))) {
        seen.add(workflowFormWidgetName(wf.name));
        out.push(flutterWorkflowForm(wf, bcByWorkflow.get(wf.name), aggregatesByName));
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
): FlutterFormSpec[] {
  if (!body) return [];
  const out: FlutterFormSpec[] = [];
  collectBodyWorkflowForms(body, workflowsByName, bcByWorkflow, aggregatesByName, out, new Set());
  return out;
}

/** Collect every distinct workflow-run form a ui's pages host — deduped by
 *  widget name across the whole ui (appended to the `lib/forms.dart` set). */
export function collectFlutterWorkflowForms(
  ui: UiIR | undefined,
  workflowsByName: ReadonlyMap<string, WorkflowIR>,
  bcByWorkflow: ReadonlyMap<string, EnrichedBoundedContextIR>,
  aggregatesByName: ReadonlyMap<string, EnrichedAggregateIR>,
): FlutterFormSpec[] {
  if (!ui) return [];
  const out: FlutterFormSpec[] = [];
  const seen = new Set<string>();
  for (const page of ui.pages ?? []) {
    if (!page.body) continue;
    collectBodyWorkflowForms(page.body, workflowsByName, bcByWorkflow, aggregatesByName, out, seen);
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

/** The state field declarations for a form's non-text-backed inputs. */
function stateDecls(fields: readonly FlutterFormField[]): string[] {
  const out: string[] = [];
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

/** The `initState` + per-field loader methods for a form's fk-select inputs
 *  (empty when the form hosts none).  Each loader GETs `/<collection>`, unwraps
 *  the paged `{items}` envelope, and stores the rows as the dropdown options. */
function fkLoaders(fields: readonly FlutterFormField[]): string[] {
  const fks = fields.filter((f) => f.kind === "fk-select");
  if (fks.length === 0) return [];
  const out: string[] = [
    "  @override",
    "  void initState() {",
    "    super.initState();",
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
      `        setState(() => _error = 'Upload failed (\${resp.statusCode})');`,
      "      }",
      "    } catch (e) {",
      "      if (mounted) setState(() => _error = '$e');",
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
      return `${stateId(f.wireName)}?.toIso8601String()`;
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
      return `(row[${i}] as DateTime?)?.toIso8601String()`;
    default:
      return `(row[${i}] as TextEditingController).text`;
  }
}

/** One level of the request body under construction — the fields written
 *  directly at this level, plus the nested object keys below it, in first-seen
 *  order so the emitted body follows the declaration order. */
interface BodyNode {
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
    for (const key of f.objectPath ?? []) {
      let child = node.children.get(key);
      if (!child) {
        child = newBodyNode();
        node.children.set(key, child);
        node.order.push(key);
      }
      node = child;
    }
    node.fields.push(f);
  }
  const emit = (node: BodyNode, indent: string): string[] => {
    const out: string[] = [];
    for (const f of node.fields) {
      out.push(`${indent}'${dartStr(f.jsonKey)}': ${fieldValueExpr(f)},`);
    }
    for (const key of node.order) {
      out.push(`${indent}'${dartStr(key)}': <String, dynamic>{`);
      out.push(...emit(node.children.get(key)!, `${indent}  `));
      out.push(`${indent}},`);
    }
    return out;
  };
  return ["    final body = <String, dynamic>{", ...emit(root, "      "), "    };"];
}

/** The `validator:` argument fragment for a text/number input (or "" when the
 *  field needs no validation). */
function validatorArg(f: FlutterFormField): string {
  if (f.kind === "text") {
    return f.required
      ? ", validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null"
      : "";
  }
  if (f.money) {
    // Money submits the typed text verbatim, so the validator has to be the
    // WIRE's own grammar rather than "does Dart parse this as a number":
    // `double.tryParse` accepts `1e5`, which the backend's
    // `^-?\d+(\.\d+)?$` schema rejects with a 422 the user cannot read.
    const ok = `${MONEY_TEXT_PATTERN}.hasMatch(v.trim())`;
    return f.required
      ? `, validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : (${ok} ? null : 'Enter an amount')`
      : `, validator: (v) => (v == null || v.trim().isEmpty) ? null : (${ok} ? null : 'Enter an amount')`;
  }
  const parse = f.kind === "number-int" ? "int.tryParse" : "double.tryParse";
  if (f.required) {
    return `, validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : (${parse}(v) == null ? 'Enter a number' : null)`;
  }
  return `, validator: (v) => (v == null || v.trim().isEmpty) ? null : (${parse}(v) == null ? 'Enter a number' : null)`;
}

/** The Flutter input widget for one field (a single build-children element). */
function fieldWidget(f: FlutterFormField): string {
  const label = `'${dartStr(f.label)}'`;
  const decoration = `const InputDecoration(labelText: ${label})`;
  switch (f.kind) {
    case "text":
      return `TextFormField(controller: ${ctrlId(f.wireName)}, decoration: ${decoration}${validatorArg(f)})`;
    case "number-int":
    case "number-double":
      return `TextFormField(controller: ${ctrlId(f.wireName)}, keyboardType: TextInputType.number, decoration: ${decoration}${validatorArg(f)})`;
    case "bool":
      return `SwitchListTile(title: const Text(${label}), value: ${stateId(f.wireName)}, onChanged: (v) => setState(() => ${stateId(f.wireName)} = v))`;
    case "enum": {
      const items = (f.enumValues ?? [])
        .map((v) => `DropdownMenuItem(value: '${dartStr(v)}', child: Text('${dartStr(v)}'))`)
        .join(", ");
      const validator = f.required ? ", validator: (v) => v == null ? 'Required' : null" : "";
      return `DropdownButtonFormField<String>(initialValue: ${stateId(f.wireName)}, decoration: ${decoration}, items: const [${items}], onChanged: (v) => setState(() => ${stateId(f.wireName)} = v)${validator})`;
    }
    case "fk-select": {
      // Options load at runtime (`_<name>Options`); the label is the target's
      // derived `display` field, falling back to the row id.
      const items = `${optionsId(f.wireName)}.map((o) => DropdownMenuItem(value: o['id'] as String?, child: Text((o['display'] ?? o['id'] ?? '').toString()))).toList()`;
      const validator = f.required ? ", validator: (v) => v == null ? 'Required' : null" : "";
      return `DropdownButtonFormField<String>(initialValue: ${stateId(f.wireName)}, decoration: ${decoration}, isExpanded: true, items: ${items}, onChanged: (v) => setState(() => ${stateId(f.wireName)} = v)${validator})`;
    }
    case "file":
      // A pick button + the current selection.  Not a `FormField`, so the
      // required check rides in `_submit` (`requiredFileGuards`) rather than the
      // `Form`'s validator sweep.
      return (
        `Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Row(children: <Widget>[` +
        `OutlinedButton.icon(icon: const Icon(Icons.upload_file), label: const Text(${label}), onPressed: ${pickerId(f.wireName)}), ` +
        `const SizedBox(width: 12), ` +
        `Expanded(child: Text(${stateId(f.wireName)}?.key ?? 'No file selected', overflow: TextOverflow.ellipsis)), ` +
        `]))`
      );
    case "datetime":
      return `InkWell(onTap: () async { final picked = await showDatePicker(context: context, initialDate: ${stateId(f.wireName)} ?? DateTime.now(), firstDate: DateTime(2000), lastDate: DateTime(2100)); if (picked != null) setState(() => ${stateId(f.wireName)} = picked); }, child: InputDecorator(decoration: ${decoration}, child: Text(${stateId(f.wireName)}?.toIso8601String() ?? 'Select date')))`;
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
        `Align(alignment: Alignment.centerLeft, child: TextButton.icon(icon: const Icon(Icons.add), label: const Text('Add'), onPressed: () => setState(() => ${ctrls}.add(TextEditingController())))), ` +
        `])`
      );
    }
    case "bool-array": {
      // A repeatable CHECKBOX row list — the bool twin of `scalar-array`'s text
      // rows.  Each row edits `_<name>Values[i]` in place.
      const vals = arrayValuesId(f.wireName);
      const row = `Expanded(child: Checkbox(value: entry.value, onChanged: (v) => setState(() => ${vals}[entry.key] = v ?? false)))`;
      return arrayEditor(label, vals, row, `${vals}.add(false)`, `${vals}.removeAt(entry.key)`);
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
      return arrayEditor(label, vals, row, `${vals}.add(${seed})`, `${vals}.removeAt(entry.key)`);
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
        `Align(alignment: Alignment.centerLeft, child: TextButton.icon(icon: const Icon(Icons.add), label: const Text('Add'), onPressed: () => setState(() => ${rows}.add(<dynamic>[${newRow}])))), ` +
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
): string {
  return (
    `Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[` +
    `Padding(padding: const EdgeInsets.only(top: 8, bottom: 4), child: Text(${label}, style: Theme.of(context).textTheme.labelLarge)), ` +
    `...${listId}.asMap().entries.map((entry) => Padding(padding: const EdgeInsets.only(bottom: 4), child: Row(children: <Widget>[` +
    `${rowWidget}, ` +
    `IconButton(icon: const Icon(Icons.remove_circle_outline), onPressed: () => setState(() => ${removeExpr})), ` +
    `]))), ` +
    `Align(alignment: Alignment.centerLeft, child: TextButton.icon(icon: const Icon(Icons.add), label: const Text('Add'), onPressed: () => setState(() => ${addExpr}))), ` +
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
  const lbl = `'${dartStr(sf.label)}'`;
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
        .map((v) => `DropdownMenuItem(value: '${dartStr(v)}', child: Text('${dartStr(v)}'))`)
        .join(", ");
      return (
        `Expanded(child: Padding(padding: const EdgeInsets.only(right: 4), child: ` +
        `DropdownButtonFormField<String>(initialValue: ${slot} as String?, isExpanded: true, ` +
        `decoration: InputDecoration(isDense: true, labelText: ${lbl}), items: const [${items}], ` +
        `onChanged: (v) => setState(() => ${slot} = v))))`
      );
    }
    case "datetime":
      return (
        `Expanded(child: Padding(padding: const EdgeInsets.only(right: 4), child: ` +
        `InkWell(onTap: () async { final picked = await showDatePicker(context: context, initialDate: ${slot} as DateTime? ?? DateTime.now(), firstDate: DateTime(2000), lastDate: DateTime(2100)); if (picked != null) setState(() => ${slot} = picked); }, ` +
        `child: InputDecorator(decoration: InputDecoration(isDense: true, labelText: ${lbl}), child: Text((${slot} as DateTime?)?.toIso8601String() ?? 'Select date', overflow: TextOverflow.ellipsis)))))`
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

/** The required-file guards for a form's `file` inputs.  A `file` input is not a
 *  `FormField`, so the `Form`'s validator sweep never sees it — a required one is
 *  enforced here instead, with the same visible `_error` banner a failed request
 *  uses. */
function requiredFileGuards(fields: readonly FlutterFormField[]): string[] {
  const out: string[] = [];
  for (const f of fields) {
    if (f.kind !== "file" || !f.required) continue;
    out.push(
      `    if (${stateId(f.wireName)} == null) {`,
      `      setState(() => _error = '${dartStr(f.label)} is required');`,
      "      return;",
      "    }",
    );
  }
  return out;
}

/** The `_submit` method for a fields-bearing (create / operation) form. */
function submitMethod(spec: FlutterFormSpec): string[] {
  const gate =
    spec.fields.length > 0 ? "    if (!(_formKey.currentState?.validate() ?? false)) return;" : "";
  return [
    "  Future<void> _submit() async {",
    ...(gate ? [gate] : []),
    ...requiredFileGuards(spec.fields),
    "    setState(() {",
    "      _submitting = true;",
    "      _error = null;",
    "    });",
    ...bodyAssembly(spec.fields),
    "    try {",
    `      final res = await http.post(apiUri('${spec.pathExpr}'),`,
    "          headers: const {'Content-Type': 'application/json'},",
    "          body: jsonEncode(body));",
    "      if (res.statusCode >= 200 && res.statusCode < 300) {",
    "        if (!mounted) return;",
    "        Navigator.of(context).pop();",
    "        return;",
    "      }",
    // Emitted Dart string interpolation — an escaped template literal keeps the
    // `${res.statusCode}` in the generated Dart (not a TS template interp).
    `      setState(() => _error = 'Request failed (\${res.statusCode})');`,
    "    } catch (e) {",
    "      setState(() => _error = '$e');",
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
    // Emitted Dart string interpolation (escaped template literal — see above).
    `      setState(() => _error = 'Delete failed (\${res.statusCode})');`,
    "    } catch (e) {",
    "      setState(() => _error = '$e');",
    "    } finally {",
    "      if (mounted) setState(() => _submitting = false);",
    "    }",
    "  }",
  ];
}

/** The submit button element for a form's build children. */
function submitButton(spec: FlutterFormSpec): string {
  const label = `'${dartStr(spec.submitLabel)}'`;
  const style = spec.destructive
    ? "style: ElevatedButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error, foregroundColor: Theme.of(context).colorScheme.onError), "
    : "";
  // The button itself can't be const (its `onPressed` closes over `_submit`), but
  // its literal-text child can.
  return `ElevatedButton(${style}onPressed: _submitting ? null : _submit, child: const Text(${label}))`;
}

/** Emit one form widget class (a `StatefulWidget` + its `State`). */
export function renderFormWidget(spec: FlutterFormSpec): string {
  const w = spec.widgetName;
  const ctorArgs = spec.needsId ? "{super.key, required this.id}" : "{super.key}";
  const idField = spec.needsId ? ["  final String id;"] : [];

  const errorBanner =
    "        if (_error != null)\n" +
    "          Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),";
  const inputChildren = spec.fields.map((f) => `        ${fieldWidget(f)},`);
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
  stateMembers.push("  String? _error;");

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

/** Emit `lib/forms.dart` — every form widget a ui hosts.  Returns "" when the
 *  ui hosts no forms (the caller then emits no file). */
export function renderFormsFile(forms: readonly FlutterFormSpec[]): string {
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
    "import 'package:http/http.dart' as http;",
    "",
    "import 'config.dart';",
    ...(usesFile ? ["import 'models.dart';"] : []),
    "",
    ...blocks.flatMap((b, i) => (i === 0 ? [b] : ["", b])),
  )}\n`;
}

// ---------------------------------------------------------------------------
// View-model preparer for a single form-input field.  Picks the
// right field-input-* template per type and assembles the VM data
// the template needs.  Recursive value-objects don't render here —
// the preparer returns nested children, the renderer walks them in
// TS so the per-pack templates stay flat.
//
// Shares the testid shape and option-label resolution rules
// (`X id`'s display field; placeholder fallback when the target
// lacks a display) with `formInput` in form-helpers.ts.
// ---------------------------------------------------------------------------

import type { AggregateIR, BoundedContextIR, TypeIR } from "../../ir/types/loom-ir.js";
import { modelTextContextOf } from "../../ir/util/model-text-owner.js";
import { findValueObjectInScope } from "../../ir/util/reachable-types.js";
import { modelTextKey } from "../../util/model-text-key.js";
import { humanize } from "../../util/naming.js";
import { idTargetHookVar, initialValueTs, unwrapOpt } from "../_frontend/form-helpers.js";
import {
  type FormFieldArms,
  type FormFieldSpec,
  formFieldSpec,
  formSpecEnvOf,
  renderFormField,
} from "../_frontend/form-spec.js";
import type { FormFieldVM } from "../_frontend/view-models.js";

export function prepareFormFieldVM(
  path: string,
  t: TypeIR,
  ctx: BoundedContextIR,
  testId: string,
  aggregatesByName: Map<string, AggregateIR>,
  /** Aggregate → owning context, for `isPagedAllRead`.  Absent means "assume
   *  the bare array": the conservative answer, per `isPagedAllRead`'s own
   *  contract — a bare-array read of an envelope renders an empty list, while
   *  an `.items` read of a bare array is a type error AND an empty list. */
  bcByAggregate?: ReadonlyMap<string, BoundedContextIR>,
  /** The model type the field is declared on (an aggregate, value object or
   *  workflow), for its identity-keyed label; absent when the input names no
   *  model fact.  Nested value-object fields key under the value object. */
  labelOwner?: string,
): FormFieldVM {
  const vm = prepareFormFieldVMInner(path, t, ctx, testId, aggregatesByName, bcByAggregate);
  if (labelOwner === undefined) return vm;
  const leaf = path.split(".").pop()!;
  const labelKey = modelTextKey({
    ctx: modelTextContextOf(labelOwner, ctx, bcByAggregate?.values()),
    type: labelOwner,
    facet: "field",
    member: leaf,
  });
  return { ...vm, labelKey };
}

/** The identity key of every value of enum `name`, in declaration order. */
function enumValueKeysOf(
  name: string,
  values: readonly string[],
  ctx: BoundedContextIR,
  bcByAggregate: ReadonlyMap<string, BoundedContextIR> | undefined,
): string[] {
  const owner = modelTextContextOf(name, ctx, bcByAggregate?.values());
  return values.map((v) => modelTextKey({ ctx: owner, type: name, facet: "value", member: v }));
}

function prepareFormFieldVMInner(
  path: string,
  t: TypeIR,
  ctx: BoundedContextIR,
  testId: string,
  aggregatesByName: Map<string, AggregateIR>,
  bcByAggregate?: ReadonlyMap<string, BoundedContextIR>,
): FormFieldVM {
  // Label = humanised leaf segment so nested VO fields render as
  // "Amount" / "Currency" rather than "price.amount" / etc.
  const leaf = path.split(".").pop()!;
  const spec = formFieldSpec(
    { name: leaf, type: t },
    formSpecEnvOf(ctx, aggregatesByName, bcByAggregate),
    path,
  );
  return renderFormField(spec, JSX_FORM_FIELD_ARMS, {
    path,
    label: humanize(leaf),
    testId,
    errorExpr: errorAccess(path),
    ctx,
    aggregatesByName,
    bcByAggregate,
  });
}

interface JsxArmCtx {
  path: string;
  label: string;
  testId: string;
  errorExpr: string;
  ctx: BoundedContextIR;
  aggregatesByName: Map<string, AggregateIR>;
  bcByAggregate?: ReadonlyMap<string, BoundedContextIR>;
}

/** The VM fields every arm shares; each arm names its `template` literally
 *  (`template: "field-input-…"`), which is what the pack-render reachability
 *  scrape reads. */
function base(c: JsxArmCtx): Omit<FormFieldVM, "template"> {
  return { path: c.path, label: c.label, testId: c.testId, errorExpr: c.errorExpr };
}

function refVM(f: FormFieldSpec, c: JsxArmCtx): FormFieldVM {
  const targetName = f.picker!.target;
  const target = c.aggregatesByName.get(targetName);
  // The Select picker reads the option label off the wire `display`
  // field — backends emit the `derived display: string = ...`
  // expression as a JSON field on the response DTO, so the picker
  // doesn't need to know the underlying source expression shape.
  // Text-input fallback only when there's truly no display to read
  // — target unresolved (cross-module ref to an aggregate the
  // context doesn't see) or target has no `derived display` at all.
  if (!target?.displayDerived) {
    const reason = !target
      ? `${targetName} id: target aggregate not found`
      : `Aggregate '${targetName}' has no 'derived display' — declare 'derived display: string = <expr>' to enable a Select picker for ${targetName} id.`;
    return {
      ...base(c),
      template: "field-input-id-text",
      placeholderJson: JSON.stringify(`<id> — ${reason}`),
    };
  }
  const hookVar = idTargetHookVar(target);
  return {
    ...base(c),
    template: "field-input-id-select",
    hookVar,
    displayField: "display",
    optionsExpr: idSelectOptionsExpr(hookVar),
  };
}

function valueObjectVM(f: FormFieldSpec, c: JsxArmCtx): FormFieldVM {
  const vo = findValueObjectInScope(c.ctx, f.valueObject!)!;
  const children = vo.fields.map((vf) =>
    prepareFormFieldVM(
      `${c.path}.${vf.name}`,
      vf.type,
      c.ctx,
      `${c.testId}-${vf.name}`,
      c.aggregatesByName,
      c.bcByAggregate,
      vo.name,
    ),
  );
  return { ...base(c), template: "field-input-valueobject", children };
}

/** A scalar / enum / id array renders the pack's disabled stub: the
 *  `field-input-array` template with no `rowFields`. */
function arrayStubVM(_f: FormFieldSpec, c: JsxArmCtx): FormFieldVM {
  return { ...base(c), template: "field-input-array" };
}

/** The JSX-family (React / Vue / Svelte) arm per form field kind.  Each arm
 *  picks the pack's `field-input-*` template and assembles its view-model. */
export const JSX_FORM_FIELD_ARMS: FormFieldArms<FormFieldVM, JsxArmCtx> = {
  string: (_f, c) => ({ ...base(c), template: "field-input-string" }),
  int: (_f, c) => ({ ...base(c), template: "field-input-int" }),
  decimal: (_f, c) => ({ ...base(c), template: "field-input-decimal" }),
  money: (_f, c) => ({ ...base(c), template: "field-input-money" }),
  bool: (_f, c) => ({ ...base(c), template: "field-input-bool" }),
  // A calendar `date` gets a DATE picker (`<input type="date">`), whose value
  // is already the wire's `YYYY-MM-DD` — no zone conversion on either side.
  date: (_f, c) => ({ ...base(c), template: "field-input-date" }),
  datetime: (_f, c) => ({ ...base(c), template: "field-input-datetime" }),
  // A `File`-typed field renders a file-upload input: the pack's
  // `field-input-file` template wraps a `<Controller>` whose `onChange`
  // receives the uploaded `FileRef` (via `api.upload`).
  file: (_f, c) => ({ ...base(c), template: "field-input-file" }),
  enum: (f, c) => ({
    ...base(c),
    template: "field-input-enum-select",
    enumValuesJson: JSON.stringify(f.enumValues),
    enumValueKeys: enumValueKeysOf(f.enumName!, f.enumValues!, c.ctx, c.bcByAggregate),
  }),
  ref: refVM,
  optionalRef: refVM,
  valueObject: valueObjectVM,
  optionalValueObject: (f, c) => ({
    ...valueObjectVM(f, c),
    optionalGroup: { zeroTs: initialValueTs(unwrapOpt(f.type), c.ctx, false) },
  }),
  scalarArray: (f, c) => ({
    ...base(c),
    template: "field-input-array",
    arrayInput: { kind: "scalar", element: f.elementKind ?? "string" },
  }),
  enumArray: (f, c) =>
    f.enumValues
      ? {
          ...base(c),
          template: "field-input-array",
          arrayInput: { kind: "enum", valuesJson: JSON.stringify(f.enumValues) },
        }
      : arrayStubVM(f, c),
  refArray: (f, c) => {
    const target = f.picker ? c.aggregatesByName.get(f.picker.target) : undefined;
    if (!target) return arrayStubVM(f, c);
    return {
      ...base(c),
      template: "field-input-array",
      arrayInput: {
        kind: "ref",
        optionsExpr: idSelectOptionsExpr(idTargetHookVar(target)),
        hasDisplay: !!target.displayDerived,
      },
    };
  },
  objectArray: (f, c) => objectArrayVM(f, c),
};

/** An array of a value-object → a dynamic-row field-array: one repeatable
 *  group per element, each carrying the value-object's sub-fields.  The row
 *  sub-fields carry BARE sub-paths (`sku`) so a `useFieldArray`-style template
 *  splices the runtime index (`items.${index}.sku`). */
function objectArrayVM(f: FormFieldSpec, c: JsxArmCtx): FormFieldVM {
  const vo = findValueObjectInScope(c.ctx, f.valueObject!)!;
  const leaf = c.path.split(".").pop()!;
  // Row sub-fields carry a BARE sub-path (`sku`, not `items.sku`) so a
  // dynamic-row template splices the runtime index; numeric sub-fields
  // flag `valueAsNumber` so their register coerces the string input.
  //
  // `money` is deliberately NOT numeric here: a money value is a string
  // (or a `Decimal`) in form state and on the wire — never a JS number.
  // `valueAsNumber` would coerce the row input to a number, which fails
  // the `moneySchema` union (`Decimal | string`) and, were it to pass,
  // would put a JSON number on a wire the backends parse as a decimal
  // string.  Same contract the flat money field already honours via
  // `Controller` + `Decimal`.
  const NUMERIC = new Set(["field-input-int", "field-input-decimal"]);
  const rowFields = vo.fields.map((vf) => {
    const vm = prepareFormFieldVM(
      vf.name,
      vf.type,
      c.ctx,
      `${c.testId}-${vf.name}`,
      c.aggregatesByName,
      c.bcByAggregate,
      vo.name,
    );
    // The row's own error access: the sub-field VM's `errorExpr` was built
    // from its BARE path (`errors.voyage?.message`) and points at nothing,
    // because the errors object mirrors the form VALUES — where the
    // sub-field sits under the array element.  `index` is the row
    // template's loop variable.
    const withRowError = { ...vm, rowErrorExpr: rowErrorAccess(c.path, vf.name) };
    return NUMERIC.has(vm.template) ? { ...withRowError, valueAsNumber: true } : withRowError;
  });
  // A fresh-row default for `append(...)` — zero value per sub-field kind.
  // Money seeds a real `new Decimal("0")`, not the string `"0"`: form
  // state holds an already-constructed Decimal (the money input control
  // converts on change — `moneySchema`'s own doc comment), and Vue's and
  // Svelte's `FormValues<T>` are the schema's OUTPUT type, where that slot
  // is `Decimal` and a string seed is `TS2322: Type 'string' is not
  // assignable to type 'Decimal'`.
  const defaultRowJson = `{ ${rowFields
    .map((rf) => `${rf.path}: ${defaultRowValue(rf)}`)
    .join(", ")} }`;
  return {
    ...base(c),
    template: "field-input-array",
    rowFields,
    elementName: vo.name,
    arrayPascal: leaf.charAt(0).toUpperCase() + leaf.slice(1),
    defaultRowJson,
  };
}

/** The zero value a freshly-appended dynamic row seeds one sub-field with.
 *  Keyed off the field's TEMPLATE (not `valueAsNumber`), so `money` — which is
 *  no longer numeric — still gets a parseable seed rather than falling into the
 *  `""` bucket that `moneySchema` rejects.
 *
 *  The money seed is a CONSTRUCTED `Decimal`, matching what the single-field
 *  money input writes on change.  `new Decimal(…)` in the emitted page is also
 *  what pulls the import in: every JS frontend's page shell decides the
 *  `decimal.js` import by scanning the assembled file for the binding
 *  (`usesDecimalBinding`), so the seed needs no import wiring of its own. */
function defaultRowValue(f: FormFieldVM): string {
  if (f.template === "field-input-money") return 'new Decimal("0")';
  if (f.template === "field-input-bool") return "false";
  // An enum row starts on its first value, the option its select shows.
  if (f.template === "field-input-enum-select" && f.enumValuesJson) {
    const first = (JSON.parse(f.enumValuesJson) as string[])[0];
    if (first !== undefined) return JSON.stringify(first);
  }
  return f.valueAsNumber ? "0" : '""';
}

/** RHF errors live at `errors.foo.bar.baz?.message` — translate a dot-
 *  path into the matching access expression. */
/** The id-select picker's option source: the target's `use<Plural>Options()`
 *  query, whose `data` is every row as a bare array (`_frontend/api-module.ts`
 *  `pickerOptionsHook`).  Every JSX/markup pack splices this verbatim, so the
 *  `field-input-id-select.hbs` templates carry no opinion about the wire. */
function idSelectOptionsExpr(hookVar: string): string {
  return `${hookVar}.data ?? []`;
}

/** The text a field's error renders: `fieldErrorText(errors.foo?.bar)`, which
 *  localizes the error by its catalog code when the form RENDERS (so a locale
 *  change re-renders it), falling back to the English message.  The helper is
 *  the React projects' `src/lib/field-error.ts`; only the React packs read
 *  `errorExpr`. */
function errorAccess(path: string): string {
  const parts = path.split(".");
  return `${FIELD_ERROR_TEXT}(errors.${parts.join("?.")})`;
}

/** Error text for one sub-field of one dynamic row —
 *  `fieldErrorText(errors.legs?.[index]?.voyage)`.  `arrayPath` is the array
 *  field's dotted path (so a nested array still optional-chains through its
 *  parents); `sub` is the row sub-field's bare name.  `index` is emitted
 *  verbatim: it is the row template's own loop variable, not a value this
 *  layer knows. */
export function rowErrorAccess(arrayPath: string, sub: string): string {
  const parts = arrayPath.split(".");
  return `${FIELD_ERROR_TEXT}(errors.${parts.join("?.")}?.[index]?.${sub.split(".").join("?.")})`;
}

/** The render-time field-error localizer a form's `errorExpr` calls. */
export const FIELD_ERROR_TEXT = "fieldErrorText";

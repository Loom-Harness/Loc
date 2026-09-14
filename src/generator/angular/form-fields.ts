import type {
  AggregateIR,
  BoundedContextIR,
  ExprIR,
  FieldIR,
  TypeIR,
} from "../../ir/types/loom-ir.js";
import { humanize, lowerFirst, plural, upperFirst } from "../../util/naming.js";
import { renderDefaultSeed } from "../_frontend/default-seed.js";
import { unwrapOpt } from "../_frontend/form-helpers.js";
import type { WalkContext } from "../_walker/walker-core.js";

// ---------------------------------------------------------------------------
// Shared Reactive-Forms field rendering for the Angular form forks
// (`CreateForm` and the operation/modal forms).  Both build a typed
// `FormGroup` of `nonNullable` `FormControl`s and render per-field Material
// inputs; this module owns the type → control-init + input-markup mapping so
// the two renderers stay byte-consistent.
// ---------------------------------------------------------------------------

/** A single `FormControl` the page-shell declares in the `FormGroup`. */
export interface AngularFormControlSpec {
  name: string;
  /** JS literal for the control's initial value (`""`, `0`, `false`, …). */
  init: string;
  /** Explicit control generic — when set, the control emits as
   *  `new FormControl<${tsType}>(${init})` (nullable, no `nonNullable`).  A
   *  `File` field uses `FileRef | null` so the uploaded ref + the `null` seed
   *  both assign (a `nonNullable` string control rejects the FileRef). */
  tsType?: string;
  /** `Validators.*` calls derived from the aggregate's wire-translatable
   *  invariants (`Validators.min(N)`, `Validators.pattern(/…/)`, …) — the
   *  Angular twin of the zod native-chain the other frontends emit on
   *  `Create<Agg>Request`.  Absent (undefined) when the field carries no
   *  wire constraint, keeping the emitted `FormControl` byte-identical. */
  validators?: string[];
}

/** A `useAll<X>()` query the page-shell hoists so an `X id` form field can
 *  render a Select populated from the referenced aggregate's collection.
 *  `hookVar` is the class field the hoist declares (`readonly <hookVar> =
 *  <hookFn>();`); the field markup reads its options off `<hookVar>.data()`. */
export interface AngularIdTargetSpec {
  /** Class field name the page-shell hoists (`customerAll`). */
  hookVar: string;
  /** `useAll<X>` factory the field calls (imported from `importFrom`). */
  hookFn: string;
  /** `src/api/<x>` module path the `hookFn` is imported from (page-relative). */
  importFrom: string;
}

/** Resolve the `useAll<X>()` query an `X id` field needs to render a Select,
 *  or `undefined` when the field is not a Select-rendered id (not an id type,
 *  the target aggregate is unresolved, or it carries no `derived display`).
 *
 *  Mirrors the shared `form-fields-vm.ts` gate (`inner.kind === "id"` with a
 *  resolvable `target.displayDerived`): the page-shell hoists `useAll<X>()`
 *  exactly for the fields {@link fieldInput} renders as a `<select>`. */
export function idTargetForField(
  t: TypeIR,
  bc: BoundedContextIR,
  ctx: WalkContext,
): AngularIdTargetSpec | undefined {
  const inner = unwrapOpt(t);
  if (inner.kind !== "id") return undefined;
  const target = resolveIdTarget(inner.targetName, bc, ctx);
  if (!target?.displayDerived) return undefined;
  return {
    hookVar: `${lowerFirst(target.name)}All`,
    hookFn: `useAll${plural(target.name)}`,
    importFrom: `../../api/${lowerFirst(target.name)}`,
  };
}

/** Collect the de-duplicated `useAll<X>()` queries a form's fields need —
 *  one per distinct Select-rendered `X id` target.  The page-shell hoists each
 *  as a class field and imports its `useAll<X>` factory. */
export function collectIdTargets(
  fields: { type: TypeIR }[],
  bc: BoundedContextIR,
  ctx: WalkContext,
): AngularIdTargetSpec[] {
  const seen = new Set<string>();
  const out: AngularIdTargetSpec[] = [];
  for (const f of fields) {
    const target = idTargetForField(f.type, bc, ctx);
    if (target && !seen.has(target.hookVar)) {
      seen.add(target.hookVar);
      out.push(target);
    }
  }
  return out;
}

/** Resolve an `X id` field's target aggregate — preferring the cross-context
 *  `ctx.aggregatesByName` (covers cross-module refs the way the React seam
 *  does), falling back to the field's own bounded context. */
function resolveIdTarget(
  name: string,
  bc: BoundedContextIR,
  ctx: WalkContext,
): AggregateIR | undefined {
  return ctx.aggregatesByName.get(name) ?? bc.aggregates.find((a) => a.name === name);
}

/** The inline Reactive-Form rendering flavour the active Angular pack uses.
 *  - `material` (`angularMaterial`) — `mat-form-field` / `matInput` / `Mat*Module`.
 *  - `primeng` — idiomatic PrimeNG inputs (`pInputText` / `p-inputnumber` /
 *    `p-select` / `p-checkbox` / `p-password` / `pButton`) + `primeng/*` modules.
 *  - `plain` (`spartanNg`) — plain styled elements + the pack's `.loom-*`
 *    classes; no component-library modules to register.
 *  The `material` branch must stay byte-identical (it's frozen by the
 *  generator tests); PrimeNG and `spartanNg` never register `Mat*Module`
 *  (those symbols don't resolve and the standalone `imports: []` would fail
 *  `ng build`). */
export type AngularFormStyle = "material" | "primeng" | "plain";

export function formStyle(ctx: WalkContext): AngularFormStyle {
  const name = ctx.pack.manifest.name;
  if (name === "primeng") return "primeng";
  if (name === "angularMaterial") return "material";
  return "plain";
}

/** True only for the Angular Material pack — the seams that fork Material-vs.
 *  other markup branch on this; PrimeNG and `spartanNg` both answer `false`
 *  and branch on {@link formStyle} for their own markup. */
export function isMaterialPack(ctx: WalkContext): boolean {
  return formStyle(ctx) === "material";
}

/** Render one form submit/cancel/action button, Material- or plain-styled per
 *  the active pack.  Material registers `MatButtonModule`; plain packs use the
 *  `.loom-button` classes from their theme (no module to register). */
export function formButton(
  ctx: WalkContext,
  opts: {
    type: "submit" | "button";
    emphasis: "primary" | "secondary" | "warn";
    label: string;
    attrs?: string;
  },
): string {
  const { type, emphasis, label, attrs = "" } = opts;
  const style = formStyle(ctx);
  if (style === "material") {
    addNg(ctx, "@angular/material/button", "MatButtonModule");
    const matAttr =
      emphasis === "secondary"
        ? "mat-stroked-button"
        : emphasis === "warn"
          ? 'mat-raised-button color="warn"'
          : type === "button"
            ? "mat-button"
            : "mat-raised-button";
    return `<button ${matAttr} type="${type}"${attrs}>${label}</button>`;
  }
  if (style === "primeng") {
    addNg(ctx, "primeng/button", "ButtonModule");
    const pAttr =
      emphasis === "secondary"
        ? ' [outlined]="true"'
        : emphasis === "warn"
          ? ' severity="danger"'
          : "";
    return `<button pButton type="${type}"${pAttr}${attrs}>${label}</button>`;
  }
  const cls =
    emphasis === "secondary"
      ? "loom-button loom-button-secondary"
      : emphasis === "warn"
        ? "loom-button loom-button-warn"
        : "loom-button loom-button-primary";
  return `<button class="${cls}" type="${type}"${attrs}>${label}</button>`;
}

/** Register the imports a File field's file input + `onFileUpload` method need:
 *  `AbstractControl` (the method's typed control param) and the `api` client
 *  (the multipart `upload` call).  The client sits at `../../api/client` —
 *  same depth as a form's `../../api/<agg>` mutation import. */
export function registerFileUploadImports(ctx: WalkContext): void {
  addNg(ctx, "@angular/forms", "AbstractControl");
  addNg(ctx, "../../api/client", "api");
  // The File FormControl is typed `FormControl<FileRef | null>`.
  addNg(ctx, "../../api/client", "FileRef");
}

/** The shared `onFileUpload` component method a form with ≥1 `File` field emits
 *  once: reads the chosen file off the change event, POSTs it multipart via
 *  `api.upload("/files", …)`, and `setValue`s the returned `FileRef` into the
 *  passed reactive-form control (clearing to `null` when the pick is cleared). */
export function fileUploadMethodLines(): string[] {
  return [
    "  async onFileUpload(event: Event, control: AbstractControl | null): Promise<void> {",
    "    if (!control) return;",
    "    const file = (event.target as HTMLInputElement).files?.[0];",
    "    if (!file) {",
    "      control.setValue(null);",
    "      return;",
    "    }",
    "    const fd = new FormData();",
    '    fd.append("file", file);',
    '    control.setValue(await api.upload("/files", fd));',
    "  }",
  ];
}

/** Register a `@angular/*` import on the walk's import map. */
export function addNg(ctx: WalkContext, from: string, ...names: string[]): void {
  let set = ctx.imports.get(from);
  if (!set) {
    set = new Set<string>();
    ctx.imports.set(from, set);
  }
  for (const n of names) set.add(n);
}

/** FormControl initial value per field type (kept in sync with the request
 *  field type so the nonNullable control stays assignable). */
export function controlInit(t: TypeIR): string {
  if (t.kind === "primitive") {
    if (t.name === "bool") return "false";
    // `money` is a STRING on the wire (`wireTsType` maps it to `string`), so the
    // control must seed a string too — a `FormControl(0)` types as
    // `FormControl<number>` and fails `TS2345` when `getRawValue()` is handed to
    // the request DTO, and if suppressed it would POST a JSON number the
    // backends reject.  `"0"` (not `""`) so an untouched required control is a
    // parseable decimal.
    if (t.name === "money") return '"0"';
    if (t.name === "int" || t.name === "long" || t.name === "decimal") {
      return "0";
    }
    return '""';
  }
  if (t.kind === "enum") return '""';
  // Required `X id` (FK) → the request wants a `string` (`wireTsType`'s id case),
  // and a Select binds the chosen id into it.  Init `""` (not `null`) so the
  // `nonNullable` control types as `FormControl<string>` and `getRawValue()`
  // stays assignable to the request DTO — a `FormControl(null)` typed as
  // `FormControl<null>` failed `mutateAsync` under `ng build` (TS2345/2322).
  if (t.kind === "id") return '""';
  // Optional id (`t.kind === "optional"`), value objects and nested entities
  // keep `null`: their request type is nullable or `unknown` (request-side VO/
  // entity stay `unknown` in `wireTsType`), both null-assignable.
  return "null";
}

// ---------------------------------------------------------------------------
// Field validation messages, and the ARIA that makes them audible
// (M-T1.12 slice 6, the Angular half).
//
// Angular is the one frontend that builds its form controls ITSELF rather than
// through a design-pack template or a UI-kit field component, so the wiring the
// others inherit for free — Mantine's `error` prop, vuetify's
// `<v-text-field>`, formsnap on Svelte — has no equivalent here.  What shipped
// was a visible message appended AFTER the whole control:
//
//     <mat-form-field><input matInput formControlName="sku"></mat-form-field>
//     @if (f.controls.sku.invalid && f.controls.sku.touched) {
//       <p class="loom-error" data-testid="…-error-sku">Sku is invalid</p> }
//
// Sighted users saw it; a screen reader announced nothing, because nothing tied
// the message to the control.  The remedy diverges by pack style, and the
// divergence is the point — spelling ARIA a library already host-binds makes it
// WORSE, not better:
//
//   material — `MatInput` host-binds `[attr.aria-invalid]` off its own
//     `errorState` (`invalid && (touched || submitted)`, which is our
//     condition), and `MatFormField` sets the input's `aria-describedby` from
//     the `<mat-error>` children it finds.  So the message moves INSIDE the
//     form field as a `<mat-error>` and the association is the library's.  An
//     explicit `[attr.aria-invalid]` beside the host binding would be a second
//     writer on one attribute — measured in a booted bundle, where the
//     attribute was present on load and was not ours.
//
//   primeng / plain — `pInputText` and the spartanNg input are plain `<input>`
//     elements with no directive managing either attribute, so Loom spells both
//     itself, bound to exactly the condition the visible message is gated on.
// ---------------------------------------------------------------------------

/** The two ARIA bindings a RAW form control carries when its field has a
 *  client-side constraint.  Both are `[attr.…]` bindings evaluating to `null`
 *  while the field is valid or untouched, so each attribute is absent from the
 *  DOM exactly when the visible message is — one condition, both channels. */
export interface AngularFieldAria {
  /** Template expression for `[attr.aria-invalid]`. */
  invalid: string;
  /** Template expression for `[attr.aria-describedby]`. */
  describedBy: string;
}

/** The ARIA bindings as an attribute fragment — empty for a field with no
 *  constraint, which is what keeps a validator-free form byte-identical. */
function fieldAriaAttrs(a: AngularFieldAria | undefined): string {
  if (!a) return "";
  return ` [attr.aria-invalid]="${a.invalid}" [attr.aria-describedby]="${a.describedBy}"`;
}

/** The id of a constrained field's inline message, and the `aria-describedby`
 *  target that points at it.  ONE definition, so the two halves cannot drift
 *  into a dangling reference. */
export function fieldErrorId(ns: string, name: string): string {
  return `${ns}-error-${name}`;
}

/** The `@if` condition a constrained field's message is gated on — and, on the
 *  raw packs, the expression both ARIA bindings evaluate. */
function fieldErrorWhen(formVar: string, name: string): string {
  return `${formVar}.controls.${name}.invalid && ${formVar}.controls.${name}.touched`;
}

/** The ARIA bindings for one constrained flat field of `formVar`'s group. */
export function fieldAriaFor(formVar: string, ns: string, name: string): AngularFieldAria {
  const when = fieldErrorWhen(formVar, name);
  return {
    invalid: `${when} ? 'true' : null`,
    describedBy: `${when} ? '${fieldErrorId(ns, name)}' : null`,
  };
}

/** Attach a constrained field's inline message to its rendered control.
 *
 *  On `material` the message is a `<mat-error>` spliced INSIDE the
 *  `<mat-form-field>` — that placement is what makes `MatFormField` point the
 *  input's `aria-describedby` at it.  A control that is NOT a form field (a
 *  `mat-checkbox`, the plain File input every pack shares) has nowhere inside
 *  to put it, so it falls back to the trailing `<p>` like the raw packs, which
 *  is why this branches on the rendered markup rather than on the style alone.
 *  On `primeng` / `plain` the message always trails and the control carries the
 *  ARIA itself. */
export function withFieldError(
  markup: string,
  style: AngularFormStyle,
  error: { id: string; testid: string; when: string; text: string } | undefined,
): string {
  if (!error) return markup;
  const { id, testid, when, text } = error;
  const CLOSE = "</mat-form-field>";
  if (style === "material" && markup.endsWith(CLOSE)) {
    const inner = `@if (${when}) {<mat-error id="${id}" data-testid="${testid}">${text}</mat-error>}`;
    return `${markup.slice(0, -CLOSE.length)}${inner}${CLOSE}`;
  }
  return `${markup}@if (${when}) {<p id="${id}" class="loom-error" data-testid="${testid}">${text}</p>}`;
}

/** Render one field's control markup, registering the Material module it needs.
 *  `testidBase` overrides the field's `data-testid` (default `${ns}-input-${name}`)
 *  — a value-object sub-field passes `${container}-${sub}` so its testid nests
 *  under the fieldset container (`products-new-input-price-amount`).
 *  `a11y` is set only for a FLAT field of a form whose group variable is known
 *  and whose name carries a constraint — a value-object sub-field or an array
 *  row resolves against a nested group, so `formVar.controls.<name>` would not
 *  address it. */
export function fieldInput(
  name: string,
  t: TypeIR,
  bc: BoundedContextIR,
  ns: string,
  ctx: WalkContext,
  testidBase: string = `${ns}-input-${name}`,
  formVar?: string,
  a11y?: AngularFieldAria,
): string {
  const label = humanize(name);
  // Attributes every branch puts on the CONTROL element itself (never on a
  // wrapper): the test id, plus — when this field carries a client-side
  // constraint — the two ARIA bindings that announce its error state.  Folded
  // into one string so a new control branch cannot forget half of it.
  const testid = ` data-testid="${testidBase}"${fieldAriaAttrs(a11y)}`;
  const cn = JSON.stringify(name);
  const style = formStyle(ctx);
  // Dispatch on the UNWRAPPED type — an optional field (`attachment: File?`,
  // `estimate: int?`, `resolvedAt: datetime?`) renders the same control as its
  // required twin, exactly as the shared `prepareFormFieldVM` does for the JSX
  // frontends.  Matching on the raw `t` instead sent every optional field to
  // the plain-text fallback, and for a `File?` that silently skipped
  // `registerFileUploadImports` while `flatControls` (which DOES unwrap) still
  // typed the control `FormControl<FileRef | null>` — `ng build` then failed on
  // an unimported `FileRef` and an unimported `api` in the emitted
  // `onFileUpload` method.
  const inner = unwrapOpt(t);
  // A `File` field renders a native file input that multipart-POSTs the chosen
  // file to `/files` (`api.upload`) and writes the returned `FileRef` back into
  // the reactive-form control — file inputs can't use `formControlName` (the
  // value accessor rejects a non-string value), so the change handler resolves
  // the control off the form group and `setValue`s it via `onFileUpload`.  A
  // plain input across all packs (no design-system file component exists in
  // Material/PrimeNG/spartanNg); mirrors the JSX frontends' `field-input-file`.
  if (inner.kind === "primitive" && inner.name === "File") {
    registerFileUploadImports(ctx);
    // The control name is single-quoted: it sits inside the double-quoted
    // `(change)="…"` attribute, so `JSON.stringify`'s double quotes would close
    // the attribute early.  Field names are safe identifiers (no escaping needed).
    const change = formVar ? ` (change)="onFileUpload($event, ${formVar}.get('${name}'))"` : "";
    return `<label class="loom-field"><span class="loom-label">${label}</span><input type="file" class="loom-input"${testid}${change} /></label>`;
  }
  if (inner.kind === "enum") {
    const en = bc.enums.find((e) => e.name === inner.name);
    if (style === "material") {
      addNg(ctx, "@angular/material/form-field", "MatFormFieldModule");
      addNg(ctx, "@angular/material/select", "MatSelectModule");
      const opts = (en?.values ?? [])
        .map((v) => `<mat-option value=${JSON.stringify(v)}>${v}</mat-option>`)
        .join("");
      return `<mat-form-field class="loom-field"><mat-label>${label}</mat-label><mat-select formControlName=${cn}${testid}>${opts}</mat-select></mat-form-field>`;
    }
    if (style === "primeng") {
      addNg(ctx, "primeng/select", "SelectModule");
      const opts = JSON.stringify((en?.values ?? []).map((v) => ({ label: v, value: v })));
      return `<label class="loom-field"><span class="loom-label">${label}</span><p-select [options]='${opts}' optionLabel="label" optionValue="value" styleClass="loom-input" formControlName=${cn}${testid}></p-select></label>`;
    }
    const opts = (en?.values ?? [])
      .map((v) => `<option value=${JSON.stringify(v)}>${v}</option>`)
      .join("");
    return `<label class="loom-field"><span class="loom-label">${label}</span><select class="loom-input" formControlName=${cn}${testid}>${opts}</select></label>`;
  }
  if (inner.kind === "primitive" && inner.name === "bool") {
    if (style === "material") {
      addNg(ctx, "@angular/material/checkbox", "MatCheckboxModule");
      return `<mat-checkbox formControlName=${cn}${testid}>${label}</mat-checkbox>`;
    }
    if (style === "primeng") {
      addNg(ctx, "primeng/checkbox", "CheckboxModule");
      return `<label class="loom-toggle"><p-checkbox [binary]="true" formControlName=${cn}${testid}></p-checkbox><span>${label}</span></label>`;
    }
    return `<label class="loom-toggle"><input type="checkbox" formControlName=${cn}${testid} />${label}</label>`;
  }
  // `X id` (cross-aggregate reference) → a Select populated from the target's
  // `useAll<X>()` collection (parity with React/Vue/Svelte's
  // `field-input-id-select`).  Gated exactly like `form-fields-vm.ts`: emit a
  // Select only when the target aggregate resolves and carries a `derived
  // display` (the option label = its wire `display` field); otherwise fall
  // through to the plain text input below (the user types the raw id).  Each
  // option's `data-testid="<ns>-input-<name>-option-<id>"` matches the
  // combobox page-object locator (`page-objects-builder.ts`).
  const idTarget = idTargetForField(t, bc, ctx);
  if (idTarget) {
    const { hookVar } = idTarget;
    const optionTestid = `${testidBase}-option`;
    if (style === "material") {
      addNg(ctx, "@angular/material/form-field", "MatFormFieldModule");
      addNg(ctx, "@angular/material/select", "MatSelectModule");
      return `<mat-form-field class="loom-field"><mat-label>${label}</mat-label><mat-select formControlName=${cn}${testid}>@for (__o of ${hookVar}.data()?.items ?? []; track __o.id) {<mat-option [value]="__o.id" [attr.data-testid]="'${optionTestid}-' + __o.id">{{ __o.display }}</mat-option>}</mat-select></mat-form-field>`;
    }
    if (style === "primeng") {
      addNg(ctx, "primeng/select", "SelectModule");
      return `<label class="loom-field"><span class="loom-label">${label}</span><p-select [options]="${hookVar}.data()?.items ?? []" optionLabel="display" optionValue="id" styleClass="loom-input" formControlName=${cn}${testid}><ng-template let-__o pTemplate="item"><span [attr.data-testid]="'${optionTestid}-' + __o.id">{{ __o.display }}</span></ng-template></p-select></label>`;
    }
    return `<label class="loom-field"><span class="loom-label">${label}</span><select class="loom-input" formControlName=${cn}${testid}>@for (__o of ${hookVar}.data()?.items ?? []; track __o.id) {<option [value]="__o.id" [attr.data-testid]="'${optionTestid}-' + __o.id">{{ __o.display }}</option>}</select></label>`;
  }
  // `money` is deliberately NOT numeric input: its control holds a decimal
  // STRING (see `controlInit`), and a numeric widget — `type="number"` or
  // PrimeNG's `p-inputnumber` — would bind a JS number back into it, losing the
  // scale the wire carries.  A text input with `inputmode="decimal"` keeps the
  // numeric soft keyboard on mobile without the coercion.
  const isMoney = inner.kind === "primitive" && inner.name === "money";
  const moneyMode = isMoney ? ' inputmode="decimal"' : "";
  const isNumeric =
    inner.kind === "primitive" &&
    (inner.name === "int" || inner.name === "long" || inner.name === "decimal");
  if (style === "primeng") {
    if (isNumeric) {
      addNg(ctx, "primeng/inputnumber", "InputNumberModule");
      return `<label class="loom-field"><span class="loom-label">${label}</span><p-inputnumber styleClass="loom-input" formControlName=${cn}${testid}></p-inputnumber></label>`;
    }
    addNg(ctx, "primeng/inputtext", "InputTextModule");
    const inputType =
      inner.kind === "primitive" && inner.name === "datetime" ? ' type="datetime-local"' : "";
    return `<label class="loom-field"><span class="loom-label">${label}</span><input pInputText class="loom-input"${inputType}${moneyMode} formControlName=${cn}${testid} /></label>`;
  }
  let inputType = "";
  if (inner.kind === "primitive") {
    if (isMoney) {
      inputType = ' type="text"';
    } else if (isNumeric) {
      inputType = ' type="number"';
    } else if (inner.name === "datetime") {
      inputType = ' type="datetime-local"';
    }
  }
  if (style === "material") {
    addNg(ctx, "@angular/material/form-field", "MatFormFieldModule");
    addNg(ctx, "@angular/material/input", "MatInputModule");
    return `<mat-form-field class="loom-field"><mat-label>${label}</mat-label><input matInput${inputType}${moneyMode} formControlName=${cn}${testid}></mat-form-field>`;
  }
  return `<label class="loom-field"><span class="loom-label">${label}</span><input class="loom-input"${inputType}${moneyMode} formControlName=${cn}${testid} /></label>`;
}

// ---------------------------------------------------------------------------
// Dynamic sub-form rows — an `X[]`-of-value-object input renders as a
// `FormArray` of nested `FormGroup`s (one per row).  The row sub-field inputs
// REUSE `fieldInput` (its `formControlName="<sub>"` resolves against the
// enclosing `[formGroupName]="$index"`), so every pack style gets row rendering
// for free; only the FormArray wrapper + add/remove methods are new.
// ---------------------------------------------------------------------------

/** A dynamic-row form field — the `FormArray` sibling of an
 *  `AngularFormControlSpec`.  The page-shell declares `<fieldName>: new
 *  FormArray<FormGroup>([])` in the form group and emits the getter + add/remove
 *  methods; the markup (`fieldArrayInput`) hosts the `@for` row loop. */
export interface AngularFieldArraySpec {
  /** Form-group control name holding the array (`items`). */
  fieldName: string;
  /** The per-row `FormControl` specs (one per value-object sub-field). */
  rowControls: AngularFormControlSpec[];
  /** Humanised singular label for the Add button (`Line Item`). */
  elementLabel: string;
  /** Component method that pushes a fresh row (`addItems`). */
  addMethod: string;
  /** Component method that removes a row by index (`removeItems`). */
  removeMethod: string;
  /** Typed getter returning the `FormArray` (`itemsArray`). */
  getter: string;
}

/** The value-object element fields of an `X[]`-of-value-object input, or null
 *  when the field isn't an array whose element is a resolvable value object.
 *  Only SCALAR-ish sub-fields (anything `fieldInput` can render as a single
 *  control — primitives, enums, `X id`) are kept; a nested VO / array inside the
 *  row element is dropped (v1, mirrors the other frontends). */
export function arrayVoFields(t: TypeIR, bc: BoundedContextIR): FieldIR[] | null {
  const inner = unwrapOpt(t);
  if (inner.kind !== "array") return null;
  const el = unwrapOpt(inner.element);
  if (el.kind !== "valueobject") return null;
  const vo = bc.valueObjects.find((v) => v.name === el.name);
  if (!vo) return null;
  const scalar = vo.fields.filter((f) => {
    const ft = unwrapOpt(f.type);
    return ft.kind === "primitive" || ft.kind === "enum" || ft.kind === "id";
  });
  return scalar.length > 0 ? scalar : null;
}

/** Build the `AngularFieldArraySpec` for an array-of-value-object field. */
export function fieldArraySpec(
  name: string,
  voFields: FieldIR[],
  elementName: string,
): AngularFieldArraySpec {
  const pascal = upperFirst(name);
  return {
    fieldName: name,
    rowControls: voFields.map((f) => ({ name: f.name, init: controlInit(f.type) })),
    elementLabel: humanize(elementName),
    addMethod: `add${pascal}`,
    removeMethod: `remove${pascal}`,
    getter: `${name}Array`,
  };
}

/** The `FormArray` control declaration for the form group (`items: new
 *  FormArray<FormGroup>([])`).  The `FormArray` import is registered by the
 *  form builder (walk time), not here (member emission runs after the walk). */
export function fieldArrayControlDecl(spec: AngularFieldArraySpec): string {
  return `${spec.fieldName}: new FormArray<FormGroup>([])`;
}

/** The class members a field array contributes: a typed getter plus the
 *  add-row / remove-row methods the template buttons call. */
export function fieldArrayMembers(formVar: string, spec: AngularFieldArraySpec): string[] {
  const rowGroup = spec.rowControls
    .map((c) => `${c.name}: new FormControl(${c.init}, { nonNullable: true })`)
    .join(", ");
  return [
    `  get ${spec.getter}(): FormArray { return this.${formVar}.get(${JSON.stringify(spec.fieldName)}) as FormArray; }`,
    `  ${spec.addMethod}(): void { this.${spec.getter}.push(new FormGroup({ ${rowGroup} })); }`,
    `  ${spec.removeMethod}(i: number): void { this.${spec.getter}.removeAt(i); }`,
  ];
}

/** The dynamic-row markup: a `formArrayName` block whose `@for` walks the array
 *  controls, each row a `[formGroupName]="$index"` group of reused `fieldInput`
 *  sub-field inputs + a Remove button, followed by an Add button. */
export function fieldArrayInput(
  spec: AngularFieldArraySpec,
  voFields: FieldIR[],
  label: string,
  bc: BoundedContextIR,
  ns: string,
  ctx: WalkContext,
): string {
  const rowNs = `${ns}-${spec.fieldName}-row`;
  const rowInputs = voFields.map((f) => fieldInput(f.name, f.type, bc, rowNs, ctx)).join("");
  const remove = formButton(ctx, {
    type: "button",
    emphasis: "warn",
    label: "Remove",
    attrs: ` (click)="${spec.removeMethod}($index)"`,
  });
  const add = formButton(ctx, {
    type: "button",
    emphasis: "secondary",
    label: `Add ${spec.elementLabel}`,
    attrs: ` (click)="${spec.addMethod}()"`,
  });
  return `<div class="loom-field" formArrayName=${JSON.stringify(spec.fieldName)}><span class="loom-label">${label}</span>@for (__row of ${spec.getter}.controls; track $index) {<div class="loom-row" [formGroupName]="$index">${rowInputs}${remove}</div>}${add}</div>`;
}

// ---------------------------------------------------------------------------
// Value-object sub-form group — a single `price: Money` input renders as a
// nested `FormGroup` (one sub-`FormControl` per value-object field), NOT one
// flat control.  This mirrors the shared page object's fill contract (a VO
// field `price` fills sub-inputs `<ns>-input-price-amount` / `-currency`), so
// `getRawValue()` yields `{ amount, currency }` — the object the request wants
// — instead of a single string.  Parallels the `FormArray` path above; only
// the wrapper (`formGroupName` vs `formArrayName`) and the fixed (non-dynamic)
// row differ.
// ---------------------------------------------------------------------------

/** A value-object sub-form group — the `FormGroup` sibling of an
 *  `AngularFieldArraySpec`.  The page-shell declares `<fieldName>: new
 *  FormGroup({ <sub>: new FormControl(...) , … })` inside the form group; the
 *  markup (`fieldGroupInput`) wraps the reused sub-field inputs in a
 *  `formGroupName` container. */
export interface AngularFieldGroupSpec {
  /** Form-group control name holding the nested group (`price`). */
  fieldName: string;
  /** The per-value-object-field sub-`FormControl` specs (`amount`, `currency`). */
  subControls: AngularFormControlSpec[];
}

/** The value-object element fields of a single `X: <VO>` input, or null when the
 *  field isn't a resolvable value object.  Only SCALAR-ish sub-fields (anything
 *  `fieldInput` renders as a single control — primitives, enums, `X id`) are
 *  kept; a nested VO / array inside the VO is dropped (v1, mirrors the other
 *  frontends and the array-of-VO path). */
export function voScalarFields(t: TypeIR, bc: BoundedContextIR): FieldIR[] | null {
  const inner = unwrapOpt(t);
  if (inner.kind !== "valueobject") return null;
  const vo = bc.valueObjects.find((v) => v.name === inner.name);
  if (!vo) return null;
  const scalar = vo.fields.filter((f) => {
    const ft = unwrapOpt(f.type);
    return ft.kind === "primitive" || ft.kind === "enum" || ft.kind === "id";
  });
  return scalar.length > 0 ? scalar : null;
}

/** Build the `AngularFieldGroupSpec` for a single value-object field. */
export function fieldGroupSpec(name: string, voFields: FieldIR[]): AngularFieldGroupSpec {
  return {
    fieldName: name,
    subControls: voFields.map((f) => ({ name: f.name, init: controlInit(f.type) })),
  };
}

/** The nested `FormGroup` control declaration for the form group (`price: new
 *  FormGroup({ amount: new FormControl(0, …), currency: new FormControl("", …) })`).
 *  The `FormGroup` import is registered by the form builder (walk time). */
export function fieldGroupControlDecl(spec: AngularFieldGroupSpec): string {
  const inner = spec.subControls
    .map((c) => `${c.name}: new FormControl(${c.init}, { nonNullable: true })`)
    .join(", ");
  return `${spec.fieldName}: new FormGroup({ ${inner} })`;
}

/** The value-object fieldset markup: a `formGroupName` container (carrying the
 *  field's `data-testid` so the page object's VO fill targets it) wrapping the
 *  reused `fieldInput` sub-field inputs, each with a nested
 *  `<container>-<sub>` testid matching the shared page-object fill path. */
export function fieldGroupInput(
  spec: AngularFieldGroupSpec,
  voFields: FieldIR[],
  label: string,
  bc: BoundedContextIR,
  ns: string,
  ctx: WalkContext,
): string {
  const containerTid = `${ns}-input-${spec.fieldName}`;
  const subInputs = voFields
    .map((f) => fieldInput(f.name, f.type, bc, ns, ctx, `${containerTid}-${f.name}`))
    .join("");
  return `<div class="loom-fieldset" formGroupName=${JSON.stringify(spec.fieldName)} data-testid="${containerTid}"><span class="loom-label">${label}</span>${subInputs}</div>`;
}

/** Split a form's input fields into the flat `FormControl` fields (rendered +
 *  spec'd as before), the array-of-value-object `FormArray` fields (row markup +
 *  add/remove spec), and the single-value-object `FormGroup` fields (nested
 *  sub-field markup).  Shared by every Angular form builder (create / operation /
 *  modal / workflow) so the fork is uniform; when a field set has no object array
 *  and no value object, `flatMarkup`/`flatControls` are byte-identical to the
 *  previous all-flat output. */
export function partitionAngularFields(
  fields: readonly { name: string; type: TypeIR; default?: ExprIR }[],
  bc: BoundedContextIR,
  ns: string,
  ctx: WalkContext,
  formVar?: string,
  /** Flat field names carrying a client-side constraint (from
   *  `angularValidatorMap`).  Each gets the two ARIA bindings that announce its
   *  error state; every other field is byte-identical to before. */
  errorFields?: ReadonlySet<string>,
): {
  flatControls: AngularFormControlSpec[];
  flatMarkup: string[];
  flatNames: string[];
  idTargets: AngularIdTargetSpec[];
  fieldArrays: AngularFieldArraySpec[];
  arrayMarkup: string[];
  fieldGroups: AngularFieldGroupSpec[];
  groupMarkup: string[];
  /** True when any flat field is a `File` — the page-shell emits the shared
   *  `onFileUpload` method once for the component. */
  hasFileField: boolean;
} {
  const isArray = (f: { type: TypeIR }) => arrayVoFields(f.type, bc) !== null;
  const isGroup = (f: { type: TypeIR }) => !isArray(f) && voScalarFields(f.type, bc) !== null;
  const flat = fields.filter((f) => !isArray(f) && !isGroup(f));
  const arrays = fields.filter(isArray);
  const groups = fields.filter(isGroup);
  const fieldArrays: AngularFieldArraySpec[] = [];
  const arrayMarkup: string[] = [];
  for (const f of arrays) {
    const voFields = arrayVoFields(f.type, bc)!;
    const arr = unwrapOpt(f.type);
    const el = arr.kind === "array" ? unwrapOpt(arr.element) : arr;
    const elementName = el.kind === "valueobject" ? el.name : f.name;
    const spec = fieldArraySpec(f.name, voFields, elementName);
    fieldArrays.push(spec);
    arrayMarkup.push(fieldArrayInput(spec, voFields, humanize(f.name), bc, ns, ctx));
  }
  const fieldGroups: AngularFieldGroupSpec[] = [];
  const groupMarkup: string[] = [];
  const groupIdFields: FieldIR[] = [];
  for (const f of groups) {
    const voFields = voScalarFields(f.type, bc)!;
    const spec = fieldGroupSpec(f.name, voFields);
    fieldGroups.push(spec);
    groupMarkup.push(fieldGroupInput(spec, voFields, humanize(f.name), bc, ns, ctx));
    groupIdFields.push(...voFields);
  }
  if (fieldArrays.length > 0 || fieldGroups.length > 0) {
    addNg(ctx, "@angular/forms", "FormGroup");
  }
  if (fieldArrays.length > 0) addNg(ctx, "@angular/forms", "FormArray");
  return {
    // A constant/enum `= default` seeds the control's initial value (client can
    // still edit it); non-evaluable defaults (money/now/this-relative/ref) and
    // no default fall back to the type-zero init.  A nonNullable control needs a
    // non-null literal, and `renderDefaultSeed` yields exactly that.
    flatControls: flat.map((f) => {
      const u = unwrapOpt(f.type);
      if (u.kind === "primitive" && u.name === "File") {
        // A File control holds a nullable FileRef, not a nonNullable string.
        return { name: f.name, init: "null", tsType: "FileRef | null" };
      }
      return {
        name: f.name,
        init: (f.default ? renderDefaultSeed(f.default) : null) ?? controlInit(f.type),
      };
    }),
    // A constrained field renders its message WITH its control (so the
    // material placement can be inside the form field) and, on a raw pack,
    // carries the matching ARIA.  A field with no constraint passes `undefined`
    // for both and is byte-identical to before.
    flatMarkup: flat.map((f) => {
      const constrained = formVar !== undefined && (errorFields?.has(f.name) ?? false);
      const style = formStyle(ctx);
      const aria =
        constrained && style !== "material" ? fieldAriaFor(formVar!, ns, f.name) : undefined;
      const error = constrained
        ? {
            id: fieldErrorId(ns, f.name),
            testid: `${ns}-error-${f.name}`,
            when: fieldErrorWhen(formVar!, f.name),
            text: `${humanize(f.name)} is invalid`,
          }
        : undefined;
      return withFieldError(
        fieldInput(f.name, f.type, bc, ns, ctx, undefined, formVar, aria),
        style,
        error,
      );
    }),
    flatNames: flat.map((f) => f.name),
    // A value-object sub-field that is itself an `X id` needs the target's
    // `useAll<X>()` Select query hoisted too (rare, but kept uniform).
    idTargets: collectIdTargets([...flat, ...groupIdFields], bc, ctx),
    fieldArrays,
    arrayMarkup,
    fieldGroups,
    groupMarkup,
    hasFileField: flat.some((f) => {
      const u = unwrapOpt(f.type);
      return u.kind === "primitive" && u.name === "File";
    }),
  };
}

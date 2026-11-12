// ---------------------------------------------------------------------------
// Collection inputs — `scalarArray`, `enumArray` and `refArray` form fields
// (`tags: string[]`, `perils: Peril[]`, `alternates: Provider id[]`) on the
// JSX-family frontends.
//
//  - a CHOICE collection (enum values, references) is a checkbox group: one box
//    per option (`<testId>-option-<value>`), the field holding the checked
//    values in option order;
//  - a SCALAR collection is one comma-separated text input (`<testId>`), split
//    on change into trimmed, non-empty items — numbers parsed, unparseable ones
//    dropped.
//
// The binding syntax is the framework's, not the design pack's, so the inputs
// are rendered here per framework, inside the pack's label.
// ---------------------------------------------------------------------------

import type { FormScalarKind } from "./form-spec.js";

export interface ArrayInputField {
  /** Form-state path (`tags`). */
  path: string;
  testId: string;
  /** The field's label: humanized text, or the framework expression that reads
   *  its identity-keyed translation. */
  label: string;
  labelExpr?: string;
  /** `choice`: a checkbox group over `optionsTs` (a JS expression evaluating to
   *  `{ value: string; label: string }[]`).  `scalar`: a list input whose items
   *  are of `element`. */
  input: { kind: "choice"; optionsTs: string } | { kind: "scalar"; element: FormScalarKind };
}

export type ArrayInputRenderer = (f: ArrayInputField) => string;

/** JS that turns the typed text `src` into the field's items. */
function splitItems(src: string, element: FormScalarKind): string {
  const items = `${src}.split(",").map((s) => s.trim()).filter((s) => s !== "")`;
  if (element === "int" || element === "decimal") {
    return `${items}.map(Number).filter((n) => !Number.isNaN(n))`;
  }
  if (element === "bool") return `${items}.map((s) => s === "true")`;
  return items;
}

const label = (f: ArrayInputField, open: string, close: string): string =>
  f.labelExpr ? `${open}${f.labelExpr}${close}` : f.label;

const react: ArrayInputRenderer = (f) => {
  if (f.input.kind === "choice") {
    return [
      `<Controller control={control} name="${f.path}" render={({ field: __list }) => (`,
      `            <fieldset data-testid="${f.testId}"><legend>${label(f, "{", "}")}</legend>`,
      `              {(${f.input.optionsTs}).map((__o) => (`,
      `                <label key={__o.value}><input type="checkbox" data-testid={\`${f.testId}-option-\${__o.value}\`} checked={((__list.value ?? []) as string[]).includes(__o.value)} onChange={(e) => __list.onChange(e.currentTarget.checked ? [...((__list.value ?? []) as string[]), __o.value] : ((__list.value ?? []) as string[]).filter((__v) => __v !== __o.value))} /> {__o.label}</label>`,
      "              ))}",
      "            </fieldset>",
      "          )} />",
    ].join("\n");
  }
  return [
    `<Controller control={control} name="${f.path}" render={({ field: __list }) => (`,
    `            <label>${label(f, "{", "}")} <input data-testid="${f.testId}" defaultValue={((__list.value ?? []) as unknown[]).join(", ")} onChange={(e) => __list.onChange(${splitItems("e.currentTarget.value", f.input.element)})} /></label>`,
    "          )} />",
  ].join("\n");
};

/** Vue and Svelte read the value through the form's reactive `values`. */
const valuesRead = (path: string): string => `form.values.${path}`;

const vue: ArrayInputRenderer = (f) => {
  const read = valuesRead(f.path);
  if (f.input.kind === "choice") {
    return [
      `<fieldset data-testid="${f.testId}"><legend>${label(f, "{{ ", " }}")}</legend>`,
      `  <label v-for="__o in ${f.input.optionsTs.replaceAll('"', "'")}" :key="__o.value"><input type="checkbox" :data-testid="'${f.testId}-option-' + __o.value" :checked="(${read} ?? []).includes(__o.value)" @change="${read} = ($event.target as HTMLInputElement).checked ? [...(${read} ?? []), __o.value] : (${read} ?? []).filter((__v) => __v !== __o.value)" /> {{ __o.label }}</label>`,
      "</fieldset>",
    ].join("\n");
  }
  return `<label>${label(f, "{{ ", " }}")} <input data-testid="${f.testId}" :value="(${read} ?? []).join(', ')" @change="${read} = ${splitItems("($event.target as HTMLInputElement).value", f.input.element).replaceAll('"', "'")}" /></label>`;
};

const svelte: ArrayInputRenderer = (f) => {
  const read = valuesRead(f.path);
  if (f.input.kind === "choice") {
    return [
      `<fieldset data-testid="${f.testId}"><legend>${label(f, "{", "}")}</legend>`,
      `  {#each ${f.input.optionsTs} as __o (__o.value)}`,
      `    <label><input type="checkbox" data-testid={\`${f.testId}-option-\${__o.value}\`} checked={(${read} ?? []).includes(__o.value)} onchange={(e) => { ${read} = e.currentTarget.checked ? [...(${read} ?? []), __o.value] : (${read} ?? []).filter((__v) => __v !== __o.value); }} /> {__o.label}</label>`,
      "  {/each}",
      "</fieldset>",
    ].join("\n");
  }
  return `<label>${label(f, "{", "}")} <input data-testid="${f.testId}" value={(${read} ?? []).join(", ")} onchange={(e) => { ${read} = ${splitItems("e.currentTarget.value", f.input.element)}; }} /></label>`;
};

/** The renderer per JSX-family framework. */
export const ARRAY_INPUT_RENDERERS: Record<"react" | "vue" | "svelte", ArrayInputRenderer> = {
  react,
  vue,
  svelte,
};

export function arrayInputRendererFor(framework: string): ArrayInputRenderer | undefined {
  return (ARRAY_INPUT_RENDERERS as Record<string, ArrayInputRenderer>)[framework];
}

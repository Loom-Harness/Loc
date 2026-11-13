// ---------------------------------------------------------------------------
// The optional value-object group — an `optionalValueObject` form field
// (`vehicle: Vehicle?`) on the JSX-family frontends.
//
// An absent optional value object is `null` on the wire, and its fields carry
// invariants a zero object fails, so the group is opt-in: a presence checkbox
// (`<testId>-present`) sets the field to the kind's zero object or back to
// `null`, and the group's inputs mount only while it is present.  A form left
// with the box clear submits `null`.
//
// The binding syntax is the framework's, not the design pack's, so the group is
// rendered here per framework and handed to the pack's `field-input-valueobject`
// template as its inner markup.
// ---------------------------------------------------------------------------

/** What the group renderer needs from a field's view-model. */
export interface OptionalGroupField {
  /** Form-state path (`vehicle`, `cover.vehicle`). */
  path: string;
  testId: string;
  /** The checkbox's text: the field's humanized label, or — when the field's
   *  label is identity-keyed — the framework expression that reads it. */
  label: string;
  labelExpr?: string;
  /** The zero object the box seeds when checked (a JS object literal). */
  zeroTs: string;
}

export type OptionalGroupRenderer = (f: OptionalGroupField, innerHtml: string) => string;

const react: OptionalGroupRenderer = (f, inner) =>
  [
    `<Controller control={control} name="${f.path}" render={({ field: __present }) => (`,
    "            <>",
    `              <label><input type="checkbox" data-testid="${f.testId}-present" checked={__present.value != null} onChange={(e) => __present.onChange(e.currentTarget.checked ? ${f.zeroTs} : null)} /> ${f.labelExpr ? `{${f.labelExpr}}` : f.label}</label>`,
    "              {__present.value != null && (<>",
    inner,
    "              </>)}",
    "            </>",
    "          )} />",
  ].join("\n");

/** Vue and Svelte read the value through the form's reactive `values`. */
const valuesRead = (path: string): string => `form.values.${path}`;

/** The group's inputs mount only while the value is present, but a binding's
 *  event-handler closure does not carry the template's narrowing — so inside the
 *  group the children read the value non-null. */
const presentReads = (path: string, inner: string): string =>
  inner.replaceAll(`${valuesRead(path)}.`, `${valuesRead(path)}!.`);

const vue: OptionalGroupRenderer = (f, inner) =>
  [
    `<label><input type="checkbox" data-testid="${f.testId}-present" :checked="${valuesRead(f.path)} != null" @change="${valuesRead(f.path)} = ($event.target as HTMLInputElement).checked ? ${f.zeroTs.replaceAll('"', "'")} : null" /> ${f.labelExpr ? `{{ ${f.labelExpr} }}` : f.label}</label>`,
    `<template v-if="${valuesRead(f.path)} != null">`,
    presentReads(f.path, inner),
    "</template>",
  ].join("\n");

const svelte: OptionalGroupRenderer = (f, inner) =>
  [
    `<label><input type="checkbox" data-testid="${f.testId}-present" checked={${valuesRead(f.path)} != null} onchange={(e) => { ${valuesRead(f.path)} = e.currentTarget.checked ? ${f.zeroTs} : null; }} /> ${f.labelExpr ? `{${f.labelExpr}}` : f.label}</label>`,
    `{#if ${valuesRead(f.path)} != null}`,
    presentReads(f.path, inner),
    "{/if}",
  ].join("\n");

/** The renderer per JSX-family framework. */
const OPTIONAL_GROUP_RENDERERS: Record<"react" | "vue" | "svelte", OptionalGroupRenderer> = {
  react,
  vue,
  svelte,
};

export function optionalGroupRendererFor(framework: string): OptionalGroupRenderer | undefined {
  return (OPTIONAL_GROUP_RENDERERS as Record<string, OptionalGroupRenderer>)[framework];
}

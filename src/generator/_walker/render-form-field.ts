// Form-field template dispatch — shared by the walker's form
// primitives across frontends.  Moved here from
// react/templating/render.ts when the body walker became the shared
// core: the function is pack-driven (each design pack supplies the
// `field-input-*` templates), so it carries no framework specifics.

import type { OptionalGroupRenderer } from "../_frontend/form-optional-group.js";
import type { FormFieldVM } from "../_frontend/view-models.js";
import type { LoadedPack } from "../_packs/loader.js";
import { chromeMessage, sentenceChromeName } from "./i18n-chrome.js";

/** Render one form-field input through its per-pack
 *  `field-input-*` template.  Used by the walker's `CreateForm(of:)` /
 *  `WorkflowForm(runs:)` emission to produce one markup block per field.
 *  Value-object fields recursively render their children and pass
 *  the joined HTML as `innerHtml` (the template variable the
 *  `field-input-valueobject.hbs` Fieldset reads). */
export function renderFormField(
  vm: FormFieldVM,
  pack: LoadedPack,
  chrome: FormFieldChrome = {},
): string {
  const tokens = chrome.fieldTokens?.(vm) ?? {};
  if (vm.template === "field-input-valueobject") {
    const childrenHtml = (vm.children ?? [])
      .map((child) => renderFormField(child, pack, chrome))
      .join("\n");
    // An optional value object is an opt-in group: a presence box, and the
    // inputs only while the value is present.
    const innerHtml =
      vm.optionalGroup && chrome.optionalGroup
        ? chrome.optionalGroup(
            {
              path: vm.path,
              testId: vm.testId,
              label: vm.label,
              ...(tokens.labelExpr ? { labelExpr: tokens.labelExpr } : {}),
              zeroTs: vm.optionalGroup.zeroTs,
            },
            childrenHtml,
          )
        : childrenHtml;
    return pack.render(vm.template, { ...vm, ...chrome, ...tokens, innerHtml });
  }
  if (vm.elementName !== undefined) {
    const addItemLabel =
      chrome.addItemLabelFor?.(vm.elementName) ??
      chromeMessage(sentenceChromeName("addItem", vm.elementName));
    const rowFields = vm.rowFields?.map((rf) => ({ ...rf, ...(chrome.fieldTokens?.(rf) ?? {}) }));
    return pack.render(vm.template, {
      ...vm,
      ...chrome,
      ...tokens,
      ...(rowFields ? { rowFields } : {}),
      addItemLabel,
    });
  }
  return pack.render(vm.template, { ...vm, ...chrome, ...tokens });
}

/** Pack-chrome tokens the `field-input-*` templates share (M-T1.11).
 *
 *  Walker-built rather than VM data, because they carry the active frontend's
 *  binding syntax (`placeholder={t(…)}` vs `:placeholder='t(…)'`) — a
 *  `FormFieldVM` is pure framework-neutral data and deliberately cannot.
 *
 *  Threaded into a value-object's CHILDREN too: a nested `X id` or enum field
 *  renders the same picker a top-level one does, and dropping the token at the
 *  recursion boundary would leave those inputs with a Handlebars blank where
 *  their placeholder should be. */
export interface FormFieldChrome {
  /** `placeholder="Select…"`, or its bound `t(…)` form under i18n. */
  selectPlaceholderAttr?: string;
  /** The add-row button's text for a field-array of `element` (a value-object
   *  name): the per-element whole sentence, as a markup-text token. */
  addItemLabelFor?: (element: string) => string;
  /** The per-field identity-keyed text tokens (`labelExpr`, `enumLabelFn`) —
   *  `_walker/model-text-sites.ts`.  Empty for a field naming no model fact or
   *  when the implicit sites are off, so a template's literal branch renders. */
  fieldTokens?: (vm: FormFieldVM) => Record<string, string>;
  /** The active framework's opt-in group for an optional value object. */
  optionalGroup?: OptionalGroupRenderer;
}

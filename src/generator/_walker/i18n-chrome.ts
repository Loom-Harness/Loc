// ---------------------------------------------------------------------------
// Pack-chrome message catalog (M-T1.11, i18n.md — "pack-chrome catalogs").
//
// The design packs bake their own user-visible strings into `.hbs` templates —
// a spinner's `aria-label="Loading"`, a grid pager's "Previous"/"Next", its
// per-column "Filter" placeholder, a form's "Remove" button.  These are NOT authored in the `.ddd` source, so the
// content-hash extraction pass (`i18n-extract.ts`, which keys `page.<P>.<role>.
// <hash>` off literals in the page body) never sees them and the per-app
// `t()` runtime can't translate them.
//
// This module is that missing catalog: a fixed set of STABLE `chrome.<name>`
// keys → their source-language (English) text.  Unlike page/component strings
// the keys are curated, not hashed — chrome is a shared, translator-facing
// vocabulary ("Loading" is ONE key across every pack and page, not a per-site
// hash).  A pack template emits `{{{loadingAria}}}` (a token the primitive's
// emitter builds via `localizedChromeAria` / the other `localizedChrome*`
// helpers in `i18n-emit.ts`), which under i18n becomes a `t("chrome.loading",
// "Loading")` binding keyed to this catalog, and stays byte-identical raw text
// when the app opted out.
//
// Chrome flows into the catalog USED-only, in lockstep with emission: the
// extraction pass (`i18n-extract.ts`) yields a primitive's chrome entries when
// it walks that primitive's call node (`CHROME_BY_PRIMITIVE`), so a page with a
// `Loader()` gets `chrome.loading` and a page without one does not — exactly
// mirroring where `localizedChromeAria` emits the `t()` binding.  Grows one
// entry per chrome string as the pack-chrome slices land.
// ---------------------------------------------------------------------------

import { createInputFields } from "../../ir/enrich/wire-projection.js";
import type {
  AggregateIR,
  BoundedContextIR,
  ExprIR,
  LayoutIR,
  PageIR,
  TypeIR,
  UiIR,
  WorkflowIR,
} from "../../ir/types/loom-ir.js";
import { valueObjectPool } from "../../ir/util/reachable-types.js";
import { walkExprDeep } from "../../ir/util/walk.js";
import { emitsCommandRoute } from "../../ir/util/workflow-command-route.js";
import { humanize } from "../../util/naming.js";
import { sourceText } from "../_i18n/source-text.js";
import { WIRE_ERROR_MESSAGES } from "../_i18n/wire-error-text.js";
import { type MessageEntry, pageNameEntry } from "./i18n-extract.js";
import { implicitModelTextEntries } from "./model-text-sites.js";
import { gridHasFilterableColumn, gridHasSelection } from "./primitives/data-grid-shape.js";

/** Stable key for a pack-chrome string: `chrome.<name>`. */
export function chromeKey(name: string): string {
  return `chrome.${name}`;
}

/** The canonical `chrome.<name>` → English catalog.  One entry per pack-chrome
 *  string the emitters localize; the value is the source-language default that
 *  rides into `t(key, default)` and renders verbatim when no locale overrides. */
export const CHROME_MESSAGES: Record<string, string> = {
  [chromeKey("loading")]: "Loading",
  [chromeKey("previous")]: "Previous",
  [chromeKey("next")]: "Next",
  [chromeKey("filter")]: "Filter",
  // The pager's position counter.  An ICU message with two holes rather than
  // three concatenated fragments ("Page " + n + " of " + m), because a locale
  // must be free to RE-ORDER them — the count-first and count-last languages
  // both exist, and a concatenation can only ever be translated in English word
  // order.  Still a static catalog string: the holes are named, the emitter
  // supplies their values (`localizedChromeIcuText`), and the runtime's
  // `intl-messageformat` substitutes and locale-formats the numbers.
  [chromeKey("pageOf")]: "Page {page} of {pages}",
  // `Table`'s pager says "Prev" where `DataGrid`'s says "Previous".  Two keys,
  // not one: collapsing them onto a canonical English would re-word one of the
  // two controls and break the i18n-off byte-identical guarantee — the same
  // reason `openMenu` and `toggleNavigation` stayed apart.  "Next" IS shared,
  // because both spell it identically.
  [chromeKey("prev")]: "Prev",
  // The per-column sort button takes its accessible name from its own content
  // (the column header), and the per-column filter input is named by
  // `filter`: neither inserts the header into a sentence frame, because a
  // translated noun cannot be dropped into a fixed phrase in a language with
  // case or gender agreement.
  // The row-selection checkboxes' accessible names.  A checkbox has no visible
  // label — its whole accessible name IS this string — so an untranslated one
  // leaves a screen-reader user with an unlabelled control at every locale but
  // English.  Two keys because they name different things (the header toggles
  // the whole page, the cell one row), and no `{row}` hole: the checkbox is
  // per-row already, and naming the row would need a display field the grid
  // does not have.
  [chromeKey("selectAllRows")]: "Select all rows",
  [chromeKey("selectRow")]: "Select row",
  // The empty-state text of a `<select>` picker.  One key rather than one per
  // call site: it is the same sentence to a translator, and every pack that
  // spells it spells it identically (unlike the nav-toggle pair, which packs
  // genuinely word differently and therefore keeps two keys).
  [chromeKey("selectPlaceholder")]: "Select…",
  // Emitter-built chrome — user-visible English constructed in the WALKER (not
  // in a pack template), so neither the extraction pass nor the pack-chrome
  // `.hbs` slice ever saw it.
  [chromeKey("cancel")]: "Cancel",
  // The op dialog's dismiss label when the operation itself is named "Cancel",
  // and its close icon's name ("Close dialog" when the operation is named
  // "Close") — see `opDialogChrome`.
  [chromeKey("goBack")]: "Go back",
  [chromeKey("close")]: "Close",
  [chromeKey("closeDialog")]: "Close dialog",
  // The accessible reason on a `when`-gated operation trigger while its
  // `GET /{id}/can_<op>` probe answers `{ allowed: false }`.
  [chromeKey("opNotAllowed")]: "Not available in the current state",
  // The body of a page that declares none, on the targets that draw a
  // placeholder for it (`HAND_BUILT_FORM_SENTENCES.rowsAndGuards`).
  [chromeKey("emptyPage")]: "Empty page",
};

/** The chrome names an operation dialog's two dismissing controls carry, given
 *  the label of its SUBMIT button (the humanized operation name, or the
 *  authored dialog title where a target labels its submit with that).
 *
 *  Rule: the submit button names the action, and no other control in the dialog
 *  shares its accessible name — two controls announced identically with
 *  opposite effects is both a usability and an accessibility defect.  So each
 *  dismissing control takes the first of its candidates whose English differs
 *  from every name already taken in the dialog:
 *
 *    - the dismiss BUTTON: "Cancel", else "Go back" (`operation cancel(…)`);
 *    - the CLOSE icon (the corner ×, on the packs whose dialog has one):
 *      "Close", else "Close dialog" (`operation close(…)`).
 *
 *  The two candidate lists are disjoint, so the button and the icon never
 *  collide with each other either.  Compared case- and whitespace-
 *  insensitively, the way an accessible-name match is. */
export interface OpDialogChrome {
  readonly dismiss: "cancel" | "goBack";
  readonly close: "close" | "closeDialog";
}

const DISMISS_CANDIDATES = ["cancel", "goBack"] as const;
const CLOSE_CANDIDATES = ["close", "closeDialog"] as const;

export function opDialogChrome(submitLabel: string): OpDialogChrome {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const taken = new Set([norm(submitLabel)]);
  const pick = <T extends string>(candidates: readonly [T, T]): T => {
    const name = candidates.find((c) => !taken.has(norm(chromeMessage(c)))) ?? candidates[1];
    taken.add(norm(chromeMessage(name)));
    return name;
  };
  const dismiss = pick(DISMISS_CANDIDATES);
  return { dismiss, close: pick(CLOSE_CANDIDATES) };
}

/** The source-language text for a chrome key, for an emitter building the
 *  `t(key, default)` binding.  Throws on an unknown name rather than emitting a
 *  `t(key, undefined)` the runtime would render as the literal string
 *  "undefined" — the emitted default MUST equal the catalog entry, so the two
 *  read the same table instead of repeating the English by hand. */
export function chromeMessage(name: string): string {
  const message =
    CHROME_MESSAGES[chromeKey(name)] ??
    PROVENANCE_CHROME[chromeKey(name)] ??
    FALLBACK_LABEL_CHROME[chromeKey(name)] ??
    sentenceChromeMessage(name);
  if (message === undefined) throw new Error(`i18n-chrome: unknown chrome string "${name}"`);
  return sourceText(chromeKey(name), message);
}

// ---------------------------------------------------------------------------
// Per-subject whole sentences.
//
// The unit of translation is a whole sentence.  "Delete this {entity}?" filled
// with an aggregate name at runtime cannot be right in a language with gender
// or case agreement ("Supprimer cette tâche ?" vs "Supprimer ce projet ?"), so
// a message that varies by aggregate, operation or item type is generated as
// one complete sentence PER SUBJECT, where the subject is known at generate
// time, and carries no hole for a word.  Data holes (`{page}`, `{count}`) are
// the only placeholders a chrome message may have.
//
// A sentence's chrome name is `<base>.<subject>` (`deleteConfirm.Task`), so its
// catalog key is `chrome.deleteConfirm.Task`; every `localizedPageChrome*`
// helper accepts such a name unchanged.
// ---------------------------------------------------------------------------

/** The sentence builders, by base name.  The subject is the DSL identifier the
 *  sentence is about: an aggregate (`deleteEntity`, `deleteConfirm`), a value
 *  object that is an array element (`addItem`), an operation
 *  (`operationSucceeded`), or a workflow (`completed`); `created` is about the
 *  aggregate a `CreateForm` makes. */
export const SENTENCE_CHROME: Record<string, (subject: string) => string> = {
  deleteEntity: (aggregate) => `Delete ${humanize(aggregate)}`,
  deleteConfirm: (aggregate) => `Delete this ${humanize(aggregate).toLowerCase()}?`,
  addItem: (element) => `Add ${humanize(element)}`,
  operationSucceeded: (operation) => `${humanize(operation)} succeeded`,
  // The header of a table / grid column whose header is neither a literal nor
  // `label(…)`.  The subject is the column's 1-based position, known at
  // generate time, so each position is its own whole message.
  column: (position) => `Column ${position}`,
  created: (aggregate) => `${humanize(aggregate)} created`,
  completed: (workflow) => `${humanize(workflow)} completed`,
  // A dynamic-row form's per-row button.  The subject is the value object each
  // row holds, so a locale can word it per item type; the English names no
  // noun.
  removeItem: () => "Remove",
  // The "Add" button of a scalar-array row editor (`tags: string[]`).  The
  // subject is the field, for the same reason.
  addValue: () => "Add",
  // The guard a required `File` input raises when nothing was picked.  The
  // subject is the input's name; the sentence is whole, so no translated label
  // is spliced into it.
  fieldRequired: (field) => `${humanize(field)} is required`,
};

/** The sentence bases a HAND-BUILT form (no design-pack form templates) renders
 *  itself, by the set its framework declares (`FrameworkFacts.
 *  handBuiltFormSentences`).  A pack's own `sentenceChrome` names the rest for
 *  the pack-rendered frontends.
 *
 *   - `rows`: the dynamic-row "Add <item>" and "Remove" buttons;
 *   - `rowsAndGuards`: the "Add <item>" button, the scalar-array "Add" button,
 *     the required-file guard, and the empty-page placeholder. */
export const HAND_BUILT_FORM_SENTENCES: Readonly<
  Record<"rows" | "rowsAndGuards", readonly string[]>
> = {
  rows: ["addItem", "removeItem"],
  rowsAndGuards: ["addItem", "addValue", "fieldRequired", "emptyPage"],
};

/** The chrome name of the `base` sentence about `subject`. */
export function sentenceChromeName(base: string, subject: string): string {
  return `${base}.${subject}`;
}

/** Placeholder text a target renders where the model gives it nothing to show:
 *  an empty form's single input label, a column-less table's only header.
 *  Merged when the scope says the target renders them
 *  ({@link FormSentenceScope.fallbackLabels}). */
const FALLBACK_LABEL_CHROME: Record<string, string> = {
  [chromeKey("fieldFallback")]: "Field",
  [chromeKey("dataFallback")]: "Data",
  [chromeKey("submitFallback")]: "Submit",
};

function sentenceChromeMessage(name: string): string | undefined {
  const dot = name.indexOf(".");
  if (dot < 0) return undefined;
  return SENTENCE_CHROME[name.slice(0, dot)]?.(name.slice(dot + 1));
}

/** The sentence chrome names a `DestroyForm` call contributes: the button
 *  label and the confirm prompt for the aggregate it names. */
function destroyFormSentences(call: ExprIR & { kind: "call" }): readonly string[] {
  const names = call.argNames ?? [];
  const idx = names.indexOf("of");
  const target = idx >= 0 ? call.args[idx] : undefined;
  if (target?.kind !== "ref") return [];
  return [
    sentenceChromeName("deleteEntity", target.name),
    sentenceChromeName("deleteConfirm", target.name),
  ];
}

/** Every value-object name used as an array ELEMENT in `t` — the types a
 *  dynamic-row form field renders an "Add <item>" button for. */
function arrayElementValueObjects(t: TypeIR | undefined, out: Set<string>): void {
  if (!t) return;
  if (t.kind === "optional") {
    arrayElementValueObjects(t.inner, out);
    return;
  }
  if (t.kind !== "array") return;
  let el = t.element;
  while (el.kind === "optional") el = el.inner;
  if (el.kind === "valueobject") out.add(el.name);
  else arrayElementValueObjects(el, out);
}

/** The `column.<n>` sentences a `Table` / `DataGrid` renders: one for every
 *  `Column` whose header is neither a string literal nor `label(…)`, numbered by
 *  its position among the `Column` calls, and one for every positional child
 *  that is not a `Column`, numbered by its position among all positionals. */
export function fallbackColumnNames(call: ExprIR & { kind: "call" }): string[] {
  const names: string[] = [];
  let column = 0;
  let position = 0;
  call.args.forEach((arg, i) => {
    if (call.argNames?.[i]) return;
    position++;
    if (arg.kind === "call" && arg.name === "Column") {
      column++;
      const header = arg.args.find((_, j) => !arg.argNames?.[j]);
      const hasText =
        header?.kind === "modelText" || (header?.kind === "literal" && header.lit === "string");
      if (!hasText) names.push(sentenceChromeName("column", String(column)));
    } else {
      names.push(sentenceChromeName("column", String(position)));
    }
  });
  return names;
}

/** A form call's named arg when it is a bare reference (`of: Order`). */
function refArgName(call: ExprIR & { kind: "call" }, argName: string): string | undefined {
  const idx = (call.argNames ?? []).indexOf(argName);
  const arg = idx >= 0 ? call.args[idx] : undefined;
  return arg?.kind === "ref" ? arg.name : undefined;
}

/** The {@link FALLBACK_LABEL_CHROME} names a UI renders, one per site where the
 *  HEEx emitter has no model text to show: a form with no input to label
 *  (`fieldFallback`), a form whose `of:` / `runs:` is not a resolvable
 *  reference (`submitFallback`), a `Table` with no column (`dataFallback`), a
 *  `KeyValueRow` with no label (`fieldFallback`).  Exact per call, so the
 *  catalog never carries a message nothing reads. */
function fallbackLabelNamesForUi(ui: UiIR, contexts: readonly BoundedContextIR[]): string[] {
  const names = new Set<string>();
  const aggregates = new Map<string, AggregateIR>();
  const workflows = new Map<string, WorkflowIR>();
  for (const bc of contexts) {
    for (const agg of bc.aggregates) aggregates.set(agg.name, agg);
    for (const wf of bc.workflows) workflows.set(wf.name, wf);
  }
  const visit = (body: ExprIR | undefined) =>
    walkExprDeep(body, (e) => {
      if (e.kind !== "call") return;
      const positionals = e.args.filter((_, i) => !e.argNames?.[i]);
      if (e.name === "Table" && positionals.length === 0) names.add("dataFallback");
      else if (e.name === "KeyValueRow" && positionals.length === 0) names.add("fieldFallback");
      else if (e.name === "CreateForm" || e.name === "WorkflowForm") {
        const of = refArgName(e, "of");
        const runs = refArgName(e, "runs");
        const wf = runs ? workflows.get(runs) : undefined;
        // An event-triggered workflow has no command surface: no form at all.
        if (wf && !emitsCommandRoute(wf)) return;
        const agg = of ? aggregates.get(of) : undefined;
        const inputs = wf
          ? wf.params.length
          : agg
            ? createInputFields(agg).filter((f) => f.name !== "id").length
            : 0;
        if (inputs === 0) names.add("fieldFallback");
        if (!agg && !wf) names.add("submitFallback");
      }
    });
  for (const page of ui.pages) visit(page.body);
  for (const component of ui.components) visit(component.body);
  return [...names].sort();
}

/** What the model-dependent sentences of a UI's FORMS are enumerated against.
 *
 *  `contexts` resolve the aggregates, operations and workflows a form call
 *  names; `sentences` are the sentence bases (`operationSucceeded`, `addItem`)
 *  the active design pack actually renders — its manifest's `sentenceChrome`.
 *  A pack that renders neither contributes no such key, so no catalog carries a
 *  sentence nothing reads. */
export interface FormSentenceScope {
  /** The system's named layouts: the slot text of those a page selects is part
   *  of the ui's catalog. */
  readonly layouts?: readonly LayoutIR[];
  readonly contexts: readonly BoundedContextIR[];
  readonly sentences: readonly string[];
  /** The rendering target keys its IMPLICIT model-text sites by identity
   *  (`WalkerTarget.modelTextImplicitSites`), so their keys belong in the
   *  catalog; unset ⇒ those sites render English and carry no key. */
  readonly implicitModelText?: boolean;
  /** The rendering target's create form also shows OPTIONAL inputs (HEEx has
   *  no update flow to defer them to), so their labels are catalogued too. */
  readonly optionalCreateInputs?: boolean;
  /** The rendering frontend draws its own session gate (sign-in prompt,
   *  forbidden view), so {@link AUTH_GATE_CHROME} belongs in the catalog. */
  readonly authGate?: boolean;
  /** The rendering frontend ships the generated session view (a loading state
   *  and a sign-in screen, no forbidden view), so {@link SESSION_VIEW_CHROME}
   *  belongs in the catalog. */
  readonly sessionView?: boolean;
  /** The rendering target emits {@link FALLBACK_LABEL_CHROME} placeholders. */
  readonly fallbackLabels?: boolean;
  /** The rendering frontend labels an untitled page by its name, so that page's
   *  `name` entry belongs in the catalog: `"all"` — every page's own bar names
   *  it (Flutter's app bar); `"navbar"` — only the links of a derived navbar,
   *  i.e. the top-level pages of a UI with no explicit `menu` and two or more
   *  of them (Feliz). */
  readonly pageNames?: "all" | "navbar";
}

/** What a hand-built form over some inputs renders sentences for: the value
 *  objects its dynamic rows repeat, the scalar-array inputs, and the required
 *  `File` inputs (each by input name). */
interface FormLeaves {
  readonly elements: Set<string>;
  readonly scalarArrays: Set<string>;
  readonly requiredFiles: Set<string>;
}

type FormInput = { readonly name: string; readonly type: TypeIR; readonly optional?: boolean };

/** Collect {@link FormLeaves} from a form's inputs.  A value-object input
 *  flattens into its fields (recursively, and optional as a whole when the
 *  object is), because the hand-built forms render each leaf as its own input. */
function collectFormLeaves(
  params: readonly FormInput[],
  vos: ReadonlyMap<string, readonly FormInput[]>,
  out: FormLeaves,
  optional = false,
  depth = 0,
): void {
  for (const p of params) {
    const isOptional = optional || p.optional === true || p.type.kind === "optional";
    let t = p.type;
    while (t.kind === "optional") t = t.inner;
    if (t.kind === "array") {
      arrayElementValueObjects(t, out.elements);
      let el = t.element;
      while (el.kind === "optional") el = el.inner;
      if (el.kind !== "valueobject" && el.kind !== "array") out.scalarArrays.add(p.name);
    } else if (t.kind === "valueobject") {
      const fields = vos.get(t.name);
      if (fields && depth < 8) collectFormLeaves(fields, vos, out, isOptional, depth + 1);
    } else if (t.kind === "primitive" && t.name === "File" && !isOptional) {
      out.requiredFiles.add(p.name);
    }
  }
}

/** Resolve a form call's `of:` aggregate name (a ref, or a string literal). */
function ofName(call: ExprIR & { kind: "call" }, argName: string): string | undefined {
  const names = call.argNames ?? [];
  const idx = names.indexOf(argName);
  const arg = idx >= 0 ? call.args[idx] : undefined;
  if (arg?.kind === "ref") return arg.name;
  if (arg?.kind === "literal" && arg.lit === "string") return arg.value;
  return undefined;
}

/** A form call that supplies its own `onSubmit:` handler renders no default
 *  success toast, so it reads no `created` / `completed` sentence. */
function hasCustomSubmit(call: ExprIR & { kind: "call" }): boolean {
  return (call.argNames ?? []).includes("onSubmit");
}

/** The model-derived sentences a UI renders, as chrome names, read off the form
 *  calls in its page and component bodies:
 *
 *   - `DestroyForm(of: Agg)` → the delete button + confirm prompt for `Agg`;
 *   - with `scope`, `OperationForm` of op `o` → `operationSucceeded.o`, and each
 *     value object a `CreateForm` / `OperationForm` / `WorkflowForm` field
 *     repeats → `addItem.<ValueObject>`, for the bases the pack renders.
 *
 *  Exact per call, so a UI that renders no such form carries no such key. */
export function sentenceChromeNamesForUi(ui: UiIR, scope?: FormSentenceScope): string[] {
  const names = new Set<string>();
  const wants = (base: string) => scope?.sentences.includes(base) === true;
  const aggregates = new Map<string, AggregateIR>();
  const workflows = new Map<string, WorkflowIR>();
  for (const bc of scope?.contexts ?? []) {
    for (const agg of bc.aggregates) aggregates.set(agg.name, agg);
    for (const wf of bc.workflows) workflows.set(wf.name, wf);
  }
  const vos = new Map<string, readonly FormInput[]>();
  for (const bc of scope?.contexts ?? []) {
    for (const vo of valueObjectPool(bc)) vos.set(vo.name, vo.fields);
  }
  const leaves: FormLeaves = {
    elements: new Set(),
    scalarArrays: new Set(),
    requiredFiles: new Set(),
  };

  const visit = (body: ExprIR | undefined) =>
    walkExprDeep(body, (e) => {
      if (e.kind !== "call") return;
      if (e.name === "DestroyForm") {
        for (const n of destroyFormSentences(e)) names.add(n);
      } else if (e.name === "OperationForm") {
        const opArg = (e.argNames ?? []).indexOf("op");
        const named = opArg >= 0 ? e.args[opArg] : undefined;
        const positional = e.args.find((_, i) => !(e.argNames ?? [])[i]);
        const opName =
          named?.kind === "ref"
            ? named.name
            : positional?.kind === "member"
              ? positional.member
              : "";
        if (opName === "") return;
        if (wants("operationSucceeded"))
          names.add(sentenceChromeName("operationSucceeded", opName));
        const owner = ofName(e, "of");
        for (const agg of owner ? [aggregates.get(owner)] : aggregates.values()) {
          for (const op of agg?.operations ?? []) {
            if (op.name === opName) collectFormLeaves(op.params, vos, leaves);
          }
        }
      } else if (e.name === "Table" || e.name === "DataGrid") {
        for (const n of fallbackColumnNames(e)) names.add(n);
      } else if (e.name === "CreateForm") {
        const owner = ofName(e, "of");
        const agg = aggregates.get(owner ?? "");
        if (agg)
          collectFormLeaves(
            createInputFields(agg).filter((f) => !f.optional),
            vos,
            leaves,
          );
        if (owner && wants("created") && !hasCustomSubmit(e))
          names.add(sentenceChromeName("created", owner));
      } else if (e.name === "WorkflowForm") {
        const runs = ofName(e, "runs");
        const wf = workflows.get(runs ?? "");
        if (wf) collectFormLeaves(wf.params, vos, leaves);
        if (runs && wants("completed") && !hasCustomSubmit(e))
          names.add(sentenceChromeName("completed", runs));
      }
    });
  for (const page of ui.pages) visit(page.body);
  for (const component of ui.components) visit(component.body);
  if (wants("addItem"))
    for (const el of leaves.elements) names.add(sentenceChromeName("addItem", el));
  if (wants("removeItem"))
    for (const el of leaves.elements) names.add(sentenceChromeName("removeItem", el));
  if (wants("addValue"))
    for (const f of leaves.scalarArrays) names.add(sentenceChromeName("addValue", f));
  if (wants("fieldRequired"))
    for (const f of leaves.requiredFiles) names.add(sentenceChromeName("fieldRequired", f));
  if (wants("emptyPage") && ui.pages.some((page) => page.body === undefined))
    names.add("emptyPage");
  return [...names].sort();
}

/** One catalog entry for a chrome name. */
function entry(name: string): MessageEntry {
  return { key: chromeKey(name), message: chromeMessage(name) };
}

/** The chrome a primitive contributes: a fixed list, or — when it depends on
 *  HOW the primitive was called — a function of the call node.  A `DataGrid`
 *  renders its per-column "Filter" placeholder only when a column asked to be
 *  filtered, so its entries are computed rather than declared. */
export type ChromeContribution =
  | readonly MessageEntry[]
  | ((call: ExprIR & { kind: "call" }) => readonly MessageEntry[]);

/** Walker-primitive call name → the chrome catalog entries it renders.  The
 *  extraction pass consults this per call node so the catalog carries exactly
 *  the chrome a UI actually emits (used-only), and a chrome-only page still
 *  counts as translatable (turns the runtime on).  Keyed by the primitive's
 *  DSL call name (`Loader`, `DataGrid`, …), the same name `registry.ts`
 *  dispatches. */
export const CHROME_BY_PRIMITIVE: Record<string, ChromeContribution> = {
  Loader: [entry("loading")],
  // Every shipped pack's grid renders the pager unconditionally; the per-column
  // filter input rides `hasFilters`, so the placeholder is contributed only when
  // a column is actually filterable — the SAME predicate the emitter gates that
  // input on (`data-grid-shape.ts`), so key and binding cannot drift.
  DataGrid: (call) => [
    entry("previous"),
    entry("next"),
    entry("pageOf"),
    // Exact for the same reason the two above are: `selection:` naming a
    // non-state field is a validation ERROR, so its presence on the call node
    // settles whether the checkbox column renders.
    ...(gridHasSelection(call) ? [entry("selectAllRows"), entry("selectRow")] : []),
    // Exact: the filter input (and its accessible name) renders iff a column
    // asked to be filtered.
    ...(gridHasFilterableColumn(call) ? [entry("filter")] : []),
  ],
  // A `SelectField` ALWAYS renders the picker, so this is exact — the primitive
  // is the only thing that renders `primitive-select-field`.
  //
  // The form-built pickers spell the SAME placeholder, but they are not here —
  // a form primitive must not FLIP i18n on (see `FORM_CHROME`).
  SelectField: [entry("selectPlaceholder")],
};

/** Resolve a primitive's chrome contribution against the call node that
 *  produced it.  Undefined for a primitive that bakes in no chrome. */
export function chromeEntriesFor(call: ExprIR & { kind: "call" }): readonly MessageEntry[] {
  const contribution = CHROME_BY_PRIMITIVE[call.name];
  if (contribution === undefined) return [];
  return typeof contribution === "function" ? contribution(call) : contribution;
}

/** App-shell chrome — strings the design packs bake into the application shell
 *  (`app-shell.hbs`: the 404 route text, the skip-to-content link).  Unlike
 *  primitive chrome the shell is ALWAYS rendered, so these are NOT driven by an
 *  authored call node: they translate only when the app is ALREADY i18n-enabled
 *  by its authored strings (never flip i18n on for a string-less app), and the
 *  catalog builders merge them under that same gate.  Shell emitters read
 *  `APP_SHELL_CHROME[chromeKey(name)]` for the source default so the emitted
 *  `t()` default lines up with the merged catalog entry. */
export const APP_SHELL_CHROME: Record<string, string> = {
  [chromeKey("notFound")]: "Not found",
  [chromeKey("skipToContent")]: "Skip to content",
  [chromeKey("primaryNav")]: "Primary navigation",
  [chromeKey("somethingWentWrong")]: "Something went wrong",
  // The ROOT error boundary (`src/ErrorBoundary.tsx`, mounted by every React
  // pack's `main.tsx` outside the provider chain) spells the same idea WITH a
  // full stop.  Its own key rather than a re-use, because the two raw strings
  // differ and re-wording either would break the i18n-off byte-identical
  // guarantee — and rather than hoisting the "." out of the message, because
  // sentence-final punctuation is not universal (CJK uses 。).
  [chromeKey("rootErrorTitle")]: "Something went wrong.",
  // The mobile nav toggle: two keys, not one, because the packs genuinely spell
  // it differently (chakra "Open menu" vs the shadcn/flowbite family "Toggle
  // navigation").  Collapsing them onto one canonical English would silently
  // re-word a pack and break the i18n-off byte-identical guarantee.
  [chromeKey("openMenu")]: "Open menu",
  [chromeKey("toggleNavigation")]: "Toggle navigation",
  // The error boundary's / 404's recovery link.  ONE key for both, even though
  // the 404 renders it as "← Back to home": the arrow is decoration the template
  // keeps OUTSIDE the token, so i18n-off still concatenates to the byte-identical
  // "← Back to home" while translators see one clean phrase.
  [chromeKey("backToHome")]: "Back to home",
  // The route-level `Suspense` fallback's accessible name while a lazy page
  // chunk downloads.  Its own key rather than the `Loader()` primitive's
  // `chrome.loading`: this table and the primitive table stay disjoint, and the
  // shell key must reach the catalog whether or not a page renders a Loader.
  [chromeKey("routeLoading")]: "Loading",
};

/** Chrome a FORM renders — currently the id/enum picker's "Select…".
 *
 *  Not in `CHROME_BY_PRIMITIVE`, and the distinction is the whole design.  A
 *  contribution there FLIPS i18n ON for a UI that has nothing else to translate
 *  (that is the point for `Loader`, `DataGrid`, `SelectField` — each always
 *  renders its chrome, so it earns the runtime).  A form does NOT always render
 *  a picker: only an `X id` field whose target has a `derived display`, or an
 *  enum field, does.  Contributing from `CreateForm`/`OperationForm`/
 *  `WorkflowForm` was measured to ship `src/i18n.ts`, `locales/en.json` and the
 *  `intl-messageformat` dependency into a plain-string form app that needs none.
 *
 *  Merged instead under the ALREADY-ENABLED gate, exactly like the app-shell
 *  chrome below.  That makes key and binding agree precisely, because both sides
 *  now answer the same question: `localizedChromeAttr` emits the `t()` form iff
 *  `ctx.i18nPrefix` is set, and `ctx.i18nPrefix` is set iff the UI is
 *  i18n-enabled — the same condition this table is merged under.
 *
 *  The residue is one over-merged key: an i18n-enabled app whose forms happen to
 *  have no picker carries "Select…" unused.  That is the trade `APP_SHELL_CHROME`
 *  already makes (a pack renders `openMenu` OR `toggleNavigation`, never both),
 *  and it is the cheap side of the asymmetry — an unused key costs a translator
 *  one phrase, while a missing one is a binding no locale can ever reach. */
export const FORM_CHROME: Record<string, string> = {
  [chromeKey("selectPlaceholder")]: "Select…",
  // The op dialog's dismiss label and close-icon name (`opDialogChrome`) —
  // built in the EMITTER, so neither the content-hash extraction pass nor the
  // pack-chrome `.hbs` slice ever saw them.  (The destroy button's label and
  // prompt are per-aggregate whole sentences — see {@link SENTENCE_CHROME}.)  They sit here rather than in `CHROME_BY_PRIMITIVE` for the same
  // reason `selectPlaceholder` does: `DestroyForm`/`Modal` are form primitives,
  // and a form must not FLIP i18n on for an app with no authored strings.
  [chromeKey("cancel")]: "Cancel",
  [chromeKey("goBack")]: "Go back",
  [chromeKey("close")]: "Close",
  [chromeKey("closeDialog")]: "Close dialog",
  // The accessible reason on a `when`-gated operation trigger while its
  // `GET /{id}/can_<op>` probe answers `{ allowed: false }`.
  [chromeKey("opNotAllowed")]: "Not available in the current state",
};

/** Chrome the generated session gate renders — the sign-in prompt and its
 *  button, and the forbidden view a `requires`-gated page falls back to.
 *  Merged only for a frontend that draws that gate itself
 *  (`FormSentenceScope.authGate`) and, like the other tables, only when the UI
 *  is already i18n-enabled.  The Feliz prompt sentence is the server's
 *  `problem.unauthenticated` text, so it reads that key rather than a copy. */
export const AUTH_GATE_CHROME: Record<string, string> = {
  [chromeKey("signIn")]: "Sign in",
  [chromeKey("notSignedIn")]: "You are not signed in.",
  [chromeKey("forbiddenTitle")]: "Forbidden",
  [chromeKey("forbiddenBody")]: "You do not have access to this page.",
};

/** Chrome the session view of the pack-rendered frontends (React, Vue, Svelte,
 *  Angular) renders: the loading state while `/auth/me` is probed, and the
 *  sign-in screen's heading and button.  Merged only for a frontend that ships
 *  that view (`FormSentenceScope.sessionView`), under the same already-enabled
 *  gate as the other tables.  The sign-in text is the gate's own `signIn`. */
export const SESSION_VIEW_CHROME: Record<string, string> = {
  [chromeKey("sessionLoading")]: "Loading…",
  [chromeKey("signIn")]: AUTH_GATE_CHROME[chromeKey("signIn")]!,
};

/** The source-language text of a session-gate or session-view chrome string, as
 *  the emitted `t(key, default)` carries it (the translator's source override
 *  applies). */
export function authGateMessage(name: string): string {
  const key = chromeKey(name);
  const message = AUTH_GATE_CHROME[key] ?? SESSION_VIEW_CHROME[key];
  if (message === undefined) throw new Error(`i18n-chrome: unknown auth-gate string "${name}"`);
  return sourceText(key, message);
}

/** Chrome a `Table`'s CONTROLS render — the pager's "Prev" / "Next" / position
 *  counter,
 *
 *  Merged-when-already-enabled rather than contributed off the `Table` call
 *  node, for the same reason `FORM_CHROME` is: the pager is CONDITIONAL, and
 *  here the condition is not even readable off the call node.  A `Table` pages
 *  only when it carries a `page:` state ref AND its rows come from a read the
 *  walker classified as server-controlled — and that second half is a
 *  walk-context fact (`primitives/table.ts`'s `serverControls`), invisible to
 *  the target-agnostic extraction pass.  A contribution would therefore either
 *  over-claim (catalog keys no pager emits) or under-claim (a binding no locale
 *  can reach); the gate below sidesteps the question, because emitter and merge
 *  site then answer the identical one — is this UI i18n-enabled. */
export const TABLE_CONTROLS_CHROME: Record<string, string> = {
  [chromeKey("prev")]: "Prev",
  [chromeKey("next")]: "Next",
  [chromeKey("pageOf")]: "Page {page} of {pages}",
};

/** Chrome a `ProvenanceInfo` disclosure renders: the summary's accessible name
 *  and the two fixed row labels above the lineage's input list.  The input rows
 *  are model data (`path = value`) and carry no chrome.
 *
 *  Merged-when-already-enabled and only for a UI that calls `ProvenanceInfo`
 *  (`uiUsesProvenanceInfo`) — the call is the exact condition under which the
 *  disclosure renders, and, like the form chrome, it must not be the reason a
 *  UI turns translatable. */
export const PROVENANCE_CHROME: Record<string, string> = {
  [chromeKey("provenanceHowComputed")]: "How this value was computed",
  [chromeKey("provenanceRule")]: "Rule",
  [chromeKey("provenanceValue")]: "Value",
};

/** True when a page or component body of `ui` calls `ProvenanceInfo`. */
function uiUsesProvenanceInfo(ui: UiIR): boolean {
  let found = false;
  const visit = (body: ExprIR | undefined) =>
    walkExprDeep(body, (e) => {
      if (e.kind === "call" && e.name === "ProvenanceInfo") found = true;
    });
  for (const page of ui.pages) visit(page.body);
  for (const component of ui.components) visit(component.body);
  return found;
}

/** The pages whose name a frontend renders (see
 *  {@link FormSentenceScope.pageNames}). */
function pagesNamedBy(ui: UiIR, mode: "all" | "navbar"): readonly PageIR[] {
  if (mode === "all") return ui.pages;
  if (ui.menu) return [];
  const topLevel = ui.pages.filter((p) => !(p.route ?? "/").includes(":"));
  return topLevel.length >= 2 ? topLevel : [];
}

/** Every chrome table merged into a catalog ONLY when the UI is already
 *  i18n-enabled — never flipping the runtime on by itself.
 *
 *  One helper rather than a list at each merge site, so a future table joins by
 *  editing this function instead of by remembering both callers
 *  (`system/i18n-catalog.ts` for `.loom/messages.en.json`, and
 *  `_frontend/i18n-runtime.ts` for each app's `locales/en.json`). */
export function chromeMergedWhenEnabled(
  ui?: UiIR,
  scope?: FormSentenceScope,
): Record<string, string> {
  const out: Record<string, string> = {
    ...APP_SHELL_CHROME,
    ...FORM_CHROME,
    ...TABLE_CONTROLS_CHROME,
    // The server-error codes every frontend localizes a refusal by.  Merged
    // like the shell chrome: any app that calls the api can receive any of
    // them, and none is the reason a UI turns translatable.
    ...WIRE_ERROR_MESSAGES,
  };
  if (scope?.authGate) Object.assign(out, AUTH_GATE_CHROME);
  if (scope?.sessionView) Object.assign(out, SESSION_VIEW_CHROME);
  if (ui && uiUsesProvenanceInfo(ui)) Object.assign(out, PROVENANCE_CHROME);
  if (ui) {
    for (const name of sentenceChromeNamesForUi(ui, scope)) {
      out[chromeKey(name)] = chromeMessage(name);
    }
    if (scope?.pageNames) {
      for (const page of pagesNamedBy(ui, scope.pageNames)) {
        const entry = pageNameEntry(ui, page);
        if (entry) out[entry.key] = entry.message;
      }
    }
    if (scope?.fallbackLabels) {
      for (const name of fallbackLabelNamesForUi(ui, scope.contexts)) {
        out[chromeKey(name)] = chromeMessage(name);
      }
    }
    // The implicit model-text sites (form labels, enum options, submit
    // buttons) — identity-keyed, and like the form chrome above never the
    // reason a UI turns translatable.
    if (scope?.implicitModelText) {
      for (const { key, message } of implicitModelTextEntries(ui, scope.contexts, {
        optionalCreateInputs: scope.optionalCreateInputs === true,
      })) {
        out[key] = message;
      }
    }
  }
  return out;
}

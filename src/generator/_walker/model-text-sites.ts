// ---------------------------------------------------------------------------
// IMPLICIT model-text sites — words a frontend renders about the model with no
// `label(…)` call in the source: a form field's label, an enum select's option
// labels, an `EnumBadge`'s value, an operation form's submit button and default
// dialog title, a create form's submit button.
//
// Each is keyed by model identity through `src/util/model-text-key.ts`, the
// same helper the `label(…)` lowering uses, so the catalog has ONE entry per
// model fact however many pages, forms and badges show it.
//
// Two halves that must agree:
//
//   - the EMIT half (`formFieldModelTextTokens`, `opModelText`, …) turns a site
//     into its translation call — only when the UI is i18n-enabled AND the
//     target's packs consume the tokens (`WalkerTarget.modelTextImplicitSites`);
//     otherwise the site keeps its humanized English, byte-identical;
//   - the CATALOG half (`implicitModelTextEntries`) enumerates the same keys off
//     the UI's form calls.  It is merged under the already-enabled gate
//     (`chromeMergedWhenEnabled`), like the form chrome: a form must never turn
//     the translation runtime on by itself.
// ---------------------------------------------------------------------------

import { createInputFields } from "../../ir/enrich/wire-projection.js";
import type {
  AggregateIR,
  BoundedContextIR,
  EnumIR,
  ExprIR,
  TypeIR,
  UiIR,
  WorkflowIR,
} from "../../ir/types/loom-ir.js";
import { modelTextContextOf } from "../../ir/util/model-text-owner.js";
import { enumPool, findValueObjectInScope } from "../../ir/util/reachable-types.js";
import { walkExprDeep } from "../../ir/util/walk.js";
import { modelTextDefaultOfKey, modelTextEntry, modelTextKey } from "../../util/model-text-key.js";
import { humanize } from "../../util/naming.js";
import type { FormFieldVM } from "../_frontend/view-models.js";
import { localizedModelText } from "./i18n-emit.js";
import type { MessageEntry } from "./i18n-extract.js";
import type { WalkContext } from "./walker-core.js";

const STRING: TypeIR = { kind: "primitive", name: "string" };

/** True when the implicit sites render through the translation runtime. */
export function implicitModelTextOn(ctx: WalkContext): boolean {
  return ctx.i18nPrefix !== undefined && ctx.target.modelTextImplicitSites === true;
}

/** `((v: string | null | undefined): string => v == null ? "" : ({ "Draft": t(…), … } as Record<string, string>)[v] ?? v)`
 *  — the label of an enum value, by its wire value.  The parameter admits
 *  `null`/`undefined` because an optional enum field reaches the badge unset,
 *  and renders as the empty string there.  `keys` parallels `values`. */
function enumLabelFn(ctx: WalkContext, values: readonly string[], keys: readonly string[]): string {
  const entries = values.map((v, i) => {
    return `${JSON.stringify(v)}: ${localizedModelText(ctx, keys[i]!, modelTextDefaultOfKey(keys[i]!))}`;
  });
  return `((v: string | null | undefined): string => v == null ? "" : ({ ${entries.join(", ")} } as Record<string, string>)[v] ?? v)`;
}

/** The `(value → label)` entries of an enum, each label the translation call of
 *  the value's identity key.  `keys` parallels `values`. */
export function enumLabelEntries(
  ctx: WalkContext,
  values: readonly string[],
  keys: readonly string[],
): Array<{ value: string; label: string }> {
  return values.map((v, i) => ({
    value: v,
    label: localizedModelText(ctx, keys[i]!, modelTextDefaultOfKey(keys[i]!)),
  }));
}

/** The label of `valueExpr`'s enum value as one expression: the typed
 *  `enumLabelFn` applied to it, or — for a target whose template language has
 *  no arrow functions or type assertions (`WalkerTarget.renderEnumLabelLookup`)
 *  — that target's own lookup. */
function enumLabelLookup(
  ctx: WalkContext,
  values: readonly string[],
  keys: readonly string[],
  valueExpr: string,
): string {
  if (ctx.target.renderEnumLabelLookup) {
    return ctx.target.renderEnumLabelLookup(enumLabelEntries(ctx, values, keys), valueExpr);
  }
  return `${enumLabelFn(ctx, values, keys)}(${valueExpr})`;
}

/** The pack-template tokens of one form field's identity-keyed text:
 *  `labelExpr` (the label as an expression) and, for an enum select,
 *  `enumLabelFn` (value → option label).  Empty when the site is off, so the
 *  templates fall back to their literal spelling. */
export function formFieldModelTextTokens(
  ctx: WalkContext,
  vm: FormFieldVM,
): Record<string, string> {
  if (!implicitModelTextOn(ctx)) return {};
  const out: Record<string, string> = {};
  if (vm.labelKey) out.labelExpr = localizedModelText(ctx, vm.labelKey, vm.label);
  if (vm.enumValueKeys && vm.enumValuesJson) {
    out.enumLabelFn = enumLabelFn(ctx, JSON.parse(vm.enumValuesJson), vm.enumValueKeys);
  }
  return out;
}

/** An operation's label as both a markup token and an expression, keyed
 *  `<Ctx>.<Agg>.op.<op>`; undefined when the site is off. */
export function opModelText(
  ctx: WalkContext,
  bc: BoundedContextIR,
  aggName: string,
  opName: string,
): { markup: string; expr: string } | undefined {
  if (!implicitModelTextOn(ctx)) return undefined;
  const { key, defaultText } = modelTextEntry({
    ctx: modelTextContextOf(aggName, bc, ctx.bcByAggregate.values()),
    type: aggName,
    facet: "op",
    member: opName,
  });
  const expr = localizedModelText(ctx, key, defaultText);
  return { markup: ctx.target.renderInterpolation(expr, STRING), expr };
}

/** The visible text of an `Action { x.<op> }` button, as markup for a text
 *  position: the operation's identity-keyed translation call under i18n (the
 *  key the scaffold's operation forms and `implicitModelTextEntries` share),
 *  else the humanized operation name. */
export function actionButtonLabel(ctx: WalkContext, agg: AggregateIR, opName: string): string {
  const bc = ctx.bcByAggregate.get(agg.name);
  return (bc && opModelText(ctx, bc, agg.name, opName)?.markup) || humanize(opName);
}

/** The English default of an operation's identity-keyed label
 *  (`<Ctx>.<Type>.op.<op>`): what a button reads when its ui carries no
 *  translation runtime, so the literal and the catalog entry cannot drift. */
export function opDefaultText(typeName: string, opName: string): string {
  return modelTextEntry({ ctx: undefined, type: typeName, facet: "op", member: opName })
    .defaultText;
}

/** The key and English default of a workflow's run button,
 *  `<Ctx>.<Workflow>.op.run` → "Run" — the one spelling every target's
 *  `WorkflowForm` submit reads. */
export function workflowRunEntry(
  wfName: string,
  bc: BoundedContextIR,
  contexts: Iterable<BoundedContextIR>,
): { key: string; defaultText: string } {
  return modelTextEntry({
    ctx: modelTextContextOf(wfName, bc, contexts),
    type: wfName,
    facet: "op",
    member: "run",
  });
}

/** A workflow form's run button as a target-native expression; undefined when
 *  the site is off (the target keeps its literal "Run"). */
export function workflowRunExpr(
  ctx: WalkContext,
  bc: BoundedContextIR,
  wfName: string,
): string | undefined {
  if (!implicitModelTextOn(ctx)) return undefined;
  const { key, defaultText } = workflowRunEntry(wfName, bc, ctx.bcByAggregate.values());
  return localizedModelText(ctx, key, defaultText);
}

/** {@link workflowRunExpr} as a markup token. */
export function workflowRunModelText(
  ctx: WalkContext,
  bc: BoundedContextIR,
  wfName: string,
): string | undefined {
  const expr = workflowRunExpr(ctx, bc, wfName);
  return expr === undefined ? undefined : ctx.target.renderInterpolation(expr, STRING);
}

/** The identity-keyed text of ONE form input, resolved off the model rather
 *  than a pack view-model — for the frontends whose forms are emitted from a
 *  spec, not rendered through pack templates (Feliz, Flutter).  Mirrors
 *  `prepareFormFieldVM`'s keying: a declared field of `owner` is
 *  `<Ctx>.<Owner>.field.<leaf>`, a flattened value-object leaf keys under the
 *  value object, and an enum select's options key under the enum. */
export interface FormInputModelText {
  readonly key: string;
  readonly defaultText: string;
  /** For an enum input: each value with its identity key and English default. */
  readonly enumOptions?: ReadonlyArray<{
    readonly value: string;
    readonly key: string;
    readonly defaultText: string;
  }>;
}

function unwrapInputType(t: TypeIR): TypeIR {
  let cur = t;
  while (cur.kind === "optional") cur = cur.inner;
  if (cur.kind === "array") {
    cur = cur.element;
    while (cur.kind === "optional") cur = cur.inner;
  }
  return cur;
}

/** Resolve the model text of the input `leaf`, reached from `inputs` by
 *  walking the value-object keys in `path` (outermost first).  `ownerOf` names
 *  the model type a TOP-LEVEL input is declared on (`undefined` ⇒ the input
 *  names no model fact and keeps its English).  `undefined` when the input
 *  cannot be resolved against `bc`. */
export function formInputModelText(
  inputs: readonly { name: string; type: TypeIR }[],
  path: readonly string[],
  leaf: string,
  ownerOf: (name: string) => string | undefined,
  bc: BoundedContextIR | undefined,
  contexts: Iterable<BoundedContextIR>,
): FormInputModelText | undefined {
  if (!bc) return undefined;
  const all = [...contexts];
  let fields: readonly { name: string; type: TypeIR }[] = inputs;
  let owner: string | undefined;
  let nested = false;
  for (const key of path) {
    const f = fields.find((x) => x.name === key);
    const t = f ? unwrapInputType(f.type) : undefined;
    const vo = t?.kind === "valueobject" ? findValueObjectInScope(bc, t.name) : undefined;
    if (!vo) return undefined;
    fields = vo.fields;
    owner = vo.name;
    nested = true;
  }
  const field = fields.find((x) => x.name === leaf);
  if (!field) return undefined;
  if (!nested) owner = ownerOf(leaf);
  if (owner === undefined) return undefined;
  const { key, defaultText } = modelTextEntry({
    ctx: modelTextContextOf(owner, bc, all),
    type: owner,
    facet: "field",
    member: leaf,
  });
  const t = unwrapInputType(field.type);
  const en = t.kind === "enum" ? enumPool(bc).find((e) => e.name === t.name) : undefined;
  if (!en) return { key, defaultText };
  const enumCtx = modelTextContextOf(en.name, bc, all);
  return {
    key,
    defaultText,
    enumOptions: en.values.map((v) => {
      const e = modelTextEntry({ ctx: enumCtx, type: en.name, facet: "value", member: v });
      return { value: v, key: e.key, defaultText: e.defaultText };
    }),
  };
}

/** The type a form input's label is keyed under: the aggregate when it
 *  declares a field of that name (an operation parameter mirroring a field),
 *  else none — an input that names no model fact keeps its English. */
export function paramLabelOwner(agg: AggregateIR, name: string): string | undefined {
  return agg.fields.some((f) => f.name === name) ? agg.name : undefined;
}

/** `EnumBadge` — the value's label lookup wrapped around `valueExpr`, when the
 *  value's enum is known and the site is on; else `valueExpr` unchanged. */
export function enumBadgeValueExpr(
  ctx: WalkContext,
  enumName: string | undefined,
  valueExpr: string,
): string {
  if (!enumName || !implicitModelTextOn(ctx)) return valueExpr;
  for (const bc of ctx.bcByAggregate.values()) {
    const en = enumPool(bc).find((e) => e.name === enumName);
    if (!en) continue;
    const owner = modelTextContextOf(en.name, bc, ctx.bcByAggregate.values());
    const keys = en.values.map((v) =>
      modelTextKey({ ctx: owner, type: en.name, facet: "value", member: v }),
    );
    return enumLabelLookup(ctx, en.values, keys, valueExpr);
  }
  return valueExpr;
}

// ---------------------------------------------------------------------------
// Catalog half
// ---------------------------------------------------------------------------

/** Catalog entries for a form input `name: type` declared on `owner`: its
 *  label, plus — through its type — the labels a nested value object's inputs
 *  and an enum select's options render.  Mirrors `prepareFormFieldVM`. */
function fieldEntries(
  owner: string | undefined,
  field: { name: string; type: TypeIR },
  bc: BoundedContextIR,
  contexts: readonly BoundedContextIR[],
  out: MessageEntry[],
  seen: Set<string> = new Set(),
): void {
  if (owner !== undefined) {
    const e = modelTextEntry({
      ctx: modelTextContextOf(owner, bc, contexts),
      type: owner,
      facet: "field",
      member: field.name,
    });
    out.push({ key: e.key, message: e.defaultText });
  }
  let t = field.type;
  while (t.kind === "optional") t = t.inner;
  if (t.kind === "array") {
    t = t.element;
    while (t.kind === "optional") t = t.inner;
  }
  if (t.kind === "enum") {
    const en = enumPool(bc).find((x) => x.name === (t as { name: string }).name);
    if (en) out.push(...enumEntries(en, bc, contexts));
  } else if (t.kind === "valueobject") {
    const vo = findValueObjectInScope(bc, t.name);
    if (vo && !seen.has(vo.name)) {
      const next = new Set(seen).add(vo.name);
      for (const vf of vo.fields) fieldEntries(vo.name, vf, bc, contexts, out, next);
    }
  }
}

function enumEntries(
  en: EnumIR,
  bc: BoundedContextIR,
  contexts: readonly BoundedContextIR[],
): MessageEntry[] {
  const owner = modelTextContextOf(en.name, bc, contexts);
  return en.values.map((v) => {
    const e = modelTextEntry({ ctx: owner, type: en.name, facet: "value", member: v });
    return { key: e.key, message: e.defaultText };
  });
}

function opEntry(
  agg: AggregateIR,
  opName: string,
  bc: BoundedContextIR,
  contexts: readonly BoundedContextIR[],
): MessageEntry {
  const e = modelTextEntry({
    ctx: modelTextContextOf(agg.name, bc, contexts),
    type: agg.name,
    facet: "op",
    member: opName,
  });
  return { key: e.key, message: e.defaultText };
}

/** A form call's named reference arg (`of:` / `runs:`), as a ref or literal. */
function namedRef(call: ExprIR & { kind: "call" }, name: string): string | undefined {
  const idx = (call.argNames ?? []).indexOf(name);
  const arg = idx >= 0 ? call.args[idx] : undefined;
  if (arg?.kind === "ref") return arg.name;
  if (arg?.kind === "literal" && arg.lit === "string") return arg.value;
  return undefined;
}

/** Every implicit model-text catalog entry a UI's forms and badges render,
 *  read off its page and component bodies against `contexts`.  Enum values are
 *  catalogued for every enum the contexts declare: an `EnumBadge`'s enum is a
 *  property of the row it reads, not of the call. */
export function implicitModelTextEntries(
  ui: UiIR,
  contexts: readonly BoundedContextIR[],
  opts: { optionalCreateInputs?: boolean } = {},
): MessageEntry[] {
  const out: MessageEntry[] = [];
  const aggregates = new Map<string, { agg: AggregateIR; bc: BoundedContextIR }>();
  const workflows = new Map<string, { wf: WorkflowIR; bc: BoundedContextIR }>();
  for (const bc of contexts) {
    for (const agg of bc.aggregates) aggregates.set(agg.name, { agg, bc });
    for (const wf of bc.workflows) workflows.set(wf.name, { wf, bc });
  }
  let rendersBadge = false;
  const visit = (body: ExprIR | undefined) =>
    walkExprDeep(body, (e) => {
      if (e.kind !== "call") return;
      if (e.name === "CreateForm") {
        const hit = aggregates.get(namedRef(e, "of") ?? "");
        if (!hit) return;
        for (const f of createInputFields(hit.agg).filter(
          (x) => opts.optionalCreateInputs || !x.optional,
        )) {
          fieldEntries(hit.agg.name, f, hit.bc, contexts, out);
        }
        out.push(opEntry(hit.agg, "create", hit.bc, contexts));
      } else if (e.name === "OperationForm") {
        const opArg = (e.argNames ?? []).indexOf("op");
        const named = opArg >= 0 ? e.args[opArg] : undefined;
        const positional = e.args.find((_, i) => !(e.argNames ?? [])[i]);
        const opName =
          named?.kind === "ref"
            ? named.name
            : positional?.kind === "member"
              ? positional.member
              : undefined;
        if (!opName) return;
        const owner = namedRef(e, "of");
        const candidates = owner
          ? [aggregates.get(owner)].filter((x) => x !== undefined)
          : [...aggregates.values()];
        for (const { agg, bc } of candidates) {
          const op = agg.operations.find((o) => o.name === opName && o.visibility === "public");
          if (!op) continue;
          out.push(opEntry(agg, opName, bc, contexts));
          for (const p of op.params)
            fieldEntries(paramLabelOwner(agg, p.name), p, bc, contexts, out);
        }
      } else if (e.name === "WorkflowForm") {
        const hit = workflows.get(namedRef(e, "runs") ?? "");
        if (!hit) return;
        const run = workflowRunEntry(hit.wf.name, hit.bc, contexts);
        out.push({ key: run.key, message: run.defaultText });
        for (const p of hit.wf.params) fieldEntries(hit.wf.name, p, hit.bc, contexts, out);
      } else if (e.name === "Action") {
        const ref = (e.args.find((_, i) => !(e.argNames ?? [])[i]) ?? e.args[0]) as
          | ExprIR
          | undefined;
        if (ref?.kind !== "member" || ref.receiver.kind !== "ref") return;
        // The receiver is an in-scope instance whose aggregate the IR does not
        // name here, so every aggregate declaring the public operation is
        // catalogued — the same candidate rule `OperationForm` uses.
        for (const { agg, bc } of aggregates.values()) {
          if (agg.operations.some((o) => o.name === ref.member && o.visibility === "public")) {
            out.push(opEntry(agg, ref.member, bc, contexts));
          }
        }
      } else if (e.name === "EnumBadge") {
        rendersBadge = true;
      }
    });
  for (const page of ui.pages) visit(page.body);
  for (const component of ui.components) visit(component.body);
  if (rendersBadge) {
    for (const bc of contexts) {
      for (const en of bc.enums) out.push(...enumEntries(en, bc, contexts));
    }
  }
  return out;
}

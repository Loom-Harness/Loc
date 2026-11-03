// ---------------------------------------------------------------------------
// Model-identity text on HEEx — `label(…)` / `plural(…)` and the implicit sites
// (a form field's label, an enum select's option labels, an `EnumBadge`'s value,
// an operation form's trigger / title / submit button).
//
// Every site is `pgettext(<identity key>, <English default>)`: the msgctxt is
// the `src/util/model-text-key.ts` key — the SAME key the catalog carries
// (`.loom/messages.en.json`, and the `.po` via `buildUiCatalog`'s implicit-site
// scope) — and the msgid is the source-language default, so an untranslated
// message falls back to the English exactly as every other HEEx slot does.
//
// The implicit sites key only when the UI is i18n-enabled (`ctx.i18nPrefix`);
// otherwise they keep the humanized English literal, byte-identical to the
// pre-i18n output.  The key derivation is the one the other frontends use
// (`modelTextContextOf` + `modelTextEntry`), so a fact has one catalog entry
// however many pages and targets show it.
// ---------------------------------------------------------------------------

import type { BoundedContextIR, EnumIR } from "../../ir/types/loom-ir.js";
import { modelTextContextOf } from "../../ir/util/model-text-owner.js";
import { enumPool } from "../../ir/util/reachable-types.js";
import { modelTextEntry } from "../../util/model-text-key.js";
import { elixirString } from "../../util/naming.js";
import { sourceText } from "../_walker/source-text.js";
import { pgettextCall } from "./i18n.js";

/** The slice of the HEEx walk context the model-text sites read. */
export interface HeexModelTextCtx {
  readonly i18nPrefix?: string | undefined;
  readonly bcByAggregate: ReadonlyMap<string, BoundedContextIR>;
}

/** True when the implicit model-text sites render through gettext. */
function heexModelTextOn(ctx: HeexModelTextCtx): boolean {
  return ctx.i18nPrefix !== undefined;
}

/** An Elixir EXPRESSION for a model-identity text: the `pgettext` call under
 *  i18n, else the (override-aware) English as a string literal. */
export function modelTextExpr(ctx: HeexModelTextCtx, key: string, defaultText: string): string {
  return heexModelTextOn(ctx)
    ? pgettextCall(key, defaultText)
    : elixirString(sourceText(key, defaultText));
}

/** The context a model type is keyed under, resolved from the form's `home`
 *  context first and then every context the walk can see. */
function ownerCtx(
  ctx: HeexModelTextCtx,
  home: BoundedContextIR | undefined,
  typeName: string,
): string | undefined {
  return modelTextContextOf(typeName, home, new Set(ctx.bcByAggregate.values()));
}

/** The context an aggregate's forms belong to. */
export function homeOf(ctx: HeexModelTextCtx, aggName: string): BoundedContextIR | undefined {
  return ctx.bcByAggregate.get(aggName);
}

/** A form input's label, as the Elixir call — undefined when the site is off or
 *  the input names no model fact (`owner` undefined), so the caller keeps its
 *  literal English. */
export function fieldLabelCall(
  ctx: HeexModelTextCtx,
  home: BoundedContextIR | undefined,
  owner: string | undefined,
  name: string,
): string | undefined {
  if (!heexModelTextOn(ctx) || owner === undefined) return undefined;
  const e = modelTextEntry({
    ctx: ownerCtx(ctx, home, owner),
    type: owner,
    facet: "field",
    member: name,
  });
  return pgettextCall(e.key, e.defaultText);
}

/** The Elixir `{label, value}` tuple of every value of `en`, labelled through
 *  gettext; undefined when the site is off. */
export function enumOptionTuples(
  ctx: HeexModelTextCtx,
  home: BoundedContextIR | undefined,
  en: EnumIR,
): string[] | undefined {
  if (!heexModelTextOn(ctx)) return undefined;
  const owner = ownerCtx(ctx, home, en.name);
  return en.values.map((v) => {
    const e = modelTextEntry({ ctx: owner, type: en.name, facet: "value", member: v });
    return `{${pgettextCall(e.key, e.defaultText)}, ${elixirString(v)}}`;
  });
}

/** An Elixir expression mapping an enum wire value to its translated label
 *  (`EnumBadge`); a value the enum lacks falls through unchanged.  Undefined
 *  when the site is off or the enum is unknown. */
export function enumLabelLookup(
  ctx: HeexModelTextCtx,
  enumName: string,
  valueExpr: string,
): string | undefined {
  if (!heexModelTextOn(ctx)) return undefined;
  const bcs = new Set(ctx.bcByAggregate.values());
  for (const bc of bcs) {
    const en = enumPool(bc).find((x) => x.name === enumName);
    if (!en) continue;
    const owner = modelTextContextOf(en.name, bc, bcs);
    const clauses = en.values.map((v) => {
      const e = modelTextEntry({ ctx: owner, type: en.name, facet: "value", member: v });
      return `${elixirString(v)} -> ${pgettextCall(e.key, e.defaultText)}`;
    });
    return `case ${valueExpr} do ${clauses.join("; ")}; other -> other end`;
  }
  return undefined;
}

/** An operation's (or `create`'s) label as the Elixir call, keyed
 *  `<Ctx>.<Agg>.op.<op>`; undefined when the site is off. */
export function opLabelCall(
  ctx: HeexModelTextCtx,
  aggName: string,
  opName: string,
): string | undefined {
  if (!heexModelTextOn(ctx)) return undefined;
  const e = modelTextEntry({
    ctx: ownerCtx(ctx, homeOf(ctx, aggName), aggName),
    type: aggName,
    facet: "op",
    member: opName,
  });
  return pgettextCall(e.key, e.defaultText);
}

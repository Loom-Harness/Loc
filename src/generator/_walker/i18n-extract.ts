// ---------------------------------------------------------------------------
// i18n message extraction — the user-visible-string catalog pass (M-T1.11,
// https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/i18n.md).
//
// Walks a `UiIR`'s pages/components/menu and collects every user-visible
// string literal into `<key, message>` catalog entries.  A downstream renderer
// (`src/system/i18n-catalog.ts`) serialises them into `.loom/messages.en.json`,
// the diffable source-language catalog every locale is merged against.
//
// SCOPE — plain string literals AND interpolated backtick templates.  A
// template (`` `Order {order.id}` ``) lowers to a `binary "+"` chain (no ICU
// node in the IR — a template is indistinguishable from hand concat post-lower);
// `icuFromConcat` re-detects that chain into an ICU message (`"Order {id}"`) so
// it too becomes a translatable catalog entry.  A dynamic slot with no literal
// text (a bare `ref`, `{count}` alone) has nothing to translate and is skipped.
//
// KEYS — D-I18N-KEY (PINNED).  Inline literals are content-hashed:
// `<Ui>.page.<Page>.<role>.<hash>` / `<Ui>.component.<Comp>.<role>.<hash>` /
// `<Ui>.menu.<role>.<hash>`.  `role` (the slot the text sits in) is part of the key
// so two different-role occurrences of the same string in one page don't
// collide; the content hash makes the key reorder-invariant and re-key on a
// rephrase.  Named `text { }` entries (stable keys) are a later slice.
//
// This module lives at the generator layer so both the catalog renderer
// (`src/system/`, downstream) and the future React translation runtime
// (`src/generator/react/`, sibling) share ONE slot table + key derivation —
// the emitted `<FormattedMessage id>` must line up with the catalog key.
// ---------------------------------------------------------------------------

import type { ActionIR, ExprIR, LayoutIR, UiIR } from "../../ir/types/loom-ir.js";
import type { OriginRef } from "../../ir/types/origin.js";
import {
  type IcuMessage,
  icuFromConcat,
  literalString,
  richTextEmphasisCalls,
  richTextMessage,
} from "../../ir/util/icu-message.js";
import { explicitMenuReadsPageLabel } from "../../ir/util/page-menu.js";
import { walkExprDeep, walkStmtExprsDeep } from "../../ir/util/walk.js";

export { type IcuMessage, icuFromConcat, literalString };

import { contentHash } from "../../util/content-hash.js";
import { USER_VISIBLE_SLOTS } from "../../util/user-visible-slots.js";
import { layoutKeyPrefix } from "../_frontend/layout-key.js";
import { chromeEntriesFor } from "./i18n-chrome.js";
import { namedArgValue, positionalArgs } from "./shared/args.js";

/** One source-language catalog entry: a stable key and its English text. */
export interface MessageEntry {
  key: string;
  message: string;
  /** True when the message came from an INTERPOLATED slot and therefore carries
   *  ICU holes (`"Status: {code}"`) rather than being a plain literal.
   *
   *  Every frontend formats holes at runtime, but only Phoenix has to DECIDE
   *  whether to ship a formatter at all: gettext alone cannot substitute ICU
   *  holes, so an app with an interpolated message needs an ICU engine and a
   *  plain-literal one must not pay for it (D-I18N-HEEX-ICU).  Marked here, at
   *  the one place that already knows, rather than re-derived by re-walking. */
  icu?: true;
  /** Where in the `.ddd` source the string was written — the expression that
   *  carries it, or the page it belongs to when the slot has no span of its
   *  own.  Absent for text no source construct wrote (design-pack chrome). */
  origin?: OriginRef;
}

/** The origin an expression node carries, when it carries one. */
function originOfExpr(e: ExprIR | undefined): OriginRef | undefined {
  return (e as { origin?: OriginRef } | undefined)?.origin;
}

/** The key role of a rich `Text` sentence — the role of a plain `Text`, so the
 *  one-child and many-child forms of a paragraph key alike. */
export const RICH_TEXT_ROLE = "text";

/** The key prefix of a page's inline strings: `<Ui>.page.<Page>`.  The ui name
 *  leads every authored key, so the translator tree can file a ui's strings
 *  under that ui's namespace (`src/i18n/namespace.ts`). */
export function pageKeyPrefix(ui: { name: string }, page: { name: string }): string {
  return `${ui.name}.page.${page.name}`;
}

/** The key prefix of a component's inline strings: `<Ui>.component.<Comp>`. */
export function componentKeyPrefix(ui: { name: string }, component: { name: string }): string {
  return `${ui.name}.component.${component.name}`;
}

/** The key prefix of the ui-level `menu { … }` chrome: `<Ui>.menu`. */
export function menuKeyPrefix(ui: { name: string }): string {
  return `${ui.name}.menu`;
}

/** The key prefix of a component rendered inline within a body keyed under
 *  `parentPrefix` — the parent's leading ui segment with the component's own
 *  name. */
export function inlineComponentKeyPrefix(parentPrefix: string, componentName: string): string {
  const ui = parentPrefix.slice(0, parentPrefix.indexOf("."));
  return `${ui}.component.${componentName}`;
}

/** The catalog key for an inline literal: `<prefix>.<role>.<hash>`.
 *  Exported so the React translation runtime (`i18n-emit.ts`) emits a
 *  `<FormattedMessage id>` / `t(key)` whose key is IDENTICAL to the one the
 *  extraction pass writes into `.loom/messages.en.json` — the two MUST agree,
 *  so both call this one function rather than each re-deriving the shape.
 *
 *  For an ICU message the hash input is the POSITIONAL-normalized form
 *  (`"Order {0}"`, {@link IcuMessage.positional}), not the named display form —
 *  so renaming a field (`{id}` → `{number}`) keeps the same key and preserves
 *  the translation (i18n-strings.md Option B).
 *
 *  A `plural` / `select` / `selectordinal` hole is hashed WHOLE: the positional
 *  form keeps its complete ICU body (`"You have {0, plural, one {# order}
 *  other {# orders}}"`), so editing any branch's English re-keys the message —
 *  every translation's branches were written against the old English and must
 *  be re-done — while renaming the counted value does not. */
export function messageKey(prefix: string, role: string, message: string): string {
  return `${prefix}.${role}.${contentHash(message)}`;
}

/** Collect the user-visible strings from one render-body expression tree,
 *  keyed under `<prefix>` (e.g. `page.OrderList` / `component.OrderCard`). */
function collectBody(body: ExprIR | undefined, prefix: string, out: MessageEntry[]): void {
  // The emphasis spans a rich `Text` folded into its sentence: their text lives
  // in that one message, so none gets a slot key of its own.
  const folded = new Set<ExprIR>();
  walkExprDeep(body, (e) => collectExpr(e, prefix, out, folded));
}

/** Collect the user-visible strings from the named actions of a page,
 *  component or store.  An action body is a statement block, so its text
 *  (`toast(label(Task))`) is reachable only through the statement walkers. */
function collectActions(
  actions: readonly ActionIR[] | undefined,
  prefix: string,
  out: MessageEntry[],
): void {
  const folded = new Set<ExprIR>();
  for (const action of actions ?? []) {
    for (const stmt of action.body)
      walkStmtExprsDeep(stmt, (e) => collectExpr(e, prefix, out, folded));
  }
}

/** The catalog entries one expression node contributes (the visitor the body
 *  and action walks share).  `folded` holds the emphasis spans an enclosing
 *  rich `Text` already carries in its own sentence. */
function collectExpr(e: ExprIR, prefix: string, out: MessageEntry[], folded: Set<ExprIR>): void {
  if (folded.has(e)) return;
  // `label(…)` / `plural(…)` — keyed by model identity, with no page prefix,
  // so every page naming the same fact shares one catalog entry.
  if (e.kind === "modelText") {
    out.push({ key: e.key, message: e.defaultText, origin: e.origin });
    return;
  }
  if (e.kind !== "call") return;
  // Pack-chrome: a primitive that renders design-pack-baked user-visible text
  // (a `Loader()`'s `aria-label="Loading"`, a `DataGrid()`'s pager) contributes
  // its stable `chrome.<name>` catalog entries wherever it appears —
  // used-only, keyed IDENTICALLY to what the `localizedChrome*` helpers emit
  // (M-T1.11).  Resolved against the CALL NODE, because a grid's per-column
  // "Filter" placeholder depends on whether a column is filterable.
  out.push(...chromeEntriesFor(e));
  // `Text { "Read the ", Bold { "terms" }, " first" }` — ONE whole-sentence
  // message, the emphasis carried as tags.
  const rich = richTextMessage(e);
  if (rich) {
    for (const span of richTextEmphasisCalls(e)) folded.add(span);
    out.push({
      key: messageKey(prefix, RICH_TEXT_ROLE, rich.positional),
      message: rich.display,
      icu: true,
      origin: originOfExpr(e),
    });
    return;
  }
  const slots = USER_VISIBLE_SLOTS[e.name];
  if (!slots) return;
  const positionals = positionalArgs(e);
  for (const slot of slots) {
    const arg = slot.kind === "positional" ? positionals[slot.index] : namedArgValue(e, slot.name);
    const message = literalString(arg);
    if (message !== undefined) {
      out.push({
        key: messageKey(prefix, slot.role, message),
        message,
        origin: originOfExpr(arg) ?? originOfExpr(e),
      });
      continue;
    }
    // Interpolated slot → an ICU entry keyed by its positional form, stored as
    // the named display form (the React emitter derives the identical key).
    const icu = icuFromConcat(arg);
    if (icu) {
      out.push({
        key: messageKey(prefix, slot.role, icu.positional),
        message: icu.display,
        icu: true,
        origin: originOfExpr(arg) ?? originOfExpr(e),
      });
    }
  }
}

/** The named layouts, among `layouts`, that a page of `ui` selects. */
function layoutsSelectedBy(ui: UiIR, layouts: readonly LayoutIR[]): LayoutIR[] {
  const selected = new Set<string>();
  for (const page of ui.pages) {
    if (page.layout?.kind === "named") selected.add(page.layout.ref);
  }
  return layouts.filter((l) => selected.has(l.name));
}

/** Extract every user-visible source-language string from a UI declaration.
 *  Pure and order-deterministic (walks pages, then components, then menu, in
 *  declaration order); the renderer dedupes + sorts. */
export function collectUiMessages(ui: UiIR, layouts: readonly LayoutIR[] = []): MessageEntry[] {
  const out: MessageEntry[] = [];

  for (const page of ui.pages) {
    const prefix = pageKeyPrefix(ui, page);
    // Page title (`page X { title: "…" }`): a plain literal, or an interpolated
    // template (`` `Order {order.id}` ``) as an ICU entry.  `localizedPageTitle`
    // (`i18n-emit.ts`) reads either back under the same `title` role.
    const title = literalString(page.title);
    if (title !== undefined) {
      out.push({
        key: messageKey(prefix, "title", title),
        message: title,
        origin: originOfExpr(page.title) ?? page.origin,
      });
    } else {
      const icu = icuFromConcat(page.title);
      if (icu) {
        out.push({
          key: messageKey(prefix, "title", icu.positional),
          message: icu.display,
          icu: true,
          origin: originOfExpr(page.title) ?? page.origin,
        });
      }
    }
    if (page.title?.kind === "modelText") {
      out.push({
        key: page.title.key,
        message: page.title.defaultText,
        origin: page.title.origin ?? page.origin,
      });
    }
    collectBody(page.body, prefix, out);
    collectActions(page.actions, prefix, out);

    // Per-page sidebar chrome — `menu { section: "…", label: "…" }` metadata.
    // An explicit ui `menu { … }` replaces the page-derived sidebar, so there a
    // page's metadata is catalogued only where a `link Page` still reads it.
    for (const entry of page.menuMeta?.entries ?? []) {
      if (entry.name !== "section" && entry.name !== "label") continue;
      if (ui.menu && (entry.name === "section" || !explicitMenuReadsPageLabel(page, ui))) continue;
      if (entry.value.kind === "modelText") {
        out.push({
          key: entry.value.key,
          message: entry.value.defaultText,
          origin: entry.value.origin ?? page.origin,
        });
        continue;
      }
      const message = literalString(entry.value);
      if (message === undefined) continue;
      out.push({
        key: messageKey(prefix, `menu.${entry.name}`, message),
        message,
        origin: originOfExpr(entry.value) ?? page.origin,
      });
    }
  }

  for (const component of ui.components) {
    collectBody(component.body, componentKeyPrefix(ui, component), out);
    collectActions(component.actions, componentKeyPrefix(ui, component), out);
  }
  for (const store of ui.stores) {
    collectActions(store.actions, `${ui.name}.store.${store.name}`, out);
  }

  // The slots of every named layout a page of this ui selects, keyed under
  // `<Ui>.layout.<Layout>` — what the frontends' layout emitters look up.
  for (const layout of layoutsSelectedBy(ui, layouts)) {
    const prefix = layoutKeyPrefix(ui, layout);
    collectBody(layout.header, prefix, out);
    collectBody(layout.sidebar, prefix, out);
    collectBody(layout.footer, prefix, out);
  }

  // UI-level `menu { section "…" { link "L" -> "url" } }` chrome.
  for (const section of ui.menu?.sections ?? []) {
    if (section.label) {
      out.push({
        key: messageKey(menuKeyPrefix(ui), "section", section.label),
        message: section.label,
      });
    }
    for (const link of section.links) {
      if (link.kind === "external" && link.label) {
        out.push({ key: messageKey(menuKeyPrefix(ui), "link", link.label), message: link.label });
      } else if (link.kind === "page") {
        const label = link.props.find((p) => p.name === "label");
        const message = literalString(label?.value);
        if (message !== undefined) {
          out.push({ key: messageKey(menuKeyPrefix(ui), "link", message), message });
        }
      }
    }
  }

  return out;
}

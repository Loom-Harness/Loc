// ---------------------------------------------------------------------------
// Attribute and chrome helpers the HEEx whole-primitive renderers share: a
// literal-or-`{…}` attribute value, the `data-testid` attribute, a call's
// named argument, and the Gettext chrome strings a form or table bakes in.
// ---------------------------------------------------------------------------

import type { ExprIR } from "../../ir/types/loom-ir.js";
import { chromeKey, chromeMessage } from "../_walker/i18n-chrome.js";
import {
  escapeHeexAttr,
  escapeHeexText,
  isAttrRenderable,
  renderExpr,
  type WalkContext,
} from "./heex-walker-core.js";
import { pgettextCall } from "./i18n.js";

/** Render an attribute *value* as either a quoted literal or a HEEx `{…}`
 *  expression, depending on whether the arg is a compile-time literal.
 *
 *  A *dynamic* value (anything but a `literal`) is an Elixir expression and
 *  MUST ride a `{…}` expression attribute — emitting it inside quotes (e.g.
 *  `id="<%= … %>"` or `data-testid="x <> y"`) produces a HEEx tokenizer
 *  ParseError ("expected attribute name").  This is the single seam that
 *  every primitive funnels dynamic attribute values through, so the bug class
 *  can't reappear one renderer at a time.
 *
 *  A value that is not renderable as an attribute at all (a LIST / OBJECT /
 *  LAMBDA — see `isAttrRenderable`) degrades to the empty string: these call
 *  sites (`src:`, `alt:`, `id:`, `testid:`) have a required attribute to fill,
 *  and an empty one is inert markup where the raw splice was a render-time
 *  crash in Phoenix's attribute escaper. */
export function attrValue(arg: ExprIR, ctx: WalkContext): string {
  if (!isAttrRenderable(arg)) return `""`;
  return arg.kind === "literal"
    ? `"${escapeHeexAttr(arg.value)}"`
    : `{${renderExpr(arg, { ...ctx, position: "template" })}}`;
}

/** The trailing ` data-testid=…` attribute for a primitive call, or `""` when
 *  no `testid:` is given.  A literal renders as `data-testid="x"`; a dynamic
 *  `testid:` renders as `data-testid={<expr>}` (see {@link attrValue}). */
export function testIdAttr(expr: Extract<ExprIR, { kind: "call" }>, ctx: WalkContext): string {
  const idx = (expr.argNames ?? []).indexOf("testid");
  const arg = idx >= 0 ? expr.args[idx] : undefined;
  return arg ? ` data-testid=${attrValue(arg, ctx)}` : "";
}

/** The value of a named arg on a call, or undefined. */
export function namedArg(
  expr: Extract<ExprIR, { kind: "call" }>,
  name: string,
): ExprIR | undefined {
  for (let i = 0; i < expr.args.length; i++) {
    if (expr.argNames?.[i] === name) return expr.args[i];
  }
  return undefined;
}

/** A chrome sentence as a HEEx ATTRIBUTE VALUE: the `{pgettext(…)}` expression
 *  form under i18n, else the quoted escaped English. */
export function heexChromeAttr(ctx: WalkContext, name: string): string {
  const { english, call } = heexChrome(ctx, name);
  return call !== undefined ? `{${call}}` : `"${escapeHeexAttr(english)}"`;
}

/** A chrome sentence in HEEx TEXT position. */
export function heexChromeText(ctx: WalkContext, name: string): string {
  return labelText(heexChrome(ctx, name));
}

/** A `{ english, call? }` label in HEEx TEXT position. */
export function labelText(label: { english: string; call?: string }): string {
  return label.call !== undefined ? `<%= ${label.call} %>` : escapeHeexText(label.english);
}

/** A shared `chrome.<name>` sentence.  `english` is the message; `call` —
 *  present under i18n — the Elixir expression that resolves it through gettext. */
export function heexChrome(ctx: WalkContext, name: string): { english: string; call?: string } {
  const english = chromeMessage(name);
  if (!ctx.i18nPrefix) return { english };
  return { english, call: pgettextCall(chromeKey(name), english) };
}

// ---------------------------------------------------------------------------
// Standalone controlled inputs — Field / NumberField / PasswordField /
// MultilineField / SelectField / Toggle.  Each binds to a page `state` field
// via `bind:` and renders the app's `<.input>` core component with a
// `phx-change` that writes the new value back to the assign through a hoisted
// `handle_event` clause — the idiomatic LiveView "state-bound input" (the
// server-side analogue of the React controlled-input-over-useState).
//

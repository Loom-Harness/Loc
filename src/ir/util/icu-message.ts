// ---------------------------------------------------------------------------
// ICU messages re-derived from lowered expressions — the one place that turns an
// authored string slot into a catalog message.
//
// A backtick template (`` `Order {order.id}` ``) lowers to a `binary "+"` chain,
// indistinguishable from hand concatenation; `icuFromConcat` re-detects it into
// an ICU message.  `richTextMessage` does the same for a `Text { … }` whose
// children interleave string pieces with inline emphasis (`Bold` / `Italic` /
// `InlineCode`): the whole sentence is ONE message, the emphasis carried as
// `<b>…</b>` / `<i>…</i>` / `<code>…</code>` tags, so a translator can reorder
// the parts.
//
// Pure IR: the generator's extraction pass and emitters, and the IR validator's
// arity gate, all read this — none re-derives the shape.
// ---------------------------------------------------------------------------

import type { ExprIR } from "../types/loom-ir.js";

/** The plain-string value of an expression, or undefined when it is not a
 *  bare string literal (a dynamic ref/expr, or an interpolated `+` chain). */
export function literalString(e: ExprIR | undefined): string | undefined {
  if (e && e.kind === "literal" && e.lit === "string") return e.value;
  return undefined;
}

/** An interpolated user-visible string, re-derived from its lowered `+`-chain.
 *  The two placeholder spaces are deliberate (i18n-strings.md Option B):
 *  `display` is what translators read + what the app emits as the default;
 *  `positional` is the rename-stable hash input. */
export interface IcuMessage {
  /** Named-placeholder ICU for the catalog + emitted default: `"Order {id}"`. */
  display: string;
  /** Positional-normalized form the key is hashed over: `"Order {0}"`. */
  positional: string;
  /** Interpolation holes in source order — the derived placeholder name and the
   *  (string-wrapped) hole expression the React emitter renders into the values
   *  object.  The catalog builder ignores `expr`. */
  holes: { name: string; expr: ExprIR }[];
}

/** Flatten a left-associative string `+`-chain — the exact shape
 *  `lowerTemplateString` folds a template into — back into its ordered operand
 *  pieces (literal segments interleaved with holes). */
function flattenConcatChain(e: ExprIR): ExprIR[] {
  const out: ExprIR[] = [];
  let cur: ExprIR = e;
  while (cur.kind === "binary" && cur.op === "+") {
    out.unshift(cur.right);
    cur = cur.left;
  }
  out.unshift(cur);
  return out;
}

/** Peel a hole's wrapping layers down to the raw value expression, returning
 *  both that expression and a translator-friendly placeholder name.  Layers:
 *  the transparent `i18nFormat` i18n wrapper, the `convert` / `.display`
 *  string-coercion lowering injects for a `string + X` concat, and `paren`.  The
 *  RAW `value` is what the runtime `values` object must carry for a formatted
 *  hole (a number for `, number`, a Date for `, date` — not its stringified
 *  form); `name` is the last path segment (`order.id` → `id`), or undefined for
 *  an unnameable expression (a call / arithmetic). */
function peelHole(expr: ExprIR): { value: ExprIR; name: string | undefined } {
  let e = expr;
  for (;;) {
    if (e.kind === "i18nFormat") e = e.inner;
    else if (e.kind === "convert" && e.target === "string") e = e.value;
    else if (e.kind === "member" && e.member === "display") e = e.receiver;
    else if (e.kind === "paren") e = e.inner;
    else break;
  }
  let name: string | undefined;
  if (e.kind === "member") name = e.member;
  else if (e.kind === "ref") name = e.name;
  else if (e.kind === "id") name = "id";
  else if (e.kind === "method-call") name = e.member;
  return { value: e, name };
}

/** Accumulates one message's two spellings and its holes, piece by piece. */
class MessageBuilder {
  display = "";
  positional = "";
  hasLiteral = false;
  readonly holes: { name: string; expr: ExprIR }[] = [];
  private readonly used = new Map<string, number>();

  /** Append literal text to both spellings. */
  text(value: string): void {
    this.hasLiteral = true;
    this.display += value;
    this.positional += value;
  }

  /** Append markup (a rich-text tag) — not translatable text on its own. */
  tag(markup: string): void {
    this.display += markup;
    this.positional += markup;
  }

  /** Append one `+`-chain operand: a literal segment or an interpolation hole. */
  piece(piece: ExprIR): void {
    const lit = literalString(piece);
    if (lit !== undefined) {
      this.text(lit);
      return;
    }
    const index = this.holes.length;
    // A `, format` suffix rides the transparent `i18nFormat` wrapper.  Splice its
    // RAW ICU text into BOTH placeholders — the positional form is the
    // rename-stable hash input, so a FORMAT change re-keys (a different
    // rendering IS a different message) while a field rename (name → `{0}`)
    // still does not.  The stored `expr` is the PEELED raw value (a number/Date),
    // so the runtime `values` object hands the locale formatter the real value
    // rather than its stringified form.
    const peeled = peelHole(piece);
    const format = piece.kind === "i18nFormat" ? piece.format : "";
    // A format-less hole keeps its stringified concat operand verbatim; a
    // formatted hole carries the peeled raw value.
    const holeExpr = piece.kind === "i18nFormat" ? peeled.value : piece;
    let name = peeled.name ?? `arg${index}`;
    const seen = this.used.get(name);
    if (seen === undefined) this.used.set(name, 1);
    else {
      const n = seen + 1;
      this.used.set(name, n);
      name = `${name}_${n}`;
    }
    this.holes.push({ name, expr: holeExpr });
    this.display += `{${name}${format}}`;
    this.positional += `{${index}${format}}`;
  }

  /** The message, or undefined when it has no translatable text. */
  build(): IcuMessage {
    return { display: this.display, positional: this.positional, holes: this.holes };
  }
}

/** Re-detect an interpolated user-visible string from its lowered `+`-chain.
 *  Returns undefined for anything that isn't `literal-text + hole` interpolation
 *  — a purely numeric `count + 1` (no string segment), a bare `{x}` (no chain),
 *  or a plain literal — so those keep their existing (raw / plain-literal) path.
 *  Shared by the catalog builder and every emitter so the emitted key + default
 *  line up with the catalog entry. */
export function icuFromConcat(expr: ExprIR | undefined): IcuMessage | undefined {
  if (expr?.kind !== "binary" || expr.op !== "+") return undefined;
  const builder = new MessageBuilder();
  for (const piece of flattenConcatChain(expr)) builder.piece(piece);
  // Needs both translatable text and at least one hole to be a message.
  if (!builder.hasLiteral || builder.holes.length === 0) return undefined;
  return builder.build();
}

// ---------------------------------------------------------------------------
// Rich text — one sentence with inline emphasis.
// ---------------------------------------------------------------------------

/** The inline-emphasis primitives a rich `Text` may carry, and the tag each
 *  becomes in the message. */
export const RICH_TEXT_TAGS: Readonly<Record<string, "b" | "i" | "code">> = {
  Bold: "b",
  Italic: "i",
  InlineCode: "code",
};

type CallIR = Extract<ExprIR, { kind: "call" }>;

/** The value kinds that stand alone as an interpolation hole. */
const HOLE_KINDS: ReadonlySet<ExprIR["kind"]> = new Set<ExprIR["kind"]>([
  "ref",
  "id",
  "member",
  "convert",
  "i18nFormat",
  "paren",
]);

function positionalOf(call: CallIR): ExprIR[] {
  return call.args.filter((_, i) => !call.argNames?.[i]);
}

/** Append one child of a rich `Text` (or of an emphasis span inside it).  False
 *  when the child is not inline text — a block primitive, a state read — so the
 *  caller keeps the ordinary slot behaviour. */
function addRichChild(builder: MessageBuilder, child: ExprIR): boolean {
  if (child.kind === "call" && child.callKind === "free") {
    const tag = RICH_TEXT_TAGS[child.name];
    if (tag === undefined || (child.argNames ?? []).some((n) => n)) return false;
    const inner = positionalOf(child);
    if (inner.length === 0) return false;
    builder.tag(`<${tag}>`);
    for (const c of inner) if (!addRichChild(builder, c)) return false;
    builder.tag(`</${tag}>`);
    return true;
  }
  if (child.kind === "binary" && child.op === "+") {
    for (const piece of flattenConcatChain(child)) builder.piece(piece);
    return true;
  }
  // A literal segment, or a lone interpolation hole (`` `{name}` `` lowers to the
  // bare value, with no `+` to chain it).
  if (literalString(child) !== undefined || HOLE_KINDS.has(child.kind)) {
    builder.piece(child);
    return true;
  }
  return false;
}

/** The whole-sentence message of a `Text { "Read the ", Bold { "terms" }, " first" }`
 *  — the positional children read as ONE message with the emphasis as
 *  `<b>…</b>` tags (`"Read the <b>terms</b> first"`), or undefined when the call
 *  is not rich text: a single child, or a child that is not inline text.
 *
 *  A single-child `Text` keeps the ordinary slot path; rich text begins at the
 *  second child, which is exactly where a slot primitive has no place for it. */
export function richTextMessage(call: CallIR): IcuMessage | undefined {
  if (call.callKind !== "free" || call.name !== "Text") return undefined;
  const children = positionalOf(call);
  if (children.length < 2) return undefined;
  const builder = new MessageBuilder();
  for (const child of children) if (!addRichChild(builder, child)) return undefined;
  if (!builder.hasLiteral) return undefined;
  return builder.build();
}

/** Every inline-emphasis call a rich `Text` consumed into its message — the
 *  extraction pass skips them, because their text lives in the sentence and not
 *  under a slot key of its own. */
export function richTextEmphasisCalls(call: CallIR): CallIR[] {
  const out: CallIR[] = [];
  const visit = (c: ExprIR): void => {
    if (c.kind !== "call" || RICH_TEXT_TAGS[c.name] === undefined) return;
    out.push(c);
    for (const inner of positionalOf(c)) visit(inner);
  };
  for (const child of positionalOf(call)) visit(child);
  return out;
}

// CodeBlock primitive — syntax-highlighted code via highlight.js CDN.
//
//   CodeBlock {
//     "aggregate Order {\n  customerId: string\n}",   // positional source
//     language: "typescript",
//     title:    "orders.ddd"                          // optional title
//   }
//
//   // Equivalent — named-arg shape:
//   CodeBlock { source: "...", language: "typescript" }
//
// Both shapes are admissible.  The Phoenix backend accepts the
// positional form (see `renderCodeBlock` in
// `src/generator/elixir/heex-walker.ts:1660+`), and the
// React emitter mirrors that surface — a positional first arg wins
// over a missing `source:` named arg.  Without this, a write like
// `CodeBlock { "x", language: "ts" }` silently emitted an empty
// `<code></code>` (the same source compiled on Phoenix).
//
// Renders to a `<pre><code class="language-...">...</code></pre>`
// block.  Highlighting it is the emitted `src/lib/highlight.ts`
// module's job: a VENDORED `highlight.js` (the 36-language
// `lib/common` bundle — no CDN, so the app builds and runs
// air-gapped), pulled in only when at least one page or component on
// the deployable uses CodeBlock.  Every frontend orchestrator decides
// that with `uiUsesCodeBlock` (`src/ir/util/code-block.ts`), the same
// detect-once gate `decimal.js` rides via `usesMoney`; `ctx.usesCodeBlock`
// below is the walker-local twin the page shells read.  A `language:`
// outside the bundled set renders as plain text.
//
// The `source` string is rendered as JSX text inside the `<code>`
// element, so JSX-significant punctuation must be HTML-entity-escaped.
// `escapeJsxText` now handles `&` / `{` / `}` / `<` / `>` for exactly
// this case — arbitrary code text round-trips cleanly.

import type { ExprIR } from "../../../ir/types/loom-ir.js";
import { localizedNamedText } from "../i18n-emit.js";
import { renderPrimitive } from "../render-primitive.js";
import { firstPositionalText, namedArgValue, stringNamed } from "../shared/args.js";
import type { WalkContext } from "../walker-core.js";
import { testidAttr } from "../walker-core.js";

export function emitCodeBlock(
  call: ExprIR & { kind: "call" },
  ctx: WalkContext,
  depth: number,
): string {
  void depth;
  const language = stringNamed(call, "language") ?? "plaintext";
  // `source:` named arg wins when present; otherwise fall back to the
  // first positional string literal so the Phoenix-style call shape
  // (`CodeBlock { "...code...", language: "ts" }`) emits the same code.
  const sourceRaw = stringNamed(call, "source") ?? firstPositionalText(call) ?? "";
  // The caption is authored prose a reader reads ("orders.ddd", "Request body"),
  // so it is a user-visible slot (`codeBlockTitle`) — a plain literal rides the
  // translation runtime under i18n, and everything else stays byte-identical.
  // The code SOURCE below deliberately is NOT one: translating code breaks it.
  const hasTitle = namedArgValue(call, "title") !== undefined;
  const titleText = hasTitle
    ? localizedNamedText(call, ctx, "codeBlockTitle", "title", '""')
    : undefined;
  // Flag the shell so it injects highlight.js once across the
  // deployable.  Pages without CodeBlock skip the CDN payload.
  ctx.usesCodeBlock = true;
  // The `<code>` block holds raw source — JSX-escape every
  // significant character so a `>` arrow, `{` brace, or `&` in the
  // code text doesn't open a JSX expression / tag at render time.
  const source = ctx.target.escapeText(sourceRaw);
  return renderPrimitive(ctx, "primitive-code-block", {
    language,
    source,
    titleText,
    hasTitle,
    testidAttr: testidAttr(call, ctx),
  });
}

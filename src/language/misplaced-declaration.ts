// ---------------------------------------------------------------------------
// Phase ① parse-error rewrite — a declaration written in the WRONG SCOPE.
//
// Loom's declarations each live at one nesting level: `migration` at the top
// of the file, `deployable` / `storage` / `ui` in a `system`, `aggregate` /
// `repository` / `enum` in a `context`, `operation` / `invariant` in an
// `aggregate`.  Write one a level off and the enclosing block's member
// repetition simply exits, so chevrotain reports the word against whatever
// closes the block:
//
//     system Library {
//       migration "x" { Task.done = false }
//     main.ddd:54:3 error: Expecting token of type '}' but found `migration`.
//
// That reads as an unbalanced brace.  The braces are fine; the declaration is
// one scope off, and the error never says which scope it wanted.
//
// `misplacedDeclaration` recognises the shape and says it.  Both halves are
// DERIVED, never hand-listed:
//
//   * WHICH KEYWORDS HEAD A DECLARATION WHERE — the FIRST-keyword set of each
//     scope's member rules (`ModelMember`, `SystemMember`, `ContextMember`, …),
//     computed off the loaded grammar by Langium reflection.  A new member
//     added to the grammar is covered the moment it parses.
//   * WHICH SCOPE THE FAILURE IS IN — the open `{` blocks before the failing
//     token, read off the source text (strings and comments skipped).
//
// It only ever REPLACES a message, never invents one: the failing word has to
// head a member of some OTHER scope and of NOT the one it sits in, at the
// start of a line (or right after a brace), inside a recognised scope block.
// Anything else returns `undefined` and the caller keeps chevrotain's text.
//
// Layering: `src/language/` (phase ①), called by `ddd-document-validator.ts`
// beside the other rewrites in `parse-errors.ts`.  Node-free.
// ---------------------------------------------------------------------------

import type { IRecognitionException } from "chevrotain";
import { AstUtils, type Grammar, GrammarAST, GrammarUtils } from "langium";
import { diagMessage } from "../diagnostics/messages.js";
import { DddGrammar } from "./generated/grammar.js";

/** The nesting levels a declaration can belong to.  `top` is the file root. */
export type DeclarationScope = "top" | "system" | "subdomain" | "context" | "aggregate";

/** Each scope's grammar rule — the members it admits are its `+=` assignments.
 *  `top` is the entry rule (`imports` + `members`). */
const SCOPE_RULES: Record<DeclarationScope, string> = {
  top: "Model",
  system: "System",
  subdomain: "Subdomain",
  context: "BoundedContext",
  aggregate: "Aggregate",
};

/** Grammar order, outermost first — the order a message lists valid scopes in. */
const SCOPE_ORDER: readonly DeclarationScope[] = [
  "top",
  "system",
  "subdomain",
  "context",
  "aggregate",
];

/** The FIRST-keyword set of a grammar element, and whether it can match the
 *  empty string (so the element after it contributes too). */
interface First {
  keywords: Set<string>;
  nullable: boolean;
}

/**
 * The keywords a grammar element can START with.
 *
 * Name-shaped positions (data-type rules such as `LooseName`, terminals,
 * cross-references) contribute NOTHING: a declaration "headed" by a name is a
 * field, and every soft keyword is a legal field name — counting them would
 * make every word valid in every member position and the whole check moot.
 */
function firstOf(el: GrammarAST.AbstractElement, visiting: Set<GrammarAST.ParserRule>): First {
  const optional = GrammarUtils.isOptionalCardinality(el.cardinality, el);
  const inner = firstOfInner(el, visiting);
  return optional ? { keywords: inner.keywords, nullable: true } : inner;
}

function firstOfInner(el: GrammarAST.AbstractElement, visiting: Set<GrammarAST.ParserRule>): First {
  if (GrammarAST.isKeyword(el)) return { keywords: new Set([el.value]), nullable: false };
  if (GrammarAST.isAction(el)) return { keywords: new Set(), nullable: true };
  if (GrammarAST.isAssignment(el)) return firstOf(el.terminal, visiting);
  if (GrammarAST.isRuleCall(el)) {
    const rule = el.rule.ref;
    if (!GrammarAST.isParserRule(rule) || GrammarUtils.isDataTypeRule(rule) || visiting.has(rule)) {
      return { keywords: new Set(), nullable: false };
    }
    visiting.add(rule);
    try {
      return firstOf(rule.definition, visiting);
    } finally {
      visiting.delete(rule);
    }
  }
  if (GrammarAST.isAlternatives(el) || GrammarAST.isUnorderedGroup(el)) {
    const keywords = new Set<string>();
    let nullable = false;
    for (const alt of el.elements) {
      const f = firstOf(alt, visiting);
      for (const k of f.keywords) keywords.add(k);
      nullable ||= f.nullable;
    }
    return { keywords, nullable };
  }
  if (GrammarAST.isGroup(el)) {
    const keywords = new Set<string>();
    for (const part of el.elements) {
      const f = firstOf(part, visiting);
      for (const k of f.keywords) keywords.add(k);
      if (!f.nullable) return { keywords, nullable: false };
    }
    return { keywords, nullable: true };
  }
  // Cross-references and anything else name-shaped.
  return { keywords: new Set(), nullable: false };
}

/** The word keywords that head a member of `scope`, read off the `+=`
 *  assignments of the scope's grammar rule. */
function memberHeads(grammar: Grammar, scope: DeclarationScope): Set<string> {
  const rule = grammar.rules.find(
    (r): r is GrammarAST.ParserRule => GrammarAST.isParserRule(r) && r.name === SCOPE_RULES[scope],
  );
  const heads = new Set<string>();
  if (!rule) return heads;
  for (const a of AstUtils.streamAllContents(rule)) {
    if (!GrammarAST.isAssignment(a) || a.operator !== "+=") continue;
    for (const k of firstOf(a.terminal, new Set()).keywords) {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) heads.add(k);
    }
  }
  return heads;
}

const HEADS: Readonly<Record<DeclarationScope, ReadonlySet<string>>> = (() => {
  const grammar = DddGrammar();
  const out = {} as Record<DeclarationScope, ReadonlySet<string>>;
  for (const scope of SCOPE_ORDER) out[scope] = memberHeads(grammar, scope);
  return out;
})();

/** The scopes in which `keyword` heads a declaration, outermost first.
 *  Exported for the tests that pin the derivation. */
export function scopesDeclaring(keyword: string): DeclarationScope[] {
  return SCOPE_ORDER.filter((s) => HEADS[s].has(keyword));
}

// ---------------------------------------------------------------------------
// Which scope a source offset sits in.
// ---------------------------------------------------------------------------

/** One open `{` on the way to the failing token. */
interface OpenBlock {
  /** The scope this block opens, or `undefined` for any other block (a
   *  `deployable { … }`, an operation body, …). */
  scope: DeclarationScope | undefined;
  /** The block's header as written, whitespace-collapsed — `system Library`. */
  header: string;
}

const SCOPE_HEADER =
  /(?:^|[\s;])(?:abstract\s+)?(system|subdomain|context|aggregate)\s+[A-Za-z_][A-Za-z0-9_]*\b[^{}]*$/;

/** What a block header opens.  The header is the text between the previous
 *  brace and this one; a scope header is its LAST `<scope-kw> <Name> …` run
 *  (fields declared before an `aggregate` sit in the same span). */
function classifyHeader(raw: string): OpenBlock {
  const m = SCOPE_HEADER.exec(raw);
  if (!m) return { scope: undefined, header: raw.trim().replace(/\s+/g, " ") };
  const header = raw
    .slice(m.index + (m[0].length - m[0].trimStart().length))
    .trim()
    .replace(/\s+/g, " ");
  const kw = m[1] as Exclude<DeclarationScope, "top">;
  return { scope: kw, header };
}

/** The `{` blocks still open at `offset`, outermost first.  Strings and
 *  comments are skipped so a brace inside either is not structure. */
function openBlocksAt(text: string, offset: number): OpenBlock[] {
  const stack: OpenBlock[] = [];
  let segmentStart = 0;
  let i = 0;
  while (i < offset) {
    const c = text[i]!;
    if (c === "/" && text[i + 1] === "/") {
      while (i < offset && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? offset : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < offset && text[i] !== c) i += text[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (c === "{") {
      stack.push(classifyHeader(stripComments(text.slice(segmentStart, i))));
      segmentStart = i + 1;
    } else if (c === "}") {
      stack.pop();
      segmentStart = i + 1;
    }
    i++;
  }
  return stack;
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

// ---------------------------------------------------------------------------
// The rewrite.
// ---------------------------------------------------------------------------

/** A rewritten parse failure — same contract as `RefinedParseError` in
 *  `parse-errors.ts`. */
export interface MisplacedDeclaration {
  offset: number;
  length: number;
  message: string;
}

const WORD = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The declaration keyword the failure is about, and where it starts — or
 *  `undefined` when the failure is not a declaration head at all.
 *
 *  Two shapes.  A HARD keyword the scope does not admit fails ON the keyword
 *  (`Expecting '}' but found 'migration'`).  A SOFT one is first read as a
 *  field name, so the failure lands one token later, on what follows it —
 *  `valueobject Money { … }` in an aggregate fails on `Money` expecting `:`.
 *  In that case the keyword is the first word on the line and the cause, so
 *  the diagnostic moves back onto it. */
function declarationHead(
  err: IRecognitionException,
  text: string,
): { word: string; offset: number } | undefined {
  const token = err.token;
  if (!token || Number.isNaN(token.startOffset)) return undefined;
  const lineStart = text.lastIndexOf("\n", token.startOffset - 1) + 1;
  const before = text.slice(lineStart, token.startOffset);
  // Hard shape: the failing token IS the word, and it starts a member — the
  // first thing on its line, or straight after a brace / `;`.
  if (WORD.test(token.image) && /(?:^|[{};])\s*$/.test(before)) {
    return { word: token.image, offset: token.startOffset };
  }
  // Soft shape: `<keyword> <next>` with the parser wanting the field's `:`.
  if (!err.message.startsWith("Expecting token of type ':'")) return undefined;
  const m = /^(\s*(?:[{};]\s*)?)([A-Za-z_][A-Za-z0-9_]*)\s+$/.exec(before);
  if (!m?.[2]) return undefined;
  return { word: m[2], offset: lineStart + m[1]!.length };
}

const SCOPE_PHRASE: Record<DeclarationScope, string> = {
  top: "at the top level of the file",
  system: "inside `system { … }`",
  subdomain: "inside `subdomain { … }`",
  context: "inside `context { … }`",
  aggregate: "inside `aggregate { … }`",
};

function joinOr(items: string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/**
 * A declaration keyword written in a scope that does not admit it — say which
 * scope does, and how to get it there.  `undefined` for every other failure.
 */
export function misplacedDeclaration(
  err: IRecognitionException,
  text: string,
): MisplacedDeclaration | undefined {
  const head = declarationHead(err, text);
  if (!head) return undefined;
  const open = openBlocksAt(text, head.offset);
  const here = open.length === 0 ? "top" : open[open.length - 1]!.scope;
  // Inside a block that is not a scope (a deployable body, an operation body)
  // the member grammar is something else entirely — not this diagnosis.
  if (!here) return undefined;
  if (HEADS[here].has(head.word)) return undefined;
  const valid = scopesDeclaring(head.word);
  if (valid.length === 0) return undefined;

  const innermost = open[open.length - 1];
  const where = joinOr(valid.map((s) => SCOPE_PHRASE[s]));
  const notHere = innermost
    ? `, not inside \`${innermost.header} { … }\``
    : ", not at the top level of the file";

  // The nearest ENCLOSING block (or the file root) that admits the word: the
  // fix is to move it out to there.  Otherwise it needs a block it has not got.
  let remedy: string;
  const outIdx = [...open.keys()]
    .reverse()
    .find((i) => i < open.length - 1 && valid.includes(open[i]!.scope!));
  if (innermost && outIdx !== undefined) {
    remedy = `move it out of \`${innermost.header} { … }\` into the enclosing \`${open[outIdx]!.header} { … }\``;
  } else if (innermost && valid.includes("top")) {
    remedy = `move it above \`${open[0]!.header} {\``;
  } else {
    const target = valid.find((s) => s !== "top")!;
    remedy = `put it in ${/^[aeiou]/.test(target) ? "an" : "a"} \`${target} <Name> { … }\` block`;
  }
  return {
    offset: head.offset,
    length: head.word.length,
    message: diagMessage("loom.parse-error#misplaced-declaration", {
      keyword: head.word,
      where,
      notHere,
      remedy,
    }),
  };
}

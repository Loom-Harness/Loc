// ---------------------------------------------------------------------------
// The soft-keyword sets, derived from the grammar rather than restated.
//
// `docs/language.md` promises that everything acting as a keyword *somewhere*
// is soft — "reserved only where its own rule begins, and admitted as an
// ordinary identifier elsewhere".  Two rules implement "elsewhere", and they
// are NOT the same set:
//
//   * `LooseName`     — a name being DECLARED (a parameter, an object-field
//                       key, a call-arg label).
//   * `NameRefIdent`  — a name being READ (a bare `NameRef` in an expression).
//
// A keyword in the first but not the second can be declared and then never
// mentioned again:
//
//     criterion InWindow(from: datetime) of A = startAt >= from
//     ...:6:56 error: Unexpected 'from'. Expected one of: '!', '-', …(+120 more).
//
// The DECLARATION is accepted; only the USE is refused, with an alternation
// dump that never says `from` is a keyword.  `to` in the same position works,
// so there is no rule to learn — you discover the set one name at a time.
//
// Closing the asymmetry is a grammar change (and a parser regeneration); what
// this module buys is the ability to SAY it, precisely, at the point of
// failure.  Reading both lists off the loaded grammar keeps that message true
// as either list moves — a restated copy would drift, and the drift would only
// ever show up in an error message nobody tests.
// ---------------------------------------------------------------------------

import { AstUtils, type Grammar, GrammarAST } from "langium";
import { DddGrammar } from "./generated/grammar.js";

/** Keywords a rule admits as an ordinary identifier, including those it
 *  inherits by referencing another rule (`LooseName` pulls in
 *  `CommonSoftKeywords`). */
function keywordsOf(grammar: Grammar, ruleName: string, seen = new Set<string>()): Set<string> {
  const out = new Set<string>();
  if (seen.has(ruleName)) return out;
  seen.add(ruleName);
  const rule = grammar.rules.find(
    (r): r is GrammarAST.ParserRule => GrammarAST.isParserRule(r) && r.name === ruleName,
  );
  if (!rule) return out;
  for (const node of AstUtils.streamAllContents(rule)) {
    if (GrammarAST.isKeyword(node)) out.add(node.value);
    else if (GrammarAST.isRuleCall(node)) {
      const target = node.rule.ref?.name;
      if (target) for (const k of keywordsOf(grammar, target, seen)) out.add(k);
    }
  }
  return out;
}

/** Keywords accepted where a name is DECLARED but refused where one is READ —
 *  the set a user can name a parameter after and then be unable to mention.
 *  Sorted, so a message that lists them is stable.
 *
 *  Computed once at import as a `const`, not memoised into a module-level
 *  `let`: the grammar is immutable, and a mutable module global is an
 *  order-dependent failure under `isolate: false`
 *  (`module-global-state-census.test.ts`). */
export function declareOnlySoftKeywords(): readonly string[] {
  return DECLARE_ONLY;
}

/** True when `word` can be a declaration name but not a reference — i.e. the
 *  author's parameter really is unreachable, rather than the word being
 *  reserved everywhere. */
export function isDeclareOnlySoftKeyword(word: string): boolean {
  return DECLARE_ONLY_SET.has(word);
}

const DECLARE_ONLY: readonly string[] = (() => {
  const grammar = DddGrammar();
  const declare = keywordsOf(grammar, "LooseName");
  const read = keywordsOf(grammar, "NameRefIdent");
  // A keyword with its OWN expression rule is readable after all — just as
  // something other than the author's binding.  `id` is the one: `IdRef`
  // (`{infer IdRef} 'id'`) is an expression atom, so `criterion C(id: X id)
  // … = this.x == id` PARSES and resolves `id` to the aggregate's own id
  // instead of the parameter.  That is a real defect, and a different one —
  // a silent wrong binding rather than a refusal — so this set, whose whole
  // claim is "declared and then unmentionable", must not include it or the
  // message would assert something untrue.
  const ownExpressionRule = keywordsOf(grammar, "IdRef");
  return [...declare]
    .filter((k) => !read.has(k) && !ownExpressionRule.has(k))
    .sort((a, b) => a.localeCompare(b));
})();

const DECLARE_ONLY_SET: ReadonlySet<string> = new Set(DECLARE_ONLY);

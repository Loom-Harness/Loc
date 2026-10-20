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

import { AstUtils, type Grammar, GrammarAST, GrammarUtils } from "langium";
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

/** True when `word` is admissible as a declared FIELD name (`PropertyName`).
 *  A keyword that is NOT is reserved in that position, so a `word:` written
 *  where a field was being declared is the reserved-name mistake — never a
 *  missing brace or a typo, which is what the parser's own wording implies. */
export function isFieldNameKeyword(word: string): boolean {
  return FIELD_NAME_SET.has(word);
}

const FIELD_NAME_SET: ReadonlySet<string> = keywordsOf(DddGrammar(), "PropertyName");

/** True when `word` is one of the grammar's word-shaped keyword literals. */
export function isGrammarKeyword(word: string): boolean {
  return GRAMMAR_KEYWORDS.has(word);
}

const GRAMMAR_KEYWORDS: ReadonlySet<string> = new Set(
  AstUtils.streamAllContents(DddGrammar())
    .filter(GrammarAST.isKeyword)
    .map((k) => k.value)
    .filter((v) => /^[A-Za-z_]\w*$/.test(v)),
);

/** The word keywords that CANNOT be a declared field name — the short hard
 *  list the reserved-keyword sweep left (every other keyword is soft by
 *  default; the reasons are in the comment above `CommonSoftKeywords` in
 *  `ddd.langium`).  Sorted, so the doc that lists them and the test that pins
 *  that doc are stable. */
export function reservedFieldNameKeywords(): readonly string[] {
  return RESERVED_FIELD_NAMES;
}

const RESERVED_FIELD_NAMES: readonly string[] = [...GRAMMAR_KEYWORDS]
  .filter((k) => !FIELD_NAME_SET.has(k))
  .sort((a, b) => a.localeCompare(b));

/** True when `word` is a `CommonSoftKeywords` member — admissible as an
 *  ordinary name in every value position, so wherever the parser would also
 *  accept an `ID` it is just another spelling of "a name". */
export function isSoftKeyword(word: string): boolean {
  return COMMON_SOFT.has(word);
}

const COMMON_SOFT: ReadonlySet<string> = keywordsOf(DddGrammar(), "CommonSoftKeywords");

// ---------------------------------------------------------------------------
// Keywords that are NAMES — and only names — inside a given rule.
//
// Every name rule (`LooseName`, `NameRefIdent`, `PropertyName`, `MemberName`,
// `LValueIdent`, …) is `ID | CommonSoftKeywords` plus a few extras of its own
// (`NameRefIdent` adds `contains`/`create`/`destroy`/`ignoring`/`page`).  When
// a syntax error lands where such a rule could start, chevrotain lists every
// one of those words as an expected token — and the extras are NOT in
// `CommonSoftKeywords`, so a filter that only knows the shared set lets them
// lead the message:
//
//     for channel in [1, 2] {
//     Unexpected '['. Expected one of: 'contains', 'create', 'destroy', 'ignoring', 'page' (+1 more).
//
// None of those is an alternative the author was choosing between; they are
// five more spellings of the `<ID>` already in the list.
//
// Which extras are "just a name" depends on WHERE the parser failed, and
// chevrotain says only which rule the failing alternation belongs to.  So per
// rule we split the keywords that can START any element of its body into two
// sets: those reachable only through a name rule, and those reachable as
// syntax (a keyword literal of the rule itself, or of a non-name rule it
// calls).  A keyword in the first set and not the second can only be a name
// anywhere in that rule — hiding it can never hide a structural alternative.
// In `AggregateMember`, `contains` heads a member of its own, so it stays in
// the list; `ignoring` is only ever a field name there, so it goes.
// ---------------------------------------------------------------------------

/** The first-token keywords of a grammar element, split by how they arrive. */
interface FirstKeywords {
  /** Reached only by way of a name rule — a spelling of `<ID>`. */
  readonly name: ReadonlySet<string>;
  /** Reached as syntax: a keyword literal outside every name rule. */
  readonly syntax: ReadonlySet<string>;
  /** The element can match nothing, so what follows it can start too. */
  readonly nullable: boolean;
}

/** The single-token choices of a datatype rule that is nothing but a flat
 *  alternation (`'a' | 'b' | OtherRule | ID`), flattened through the parser
 *  rules it calls; `undefined` when the rule has any other shape — a sequence,
 *  a repetition, an assignment — since then its keywords are not all one-token
 *  spellings of the same thing (`QualifiedName`'s `.` is syntax). */
function flatChoices(
  rule: GrammarAST.ParserRule,
  seen = new Set<string>(),
): Set<string> | undefined {
  if (seen.has(rule.name)) return new Set();
  seen.add(rule.name);
  if (!GrammarUtils.isDataTypeRule(rule)) return undefined;
  const def = rule.definition;
  const arms = GrammarAST.isAlternatives(def) ? def.elements : [def];
  const out = new Set<string>();
  for (const arm of arms) {
    if (arm.cardinality) return undefined;
    if (GrammarAST.isKeyword(arm)) out.add(arm.value);
    else if (GrammarAST.isRuleCall(arm) && arm.rule.ref) {
      const callee = arm.rule.ref;
      if (GrammarAST.isTerminalRule(callee)) out.add(callee.name);
      else if (GrammarAST.isParserRule(callee)) {
        const inner = flatChoices(callee, seen);
        if (!inner) return undefined;
        for (const k of inner) out.add(k);
      } else return undefined;
    } else return undefined;
  }
  return out;
}

/** True for the shape of every "a name goes here" rule (`LooseName`,
 *  `NameRefIdent`, `MacroArgName`, …): a flat alternation that admits `ID`
 *  and the whole shared soft-keyword set.  Read off the grammar so a new name
 *  rule is picked up without a list to maintain. */
function isNameRule(rule: GrammarAST.ParserRule): boolean {
  if (rule.name === "CommonSoftKeywords") return true;
  const choices = flatChoices(rule);
  return !!choices && choices.has("ID") && [...COMMON_SOFT].every((k) => choices.has(k));
}

/** Per parser rule, the keywords that are only ever a NAME at the start of any
 *  of its elements.  Built once from the immutable grammar. */
const NAME_ONLY_BY_RULE: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const grammar = DddGrammar();
  const EMPTY: FirstKeywords = { name: new Set(), syntax: new Set(), nullable: false };
  const NULLABLE: FirstKeywords = { name: new Set(), syntax: new Set(), nullable: true };
  const nameRules = new Set(
    grammar.rules
      .filter((r): r is GrammarAST.ParserRule => GrammarAST.isParserRule(r))
      .filter(isNameRule)
      .map((r) => r.name),
  );
  const ruleFirst = new Map<string, FirstKeywords>();
  const inProgress = new Set<string>();

  const union = (parts: FirstKeywords[], nullable: boolean): FirstKeywords => ({
    name: new Set(parts.flatMap((p) => [...p.name])),
    syntax: new Set(parts.flatMap((p) => [...p.syntax])),
    nullable,
  });
  const optional = (f: FirstKeywords, el: GrammarAST.AbstractElement): FirstKeywords =>
    el.cardinality === "?" || el.cardinality === "*" ? { ...f, nullable: true } : f;

  const firstOfRule = (rule: GrammarAST.AbstractRule): FirstKeywords => {
    if (!GrammarAST.isParserRule(rule)) return EMPTY; // a terminal: never a keyword token
    const cached = ruleFirst.get(rule.name);
    if (cached) return cached;
    // A rule reached again through its own nullable prefix adds nothing new.
    if (inProgress.has(rule.name)) return EMPTY;
    inProgress.add(rule.name);
    const inner = firstOf(rule.definition);
    inProgress.delete(rule.name);
    const result = nameRules.has(rule.name)
      ? {
          name: new Set([...inner.name, ...inner.syntax]),
          syntax: new Set<string>(),
          nullable: inner.nullable,
        }
      : inner;
    ruleFirst.set(rule.name, result);
    return result;
  };

  const firstOf = (el: GrammarAST.AbstractElement): FirstKeywords => {
    let f: FirstKeywords;
    if (GrammarAST.isKeyword(el))
      f = { name: new Set(), syntax: new Set([el.value]), nullable: false };
    else if (GrammarAST.isRuleCall(el)) f = el.rule.ref ? firstOfRule(el.rule.ref) : EMPTY;
    else if (GrammarAST.isAssignment(el)) f = firstOf(el.terminal);
    else if (GrammarAST.isCrossReference(el)) f = el.terminal ? firstOf(el.terminal) : EMPTY;
    else if (GrammarAST.isAction(el)) f = NULLABLE;
    else if (GrammarAST.isAlternatives(el) || GrammarAST.isUnorderedGroup(el)) {
      const parts = el.elements.map(firstOf);
      f = union(
        parts,
        parts.some((p) => p.nullable),
      );
    } else if (GrammarAST.isGroup(el)) {
      const parts: FirstKeywords[] = [];
      let nullable = true;
      for (const child of el.elements) {
        const c = firstOf(child);
        parts.push(c);
        if (!c.nullable) {
          nullable = false;
          break;
        }
      }
      f = union(parts, nullable);
    } else {
      // An element kind this analysis does not model: count every keyword in
      // it as syntax, so the filter errs toward SHOWING a candidate.
      const words = AstUtils.streamAllContents(el)
        .filter(GrammarAST.isKeyword)
        .map((k) => k.value);
      f = { name: new Set(), syntax: new Set(words), nullable: true };
    }
    return optional(f, el);
  };

  const parserRules = grammar.rules.filter((r): r is GrammarAST.ParserRule =>
    GrammarAST.isParserRule(r),
  );
  const split = new Map<string, { name: Set<string>; syntax: Set<string> }>();
  const callers = new Map<string, Set<string>>();
  for (const rule of parserRules) {
    const name = new Set<string>();
    const syntax = new Set<string>();
    // Every element of the body, not just its start: the failing alternation
    // can sit anywhere in the rule, and chevrotain reports only the rule.
    for (const el of [rule.definition, ...AstUtils.streamAllContents(rule.definition)]) {
      if (!GrammarAST.isAbstractElement(el)) continue;
      const f = firstOf(el);
      for (const k of f.name) name.add(k);
      for (const k of f.syntax) syntax.add(k);
      if (GrammarAST.isRuleCall(el) && el.rule.ref) {
        const callee = el.rule.ref.name;
        if (!callers.has(callee)) callers.set(callee, new Set());
        callers.get(callee)?.add(rule.name);
      }
    }
    if (nameRules.has(rule.name)) {
      // Inside a name rule every keyword literal IS a name spelling.
      for (const k of syntax) name.add(k);
      syntax.clear();
    }
    split.set(rule.name, { name, syntax });
  }

  const out = new Map<string, ReadonlySet<string>>();
  for (const rule of parserRules) {
    const own = split.get(rule.name);
    if (!own) continue;
    const syntax = new Set(own.syntax);
    // An alternation with an empty arm looks past the end of its rule, so its
    // expected tokens can include what a CALLER puts next — syntax there, not a
    // name.  A name rule is a flat, non-empty choice and never does this; any
    // other rule also counts its callers' syntax, so such a word stays listed.
    if (!nameRules.has(rule.name)) {
      for (const caller of callers.get(rule.name) ?? []) {
        for (const k of split.get(caller)?.syntax ?? []) syntax.add(k);
      }
    }
    out.set(rule.name, new Set([...own.name].filter((k) => !syntax.has(k))));
  }
  return out;
})();

/** True when `word`, among the tokens expected inside `ruleName`, can only be
 *  an identifier — every way it starts an element of that rule is through a
 *  name rule.  The candidate list of a parse error drops such words: `<ID>`
 *  already stands for them, and listing them buries the real alternatives. */
export function isNameOnlyKeywordIn(ruleName: string, word: string): boolean {
  return NAME_ONLY_BY_RULE.get(ruleName)?.has(word) ?? false;
}

// ---------------------------------------------------------------------------
// The FIELD-TYPE catalogue, derived from the grammar rather than restated.
//
// `PrimitiveType` is a keyword alternation in `ddd.langium`, so a name that is
// not one of its keywords falls through to `NamedType` and becomes a
// `[NamedDecl:ID]` cross-reference — which means a mistyped or non-existent
// type does not fail as "unknown type", it fails as an unresolved REFERENCE.
// The message that produces is Langium-internal ("Could not resolve reference
// to NamedDecl named 'duration'.") and says nothing a user of the language can
// act on: not that `duration` is a type position, not which types exist, not
// that a cross-aggregate link is spelled `X id`.
//
// Reading the keywords off the loaded grammar (instead of hard-coding them
// beside it) is what keeps the message true after the next primitive is added:
// a restated list would drift silently, and the drift would only ever show up
// in an error message nobody tests.
// ---------------------------------------------------------------------------

import { AstUtils, type Grammar, GrammarAST } from "langium";
import { DddGrammar } from "./generated/grammar.js";

/** Every primitive field-type keyword the grammar accepts, sorted.
 *
 *  Computed once at import as a `const`, not memoised into a module-level
 *  `let`: the grammar is immutable, so there is nothing to invalidate, and a
 *  mutable module global would be an order-dependent failure waiting to happen
 *  under `isolate: false` (`module-global-state-census.test.ts`).
 *  `DddGrammar()` does its own lazy load, so this costs one call. */
export function primitiveTypeNames(): readonly string[] {
  return PRIMITIVE_TYPE_NAMES;
}

const PRIMITIVE_TYPE_NAMES: readonly string[] = collect(DddGrammar());

function collect(grammar: Grammar): readonly string[] {
  const rule = grammar.rules.find(
    (r): r is GrammarAST.ParserRule => GrammarAST.isParserRule(r) && r.name === "PrimitiveType",
  );
  const names = new Set<string>();
  if (rule) {
    for (const node of AstUtils.streamAllContents(rule)) {
      if (GrammarAST.isKeyword(node)) names.add(node.value);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Levenshtein distance, iterative two-row form (the shape
 *  `validators/names.ts` already uses for its "did you mean" hint). */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let cur = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n]!;
}

/** Nearest candidate within a small edit distance, or undefined.  Same
 *  threshold as the expression-scope hint — `min(2, floor(len/2))` — so a
 *  three-letter stub cannot "suggest" an unrelated three-letter type. */
export function nearestType(name: string, candidates: Iterable<string>): string | undefined {
  const max = Math.min(2, Math.floor(name.length / 2));
  if (max < 1) return undefined;
  let best: string | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const cand of candidates) {
    if (cand === name || cand.length < 3) continue;
    const d = levenshtein(name, cand);
    if (d < bestDist && d <= max) {
      bestDist = d;
      best = cand;
    }
  }
  return best;
}

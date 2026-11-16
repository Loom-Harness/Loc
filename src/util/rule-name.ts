// ---------------------------------------------------------------------------
// The rule name a `message "…"` clause migrates to.
//
// `message "…"` is no longer part of the language: a rule is NAMED
// (`invariant nameRequired: …`) and its English text lives in
// `locales/en/<Ctx>.json` under the rule's identity key.  A rule that still
// carries `message "X"` is an error (`loom.rule-message-removed`) whose text
// names `deriveRuleName("X")` (deduplicated within its owner's rule
// namespace) as the name to write.
// ---------------------------------------------------------------------------

/** At most this many words of the message make up the derived name. */
const RULE_NAME_MAX_WORDS = 4;

/** Filler words dropped before the word budget is spent ("Name is required" →
 *  `nameRequired`). */
const FILLER = new Set(["a", "an", "the", "is", "are", "be", "must", "should", "been"]);

/** camelCase rule name derived from a message's text: its first
 *  {@link RULE_NAME_MAX_WORDS} non-filler alphanumeric words.  A name is
 *  always at least two words (a lone word could be a keyword — `required`) and
 *  always starts with a letter. */
export function deriveRuleName(text: string): string {
  const all = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const kept = all.filter((w) => !FILLER.has(w));
  const words = (kept.length > 0 ? kept : all).slice(0, RULE_NAME_MAX_WORDS);
  if (words.length === 0 || !/^[a-z]/.test(words[0]!)) {
    words.unshift("rule");
    words.length = Math.min(words.length, RULE_NAME_MAX_WORDS);
  }
  if (words.length === 1) words.push("rule");
  return words.map((w, i) => (i === 0 ? w : w[0]!.toUpperCase() + w.slice(1))).join("");
}

/** `name` made unique against `taken` by a numeric suffix (`nameRequired2`),
 *  and recorded there. */
export function dedupeRuleName(name: string, taken: Set<string>): string {
  let out = name;
  for (let n = 2; taken.has(out); n++) out = `${name}${n}`;
  taken.add(out);
  return out;
}

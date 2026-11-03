// ---------------------------------------------------------------------------
// The text a tripped rule answers with — the ONE place every backend asks.
//
// A NAMED rule (`invariant nameRequired: …`) answers its identity key's
// source-language text: the `locales/en/<Ctx>.json` override when there is
// one, else the English default lowering derived (`MessageIR.text`).
//
// An UNNAMED rule answers a GENERIC message.  Never its `.ddd` source: an
// expression like `qty <= stock` is the model's internals, not a sentence a
// user can act on, and it would leak the DSL into every response.  The source
// stays available to server-side diagnostics (the generated code still carries
// the predicate itself).  The generic text is
//
//   field.rule            "Invalid value"           the rule points at one field
//   problem.domain-floor  "Business rule violated"  anything else
//
// — both overridable through `locales/en/_chrome.json` like any other key.
// ---------------------------------------------------------------------------

import type { ExprIR, InvariantIR, MessageIR } from "../../ir/types/loom-ir.js";
import { singleFieldShape } from "../../ir/validate/invariant-classify.js";
import { sourceText } from "./source-text.js";

/** Generic key of an unnamed rule that points at a single field. */
const FIELD_RULE_KEY = "field.rule";
/** Generic key of any other unnamed rule. */
const DOMAIN_FLOOR_RULE_KEY = "problem.domain-floor";

/** The English of the two generic keys. */
const GENERIC_RULE_TEXT: Readonly<Record<string, string>> = {
  [FIELD_RULE_KEY]: "Invalid value",
  [DOMAIN_FLOOR_RULE_KEY]: "Business rule violated",
};

/** The source-language text of a named rule's `MessageIR`. */
export function namedRuleText(message: MessageIR): string {
  return sourceText(message.key, message.text);
}

/** The generic key an UNNAMED rule answers with. */
function genericRuleKey(rule: { expr: ExprIR; guard?: ExprIR; source: string }): string {
  return singleFieldShape({ expr: rule.expr, guard: rule.guard, source: rule.source })
    ? FIELD_RULE_KEY
    : DOMAIN_FLOOR_RULE_KEY;
}

/** The user-facing text a tripped rule answers with: its named text, else the
 *  generic message for its shape.  Never the rule's source expression. */
export function ruleText(rule: Pick<InvariantIR, "expr" | "guard" | "source" | "message">): string {
  if (rule.message) return namedRuleText(rule.message);
  const key = genericRuleKey(rule);
  return sourceText(key, GENERIC_RULE_TEXT[key]!);
}

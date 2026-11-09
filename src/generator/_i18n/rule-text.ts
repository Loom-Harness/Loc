// ---------------------------------------------------------------------------
// The text and wire code a tripped rule answers with — the ONE place every
// backend asks.
//
// A NAMED rule (`invariant nameRequired: …`) answers its identity key's
// source-language text: the `locales/en/<Ctx>.json` override when there is
// one, else the English default lowering derived (`MessageIR.text`).  Its wire
// `code` is that identity key.
//
// An UNNAMED rule answers a GENERIC message.  Never its `.ddd` source: an
// expression like `qty <= stock` is the model's internals, not a sentence a
// user can act on, and it would leak the DSL into every response.  The source
// stays available to server-side diagnostics (the generated code still carries
// the predicate itself).  Its code is the generic key, which is also its
// catalog key:
//
//   field.rule            the rule points at one field
//   problem.domain-floor  anything else
//
// — both registered with the other wire error codes in
// `wire-error-text.ts`, and overridable through `locales/en/_chrome.json`
// like any other key.
// ---------------------------------------------------------------------------

import { fieldCode, wireCode } from "../../ir/enrich/wire-policy.js";
import type { ExprIR, InvariantIR, MessageIR } from "../../ir/types/loom-ir.js";
import { singleFieldShape } from "../../ir/validate/invariant-classify.js";
import { sourceText } from "./source-text.js";
import { wireErrorMessage } from "./wire-error-text.js";

/** The source-language text of a named rule's `MessageIR`. */
export function namedRuleText(message: MessageIR): string {
  return sourceText(message.key, message.text);
}

/** The generic key an UNNAMED rule answers with. */
function genericRuleKey(rule: { expr: ExprIR; guard?: ExprIR; source: string }): string {
  return singleFieldShape({ expr: rule.expr, guard: rule.guard, source: rule.source })
    ? fieldCode("rule")
    : wireCode("domain-floor");
}

/** The wire `code` a tripped rule carries: a named rule's identity key, else
 *  the generic key for its shape.  Always also its catalog key. */
export function ruleCode(rule: Pick<InvariantIR, "expr" | "guard" | "source" | "message">): string {
  return rule.message ? rule.message.key : genericRuleKey(rule);
}

/** The user-facing text a tripped rule answers with: its named text, else the
 *  generic message for its shape.  Never the rule's source expression. */
export function ruleText(rule: Pick<InvariantIR, "expr" | "guard" | "source" | "message">): string {
  if (rule.message) return namedRuleText(rule.message);
  return wireErrorMessage(genericRuleKey(rule));
}

/** The `detail` a rule tripped at the DOMAIN FLOOR answers with — the text of
 *  the same key as the floor's `code`.  A named rule carries its identity key
 *  through the throw, so its text is its named text; an unnamed one answers
 *  the plain floor body (`problem.domain-floor`), so its text is the
 *  domain-floor sentence even when the rule is single-field-shaped (that
 *  shape's `field.rule` text belongs to the wire rung's `errors[]` entry,
 *  which names the field). */
export function floorRuleText(
  rule: Pick<InvariantIR, "expr" | "guard" | "source" | "message">,
): string {
  if (rule.message) return namedRuleText(rule.message);
  return wireErrorMessage(wireCode("domain-floor"));
}

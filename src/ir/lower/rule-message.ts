// ---------------------------------------------------------------------------
// A rule's user-facing text identity — the `MessageIR` a NAMED `invariant` /
// field `check` / `precondition` lowers to.
//
// The key is the rule's model-identity key `<Ctx>.<Owner>.rule.<name>`
// (`src/util/model-text-key.ts`), so a reword never orphans a translation and
// every backend, client validator and catalog agree on one code.  The English
// default is the sentence form of the name ("Name required"); a translator's
// `locales/en/<Ctx>.json` entry overrides it at emission (`sourceText`).
//
// An UNNAMED rule lowers to no `MessageIR` at all and answers a generic
// message (`src/generator/_i18n/rule-text.ts`).
// ---------------------------------------------------------------------------

import { type RuleNode, ruleContext, ruleNameOf, ruleOwner } from "../../language/rule-names.js";
import { modelTextEntry } from "../../util/model-text-key.js";
import type { MessageIR } from "../types/loom-ir.js";

/** The `MessageIR` of rule `node`, or `undefined` for an unnamed rule (or one
 *  outside every rule-owning declaration). */
export function lowerRuleMessage(node: RuleNode): MessageIR | undefined {
  const owner = ruleOwner(node);
  const name = ruleNameOf(node);
  if (!owner || name === undefined) return undefined;
  const entry = modelTextEntry({
    ctx: ruleContext(node),
    type: owner.name,
    facet: "rule",
    member: name,
  });
  return { key: entry.key, text: entry.defaultText };
}

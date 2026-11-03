// ---------------------------------------------------------------------------
// Rule names in the builder — the identifier a rule (`invariant`, field
// `check`, `precondition`) is named with.  The name is the rule's i18n identity
// (`<Ctx>.<Owner>.rule.<name>`), so the builder validates it the way the
// language does: a plain identifier, unique across the owner's rule namespace.
// Keyword clashes are caught by the re-parse every edit goes through.
// ---------------------------------------------------------------------------

import type { AstNode } from "langium";
import { declaredRuleName, ruleOwner, rulesOf } from "../../../../src/language/rule-names";
import { IDENTIFIER, IDENTIFIER_RULE } from "./rename";

/** Names declared by every rule in `node`'s owner namespace except `node`. */
export function otherRuleNames(node: AstNode): Set<string> {
  const owner = ruleOwner(node);
  const out = new Set<string>();
  if (!owner) return out;
  for (const r of rulesOf(owner)) {
    if (r === node) continue;
    const n = declaredRuleName(r);
    if (n !== undefined) out.add(n);
  }
  return out;
}

/** Why `name` cannot name a rule next to `taken`, or null when it can. */
export function ruleNameError(name: string, taken: ReadonlySet<string>): string | null {
  if (!IDENTIFIER.test(name)) return IDENTIFIER_RULE;
  if (taken.has(name)) return `a rule named ${name} already exists on this owner`;
  return null;
}

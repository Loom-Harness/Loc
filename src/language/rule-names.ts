// ---------------------------------------------------------------------------
// Rule names — the identity of an `invariant` / field `check` / `precondition`.
//
// A rule is named with a colon (`invariant nameRequired: name.length > 0`,
// `title: string check nonEmpty: …`, `precondition inStock: qty <= stock`).
// Its user-facing text is keyed by that name, not by its wording:
//
//   <Ctx>.<Owner>.rule.<name>          (src/util/model-text-key.ts)
//
// The OWNER is the declaration whose rule namespace the name lives in: an
// aggregate (its own invariants, its parts' invariants, every field `check` and
// every operation `precondition` share it), a value object, a command / query
// handler, or a workflow.  Names are unique per owner
// (`loom.rule-name-duplicate`).
//
// Pure language layer: AST only.  The lowering (`src/ir/lower/rule-message.ts`)
// and the validator read the same declared names, so the key a rule lowers to
// and the name the duplicate check sees cannot disagree.
// ---------------------------------------------------------------------------

import { type AstNode, AstUtils } from "langium";
import {
  type Invariant,
  isAggregate,
  isBoundedContext,
  isCommandHandler,
  isDomainService,
  isInvariant,
  isPreconditionStmt,
  isProperty,
  isQueryHandler,
  isValueObject,
  isWorkflow,
  type PreconditionStmt,
  type Property,
} from "./generated/ast.js";

/** A node that declares a rule: an invariant, a property carrying a `check`,
 *  or a precondition statement. */
export type RuleNode = Invariant | Property | PreconditionStmt;

/** The declaration owning a rule namespace. */
export type RuleOwner = AstNode & { name: string };

const isOwner = (n: AstNode): n is RuleOwner =>
  isAggregate(n) ||
  isValueObject(n) ||
  isCommandHandler(n) ||
  isQueryHandler(n) ||
  isWorkflow(n) ||
  isDomainService(n);

/** True when `n` declares a rule. */
function isRuleNode(n: AstNode): n is RuleNode {
  return isInvariant(n) || isPreconditionStmt(n) || (isProperty(n) && n.check !== undefined);
}

/** The name the rule DECLARES (`name:` / `check name:`), if any. */
export function declaredRuleName(n: RuleNode): string | undefined {
  return isProperty(n) ? n.checkName : n.name;
}

/** The declaration whose rule namespace `n` lives in. */
export function ruleOwner(n: AstNode): RuleOwner | undefined {
  for (let cur = n.$container; cur; cur = cur.$container) if (isOwner(cur)) return cur;
  return undefined;
}

/** The bounded context `n` is declared in (`undefined` at system level). */
export function ruleContext(n: AstNode): string | undefined {
  return AstUtils.getContainerOfType(n, isBoundedContext)?.name;
}

/** Every rule in `owner`'s namespace, in document order. */
export function rulesOf(owner: RuleOwner): RuleNode[] {
  const out: RuleNode[] = [];
  for (const n of AstUtils.streamAllContents(owner)) {
    if (isRuleNode(n) && ruleOwner(n) === owner) out.push(n);
  }
  return out;
}

/** The name of rule `n`, or `undefined` for an unnamed rule. */
export function ruleNameOf(n: RuleNode): string | undefined {
  return declaredRuleName(n) ?? undefined;
}

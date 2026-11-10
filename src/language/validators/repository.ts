// Read-path gate checks: the `policy { read X requires … }` rule and the
// query-time projection gate, the read-side twins of the operation gate.
//
// A repository declares no reads of its own (D-FINDDECL-REMOVED): a leftover
// `find` in a repository body is a parse error (`parse-errors.ts`).

import { AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import {
  type Expression,
  isPolicyReadRule,
  isProjection,
  type Model,
  type PolicyReadRule,
  type Projection,
} from "../generated/ast.js";
import { envForNode, typeOf, typeToString } from "../type-system.js";

/** A read-path `requires <expr>` authorization gate must type to bool, exactly
 *  like the operation / workflow `requires` clause (`statements.ts` /
 *  `structural.ts`).  Without this a non-bool gate (`requires 42`) lowered to
 *  an always-truthy no-op that silently never fired.  Now that `currentUser`
 *  types precisely (`type-system.ts`), a bare
 *  `requires currentUser.permissions.contains(permissions.x)` gate passes. */
function checkGateIsBool(
  gate: Expression | undefined,
  node: PolicyReadRule | Projection,
  accept: ValidationAcceptor,
): void {
  if (!gate) return;
  const gt = typeOf(gate, envForNode(gate));
  if (gt.kind !== "primitive" || gt.name !== "bool") {
    accept("error", diagMessage("loom.requires-not-bool", { actual: typeToString(gt) }), {
      node,
      property: "gate",
      code: "loom.requires-not-bool",
    });
  }
}

/** The words a `policy { }` rule may start with. */
const POLICY_RULE_HEADS: ReadonlySet<string> = new Set(["allow", "deny", "read"]);

export function checkReadGates(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    // Read-path `requires` gate bool check — the policy read gate
    // (`policy { read X requires … }`) and the query-time projection gate,
    // the read-side twins of the operation gate.
    if (isPolicyReadRule(node) && !POLICY_RULE_HEADS.has(node.effect)) {
      // `read` heads the gate rule as an identifier, not a keyword, so any
      // other word parses there too — refuse it by name.
      accept("error", diagMessage("loom.policy-unknown-rule", { word: node.effect }), {
        node,
        property: "effect",
        code: "loom.policy-unknown-rule",
      });
      continue;
    }
    // A row rule's verb is an identifier too (`allow read on X as x where …`).
    if (isPolicyReadRule(node) && node.verb && node.verb !== "read" && node.verb !== "write") {
      accept("error", diagMessage("loom.policy-unknown-rule#verb", { word: node.verb }), {
        node,
        property: "verb",
        code: "loom.policy-unknown-rule",
      });
      continue;
    }
    if (isProjection(node) || isPolicyReadRule(node)) checkGateIsBool(node.gate, node, accept);
  }
}

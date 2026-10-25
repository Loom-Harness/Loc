// Repository `find` checks (read-path-architecture.md, migration).
//
//   - loom.repository-find-deprecated — a wire-shaped LIST `find` on a
//     repository (a bespoke list query returning `T[]` or `T paged`) is
//     deprecated in favour of criterion-driven reads: pass a `criterion` to
//     `run` (`Repo.run(<Criterion>(args))`) or name a `retrieval`, and expose
//     it on the wire with `scaffoldPaged(of: …)` + `scaffoldPagedApi(of: …)`
//     when a client must call it.  This kills the
//     "repository-with-40-finders" smell — every distinct list query stops
//     minting a `find byX` method.  A **unique-key reconstitution** find
//     (returning a single `T` / `T?` by identity) is NOT a list query and
//     stays legal (proposal Open Q4).  A WARNING, not an error: existing
//     `.ddd` keeps parsing.
//
// This is an AST-level check over author-declared `FindDecl` nodes, so the
// compiler-SYNTHESIZED finds (the auto-`findAll`, and the paged find a
// paged-run queryHandler mints — both made in enrich, never in source) are
// naturally exempt: they don't exist at this layer.

import { AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import {
  type Expression,
  type FindDecl,
  isFindDecl,
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

/** A find whose return type is a COLLECTION — an array (`T[]`) or the `paged`
 *  list carrier (`T paged`).  These are list queries; a single (`T`) or
 *  optional-single (`T?`) return is reconstitution, not a list. */
function returnsCollection(find: FindDecl): boolean {
  const rt = find.returnType;
  if (!rt) return false;
  return rt.array === true || rt.ctors.includes("paged");
}

export function checkRepositoryFinds(model: Model, accept: ValidationAcceptor): void {
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
    if (isProjection(node) || isPolicyReadRule(node)) {
      checkGateIsBool(node.gate, node, accept);
      continue;
    }
    if (!isFindDecl(node)) continue;
    if (!returnsCollection(node)) continue;
    accept("warning", diagMessage("loom.repository-find-deprecated", { name: node.name }), {
      node,
      property: "name",
      code: "loom.repository-find-deprecated",
    });
  }
}

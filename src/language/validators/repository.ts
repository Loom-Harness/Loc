// Repository `find` checks (read-path-architecture.md, migration).
//
//   - loom.repository-find-deprecated — a wire-shaped LIST `find` on a
//     repository (a bespoke list query returning `T[]` or `T paged`) is
//     deprecated in favour of criterion-driven reads: pass a `criterion` to
//     `run` (`Repo.run(<Criterion>(args))`) or name a `retrieval`.  This
//     kills the "repository-with-40-finders" smell — every distinct list
//     query stops minting a `find byX` method.  A **unique-key
//     reconstitution** find (returning a single `T` / `T?` by identity) is
//     NOT a list query and stays legal (proposal Open Q4).  A WARNING, not an
//     error: existing `.ddd` keeps parsing.
//
// This is an AST-level check over author-declared `FindDecl` nodes, so the
// compiler-SYNTHESIZED finds (the auto-`findAll`, and scaffoldPaged's paged
// `findAllBy<Criterion>` — both minted in enrich, never in source) are
// naturally exempt: they don't exist at this layer.
//
// SCOPE (interim, audits/2026-09-10-eshop-dev-experience.md §D7 / G2).  The
// warning fires only inside a bounded context that already declares a
// `criterion` or a `retrieval` — i.e. where the replacement it names is
// demonstrably in reach and the migration is a local, mechanical one.  A model
// that has adopted neither (the `ddd new --template crud` starter among them)
// is NOT nagged: the replacement is not yet at parity — a criterion/retrieval
// read emits a repository method but no HTTP route, no client hook and no
// scaffolded filter bar — and a tool must not deprecate the only spelling that
// works, least of all in its own template.  This narrowing is temporary: when
// a `retrieval` carries its own route (audit G2), drop the context gate and
// the warning returns at full strength on every list `find`.

import { AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import {
  type BoundedContext,
  type FindDecl,
  isBoundedContext,
  isCriterion,
  isFindDecl,
  isProjection,
  isRetrieval,
  type Model,
} from "../generated/ast.js";
import { envForNode, typeOf, typeToString } from "../type-system.js";

/** A read-path `requires <expr>` authorization gate must type to bool, exactly
 *  like the operation / workflow `requires` clause (`statements.ts` /
 *  `structural.ts`).  Without this a non-bool gate (`requires 42`) lowered to
 *  an always-truthy no-op that silently never fired.  Now that `currentUser`
 *  types precisely (`type-system.ts`), a bare
 *  `requires currentUser.permissions.contains(permissions.x)` gate passes. */
function checkGateIsBool(
  gate: FindDecl["gate"],
  node: FindDecl | import("../generated/ast.js").Projection,
  accept: ValidationAcceptor,
): void {
  if (!gate) return;
  const gt = typeOf(gate, envForNode(gate));
  if (gt.kind !== "primitive" || gt.name !== "bool") {
    accept("error", `'requires' must be of type 'bool', got '${typeToString(gt)}'.`, {
      node,
      property: "gate",
    });
  }
}

/** A find whose return type is a COLLECTION — an array (`T[]`) or the `paged`
 *  list carrier (`T paged`).  These are list queries; a single (`T`) or
 *  optional-single (`T?`) return is reconstitution, not a list. */
function returnsCollection(find: FindDecl): boolean {
  const rt = find.returnType;
  if (!rt) return false;
  return rt.array === true || rt.ctors.includes("paged");
}

/** Does the bounded context holding this find already declare a `criterion` or
 *  a `retrieval` — the two replacements the deprecation names?  A find outside
 *  any context (none parses today, but the walk is total) counts as having no
 *  replacement in reach. */
function replacementInReach(find: FindDecl, cache: Map<BoundedContext, boolean>): boolean {
  const ctx = AstUtils.getContainerOfType(find, isBoundedContext);
  if (!ctx) return false;
  const hit = cache.get(ctx);
  if (hit !== undefined) return hit;
  const has = ctx.members.some((m) => isCriterion(m) || isRetrieval(m));
  cache.set(ctx, has);
  return has;
}

export function checkRepositoryFinds(model: Model, accept: ValidationAcceptor): void {
  const replacementByContext = new Map<BoundedContext, boolean>();
  for (const node of AstUtils.streamAllContents(model)) {
    // Read-path `requires` gate bool check — the find and query-time projection
    // (the "view" successor) gates, the read-side twins of the operation gate.
    if (isProjection(node)) {
      checkGateIsBool(node.gate, node, accept);
      continue;
    }
    if (!isFindDecl(node)) continue;
    checkGateIsBool(node.gate, node, accept);
    if (!returnsCollection(node)) continue;
    // Interim scope (see the header): only nag where the criterion-driven read
    // path is already in use in this context.
    if (!replacementInReach(node, replacementByContext)) continue;
    accept("warning", diagMessage("loom.repository-find-deprecated", { name: node.name }), {
      node,
      property: "name",
      code: "loom.repository-find-deprecated",
    });
  }
}

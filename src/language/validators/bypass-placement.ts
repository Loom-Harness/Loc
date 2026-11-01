// Where an `ignoring` capability-filter bypass may be WRITTEN (M-T5.25).
//
// The clause has three kinds of legal home, each read by its own lowerer:
//
//   1. a repository `find … ignoring …`        (`FindDecl`, lower.ts)
//   2. a query-time projection's `where` slot  (`ProjectionQueryClauses`,
//      `from <Agg> [where …] ignoring … join … group by … select …`,
//      lower-projection.ts)
//   3. an inline repository read               (`let xs = Repo.findAll(…)
//      ignoring …`, `if let o = Repo.find(C) ignoring …`, lower-workflow.ts /
//      repo-read.ts)
//
// (3) is the one that needs a gate.  It rides `PostfixExpr`, which admits a
// trailing `IgnoringClause` on ANY postfix chain — and a postfix chain is
// admissible anywhere an `Expression` is.  So `group by o.status ignoring
// softDeletable` parses clean, binds the clause to the GROUPING expression, and
// nothing ever reads it back: the author asked to see soft-deleted rows and
// silently keeps getting the filtered count.  Same model, same intent, opposite
// data — decided by where in the clause list the word sits:
//
//   group by o.status ignoring softDeletable  → …and(eq(status,…), not(eq(isDeleted,true)))
//   ignoring softDeletable / group by o.status → …eq(status,…)
//
// Refusing it is the right shape rather than hoisting the grammar: `ignoring`
// means "bypass the SOURCE's capability filters", which has no per-expression
// reading.  The gate lives here, in phase ④, because the CST still carries the
// offending span — by lowering the clause is already gone.
//
// The rule mirrors the consuming sites exactly:
//
//   - a `let` binding's own expression, over a `.findAll(…)` / `.run(…)` /
//     natural-key `.getBy(…)` / `.findBy(…)` read (`lower-workflow.ts`'s
//     `isLetStmt` arm, whose `repo-run` arms spread `resolveBypass` and whose
//     key-lookup arm reads the stance off the chain);
//   - an `if let` source over a natural-key `.findBy(…)` or a criterion
//     `.find(<Criterion>)` read (`findBy` / `find` are `T?`, so `if let` is
//     where they are bound);
//   - an expression in a `domainService` operation over a single-row read —
//     `.find(<Criterion>)`, `.findById(id)`, `.getBy(…)` / `.findBy(…)`
//     (`matchRepoRead`, which every service read lowers through, reads the
//     stance off the chain for exactly these).
//
// Every other position drops it.

import { AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import { type RepoArgShape, repositoryVerb } from "../../util/repository-contract.js";
import {
  isDomainServiceOperation,
  isIfLetStmt,
  isLetStmt,
  isMemberSuffix,
  isPostfixChain,
  type Model,
  type PostfixChain,
} from "../generated/ast.js";

/** Does this chain carry an `ignoring` clause?  The fragment sets `bypassAll`
 *  for `ignoring *` and fills `bypass` for `ignoring A, B`. */
function carriesIgnoring(chain: PostfixChain): boolean {
  return chain.bypassAll === true || (chain.bypass?.length ?? 0) > 0;
}

/** The chain's trailing member name, when its last suffix is a `.member(...)`
 *  call — the shape the two consuming matchers key on. */
function trailingCallMember(chain: PostfixChain): string | undefined {
  const last = chain.suffixes.at(-1);
  if (!last || !isMemberSuffix(last) || !last.call) return undefined;
  return last.member;
}

/** How the author spelled it, for the message: `ignoring *` or `ignoring A, B`. */
function spelling(chain: PostfixChain): string {
  return chain.bypassAll ? "ignoring *" : `ignoring ${(chain.bypass ?? []).join(", ")}`;
}

/** The repository verbs whose `ignoring` stance the `let` lowerer reads. */
const LET_VERBS: ReadonlySet<RepoArgShape> = new Set([
  "criterion-or-none",
  "retrieval-or-criterion",
  "key",
]);
/** The repository verbs whose `ignoring` stance the `if let` lowerer reads. */
const IF_LET_VERBS: ReadonlySet<RepoArgShape> = new Set(["key", "criterion"]);
/** The repository verbs whose `ignoring` stance a domain-service read reads. */
const SERVICE_VERBS: ReadonlySet<RepoArgShape> = new Set(["id", "key", "criterion"]);

/** Is a chain-borne `ignoring` consumed where `chain` sits? */
function consumed(chain: PostfixChain): boolean {
  const c = repositoryVerb(trailingCallMember(chain) ?? "");
  if (!c?.ignoring) return false;
  const parent = chain.$container;
  if (isLetStmt(parent) && chain.$containerProperty === "expr" && LET_VERBS.has(c.args)) {
    return true;
  }
  if (isIfLetStmt(parent) && chain.$containerProperty === "source" && IF_LET_VERBS.has(c.args)) {
    return true;
  }
  return (
    SERVICE_VERBS.has(c.args) &&
    AstUtils.getContainerOfType(chain, isDomainServiceOperation) !== undefined
  );
}

export function checkBypassPlacement(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    if (!isPostfixChain(node) || !carriesIgnoring(node) || consumed(node)) continue;
    accept("error", diagMessage("loom.ignoring-clause-placement", { clause: spelling(node) }), {
      node,
      code: "loom.ignoring-clause-placement",
    });
  }
}

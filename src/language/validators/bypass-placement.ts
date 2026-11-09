// Where an `ignoring` capability-filter bypass may be WRITTEN (M-T5.25).
//
// The clause has two kinds of legal home, each read by its own lowerer:
//
//   1. a query-time projection's `where` slot  (`ProjectionQueryClauses`,
//      `from <Agg> [where …] ignoring … join … group by … select …`,
//      lower-projection.ts)
//   2. an inline repository read               (`let xs = Repo.all(C)
//      ignoring …`, `if let o = Repo.find(C) ignoring …`, lower-workflow.ts /
//      repo-read.ts)
//
// (2) is the one that needs a gate.  It rides `PostfixExpr`, which admits a
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
//   - a `let` binding's own expression, over an `.all(<Criterion | Retrieval>)`
//     or natural-key `.getBy(…)` / `.findBy(…)` read (`lower-workflow.ts`'s
//     `isLetStmt` arm, whose `repo-run` arms spread `resolveBypass` and whose
//     key-lookup arm reads the stance off the chain);
//   - in a workflow, reactor or handler body, a `let` or `if let` over a
//     single-row read — `.find(<Criterion>)`, `.find(id)`, `.findBy(…)` —
//     which lowers to the read's own widened method (`bypassRead`);
//   - an `if let` source over a natural-key `.findBy(…)` anywhere;
//   - an expression in a `domainService` operation over a single-row read —
//     `.find(<Criterion>)`, `.find(id)`, `.getBy(…)` / `.findBy(…)` — or a
//     list read `.all(<Criterion | Retrieval>)` (`matchRepoRead`, which every
//     service read lowers through, reads the stance off the chain for exactly
//     these: the single-row reads call their own widened method, the list
//     read runs its own widened retrieval);
//   - in a context integration `test`, `let o = Agg.find(id) ignoring …`
//     (`lower-test.ts` names the widened method on the read).
//
// Every other position drops it.

import { type AstNode, AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import { type RepoArgShape, repositoryVerbFor } from "../../util/repository-contract.js";
import {
  isBoundedContext,
  isCommandHandler,
  isDomainServiceOperation,
  isIfLetStmt,
  isLetStmt,
  isMemberSuffix,
  isOnDecl,
  isPostfixChain,
  isQueryHandler,
  isTestBlock,
  isWorkflowCreateDecl,
  type Model,
  type PostfixChain,
} from "../generated/ast.js";
import { classifyRepoArg, queryNamesOf, queryRefOf } from "../repo-query-arg.js";

/** Does this chain carry an `ignoring` clause?  The fragment sets `bypassAll`
 *  for `ignoring *` and fills `bypass` for `ignoring A, B`. */
function carriesIgnoring(chain: PostfixChain): boolean {
  return chain.bypassAll === true || (chain.bypass?.length ?? 0) > 0;
}

/** The chain's trailing `.member(...)` call — the shape the consuming
 *  matchers key on. */
function trailingCall(chain: PostfixChain) {
  const last = chain.suffixes.at(-1);
  if (!last || !isMemberSuffix(last) || !last.call) return undefined;
  return last;
}

/** How the author spelled it, for the message: `ignoring *` or `ignoring A, B`. */
function spelling(chain: PostfixChain): string {
  return chain.bypassAll ? "ignoring *" : `ignoring ${(chain.bypass ?? []).join(", ")}`;
}

/** The repository verbs whose `ignoring` stance the `let` lowerer reads in
 *  any body. */
const LET_VERBS: ReadonlySet<RepoArgShape> = new Set(["query-or-none", "key"]);
/** The single-row verbs whose `ignoring` stance a `let` / `if let` reads in a
 *  workflow, reactor or handler body (`lower-workflow.ts`). */
const BODY_ROW_VERBS: ReadonlySet<RepoArgShape> = new Set(["id", "key", "criterion"]);
/** The repository verbs whose `ignoring` stance a domain-service read reads. */
const SERVICE_VERBS: ReadonlySet<RepoArgShape> = new Set([
  "id",
  "key",
  "criterion",
  "query-or-none",
]);

/** Is `node` inside a body `lower-workflow.ts` lowers — a workflow `create`,
 *  an `on` reactor, or a command / query handler? */
function inWorkflowBody(node: AstNode): boolean {
  return (
    AstUtils.getContainerOfType(
      node,
      (n) => isWorkflowCreateDecl(n) || isOnDecl(n) || isCommandHandler(n) || isQueryHandler(n),
    ) !== undefined
  );
}

/** Is `node` inside a context integration `test` (one written in a context,
 *  not an aggregate / value object / domain-service unit test)? */
function inContextTest(node: AstNode): boolean {
  const test = AstUtils.getContainerOfType(node, isTestBlock);
  if (!test) return false;
  return test.target ? isBoundedContext(test.target.ref) : isBoundedContext(test.$container);
}

/** Is a chain-borne `ignoring` consumed where `chain` sits? */
function consumed(chain: PostfixChain): boolean {
  const call = trailingCall(chain);
  if (!call) return false;
  const positional = call.args.find((a) => !a.name)?.value;
  const names = queryNamesOf(AstUtils.getContainerOfType(chain, isBoundedContext));
  const c = repositoryVerbFor(call.member, classifyRepoArg(positional, names) === "criterion");
  if (!c?.ignoring) return false;
  // `all()` with no reference is the by-name whole-collection read, which
  // carries no stance; only `all(<Ref>)` reads one.
  if (c.args === "query-or-none" && !queryRefOf(positional)) return false;
  const parent = chain.$container;
  if (isLetStmt(parent) && chain.$containerProperty === "expr") {
    if (LET_VERBS.has(c.args)) return true;
    if (BODY_ROW_VERBS.has(c.args) && inWorkflowBody(chain)) return true;
    // A context integration test reads by id through the aggregate's
    // repository (`let o = Order.find(id) ignoring *`).
    if (c.args === "id" && inContextTest(chain)) return true;
  }
  if (
    isIfLetStmt(parent) &&
    chain.$containerProperty === "source" &&
    (c.args === "key" || (BODY_ROW_VERBS.has(c.args) && inWorkflowBody(chain)))
  ) {
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

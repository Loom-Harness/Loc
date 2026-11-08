// Repository reads in EXPRESSION position inside a workflow / handler body —
// `return Items.getBy(sku: s)`, `return Reqs.all(Big(n)).count`,
// `precondition Items.get(id).active`, `for t in Tickets.all(Stale)` — are
// desugared to the `let` form the statement lowerer already lowers:
//
//     return Reqs.all(Big(n)).count
//   ≡ let readReqs = Reqs.all(Big(n))
//     return readReqs.count
//
// The workflow statement vocabulary binds a read only through a `let`
// (`repo-let` / `repo-run`), and every backend renders those; an expression-
// position read has no IR form of its own in these bodies, so without the
// desugar it lowered as an ordinary method call on an unresolved name (and
// `Repo.all(<Criterion>)` as the collection quantifier `all(pred)`).
//
// Only a read the statement evaluates UNCONDITIONALLY is hoisted: moving a read
// out of a lambda, a `?:` / `&&` / `||` / `??` right-hand side or a `match` arm
// would run it where the source does not (a `get` that throws on a miss, or a
// read of a lambda parameter).  A read left in such a position keeps its
// unresolved lowering, which `loom.workflow-inline-repository-call` refuses.
//
// A LEAF over the Langium AST: it imports `repo-read.ts` (the single
// "is this a repository read" detector) and nothing from `lower.ts`.
import { type AstNode, AstUtils } from "langium";
import type {
  Expression,
  PostfixChain,
  Repository,
  Statement,
} from "../../language/generated/ast.js";
import {
  isBinaryChain,
  isExpression,
  isIfLetStmt,
  isLambda,
  isLetStmt,
  isMatchExpr,
  isMemberSuffix,
  isNameRef,
  isPostfixChain,
  isStatement,
  isTernaryExpr,
} from "../../language/generated/ast.js";
import type { QueryNames } from "../../language/repo-query-arg.js";
import { matchRepoRead } from "./repo-read.js";

/** One read to hoist: `chain` is the source expression the read heads, `read`
 *  the read alone (`Repo.verb(args)` — `chain` itself when nothing follows the
 *  read call). */
export interface HoistableRead {
  chain: PostfixChain;
  read: PostfixChain;
}

/** Operators whose right-hand operands are evaluated only on some inputs. */
const SHORT_CIRCUIT = new Set(["&&", "||", "??"]);

/** The repository reads `stmt` evaluates unconditionally in its OWN
 *  expressions (nested statement blocks are lowered — and hoisted — on their
 *  own), in evaluation order: a read nested in another read's arguments comes
 *  before it.  The direct source of a `let` / `if let` is the statement's own
 *  read form, so it is left to the statement lowerer.  A `for` iterable is
 *  not one: `for t in Tickets.all(Stale)` iterates the hoisted `let`. */
export function hoistableReads(
  stmt: Statement,
  reposByName: Map<string, Repository>,
  names: QueryNames,
): HoistableRead[] {
  const out: HoistableRead[] = [];
  visitChildren(stmt, directSource(stmt), reposByName, names, out);
  return out;
}

/** The repository reads an expression evaluates unconditionally — the value of
 *  a `return`, lowered apart from the statement walk. */
export function hoistableReadsInExpr(
  expr: Expression,
  reposByName: Map<string, Repository>,
  names: QueryNames,
): HoistableRead[] {
  const out: HoistableRead[] = [];
  visitExpr(expr, undefined, reposByName, names, out);
  return out;
}

function directSource(stmt: Statement): Expression | undefined {
  if (isLetStmt(stmt)) return stmt.expr;
  if (isIfLetStmt(stmt)) return stmt.source;
  return undefined;
}

function visitChildren(
  node: AstNode,
  direct: Expression | undefined,
  reposByName: Map<string, Repository>,
  names: QueryNames,
  out: HoistableRead[],
): void {
  for (const child of AstUtils.streamContents(node)) {
    if (isStatement(child)) continue;
    if (isExpression(child)) visitExpr(child, direct, reposByName, names, out);
    else visitChildren(child, direct, reposByName, names, out);
  }
}

function visitExpr(
  e: Expression,
  direct: Expression | undefined,
  reposByName: Map<string, Repository>,
  names: QueryNames,
  out: HoistableRead[],
): void {
  // Conditionally evaluated sub-expressions are not descended into.
  if (isLambda(e)) return;
  if (isTernaryExpr(e)) {
    visitExpr(e.cond, direct, reposByName, names, out);
    return;
  }
  if (isMatchExpr(e)) {
    if (e.subject) visitExpr(e.subject, direct, reposByName, names, out);
    return;
  }
  if (isBinaryChain(e) && e.ops.some((op) => SHORT_CIRCUIT.has(op))) {
    visitExpr(e.head, direct, reposByName, names, out);
    return;
  }
  if (isPostfixChain(e)) {
    const read = readPrefix(e, reposByName, names);
    if (read) {
      // The read's own arguments run first, then the read, then whatever
      // follows it in the chain.
      visitChildren(e.suffixes[0]!, direct, reposByName, names, out);
      if (!(e === direct && e.suffixes.length === 1)) out.push({ chain: e, read });
      for (const s of e.suffixes.slice(1)) visitChildren(s, direct, reposByName, names, out);
      return;
    }
  }
  visitChildren(e, direct, reposByName, names, out);
}

/** `chain`'s leading `Repo.verb(args)` as a chain of its own, when it is a
 *  repository read.  A trailing `ignoring` clause belongs to the read. */
function readPrefix(
  chain: PostfixChain,
  reposByName: Map<string, Repository>,
  names: QueryNames,
): PostfixChain | undefined {
  const first = chain.suffixes[0];
  if (!isNameRef(chain.head) || !reposByName.has(chain.head.name)) return undefined;
  if (!first || !isMemberSuffix(first) || !first.call) return undefined;
  const read: PostfixChain =
    chain.suffixes.length === 1
      ? chain
      : ({
          $type: "PostfixChain",
          $container: chain.$container,
          $containerProperty: chain.$containerProperty,
          $containerIndex: chain.$containerIndex,
          head: chain.head,
          suffixes: [first],
          bypass: chain.bypass,
          bypassAll: chain.bypassAll,
        } as PostfixChain);
  return matchRepoRead(read, reposByName, names) ? read : undefined;
}

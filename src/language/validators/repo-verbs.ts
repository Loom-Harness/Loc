// The repository contract's surface verbs (D-REPO-VERBS):
//
//   Repo.get(id)                         the row; absent → not-found
//   Repo.find(id)                        the row or none (`T?`)
//   Repo.find(<Criterion>)               the first match or none (`T?`)
//   Repo.getBy(col: v) / findBy(col: v)  a natural-key read (repo-key-lookup.ts)
//   Repo.all(<Criterion | Retrieval>, sort: [...], page: {...})   the rows
//   Repo.all()                           the whole collection
//   Repo.remove(x)                       delete
//
// This file owns the shape rules the grammar cannot state:
//
//   - loom.repo-verb-renamed   — a retired verb (`getById`, `findById`,
//                                `findAll`, `run`, `delete`): the hard cutover
//                                names the verb that replaced it;
//   - loom.repo-get-criterion  — `get(<Criterion>)`: `get` takes an id; the
//                                criterion read is `find`;
//   - loom.repo-find-retrieval — `find(<Retrieval>)`: a retrieval is a list
//                                read, so it goes to `all`;
//   - loom.repo-all-arg        — `all(x)` whose argument is no criterion or
//                                retrieval reference;
//   - loom.repo-sort-placement — a `sort:` slot anywhere but `all(<Criterion>)`
//                                (a retrieval carries its own `sort:`).
//
// A receiver is a repository when it names one in the enclosing context.  A
// context `test` body reads by AGGREGATE name (`Order.get(id)`), so there an
// aggregate receiver counts too.  The criterion / retrieval classification is
// the one the lowerer uses (`language/repo-query-arg.ts`).

import { type AstNode, AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import { retiredRepoVerb } from "../../util/repository-contract.js";
import {
  type BoundedContext,
  type CallArg,
  isAggregate,
  isAssignOrCallStmt,
  isBoundedContext,
  isMemberSuffix,
  isNameRef,
  isPostfixChain,
  isRepository,
  isTestBlock,
  type MemberSuffix,
  type Model,
} from "../generated/ast.js";
import { classifyRepoArg, queryNamesOf, queryRefOf } from "../repo-query-arg.js";

/** The bounded context whose repositories (and, in a context `test`, whose
 *  aggregates) a receiver name resolves against. */
function contextOf(node: AstNode): { ctx: BoundedContext; inTest: boolean } | undefined {
  const test = AstUtils.getContainerOfType(node, isTestBlock);
  const target = test?.target?.ref;
  if (test && target && isBoundedContext(target)) return { ctx: target, inTest: true };
  const ctx = AstUtils.getContainerOfType(node, isBoundedContext);
  return ctx ? { ctx, inTest: test !== undefined } : undefined;
}

/** Is `name` a repository receiver at `node`? */
function isRepoReceiver(name: string, node: AstNode): BoundedContext | undefined {
  const where = contextOf(node);
  if (!where) return undefined;
  const hit = where.ctx.members.some(
    (m) => (isRepository(m) || (where.inTest && isAggregate(m))) && m.name === name,
  );
  return hit ? where.ctx : undefined;
}

function reportRenamed(
  receiver: string,
  verb: string,
  node: AstNode,
  accept: ValidationAcceptor,
): void {
  const next = retiredRepoVerb(verb);
  if (!next) return;
  accept(
    "error",
    diagMessage("loom.repo-verb-renamed", {
      receiver,
      verb,
      next,
      hint:
        next === "all"
          ? ` A criterion or retrieval reference stays the argument (\`${receiver}.all(Active, page: { limit: 20 })\`); a \`retrieval { where: C sort: […] }\` literal is now \`${receiver}.all(C, sort: […])\`.`
          : "",
    }),
    { node, code: "loom.repo-verb-renamed" },
  );
}

/** The shape rules over one `<Repo>.<verb>(…)` member call. */
function checkCall(
  ctx: BoundedContext,
  receiver: string,
  s: MemberSuffix,
  accept: ValidationAcceptor,
): void {
  const verb = s.member;
  const positional = (s.args ?? []).find((a: CallArg) => !a.name)?.value;
  const names = queryNamesOf(ctx);
  const kind = classifyRepoArg(positional, names);
  const ref = queryRefOf(positional)?.name ?? "";
  if (verb === "get" && kind === "criterion") {
    accept("error", diagMessage("loom.repo-get-criterion", { receiver, ref }), {
      node: s,
      code: "loom.repo-get-criterion",
    });
  }
  if (verb === "get" && kind === "retrieval") {
    accept("error", diagMessage("loom.repo-get-criterion#retrieval", { receiver, ref }), {
      node: s,
      code: "loom.repo-get-criterion",
    });
  }
  if (verb === "find" && kind === "retrieval") {
    accept("error", diagMessage("loom.repo-find-retrieval", { receiver, ref }), {
      node: s,
      code: "loom.repo-find-retrieval",
    });
  }
  if (verb === "all" && positional && !queryRefOf(positional)) {
    accept("error", diagMessage("loom.repo-all-arg", { receiver }), {
      node: s,
      code: "loom.repo-all-arg",
    });
  }
  if (s.sorted && verb === "all" && kind === "retrieval") {
    accept("error", diagMessage("loom.repo-sort-placement#retrieval", { receiver, ref }), {
      node: s,
      property: "sorted",
      code: "loom.repo-sort-placement",
    });
  } else if (s.sorted && !(verb === "all" && kind === "criterion")) {
    accept("error", diagMessage("loom.repo-sort-placement", { receiver, verb }), {
      node: s,
      property: "sorted",
      code: "loom.repo-sort-placement",
    });
  }
}

export function checkRepoVerbs(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    if (isPostfixChain(node)) {
      const s = node.suffixes[0];
      if (!isNameRef(node.head) || !s || !isMemberSuffix(s) || !s.call) {
        // `sort:` on any member call other than a repository's.
        for (const x of node.suffixes)
          if (isMemberSuffix(x) && x.sorted)
            accept(
              "error",
              diagMessage("loom.repo-sort-placement", { receiver: "", verb: x.member }),
              { node: x, property: "sorted", code: "loom.repo-sort-placement" },
            );
        continue;
      }
      const receiver = node.head.name;
      const ctx = isRepoReceiver(receiver, node);
      if (!ctx) {
        if (s.sorted)
          accept("error", diagMessage("loom.repo-sort-placement", { receiver, verb: s.member }), {
            node: s,
            property: "sorted",
            code: "loom.repo-sort-placement",
          });
        continue;
      }
      if (retiredRepoVerb(s.member)) reportRenamed(receiver, s.member, s, accept);
      else checkCall(ctx, receiver, s, accept);
    } else if (isAssignOrCallStmt(node)) {
      // A call statement `Orders.remove(o)` — an `LValue`, not a chain.
      const lv = node.target;
      if (node.op || !lv.call || lv.thisRef || lv.tail.length !== 1) continue;
      const verb = lv.tail[0]!;
      if (retiredRepoVerb(verb) && isRepoReceiver(lv.head, node))
        reportRenamed(lv.head, verb, lv, accept);
    }
  }
}

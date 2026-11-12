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
//                                retrieval reference, and, in a context
//                                `test`, an aggregate-rooted `all` with any
//                                argument (the test reads the whole
//                                collection; every backend's test renderer
//                                calls the unfiltered list read);
//   - loom.repo-sort-placement — a `sort:` slot anywhere but `all(<Criterion>)`
//                                (a retrieval carries its own `sort:`);
//   - loom.repository-unknown  — a repository verb on a name that is no
//                                repository: an undeclared name, or (outside a
//                                context `test`) an aggregate.  Unreported, the
//                                call typed as whatever the receiver fell back
//                                to — `X.all(C)` as the collection quantifier
//                                `all(pred)`, a `bool`.
//
// A receiver is a repository when it names one in the enclosing context.  A
// context `test` body reads by AGGREGATE name (`Order.get(id)`), so there an
// aggregate receiver counts too.  The criterion / retrieval classification is
// the one the lowerer uses (`language/repo-query-arg.ts`).

import { type AstNode, AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import { plural } from "../../util/naming.js";
import { repositoryVerb, retiredRepoVerb } from "../../util/repository-contract.js";
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
  isTestE2E,
  isUi,
  type MemberSuffix,
  type Model,
  type PostfixChain,
} from "../generated/ast.js";
import { classifyRepoArg, queryNamesOf, queryRefOf } from "../repo-query-arg.js";
import { typingFor } from "../typing/shared.js";
import { modelContents } from "./model-contents.js";

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

/** A repository verb called on `receiver`, which names no repository.  The
 *  typing pass leaves such a read unknown — `unresolved-name` for a name
 *  declared nowhere, `not-a-value` for an aggregate read outside a context
 *  `test` — and this names the cause. */
function reportNotARepository(
  chain: PostfixChain,
  receiver: string,
  s: MemberSuffix,
  accept: ValidationAcceptor,
): void {
  const verb = s.member;
  if (!repositoryVerb(verb) && !retiredRepoVerb(verb)) return;
  for (let c: AstNode | undefined = chain.$container; c; c = c.$container) {
    if (isUi(c) || isTestE2E(c) || isTestBlock(c)) return;
  }
  const where = contextOf(chain);
  if (!where) return;
  const t = typingFor(chain).typeAt(s);
  if (t?.kind !== "unknown") return;
  const repos = where.ctx.members.filter(isRepository);
  const declared = repos.length
    ? ` Its repositories are: ${repos.map((r) => `'${r.name}'`).join(", ")}.`
    : "";
  if (t.cause === "unresolved-name") {
    const agg = where.ctx.members.find((m) => isAggregate(m) && plural(m.name) === receiver);
    accept(
      "error",
      diagMessage("loom.repository-unknown", {
        receiver,
        verb,
        ctx: where.ctx.name,
        agg: agg && isAggregate(agg) ? agg.name : "<Aggregate>",
        declared,
      }),
      { node: chain, code: "loom.repository-unknown" },
    );
    return;
  }
  const agg = where.ctx.members.find((m) => isAggregate(m) && m.name === receiver);
  if (t.cause !== "not-a-value" || !agg) return;
  const own = repos.find((r) => r.aggregate?.ref === agg || r.aggregate?.$refText === receiver);
  accept(
    "error",
    own
      ? diagMessage("loom.repository-unknown#aggregate", { receiver, verb, repo: own.name })
      : diagMessage("loom.repository-unknown#aggregate-no-repository", {
          receiver,
          verb,
          repo: plural(receiver),
        }),
    { node: chain, code: "loom.repository-unknown" },
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
  for (const node of modelContents(model)) {
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
        reportNotARepository(node, receiver, s, accept);
        if (s.sorted)
          accept("error", diagMessage("loom.repo-sort-placement", { receiver, verb: s.member }), {
            node: s,
            property: "sorted",
            code: "loom.repo-sort-placement",
          });
        continue;
      }
      if (retiredRepoVerb(s.member)) reportRenamed(receiver, s.member, s, accept);
      else if (
        s.member === "all" &&
        ((s.args ?? []).length > 0 || s.sorted) &&
        contextOf(node)?.inTest &&
        !ctx.members.some((m) => isRepository(m) && m.name === receiver) &&
        ctx.members.some((m) => isAggregate(m) && m.name === receiver)
      ) {
        accept("error", diagMessage("loom.repo-all-arg#integration-test", { receiver }), {
          node: s,
          code: "loom.repo-all-arg",
        });
      } else checkCall(ctx, receiver, s, accept);
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

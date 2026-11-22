// A multi-key in-memory sort reuses the query's `sort:` items (owner ruling
// 173): `xs.sortBy(sort: [status, code desc])` orders by `status`, then by
// `code` descending, under the one sort order (`src/ir/plan/sort-order.ts`).
//
// ALWAYS-ON, AST → AST.  The items become chained single-key sorts, LAST key
// first — a stable sort applied last-key-first is the multi-key order:
//
//   xs.sortBy(sort: [status, code desc])
//     →  xs.sortBy(key => key.code, true).sortBy(key => key.status)
//
// so the type system, the validators and every target see only the
// single-key `sortBy` they already order by the one rule, and `unfold` ejects
// real `.ddd`.  A `sort:` slot anywhere else is left for the validator
// (`loom.repo-sort-placement`) to refuse.

import { AstUtils } from "langium";
import type { Expression, MemberSuffix, Model, SortItem } from "../../language/generated/ast.js";
import { isMemberSuffix, isPostfixChain } from "../../language/generated/ast.js";
import { mkCallArg, mkLambda, mkMemberSuffix } from "../api/_mk.js";
import { memberAccess } from "../api/factories.js";
import { _setContainer, _tag } from "../api/factories-internals.js";
import { boolLit, nameRefExpr } from "../api/ui-factories.js";

/** The lambda parameter the desugared keys read through. */
const KEY_PARAM = "key";

export function desugarMultiKeySorts(model: Model): void {
  for (const node of [...AstUtils.streamAllContents(model)]) {
    if (!isPostfixChain(node)) continue;
    const at = node.suffixes.findIndex(
      (s) => isMemberSuffix(s) && s.member === "sortBy" && s.sorted && s.args.length === 0,
    );
    if (at < 0) continue;
    const items = (node.suffixes[at] as MemberSuffix).sort;
    const keys = [...items].reverse().map(singleKeySort);
    node.suffixes.splice(at, 1, ...keys);
    node.suffixes.forEach((s, i) => {
      _setContainer(s, node, "suffixes", i);
    });
  }
}

/** `.sortBy(sortKey => sortKey.<path>[, true])` for one sort item. */
function singleKeySort(item: SortItem): MemberSuffix {
  let body: Expression = nameRefExpr(KEY_PARAM);
  for (const seg of item.path.segments) body = memberAccess(body, seg.name);
  const lambda = _tag(mkLambda({ $type: "Lambda", param: KEY_PARAM, body, stmts: [] }), undefined);
  _setContainer(body, lambda, "body");
  const values: Expression[] = [lambda, ...(item.direction === "desc" ? [boolLit(true)] : [])];
  const args = values.map((value) => {
    const arg = _tag(mkCallArg({ $type: "CallArg", value }), undefined);
    _setContainer(value, arg, "value");
    return arg;
  });
  const suffix = _tag(
    mkMemberSuffix({
      $type: "MemberSuffix",
      member: "sortBy",
      call: true,
      args,
      sorted: false,
      sort: [],
    }),
    undefined,
  );
  args.forEach((a, i) => {
    _setContainer(a, suffix, "args", i);
  });
  return suffix;
}

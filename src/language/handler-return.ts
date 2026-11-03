// Where a `commandHandler` / `queryHandler` body may `return`.
//
// A handler answers its value once, after the body has run, so a `return` is
// the last top-level statement — with one more shape, the single-row read:
//
//   if let o = Orders.find(OrdersByCode(code)) {
//     return o
//   } else {
//     notFound
//   }
//
// as the body's last statement.  The `else` cannot fall through (it ends in
// `notFound`), so the shape is a guard: the lookup binds `o` or answers the
// 404, and the handler then answers `o`.  Lowering reads it exactly that way
// (`lowerHandlerBody`), and the validator refuses every other placement
// (`loom.handler-return-not-last`) — a `return` anywhere else would not stop
// the statements after it.

import { type AstNode, AstUtils } from "langium";
import {
  type IfLetStmt,
  isIfLetStmt,
  isLambda,
  isLetStmt,
  isMatchStmt,
  isNameRef,
  isNotFoundStmt,
  isReturnStmt,
  type MatchStmt,
  type ReturnStmt,
  type Statement,
} from "./generated/ast.js";

/** The guard a handler body ends in, when it does: its last statement is an
 *  `if let` whose then-branch is exactly `return <expr>` and whose `else` ends
 *  in `notFound`. */
export function handlerReturnGuard(
  body: readonly Statement[],
): { ifLet: IfLetStmt; ret: ReturnStmt } | undefined {
  const last = body[body.length - 1];
  if (!isIfLetStmt(last)) return undefined;
  const ret = last.thenBody[0];
  if (last.thenBody.length !== 1 || !isReturnStmt(ret)) return undefined;
  const elseLast = last.elseBody[last.elseBody.length - 1];
  if (!isNotFoundStmt(elseLast)) return undefined;
  return { ifLet: last, ret };
}

/** The `return` statements a handler body may hold: its last top-level
 *  statement, or the return of a trailing {@link handlerReturnGuard}. */
export function allowedHandlerReturns(body: readonly Statement[]): Set<ReturnStmt> {
  const out = new Set<ReturnStmt>();
  const last = body[body.length - 1];
  if (isReturnStmt(last)) out.add(last);
  const guard = handlerReturnGuard(body);
  if (guard) out.add(guard.ret);
  return out;
}

/** True when `node` sits inside a statement `match` (an arm or its `else`)
 *  of its own body — a block-bodied lambda between the two starts a body of
 *  its own.  A `return` there is refused with the `#match-arm` wording: an arm
 *  runs statements, and the body answers once, after the `match`. */
export function inMatchArm(node: AstNode): boolean {
  for (let c = node.$container; c; c = c.$container) {
    if (isMatchStmt(c)) return true;
    if (isLambda(c)) return false;
  }
  return false;
}

/** The terminal statement `match` of a body whose result may be an expected
 *  failure (`T or E`), when every arm (and the `else`, when present) ends in
 *  `return <expr>` or `notFound`:
 *
 *    match r {
 *      int left => { emit Paid { … }  return Receipt { left: left } }
 *      Insufficient e => { return PaymentDeclined { available: e.needed } }
 *    }
 *
 *  The body answers once, after the `match`: lowering keeps the arms'
 *  statements in the statement `match` and answers a value `match` over the
 *  same subject whose arms are the arms' returned values.  `returns` are the
 *  arms' trailing returns. */
export function terminalMatchReturns(
  body: readonly Statement[],
): { match: MatchStmt; returns: ReturnStmt[] } | undefined {
  const last = body[body.length - 1];
  if (!isMatchStmt(last) || last.varArms.length === 0) return undefined;
  const branches = [
    ...last.varArms.map((a) => a.body),
    ...(last.elseBody.length > 0 ? [last.elseBody] : []),
  ];
  const returns: ReturnStmt[] = [];
  for (const b of branches) {
    const tail = b[b.length - 1];
    if (isReturnStmt(tail)) returns.push(tail);
    else if (!isNotFoundStmt(tail)) return undefined;
  }
  return returns.length > 0 ? { match: last, returns } : undefined;
}

/** The arm-local `let` names a terminal-match arm's `return` reads.  The
 *  returned value is answered after the `match`, where only the arm's binding
 *  and the lets declared before the `match` are in scope. */
export function armLocalLetReads(ret: ReturnStmt, armBody: readonly Statement[]): string[] {
  const locals = new Set<string>();
  for (const s of armBody) {
    if (s === ret) break;
    for (const n of AstUtils.streamAst(s)) if (isLetStmt(n)) locals.add(n.name);
  }
  const read = new Set<string>();
  for (const n of AstUtils.streamAst(ret.value)) {
    if (isNameRef(n) && locals.has(n.name)) read.add(n.name);
  }
  return [...read];
}

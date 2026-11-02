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

import {
  type IfLetStmt,
  isIfLetStmt,
  isNotFoundStmt,
  isReturnStmt,
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

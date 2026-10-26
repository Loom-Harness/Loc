// The checks every callable body gets, whatever kind of callable it is.
//
// A callable that declares a result type (`operation pay(): Receipt or Declined`,
// a domain-service operation, a `commandHandler` / `queryHandler`) has every
// `return` checked against it, and must return on every path. A body that is
// not an aggregate `operation` (whose statement walk lives in `statements.ts`)
// still gets the expression checks: record-construction field types, call
// arguments, member-call statements and `emit` fields. Without these, a
// handler or a domain-service operation validated clean whatever it held, and
// the mistake surfaced only when a generated backend failed to compile.

import { type AstNode, AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import {
  type CommandHandler,
  type DomainServiceOperation,
  isAggregate,
  isCommandHandler,
  isDomainServiceOperation,
  isEmitStmt,
  isEntityPart,
  isFunctionDecl,
  isIfStmt,
  isLambda,
  isMatchStmt,
  isOperation,
  isQueryHandler,
  isReturnStmt,
  isWorkflowCreateDecl,
  type Model,
  type Operation,
  type QueryHandler,
  type Statement,
  type TypeRef,
} from "../generated/ast.js";
import { envForNode, isAssignable, resolveTypeRef, typeOf, typeToString } from "../type-system.js";
import { canPromoteLiteralTo, warnSensitivityDrop } from "./_shared.js";
import {
  checkConstructionArgTypes,
  checkEmit,
  checkExprCallArgs,
  checkWorkflowBodyCallStmts,
} from "./statements.js";

type Callable = Operation | DomainServiceOperation | CommandHandler | QueryHandler;

function callableLabel(c: Callable): string {
  if (isOperation(c)) return `Operation '${c.name}'`;
  if (isDomainServiceOperation(c)) return `Domain-service operation '${c.name}'`;
  if (isCommandHandler(c)) return `commandHandler '${c.name}'`;
  return `queryHandler '${c.name}'`;
}

/** The callable a `return` belongs to: the nearest enclosing callable, or
 *  `undefined` when a lambda or another body kind sits in between. */
function owningCallable(node: AstNode): AstNode | undefined {
  for (let n = node.$container; n; n = n.$container) {
    if (
      isOperation(n) ||
      isDomainServiceOperation(n) ||
      isCommandHandler(n) ||
      isQueryHandler(n) ||
      isFunctionDecl(n) ||
      isWorkflowCreateDecl(n) ||
      isLambda(n)
    )
      return n;
  }
  return undefined;
}

/** Does this statement list yield a value on every path? A `return`; an
 *  `if` / `else if` chain ending in `else` whose every branch does; a `match`
 *  statement whose every arm (and `else`, when written) does. A loop never
 *  counts: its body may not run. */
export function definitelyReturns(stmts: readonly Statement[]): boolean {
  return stmts.some((s) => {
    if (isReturnStmt(s)) return true;
    if (isIfStmt(s)) {
      if (!definitelyReturns(s.thenBody)) return false;
      if (s.elseIf) return definitelyReturns([s.elseIf]);
      return s.elseBody.length > 0 && definitelyReturns(s.elseBody);
    }
    if (isMatchStmt(s)) {
      if (s.varArms.length === 0) return false;
      if (!s.varArms.every((a) => definitelyReturns(a.body))) return false;
      return s.elseBody.length === 0 || definitelyReturns(s.elseBody);
    }
    return false;
  });
}

function checkReturns(
  c: Callable,
  returnType: TypeRef,
  body: readonly Statement[],
  accept: ValidationAcceptor,
): void {
  const declared = resolveTypeRef(returnType);
  if (declared.kind === "unknown") return;
  const label = callableLabel(c);
  for (const n of AstUtils.streamAllContents(c)) {
    if (!isReturnStmt(n) || owningCallable(n) !== c) continue;
    const actual = typeOf(n.value, envForNode(n.value));
    if (
      actual.kind !== "unknown" &&
      !isAssignable(actual, declared) &&
      !canPromoteLiteralTo(n.value, declared)
    ) {
      accept(
        "error",
        diagMessage("loom.return-type-mismatch", {
          label,
          actual: typeToString(actual),
          declared: typeToString(declared),
        }),
        { node: n, property: "value", code: "loom.return-type-mismatch" },
      );
    }
    warnSensitivityDrop(actual, declared, accept, { node: n, property: "value" });
  }
  if (!definitelyReturns(body)) {
    accept(
      "error",
      diagMessage("loom.return-missing", { label, declared: typeToString(declared) }),
      { node: c, property: "name", code: "loom.return-missing" },
    );
  }
}

/** The expression checks an aggregate operation gets from its statement walk,
 *  for the bodies that walk never visits. */
function checkBodyExpressions(c: Callable, accept: ValidationAcceptor): void {
  const env = envForNode(c);
  checkConstructionArgTypes(c, env, accept);
  checkExprCallArgs(c, env, accept);
  checkWorkflowBodyCallStmts(c, accept);
  for (const n of AstUtils.streamAst(c)) {
    if (isEmitStmt(n)) checkEmit(n, envForNode(n), accept);
  }
}

export function checkCallableBodies(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    if (isOperation(node)) {
      // A capability's operations are templates; they are checked once spliced
      // into each host aggregate.
      const host = node.$container;
      if (!isAggregate(host) && !isEntityPart(host)) continue;
      if (node.returnType) checkReturns(node, node.returnType, node.body, accept);
      continue;
    }
    if (isDomainServiceOperation(node) || isCommandHandler(node) || isQueryHandler(node)) {
      // An `extern` handler has no body here; its implementation is user code.
      if ((isCommandHandler(node) || isQueryHandler(node)) && node.extern) continue;
      checkBodyExpressions(node, accept);
      const body = isDomainServiceOperation(node) ? node.stmts : node.body;
      if (node.returnType) checkReturns(node, node.returnType, body, accept);
    }
  }
}

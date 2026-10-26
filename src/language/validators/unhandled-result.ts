// An `A or E` result whose `E` is an `error` must be handled.
//
// `operation withdraw(amt: money): Account or InsufficientCredit` declares the
// failure in its signature; that makes it a contract only if a caller cannot
// drop it. A call statement (`a.withdraw(amt)`) discards the result, and a
// workflow that does so answers 204 on `InsufficientCredit` — the
// exception-less twin of an exception nobody catches. So the result has to be
// matched, returned through a caller whose own declared result admits it, or
// bound and read; a `let` that binds it and is never read discards it too.
// There is no implicit propagation.
//
// Test and `ui` bodies are not judged: a test asserts on what it cares about,
// and a page handles a result through `match await`.

import { type AstNode, AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import {
  isAssignOrCallStmt,
  isComponent,
  isLetStmt,
  isNameRef,
  isPayloadDecl,
  isTestBlock,
  isTestE2E,
  isUi,
  type LetStmt,
  type Model,
} from "../generated/ast.js";
import { typeToString } from "../type-system.js";
import { typingFor } from "../typing/shared.js";
import type { Ty } from "../typing/ty.js";

function exempt(node: AstNode): boolean {
  return (
    AstUtils.getContainerOfType(node, isTestE2E) !== undefined ||
    AstUtils.getContainerOfType(node, isTestBlock) !== undefined ||
    AstUtils.getContainerOfType(node, isUi) !== undefined ||
    AstUtils.getContainerOfType(node, isComponent) !== undefined
  );
}

/** The `error` variants of a union result, by name; empty when there are none. */
function errorVariants(t: Ty | undefined): string[] {
  if (t?.kind !== "union") return [];
  return t.variants.flatMap((v) =>
    v.kind === "record" && v.shape.of === "payload" && isPayloadDecl(v.shape.ref)
      ? v.shape.ref.kind === "error"
        ? [v.shape.ref.name]
        : []
      : [],
  );
}

/** The declaration whose body a `let` is in: the nearest ancestor that is a
 *  member of something (an operation, a workflow's `create` / `handle` / `on`,
 *  a handler, a domain-service operation). */
function bodyOwner(node: AstNode): AstNode {
  for (let c: AstNode | undefined = node; c; c = c.$container) {
    if (c.$containerProperty === "members") return c;
  }
  return node.$container ?? node;
}

function isRead(let_: LetStmt): boolean {
  const typing = typingFor(let_);
  for (const n of AstUtils.streamAllContents(bodyOwner(let_))) {
    if (isNameRef(n) && n.name === let_.name && typing.bindingAt(n, n.name)?.origin === let_)
      return true;
    if (n.$type === "LValue" && (n as { head?: string }).head === let_.name) return true;
  }
  return false;
}

export function checkUnhandledResults(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    if (isAssignOrCallStmt(node) && !node.op && node.target.call) {
      if (exempt(node)) continue;
      const result = typingFor(node).lvalueCallResultAt(node.target);
      const errors = errorVariants(result);
      if (errors.length === 0) continue;
      const callee = [node.target.head, ...node.target.tail].join(".");
      accept(
        "error",
        diagMessage("loom.unhandled-result", {
          call: `${callee}(…)`,
          type: typeToString(result!),
          errors: errors.map((e) => `'${e}'`).join(", "),
        }),
        { node, property: "target", code: "loom.unhandled-result" },
      );
    } else if (isLetStmt(node)) {
      if (exempt(node)) continue;
      const result = typingFor(node).synthAt(node.expr);
      const errors = errorVariants(result);
      if (errors.length === 0 || isRead(node)) continue;
      accept(
        "error",
        diagMessage("loom.unhandled-result#unread-let", {
          name: node.name,
          type: typeToString(result!),
          errors: errors.map((e) => `'${e}'`).join(", "),
        }),
        { node, property: "name", code: "loom.unhandled-result" },
      );
    }
  }
}

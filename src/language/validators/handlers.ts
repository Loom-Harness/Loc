// Application-layer handler checks — the `extern` ↔ body pairing on
// `commandHandler` / `queryHandler` context members
// (unfoldable-api-derivation.md, Layer 3; extern-handler).
//
// The grammar admits BOTH a braced body (`{ … }`) and a bodyless `;` for either
// prefix, so the validator enforces the pairing (mirror of the `extern`
// component gate in `ui.ts`, `loom.extern-component-has-body`):
//
//   loom.extern-handler-has-body — an `extern` handler is bodyless by
//       definition (its impl is a scaffold-once user file the generated
//       dispatch calls), so a `{ body }` is a contradiction — write `;`.
//   loom.handler-missing-body — a non-extern handler runs a DSL body, so a
//       bodyless `;` has nothing to emit — write `{ … }`, or mark it `extern`.
//   loom.handler-starts-workflow — a handler body names a workflow (to start
//       it, `Fulfillment.create(…)`).  A handler has no way to start a workflow;
//       a workflow starts through its own command route.
//
// (The layering contracts — a queryHandler must not save, a commandHandler
// touches one aggregate — need the resolved IR and live in the phase-⑦
// `api-checks.ts`; these two are purely structural and gate at the AST side.)

import { type AstNode, AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import {
  type CommandHandler,
  isCommandHandler,
  isForStmt,
  isIfLetStmt,
  isLambda,
  isLetStmt,
  isLValue,
  isNameRef,
  isQueryHandler,
  isVariantArm,
  isVariantStmtArm,
  isWorkflow,
  type Model,
  type QueryHandler,
} from "../generated/ast.js";
import { modelContents } from "./model-contents.js";

/** True when a handler carries a braced `{ … }` body (vs. the bodyless `;`).  A
 *  non-empty `body` is unambiguously braced; for an EMPTY body — `{ }` and `;`
 *  both leave `body` empty — the discriminator is the node's trailing CST
 *  terminal (`}` vs `;`), the only place the two forms differ. */
function hasBracedBody(node: CommandHandler | QueryHandler): boolean {
  if (node.body.length > 0) return true;
  const text = (node.$cstNode?.text ?? "").trimEnd();
  return text.endsWith("}");
}

/** Enforce the `extern` ↔ body pairing on every `commandHandler` /
 *  `queryHandler` in the model (both context-member kinds share the rule). */
export function checkHandlerBodies(model: Model, accept: ValidationAcceptor): void {
  const workflows = new Set(
    modelContents(model)
      .filter(isWorkflow)
      .map((w) => w.name),
  );
  for (const node of modelContents(model)) {
    if (!isCommandHandler(node) && !isQueryHandler(node)) continue;
    const kind = isCommandHandler(node) ? "commandHandler" : "queryHandler";
    const braced = hasBracedBody(node);
    if (node.extern && braced) {
      accept("error", diagMessage("loom.extern-handler-has-body", { kind, name: node.name }), {
        node,
        property: "name",
        code: "loom.extern-handler-has-body",
      });
    } else if (!node.extern && !braced) {
      accept("error", diagMessage("loom.handler-missing-body", { kind, name: node.name }), {
        node,
        property: "name",
        code: "loom.handler-missing-body",
      });
    }
    // A name the handler binds itself (a parameter or a body binding) shadows
    // a workflow's.
    const params = new Set(node.params.map((pr) => pr.name));
    for (const n of node.body.flatMap((st) => [...AstUtils.streamAst(st)])) {
      if (isLetStmt(n)) params.add(n.name);
      else if (isIfLetStmt(n) || isForStmt(n)) params.add(n.var);
      else if ((isVariantStmtArm(n) || isVariantArm(n)) && n.binding) params.add(n.binding);
      else if (isLambda(n)) params.add(n.param);
    }
    for (const stmt of node.body) {
      // An expression reads a name as a `NameRef`; a call statement
      // (`Fulfillment.create(…)`) spells its receiver as an `LValue` head.
      const refs = AstUtils.streamAst(stmt).flatMap((n): { ref: AstNode; name: string }[] =>
        isNameRef(n)
          ? [{ ref: n, name: n.name }]
          : isLValue(n) && !n.thisRef
            ? [{ ref: n, name: n.head }]
            : [],
      );
      for (const { ref, name } of refs) {
        if (!workflows.has(name) || params.has(name)) continue;
        accept(
          "error",
          diagMessage("loom.handler-starts-workflow", {
            kind,
            name: node.name,
            workflow: name,
          }),
          { node: ref, code: "loom.handler-starts-workflow" },
        );
      }
    }
  }
}

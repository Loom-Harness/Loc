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
//   loom.handler-starts-workflow — a handler body, or a workflow's `create` /
//       `on` body, names a workflow (to start it, `Fulfillment.create(…)`).
//       A caller starts a workflow only by emitting an event the workflow's
//       event-started `create(e: …) by …` reacts to, after the caller commits.
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
  isOnDecl,
  isProperty,
  isQueryHandler,
  isVariantArm,
  isVariantStmtArm,
  isWorkflow,
  isWorkflowCreateDecl,
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
    refuseWorkflowNames(
      `${kind} '${node.name}'`,
      node.params.map((pr) => pr.name),
      node.body,
      workflows,
      accept,
    );
  }
  // A workflow body starts another workflow the same way a handler cannot: by
  // name.  Its own fields and the reactor's event param are bound names.
  for (const wf of modelContents(model).filter(isWorkflow)) {
    const fields = wf.members.filter(isProperty).map((p) => p.name);
    for (const m of wf.members) {
      if (isWorkflowCreateDecl(m)) {
        refuseWorkflowNames(
          `workflow '${wf.name}' create${m.name ? ` ${m.name}` : ""}`,
          [...fields, ...m.params.map((pr) => pr.name)],
          m.body,
          workflows,
          accept,
        );
      } else if (isOnDecl(m)) {
        refuseWorkflowNames(
          `workflow '${wf.name}' on(${m.event.$refText})`,
          [...fields, m.param],
          m.body,
          workflows,
          accept,
        );
      }
    }
  }
}

/** Report every name in `body` that resolves to a workflow and that the
 *  caller does not bind itself (a parameter, field or body binding). */
function refuseWorkflowNames(
  caller: string,
  bound: readonly string[],
  body: readonly AstNode[],
  workflows: ReadonlySet<string>,
  accept: ValidationAcceptor,
): void {
  const names = new Set(bound);
  const nodes = body.flatMap((st) => [...AstUtils.streamAst(st)]);
  for (const n of nodes) {
    if (isLetStmt(n)) names.add(n.name);
    else if (isIfLetStmt(n) || isForStmt(n)) names.add(n.var);
    else if ((isVariantStmtArm(n) || isVariantArm(n)) && n.binding) names.add(n.binding);
    else if (isLambda(n)) names.add(n.param);
  }
  for (const n of nodes) {
    // An expression reads a name as a `NameRef`; a call statement
    // (`Fulfillment.create(…)`) spells its receiver as an `LValue` head.
    const name = isNameRef(n) ? n.name : isLValue(n) && !n.thisRef ? n.head : undefined;
    if (name === undefined || !workflows.has(name) || names.has(name)) continue;
    accept("error", diagMessage("loom.handler-starts-workflow", { caller, workflow: name }), {
      node: n,
      code: "loom.handler-starts-workflow",
    });
  }
}

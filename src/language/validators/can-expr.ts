// A permission query `can o.op(args)` names a bound aggregate, one of its
// operations, and that operation's arguments.  Lowering answers it with the
// operation's own gates, so each of the three has to resolve: a receiver that
// is not an aggregate (`loom.can-receiver`), an operation it does not declare
// (`loom.can-operation`), or arguments that do not match the operation's
// parameters (`loom.can-args`) would leave nothing to answer with.

import { AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import { isCanExpr, isOperation, type Model, type Operation } from "../generated/ast.js";
import { envForNode, typeOf } from "../type-system.js";

export function checkCanExprs(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    if (!isCanExpr(node)) continue;
    const name = node.receiver.name;
    const ty = typeOf(node.receiver, envForNode(node));
    if (ty.kind === "unknown") continue;
    if (ty.kind !== "record" || ty.shape.of !== "aggregate") {
      accept("error", diagMessage("loom.can-receiver", { name, op: node.op }), {
        node,
        property: "receiver",
        code: "loom.can-receiver",
      });
      continue;
    }
    const agg = ty.shape.ref;
    const op = agg.members.find((m): m is Operation => isOperation(m) && m.name === node.op);
    if (!op) {
      accept(
        "error",
        diagMessage("loom.can-operation", { aggregate: agg.name, name, op: node.op }),
        { node, property: "op", code: "loom.can-operation" },
      );
      continue;
    }
    if (node.args.length !== op.params.length) {
      accept(
        "error",
        diagMessage("loom.can-args", {
          aggregate: agg.name,
          op: node.op,
          expected: op.params.length,
          actual: node.args.length,
        }),
        { node, code: "loom.can-args" },
      );
    }
  }
}

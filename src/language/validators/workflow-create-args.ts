// `Agg.create(…)` in a workflow or handler body whose argument list maps onto
// no create-input record (`loom.workflow-create-args`).
//
// A body creates an aggregate through its factory, whose input on every
// backend is a record keyed by field name.  The positional (`Agg.create(a,
// b)`), named (`Agg.create(x: a)`) and record (`Agg.create({ x: a })`) shapes
// all lower to that record — positions in the create input's order
// (`language/factory-call.ts`) — and so to the same saved `create` effect.
// An argument list that names no record is refused here, rather than falling
// through to a plain call that nothing saves: more positions than inputs,
// positional and named arguments mixed, a name that is not an input, or the
// same name twice.
//
// Phase ④, beside `loom.workflow-explicit-save`: the call shape is visible
// here with its span, and the zone is the one `stmt-placement.ts` decides.

import { AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import { factoryArgs } from "../factory-call.js";
import {
  isAggregate,
  isBoundedContext,
  isMemberSuffix,
  isNameRef,
  isPostfixChain,
  type Model,
} from "../generated/ast.js";
import { describeOwner, zoneOf } from "./stmt-placement.js";

export function checkWorkflowCreateArgs(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    if (!isPostfixChain(node) || !isNameRef(node.head)) continue;
    const first = node.suffixes[0];
    if (!first || !isMemberSuffix(first) || !first.call || first.member !== "create") continue;
    const aggName = node.head.name;
    const ctx = AstUtils.getContainerOfType(node, isBoundedContext);
    const agg = ctx?.members.find((m) => isAggregate(m) && m.name === aggName);
    if (!agg || !isAggregate(agg)) continue;
    if (zoneOf(node) !== "workflow") continue;
    const mapped = factoryArgs(agg, first.args);
    const owner = describeOwner(node);
    const inputs = mapped.kind === "arity" || mapped.kind === "unknown-name" ? mapped.inputs : [];
    const list = inputs.length > 0 ? inputs.map((n) => `'${n}'`).join(", ") : "(none)";
    switch (mapped.kind) {
      case "fields":
        continue;
      case "mixed":
        accept("error", diagMessage("loom.workflow-create-args#mixed", { agg: aggName, owner }), {
          node,
          code: "loom.workflow-create-args",
        });
        continue;
      case "arity":
        accept(
          "error",
          diagMessage("loom.workflow-create-args", {
            agg: aggName,
            owner,
            given: mapped.given,
            count: inputs.length,
            inputs: list,
          }),
          { node, code: "loom.workflow-create-args" },
        );
        continue;
      case "unknown-name":
        accept(
          "error",
          diagMessage("loom.workflow-create-args#unknown-name", {
            agg: aggName,
            owner,
            name: mapped.name,
            inputs: list,
          }),
          { node, code: "loom.workflow-create-args" },
        );
        continue;
      case "duplicate":
        accept(
          "error",
          diagMessage("loom.workflow-create-args#duplicate", {
            agg: aggName,
            owner,
            name: mapped.name,
          }),
          { node, code: "loom.workflow-create-args" },
        );
        continue;
      default: {
        const _exhaustive: never = mapped;
        void _exhaustive;
        continue;
      }
    }
  }
}

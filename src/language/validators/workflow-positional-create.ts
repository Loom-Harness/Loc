// `Agg.create(…)` in a workflow or handler body with anything but ONE record
// argument (`loom.workflow-positional-create`).
//
// A body creates an aggregate through its factory, whose input on every
// backend is a record keyed by field name (`static create(input: { … })` on
// node, the create-input record on .NET / java / python, a map on elixir) —
// and a declared `create(a: A, b: B)` does not change that: its parameters
// ARE the record's fields.  The lowering recognises exactly the record form
// (`Agg.create({ field: value, … })`) as a `create` effect, which is what binds
// the new aggregate for the exit save.  A positional (`Agg.create(a, b)`), named
// (`Agg.create(a: x)`) or empty argument list matched nothing, fell through to
// a plain call, and the aggregate was never saved — on node the call did not
// even typecheck against the record-typed factory.  Refused, pointing at the
// record form, rather than guessing which field each position means.
//
// Phase ④, beside `loom.workflow-explicit-save`: the call shape is visible
// here with its span, and the zone is the one `stmt-placement.ts` decides.

import { AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import {
  isAggregate,
  isBoundedContext,
  isMemberSuffix,
  isNameRef,
  isObjectLit,
  isPostfixChain,
  type Model,
} from "../generated/ast.js";
import { describeOwner, zoneOf } from "./stmt-placement.js";

export function checkWorkflowPositionalCreate(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    if (!isPostfixChain(node) || !isNameRef(node.head)) continue;
    const first = node.suffixes[0];
    if (!first || !isMemberSuffix(first) || !first.call || first.member !== "create") continue;
    const only = first.args.length === 1 ? first.args[0] : undefined;
    if (only && !only.name && isObjectLit(only.value)) continue;
    const aggName = node.head.name;
    const ctx = AstUtils.getContainerOfType(node, isBoundedContext);
    if (!ctx?.members.some((m) => isAggregate(m) && m.name === aggName)) continue;
    if (zoneOf(node) !== "workflow") continue;
    accept(
      "error",
      diagMessage("loom.workflow-positional-create", { agg: aggName, owner: describeOwner(node) }),
      { node, code: "loom.workflow-positional-create" },
    );
  }
}

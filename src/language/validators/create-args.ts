// The argument list of an aggregate factory call `Agg.create(…)`
// (`loom.create-args`, `loom.create-record-form`).
//
// An aggregate's `create` is a lifecycle method, called like any other method:
// positional (`Agg.create(a, b)`) or named (`Agg.create(x: a)`).  Both lower,
// in every position — a domain body, a workflow or handler, a unit test, a
// seed — to the one create-input record every backend's factory takes,
// positions in the create input's order (`language/factory-call.ts`).
//
// Two shapes are refused here, wherever the call sits:
//   - the record form `Agg.create({ x: a })`, which leaked the create-command
//     wire record into the domain language (D-CREATE-CALL-STYLE); the message
//     names the call form and the codemod that rewrites it;
//   - an argument list that names no record: more positions than inputs,
//     positional and named arguments mixed, a name that is not an input, or
//     the same name twice.
//
// A writable field a declared `create(…)` leaves out is named as such: it
// takes its declared default and is no factory input.  A name that is no
// writable field at all is left to `loom.create-unknown-field` /
// `loom.create-server-field` (`builder-call.ts`), which say whether the name
// is server-owned or a typo.
//
// `api.orders.create({ … })` in a `test e2e` body is an HTTP client call whose
// argument is the request body; its receiver is a member chain, not an
// aggregate name, so `factoryCallOf` never matches it.

import { AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import {
  declaredCreateParams,
  factoryArgs,
  factoryCallOf,
  factoryInputFieldNames,
  isRecordFormCreate,
} from "../factory-call.js";
import { isTestBlock, type Model } from "../generated/ast.js";
import { describeOwner } from "./stmt-placement.js";

export function checkCreateArgs(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    const fc = factoryCallOf(node);
    if (!fc) continue;
    const { agg, call } = fc;
    const test = AstUtils.getContainerOfType(node, isTestBlock);
    const owner = test ? `test "${test.name}"` : describeOwner(node);
    if (isRecordFormCreate(call.args)) {
      accept("error", diagMessage("loom.create-record-form", { agg: agg.name, owner }), {
        node: call.args[0]!,
        code: "loom.create-record-form",
      });
      continue;
    }
    const mapped = factoryArgs(agg, call.args);
    const inputs = mapped.kind === "arity" || mapped.kind === "unknown-name" ? mapped.inputs : [];
    const list = inputs.length > 0 ? inputs.map((n) => `'${n}'`).join(", ") : "(none)";
    switch (mapped.kind) {
      case "fields":
        continue;
      case "mixed":
        accept("error", diagMessage("loom.create-args#mixed", { agg: agg.name, owner }), {
          node,
          code: "loom.create-args",
        });
        continue;
      case "arity":
        accept(
          "error",
          diagMessage("loom.create-args", {
            agg: agg.name,
            owner,
            given: mapped.given,
            count: inputs.length,
            inputs: list,
          }),
          { node, code: "loom.create-args" },
        );
        continue;
      case "unknown-name":
        // A writable field the declared `create(…)` leaves out takes its
        // default.  A name that is no writable field at all is the field
        // gate's (`loom.create-unknown-field` / `loom.create-server-field`).
        if (!declaredCreateParams(agg) || !factoryInputFieldNames(agg).includes(mapped.name)) {
          continue;
        }
        accept(
          "error",
          diagMessage("loom.create-args#not-in-create", {
            agg: agg.name,
            owner,
            name: mapped.name,
            inputs: list,
          }),
          { node, code: "loom.create-args" },
        );
        continue;
      case "duplicate":
        accept(
          "error",
          diagMessage("loom.create-args#duplicate", {
            agg: agg.name,
            owner,
            name: mapped.name,
          }),
          { node, code: "loom.create-args" },
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

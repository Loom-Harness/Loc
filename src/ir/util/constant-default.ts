// Whether a field's `= <default>` is a compile-time CONSTANT — a value every
// backend's domain create factory can materialize itself, with no runtime
// context (no clock, no principal, no lookup, no value-object constructor).
//
// The set: a literal (`"A1"`, `7`, `true`, `null`, `money("2.50")`), an enum
// member (`Requested`), and a paren / unary over one (`-1`, `!true`).
//
// Two consumers ask the same question, so it is answered once here:
//   * the emitters' construction seed (`src/generator/construction-default.ts`)
//     — which defaults the factory writes for a field outside the create input;
//   * the IR gate that a narrowed `create(…)` leaves out only fields the
//     factory can initialise (`loom.create-param-required-omitted`).
// Were they to disagree, the gate would accept a field the factory then seeds
// with the type zero.

import type { ExprIR } from "../types/loom-ir.js";

const CONSTANT_LITERALS: ReadonlySet<string> = new Set([
  "string",
  "bool",
  "int",
  "long",
  "decimal",
  "money",
  "null",
]);

export function isConstantDefault(e: ExprIR): boolean {
  switch (e.kind) {
    case "literal":
      return CONSTANT_LITERALS.has(e.lit);
    case "ref":
      return e.refKind === "enum-value";
    case "paren":
      return isConstantDefault(e.inner);
    case "unary":
      return isConstantDefault(e.operand);
    case "action-ref":
    case "authz-filter":
    case "binary":
    case "call":
    case "convert":
    case "duration":
    case "i18nFormat":
    case "id":
    case "lambda":
    case "list":
    case "match":
    case "member":
    case "method-call":
    case "new":
    case "object":
    case "ternary":
    case "this":
      return false;
    default: {
      const _exhaustive: never = e;
      void _exhaustive;
      return false;
    }
  }
}

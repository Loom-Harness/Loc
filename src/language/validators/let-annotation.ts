// `let x: T = e` — the value must fit the declared type. A bare numeric literal
// promotes to it (`let z: long = 1`, `let fee: money = 5`), as it does for an
// assignment or a property default.

import { AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import { isLetStmt, type Model } from "../generated/ast.js";
import { envForNode, isAssignable, resolveTypeRef, typeOf, typeToString } from "../type-system.js";
import { canPromoteLiteralTo, warnSensitivityDrop } from "./_shared.js";

export function checkLetAnnotations(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    if (!isLetStmt(node) || !node.type) continue;
    const declared = resolveTypeRef(node.type);
    // An unresolved declared type is reported where it is written.
    if (declared.kind === "unknown") continue;
    const actual = typeOf(node.expr, envForNode(node.expr));
    if (
      actual.kind !== "unknown" &&
      !isAssignable(actual, declared) &&
      !canPromoteLiteralTo(node.expr, declared)
    ) {
      accept(
        "error",
        diagMessage("loom.let-type-mismatch", {
          name: node.name,
          actual: typeToString(actual),
          declared: typeToString(declared),
        }),
        { node, property: "expr", code: "loom.let-type-mismatch" },
      );
    }
    warnSensitivityDrop(actual, declared, accept, { node, property: "expr" });
  }
}

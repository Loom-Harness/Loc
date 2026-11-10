// A transport record or a named union written as a type outside the positions
// the type-position table admits it (`../type-positions.ts`).
//
// The scope provider resolves these names in every type position — behind the
// ordinary types outside the transport boundaries — so the refusal names the
// declaration that was written and the position it was written in, with the
// table's code, instead of "Unknown type".

import { AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import { isEventDecl, isNamedType, isPayloadDecl, type Model } from "../generated/ast.js";
import {
  admittedPositionsText,
  namedTypePosition,
  positionLabel,
  positionRule,
} from "../type-positions.js";

export function checkTransportTypePositions(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    if (!isNamedType(node)) continue;
    const target = node.target?.ref;
    if (!target || !(isEventDecl(target) || isPayloadDecl(target))) continue;
    const named = isPayloadDecl(target) && target.variants.length > 0;
    const form = named ? "named-union" : "transport-record";
    const position = namedTypePosition(node);
    const rule = positionRule(form, position);
    if (rule.verdict !== "refused") continue;
    if (named) {
      accept(
        "error",
        diagMessage("loom.union-position#named", {
          name: target.name,
          position: positionLabel(position),
          positions: admittedPositionsText("named-union"),
          inline: admittedPositionsText("inline-union"),
        }),
        { node, property: "target", code: rule.code },
      );
      continue;
    }
    const kind = isEventDecl(target) ? "an event" : `${article(target.kind)} ${target.kind}`;
    accept(
      "error",
      diagMessage("loom.transport-type-position", {
        name: target.name,
        kind,
        position: positionLabel(position),
        positions: admittedPositionsText("transport-record"),
      }),
      { node, property: "target", code: rule.code },
    );
  }
}

function article(word: string): string {
  return /^[aeiou]/.test(word) ? "an" : "a";
}

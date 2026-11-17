// A transport record or a named union written as a type outside the positions
// the type-position table admits it (`../type-positions.ts`).
//
// The scope provider resolves these names in every type position — behind the
// ordinary types outside the transport boundaries — so the refusal names the
// declaration that was written and the position it was written in, with the
// table's code, instead of "Unknown type".

import type { ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import { AUDIT_ENTRY_TYPE } from "../../util/audit-names.js";
import {
  isEventDecl,
  isNamedType,
  isPayloadDecl,
  isPrimitiveType,
  isTypeAtom,
  isTypeRef,
  type Model,
} from "../generated/ast.js";
import {
  admittedPositionsText,
  namedTypePosition,
  positionLabel,
  positionRule,
  typeRefPosition,
} from "../type-positions.js";
import { modelContents } from "./model-contents.js";

export function checkTransportTypePositions(model: Model, accept: ValidationAcceptor): void {
  for (const node of modelContents(model)) {
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

/** `AuditEntry` — the built-in record a history read answers — stands only as a
 *  queryHandler's `AuditEntry[]` return: the one place the read's list reaches
 *  a caller.  No backend stores, accepts or nests one. */
export function checkAuditEntryPositions(model: Model, accept: ValidationAcceptor): void {
  for (const node of modelContents(model)) {
    if (!(isTypeRef(node) || isTypeAtom(node))) continue;
    if (!isPrimitiveType(node.base) || node.base.name !== AUDIT_ENTRY_TYPE) continue;
    // A macro copies a refused field into the records it synthesises; the
    // refusal stands once, where the author wrote it.
    if (!node.base.$cstNode?.text.includes(AUDIT_ENTRY_TYPE)) continue;
    const position = typeRefPosition(node);
    const rule = positionRule("builtin-record", position);
    if (rule.verdict === "refused") {
      accept(
        "error",
        diagMessage("loom.audit-entry-position", {
          position: positionLabel(position),
          positions: admittedPositionsText("builtin-record"),
        }),
        { node, code: rule.code },
      );
      continue;
    }
    const list =
      node.array &&
      !node.optional &&
      node.ctors.length === 0 &&
      !(isTypeRef(node) && node.alternatives.length > 0);
    if (!list)
      accept("error", diagMessage("loom.audit-entry-position#list", {}), {
        node,
        code: "loom.audit-entry-position",
      });
  }
}

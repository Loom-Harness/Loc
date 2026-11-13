// The backstop behind "lowering reads only the typing pass": every expression
// lowering read whose type the pass could not resolve was recorded on the
// model (`LoomModel.unresolvedTypes`), and here it fails validation.
//
// An author error usually explains the hole already — an unresolved name, an
// unknown e2e handle — and its own diagnostic is the one worth reading.  So the
// backstop speaks only when nothing else refused the model; a host that also
// holds the AST layer's diagnostics drops it the same way when those carry an
// error (`src/api`).  Either way a model with an unresolved type never reaches
// codegen, where its expressions would carry a placeholder type.

import { diagMessage } from "../../../diagnostics/messages.js";
import type { EnrichedLoomModel } from "../../types/loom-ir.js";
import type { LoomDiagnostic } from "./diagnostic.js";

export const UNRESOLVED_TYPE_CODE = "loom.unresolved-type";

export function validateUnresolvedTypes(loom: EnrichedLoomModel, diags: LoomDiagnostic[]): void {
  if (diags.some((d) => d.severity === "error")) return;
  for (const site of loom.unresolvedTypes) {
    diags.push({
      severity: "error",
      code: UNRESOLVED_TYPE_CODE,
      message: diagMessage("loom.unresolved-type", { text: site.text, why: why(site.cause) }),
      source: site.text,
      ...(site.origin ? { origin: site.origin } : {}),
    });
  }
}

/** The typing pass's reason, in the author's terms. */
function why(cause: string): string {
  switch (cause) {
    case "unresolved-name":
      return "it names nothing in scope";
    case "unresolved-member":
      return "its receiver has no such member";
    case "unresolved-type":
      return "its declared type does not resolve";
    case "contextual-lambda":
      return "nothing here gives this lambda's parameter a type";
    default:
      return "no typing rule covers this expression";
  }
}

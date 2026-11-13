// The backstop behind "lowering produces a well-formed IR": every place
// `verifyLoweredModel` found the lowered IR disagreeing with itself was
// recorded on the model (`LoomModel.loweringViolations`), and here it fails
// validation as an internal error naming the `.ddd` span.
//
// A violation is a compiler defect, not an author error — but on a model some
// other check already refuses, the author error usually explains it (a
// recovered AST lowers to half-resolved names), so the backstop speaks only
// when nothing else refused the model.  A host holding the AST layer's
// diagnostics drops it the same way when those carry an error (`src/api`).

import { diagMessage } from "../../../diagnostics/messages.js";
import type { EnrichedLoomModel } from "../../types/loom-ir.js";
import { formatViolation } from "../../verify/verify-lowered.js";
import type { LoomDiagnostic } from "./diagnostic.js";

export const IR_ILL_FORMED_CODE = "loom.ir-ill-formed";

export function validateLoweringViolations(loom: EnrichedLoomModel, diags: LoomDiagnostic[]): void {
  if (diags.some((d) => d.severity === "error")) return;
  for (const v of loom.loweringViolations) {
    diags.push({
      severity: "error",
      code: IR_ILL_FORMED_CODE,
      message: diagMessage("loom.ir-ill-formed", { violation: formatViolation(v) }),
      source: v.where,
      ...(v.origin ? { origin: v.origin } : {}),
    });
  }
}

// -------------------------------------------------------------------------
// UI ↔ backend wiring gates.
//
// A frontend deployable names ONE backend in `targets:`, and that is what its
// generated surface is built from: enrichment copies the target's
// `contextNames` onto the frontend so the page emitter has every served
// aggregate's wire shape in scope, and the emitted client reads ONE
// `API_BASE_URL`.
//
// A `ui` may nevertheless declare several api parameters and bind each to a
// different backend (`ui: U { O: apiOne, T: apiTwo }`).  That parses, binds,
// and type-checks in the model — and then the two halves disagree: only the
// `targets:` backend's aggregates reach the emitter, so a page reading the
// second handle imports an api module that is never written
// (`TS2307: Cannot find module '../api/beta'`) while compose bakes a single
// `VITE_API_BASE_URL` pointing at the first backend.  `0 error(s), 0
// warning(s)`, 101 files, a frontend that does not build.
//
// Until per-handle clients and base URLs land, the honest answer is to refuse
// the combination rather than emit a bundle whose requests go to a backend
// that does not serve them.  Refusing costs nothing today: the shape does not
// compile, so no working model can be relying on it.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import type { SystemIR } from "../../types/loom-ir.js";
import type { LoomDiagnostic } from "./diagnostic.js";

export function validateUiBackendBindings(sys: SystemIR, diags: LoomDiagnostic[]): void {
  for (const d of sys.deployables) {
    const bindings = d.uiBindings ?? [];
    if (bindings.length < 2) continue;
    // Several handles onto the SAME backend is the ordinary case (one contract
    // per subdomain, one service serving them all) and is fully supported —
    // only a genuine fan-out across distinct deployables is the unsupported
    // shape.
    const sources = [...new Set(bindings.map((b) => b.sourceDeployableName))].sort();
    if (sources.length < 2) continue;
    // Deterministic, and it names the handles the author wrote rather than
    // just the backends, because the handle is what they would edit.
    const pairs = bindings
      .slice()
      .sort((a, b) => a.paramName.localeCompare(b.paramName))
      .map((b) => `${b.paramName} → ${b.sourceDeployableName}`)
      .join(", ");
    diags.push({
      severity: "error",
      code: "loom.ui-multi-backend-unsupported",
      message: diagMessage("loom.ui-multi-backend-unsupported", {
        dName: d.name,
        uiName: d.uiName ?? "(none)",
        pairs,
        targetName: d.targetName ?? "(none)",
        count: sources.length,
      }),
      source: `${d.name}/${d.uiName ?? "ui"}`,
    });
  }
}

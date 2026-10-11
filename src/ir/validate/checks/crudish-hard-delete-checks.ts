// ---------------------------------------------------------------------------
// crudish hard-delete advisory (#3229 follow-up, banking eval #3137).
//
// THE SHAPE.  `aggregate Account with softDeletable, crudish { … }` — the
// author adds the soft-delete capability and expects `DELETE /accounts/{id}`
// to soft-delete.  It does not: `crudish` synthesises the canonical `destroy`,
// which every backend emits as a physical row DELETE.  `softDeletable` is a
// pure mixin (the `isDeleted`/`deletedAt` state and the `!this.isDeleted` read
// filter); the soft-delete OPERATION is the `softDelete` macro's
// `POST /{id}/soft_delete`.
//
// WHY AN ADVISORY, AND NOT A BEHAVIOUR CHANGE.  The hard delete is documented
// and deliberate.  `docs/scaffold-macros.md` gives the composition rule —
// `with crudish(updateOnly: true), softDeletable` "leaves the soft-delete
// terminator uncontested" — and the showcase/corpus models are written that
// way on purpose.  A capability that silently rewrote another macro's
// operation would also break the "capabilities are pure mixins" contract
// (`docs/capabilities.md`), and a retained hard delete has real uses (an admin
// purge, GDPR erasure).  So the shape is legal and the remedy is one keyword:
// the gap is DISCOVERABILITY, which is what this says.
//
// Delivery: the `Suggestions:` channel (`src/diagnostics/advisory.ts`) —
// warning severity, kept out of the warning count, never gates.
// ---------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import type { EnrichedSystemIR } from "../../types/loom-ir.js";
import type { LoomDiagnostic } from "./diagnostic.js";

export function validateCrudishHardDelete(sys: EnrichedSystemIR, diags: LoomDiagnostic[]): void {
  for (const mod of sys.subdomains) {
    for (const ctx of mod.contexts) {
      for (const agg of ctx.aggregates) {
        if (!(agg.capabilities?.includes("softDeletable") ?? false)) continue;
        const destroy = agg.canonicalDestroy;
        // Only the destroy `crudish` synthesised: a hand-written `destroy {}`
        // is the author's own, explicit choice of a hard delete.
        if (!destroy || destroy.origin?.kind !== "macro" || destroy.origin.macro !== "crudish") {
          continue;
        }
        diags.push({
          severity: "warning",
          code: "loom.crudish-hard-delete",
          message: diagMessage("loom.crudish-hard-delete", { name: agg.name }),
          source: `${ctx.name}/${agg.name}`,
          origin: agg.origin,
        });
      }
    }
  }
}

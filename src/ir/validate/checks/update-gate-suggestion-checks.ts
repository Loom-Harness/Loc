// ---------------------------------------------------------------------------
// Update-gate advisory lint (audit D3, `docs/audits/2026-09-10-claimshub-dev-
// experience.md`).
//
// THE SHAPE.  `crudish` synthesises a generic `update(...)` that assigns every
// writable update field.  When the author then grows a guarded state-machine
// operation on the same aggregate —
//
//     aggregate Claim with crudish {
//       status: ClaimStatus
//       operation approve() {
//         requires currentUser.permissions.contains(permissions.claimsApprove)
//         precondition status == UnderReview
//         status := Approved
//       }
//     }
//
// — `POST /claims/{id}/update {"status":"Approved"}` writes `status` at
// whatever gate the *update* carries, skipping both the `requires` on
// `approve()` and its `precondition`.  It is a state-machine bypass, not only
// an authorization one, and `with crudish(requires: <Policy>)` does not close
// it: that gate is per-member and identical across create/update/destroy,
// while the update still writes every field.
//
// WHY AN ADVISORY, AND NOT AN AUTO-EXCLUSION.  The obvious fix — teach
// `writableUpdateFields` to drop any field a gated operation assigns, the way
// it already drops stamp targets — was considered and rejected.  `docs/
// language.md` § "Field access modifiers" defines a complete six-state matrix
// (`editable` default, `immutable`, `managed`, `token`, `internal`, `secret`)
// whose every column is a real projection in `src/ir/enrich/wire-projection.ts`.
// A field with no modifier is DECLARED `editable` — the author has said it
// participates in the update input.  Silently overriding that would add an
// invisible seventh state: a field's wire participation would no longer be
// readable off the field, you would have to scan every operation body in the
// aggregate.
//
// And the state the audit thought was missing already exists.  `immutable` is
// read ✓ / create ✓ / update ✗, and its enforcement is purely wire-side —
// nothing forbids `status := Approved` inside an operation body on an
// `immutable` field, on any of the five backends (verified by generating and
// compiling all five).  So `status: ClaimStatus immutable` closes both holes at
// once: the client still reads it, `create` still seeds it, the generic update
// can no longer touch it, and `approve()` still assigns it server-side.
//
// D3 is therefore a DISCOVERABILITY gap — nothing pointed at `immutable` —
// which is what this advisory fixes.  It is advice, not a verdict: there are
// legitimate models where the author really does want the field editable.
//
// SCOPE — `requires`-gated operations only.  A field assigned by an operation
// carrying only a `precondition` has the same state-machine bypass, but
// triggering on that would fire on a large fraction of real models (every
// scaffolded aggregate that grows any state transition).  Deferred as a
// deliberate second axis rather than silently included or silently dropped.
//
// Delivery: the advisory channel `loom.index-suggestion` already uses — a
// WARNING-severity diagnostic on the normal `validateLoomModel` output, kept
// out of the warning count and printed under `ddd parse`'s `Suggestions:`
// footer (`isAdvisoryCode`, `src/diagnostics/advisory.ts`).  Never gates.
// ---------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import type {
  EnrichedAggregateIR,
  EnrichedSystemIR,
  OperationIR,
  StmtIR,
} from "../../types/loom-ir.js";
import { operationIsGuarded } from "../../types/loom-ir.js";
import { walkStmtsDeep } from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";

/** The `update` operation `crudish` synthesised on this aggregate, if any.
 *  Identified by its macro origin rather than by name alone, so a HAND-WRITTEN
 *  `operation update(...)` — which the author gates themselves — is not
 *  mistaken for the generic mass-assigning one. */
function crudishUpdate(agg: EnrichedAggregateIR): OperationIR | undefined {
  return agg.operations.find(
    (op) => op.name === "update" && op.origin?.kind === "macro" && op.origin.macro === "crudish",
  );
}

/** Aggregate-field names this body writes with a bare `field := …`.  Rides
 *  `walkStmtsDeep` so an assignment nested in a `variant-match` arm or a
 *  block-bodied lambda counts, rather than a hand-rolled one-level scan. */
function assignedFieldNames(statements: readonly StmtIR[]): Set<string> {
  const out = new Set<string>();
  const visit = (s: StmtIR): void => {
    if (s.kind !== "assign") return;
    // Single-segment path ⇒ the aggregate's own field.  A deeper path
    // (`part.field`) writes through a containment, which the generic update
    // never touches (it assigns only wire-shape scalars).
    if (s.target.segments.length === 1 && s.target.segments[0]) {
      out.add(s.target.segments[0]);
    }
  };
  for (const s of statements) walkStmtsDeep(s, visit);
  return out;
}

export function validateUpdateGateSuggestions(
  sys: EnrichedSystemIR,
  diags: LoomDiagnostic[],
): void {
  for (const mod of sys.subdomains) {
    for (const ctx of mod.contexts) {
      for (const agg of ctx.aggregates) {
        const update = crudishUpdate(agg);
        if (!update) continue;
        // What the generic update actually writes — the fields
        // `writableUpdateFields` admitted, read off the emitted body.
        const massAssigned = assignedFieldNames(update.statements);
        if (massAssigned.size === 0) continue;

        // Deterministic order: declared field order, then declared operation
        // order, so a multi-hit aggregate reports stably.
        for (const f of agg.fields) {
          if (!massAssigned.has(f.name)) continue;
          const gated = agg.operations.find(
            (op) =>
              op !== update &&
              op.visibility !== "private" &&
              operationIsGuarded(op) &&
              assignedFieldNames(op.statements).has(f.name),
          );
          if (!gated) continue;
          diags.push({
            severity: "warning",
            code: "loom.update-gate-suggestion",
            message: diagMessage("loom.update-gate-suggestion", {
              name: agg.name,
              fName: f.name,
              opName: gated.name,
            }),
            source: `${ctx.name}/${agg.name}`,
          });
        }
      }
    }
  }
}

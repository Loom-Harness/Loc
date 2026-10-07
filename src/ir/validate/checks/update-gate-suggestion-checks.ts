// ---------------------------------------------------------------------------
// Update-gate bypass lint (audit D3, `docs/audits/2026-09-10-claimshub-dev-
// experience.md`; helpdesk eval H-01 for the `when` / `precondition` gates).
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
// which is what this warning fixes.  The field is never silently made
// non-editable; the author picks the modifier.
//
// SCOPE — an operation that GATES the field.  Three gate shapes count, each
// a declared claim by the author that the field moves only under a condition:
//
//   * `requires …`            — an authorization gate on the operation;
//   * `when …`                — the canCommand state gate (the canonical state
//                               machine, `operation close() when status ==
//                               Resolved { status := Closed }`, helpdesk eval
//                               H-01);
//   * `precondition …` that READS the field it assigns and no operation
//                               parameter — the same state-machine shape spelled
//                               in the body (`precondition status == Open;
//                               status := Resolved`), i.e. exactly what a `when`
//                               may say.
//
// A `precondition` over OTHER fields only, or one that compares the field with
// an argument (`precondition stockLevel >= qty`), validates the call's inputs
// rather than gating the field's state, so it does not count.
// A field the generic update alone writes — no gated operation touches it — is
// ordinary editable data and never fires.
//
// CREATE.  The field is on the create input too (every update-writable field
// is), so a client can also seed any state at `POST /<plural>`.  `immutable`
// does not close that half; when the field declares a default, `managed` does
// (off both inputs, initialised from the default, still assignable by the
// operation), and the message says so.  Advice, not an auto-fix: an aggregate
// whose clients legitimately pick the initial state keeps `immutable`.
//
// SEVERITY — a counted WARNING, not an advisory hint.  Each trigger is a
// real bypass of a gate the author wrote, and none has a legitimate reading
// (a transition gated on its own route but open on another is a hole, not a
// design).  Warnings never affect an exit code, and the code name stays
// `…-suggestion` for stability of anything keyed on it.
// ---------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import type {
  EnrichedAggregateIR,
  EnrichedSystemIR,
  ExprIR,
  OperationIR,
  StmtIR,
} from "../../types/loom-ir.js";
import { operationIsGuarded } from "../../types/loom-ir.js";
import { walkExprDeep, walkStmtsDeep } from "../../util/walk.js";
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

/** True when `e` is a pure state predicate over the field `fName` — it reads
 *  that field and no operation parameter (the shape `when` itself requires). */
function isStateGateOn(e: ExprIR, fName: string): boolean {
  let readsField = false;
  let readsParam = false;
  walkExprDeep(e, (x) => {
    if (x.kind !== "ref") return;
    if (x.refKind === "this-prop" && x.name === fName) readsField = true;
    if (x.refKind === "param") readsParam = true;
  });
  return readsField && !readsParam;
}

type Gate = "requires" | "when" | "precondition";

/** Which gate on `op` guards the transition of `fName`, if any — see SCOPE. */
function gateKind(op: OperationIR, fName: string): Gate | undefined {
  if (operationIsGuarded(op)) return "requires";
  if (op.when) return "when";
  let pre = false;
  for (const s of op.statements) {
    walkStmtsDeep(s, (x) => {
      if (x.kind === "precondition" && isStateGateOn(x.expr, fName)) pre = true;
    });
  }
  return pre ? "precondition" : undefined;
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
          let hit: { op: OperationIR; gate: Gate } | undefined;
          for (const op of agg.operations) {
            if (op === update || op.visibility === "private") continue;
            if (!assignedFieldNames(op.statements).has(f.name)) continue;
            const gate = gateKind(op, f.name);
            if (gate) {
              hit = { op, gate };
              break;
            }
          }
          if (!hit) continue;
          diags.push({
            severity: "warning",
            code: "loom.update-gate-suggestion",
            message: diagMessage("loom.update-gate-suggestion", {
              name: agg.name,
              fName: f.name,
              opName: hit.op.name,
              gate: hit.gate,
              hasDefault: f.default !== undefined,
            }),
            source: `${ctx.name}/${agg.name}`,
            origin: agg.origin,
          });
        }
      }
    }
  }
}

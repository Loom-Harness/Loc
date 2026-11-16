// -------------------------------------------------------------------------
// Entity history — the READ side of the `audited` command trail (docs/audit.md).
//
// The write side stores, per successful public command, an append-only
// `audit_records` row carrying full `before`/`after` wire-DTO snapshots.  This
// module defines the one platform-neutral shape every backend serves that trail
// as, and the two derivations that make serving it SAFE:
//
//   1. `auditEntryWireShape()` / `auditFieldChangeWireShape()` — the canonical
//      ordered wire fields, in the same `WireField` vocabulary every DTO
//      emitter already consumes.  One definition, five backends, byte-identical
//      key sets by construction rather than by five people agreeing.
//
//   2. `historyDiffFields(payloads, agg)` — WHICH of the aggregate's wire
//      fields the per-entry diff is computed over: the rows of its declared
//      `<Agg>Response` record minus the stamp churn (`managed` / `token`
//      rows).  Derived at read time from the two snapshots and never stored (a
//      stored diff is a cache with no invalidation story).  An aggregate with
//      no declared record has no read contract, hence no history.
//
//   3. `maskedHistoryFields(payloads, agg)` — the fields whose change entry must be
//      DROPPED for a caller who fails the field's `mask unless` predicate.
//
// (3) is the load-bearing one.  The snapshots are written server-side INSIDE
// the command's transaction, where there is no caller to mask against, so they
// hold RAW values for every field — including the ones `mask unless` redacts on
// every other read surface.  A history endpoint that skips the masking pass
// therefore republishes each masked field's entire change history through a
// route nobody thought of as a read surface.  Dropping rather than redacting is
// deliberate: a redacted-but-present entry still discloses THAT the field
// changed, when, and by whom — "the admin changed `salary` on the 3rd" is the
// leak, not just its value.
//
// Platform-neutral and browser-safe: pure structural reads off the resolved IR.
// -------------------------------------------------------------------------
import { AUDIT_HISTORY_FIND } from "../../util/audit-names.js";
import { partContentMask } from "../enrich/mask-taint.js";
import type { AggregateIR, FindIR, PayloadIR, TypeIR, WireField } from "../types/loom-ir.js";
import { PLAIN_FIND_FLAGS } from "../types/loom-ir.js";
import { aggHasAuditedTarget } from "./audit-capability.js";
import { declaredResponseFor } from "./declared-response.js";
import { responseWireFor } from "./response-wire.js";

/** Name of the derived per-entity history read — re-exported from `util/` so
 *  the phase-② scaffold macro can name the same read without value-importing
 *  `ir/` (see `src/util/audit-names.ts`).  This module's surface is unchanged. */
export {
  AUDIT_ENTRY_TYPE,
  AUDIT_FIELD_CHANGE_TYPE,
  AUDIT_HISTORY_FIND,
} from "../../util/audit-names.js";
/** The fixed history wire shapes, which read no mask: re-exported from the
 *  leaf a frontend imports (`audit-wire.ts`). */
export { auditEntryWireShape, auditFieldChangeWireShape } from "./audit-wire.js";

/** The aggregate wire fields an entry's `changes` list may cover — the rows of
 *  the declared response record minus stamp churn (`managed` / `token`).  A backend derives the diff by
 *  comparing these keys across the two snapshots; a key absent here is never
 *  looked at, so a `secret` or `internal` field cannot reach the timeline even
 *  though the snapshot holds it.
 *
 *  A containment whose part carries a `mask unless` member is diffed as a
 *  whole value, so its change entry holds that member in the clear: the entry
 *  carries the conjunction of every mask inside the part (`partContentMask`)
 *  and is dropped for a caller who could not read all of it. */
export function historyDiffFields(payloads: readonly PayloadIR[], agg: AggregateIR): WireField[] {
  if (!declaredResponseFor(payloads, agg)) return [];
  const rows = responseWireFor(payloads, agg).filter(
    (f) => f.access !== "managed" && f.access !== "token",
  );
  return rows.map((wf) => {
    if (wf.source !== "containment") return wf;
    const part = agg.parts.find((p) => p.name === containedPartName(wf.type));
    const mask = part ? partContentMask(part, agg.parts) : undefined;
    return mask ? { ...wf, maskUnless: mask } : wf;
  });
}

function containedPartName(t: TypeIR): string | undefined {
  const inner = t.kind === "array" ? t.element : t.kind === "optional" ? t.inner : t;
  return inner.kind === "entity" ? inner.name : undefined;
}

/** The diff fields carrying a `mask unless` predicate — the ones whose change
 *  entry is DROPPED (not redacted) when the caller fails the predicate.  Same
 *  predicate the aggregate's own read surface applies, so history can never
 *  disclose a field the entity read would have hidden. */
export function maskedHistoryFields(payloads: readonly PayloadIR[], agg: AggregateIR): WireField[] {
  return historyDiffFields(payloads, agg).filter((f) => f.maskUnless !== undefined);
}

/** The diff fields with no mask — always visible to any caller who cleared the
 *  read gate. */
export function unmaskedHistoryFields(
  payloads: readonly PayloadIR[],
  agg: AggregateIR,
): WireField[] {
  return historyDiffFields(payloads, agg).filter((f) => f.maskUnless === undefined);
}

/** True when this aggregate serves a history read: it has at least one audited
 *  command (so rows exist) AND at least one diffable field (so an entry could
 *  say something).  The second half matters — an aggregate whose every field is
 *  `managed`/`secret` would serve a timeline of empty entries, which reads as
 *  authoritative while carrying no information. */
export function aggServesHistory(payloads: readonly PayloadIR[], agg: AggregateIR): boolean {
  return aggHasAuditedTarget(agg) && historyDiffFields(payloads, agg).length > 0;
}

/** The compiler-synthesized `find history(id)` for an audited aggregate.
 *
 *  Injected in the same enrichment slot as the auto-`findAll` so it rides the
 *  existing find pipeline: `requires` carries the inherited read gate, and
 *  `bypassAll` / `bypassCaps` carry the aggregate read's `ignoring` stance, so
 *  every capability query-filter (`tenantOwned` included) scopes the history
 *  read exactly as it scopes the entity read.  `auditHistory` marks it for the
 *  emitters, which serve it from `audit_records` rather than the aggregate
 *  table — the generic find-route and repository builders skip it. */
export function buildHistoryFind(agg: AggregateIR, requires?: FindIR["requires"]): FindIR {
  return {
    ...PLAIN_FIND_FLAGS,
    name: AUDIT_HISTORY_FIND,
    params: [{ name: "id", type: { kind: "id", targetName: agg.name } }],
    returnType: { kind: "array", element: { kind: "primitive", name: "json" } },
    auditHistory: true,
    ...(requires ? { requires } : {}),
  };
}

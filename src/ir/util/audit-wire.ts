// The canonical wire shapes of an audit-history entry and of one field change
// inside it.  They are fixed by the audit vocabulary (`src/util/audit-names.ts`)
// and read no aggregate, so they read no mask either: a frontend renders its
// history models from them without reaching the mask analysis that
// `audit-history.ts` runs over an aggregate's own fields.

import {
  AUDIT_ENTRY_MEMBERS,
  AUDIT_FIELD_CHANGE_MEMBERS,
  type AuditWireMember,
} from "../../util/audit-names.js";
import type { TypeIR, WireField } from "../types/loom-ir.js";

export {
  AUDIT_ENTRY_TYPE,
  AUDIT_FIELD_CHANGE_TYPE,
} from "../../util/audit-names.js";

/** A history member's IR type.  `changes` is a `json[]` here: each emitter
 *  renders its elements as the `AuditFieldChange` record by name. */
function memberType(t: AuditWireMember["type"]): TypeIR {
  if (t === "changes") return { kind: "array", element: { kind: "primitive", name: "json" } };
  return { kind: "primitive", name: t };
}

/** Build a wire field in the canonical history vocabulary.  Everything here is
 *  server-derived and read-only, so the access role is `immutable` — never
 *  `managed`, which would make the entry's own fields self-excluding if this
 *  shape were ever fed back through the history-diff filter. */
function wf(name: string, type: TypeIR, optional = false): WireField {
  return { name, type, optional, source: "property", access: "immutable" };
}

/** One field-level change derived from an entry's two snapshots.
 *
 *  `before` / `after` are `json` because the snapshot holds whatever the
 *  aggregate's wire DTO held for that key — a scalar, a value object, a
 *  containment array.  Typing them as the field's own type would need one
 *  `AuditFieldChange` per field per aggregate; a `json` leaf keeps the entry
 *  shape uniform, which is what lets a single `Timeline` primitive render the
 *  history of any audited aggregate.
 *
 *  Both sides are nullable and both are meaningful: a `create` has no `before`
 *  (every field reads null → value) and a `destroy` has no `after`. */
export function auditFieldChangeWireShape(): WireField[] {
  return AUDIT_FIELD_CHANGE_MEMBERS.map((m) => wf(m.name, memberType(m.type), m.optional));
}

/** One entry in an entity's history — the canonical ordered wire shape.
 *
 *  Deliberately NOT carrying the raw `before` / `after` snapshots.  They are
 *  stored unmasked (see the module header), so publishing them whole would need
 *  a recursive redaction pass over arbitrary JSON with no schema to guarantee
 *  it reached every masked key.  The derived `changes` list is a typed,
 *  field-keyed projection where the masking rule is exact and checkable: drop
 *  the entry whose `field` is masked for this caller.  Point-in-time state
 *  reconstruction ("time travel") is a separate feature and would need its own
 *  authorization story. */
export function auditEntryWireShape(): WireField[] {
  return AUDIT_ENTRY_MEMBERS.map((m) => wf(m.name, memberType(m.type), m.optional));
}

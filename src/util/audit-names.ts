// -------------------------------------------------------------------------
// Shared audit-facility NAMES — the spellings more than one pipeline layer has
// to agree on (docs/audit.md).
//
// Home is `util/` for the reason the layering gate enforces: the entity-history
// read is DERIVED at phase ⑥ (`src/ir/util/audit-history.ts`) and CONSUMED by
// the backends at phase ⑧, but the scaffold macro at phase ② also has to name
// it — and `macros/` may not value-import `ir/` (that would invert the
// pipeline; `test/platform/pipeline-layering.test.ts`).  A helper consumed
// across layers belongs at the layer its consumers share, which is `util/` —
// the same move `walker-primitive-names.ts` made for the walker stdlib.
//
// `ir/util/audit-history.ts` re-exports what it needs from here, so its public
// surface is unchanged and there is still exactly one spelling.
// -------------------------------------------------------------------------

/** Name of the derived per-entity history read.  A repository find of this
 *  name is compiler-synthesized onto every audited aggregate (the auto-`findAll`
 *  analog); an author-declared find of the same name wins, exactly as with
 *  `all`. */
export const AUDIT_HISTORY_FIND = "history";

/** Wire type name of one history entry — the DTO every backend emits. */
export const AUDIT_ENTRY_TYPE = "AuditEntry";

/** Wire type name of one field-level change inside an entry. */
export const AUDIT_FIELD_CHANGE_TYPE = "AuditFieldChange";

/** One member of a history wire record: a JSON scalar (`json` is any value),
 *  or `changes`, the entry's list of `AuditFieldChange`s. */
export interface AuditWireMember {
  readonly name: string;
  readonly type: "string" | "datetime" | "json" | "changes";
  readonly optional: boolean;
}

/** One field-level change derived from an entry's two snapshots: `before` /
 *  `after` hold whatever the aggregate's wire DTO held for that key. */
export const AUDIT_FIELD_CHANGE_MEMBERS: readonly AuditWireMember[] = [
  { name: "field", type: "string", optional: false },
  { name: "before", type: "json", optional: true },
  { name: "after", type: "json", optional: true },
];

/** One entry in an entity's history, in wire order. */
export const AUDIT_ENTRY_MEMBERS: readonly AuditWireMember[] = [
  { name: "auditId", type: "string", optional: false },
  { name: "at", type: "datetime", optional: false },
  { name: "action", type: "string", optional: false },
  { name: "operationId", type: "string", optional: false },
  // The principal as recorded at command time: a snapshot that need not still
  // match the `user {}` block's claim set.
  { name: "actor", type: "json", optional: true },
  { name: "correlationId", type: "string", optional: true },
  { name: "changes", type: "changes", optional: false },
];

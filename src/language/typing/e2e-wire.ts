// The fixed records the generated `test e2e` clients exchange that the model
// does not declare: a list read's query, a write's options, an audit history
// entry and a provenance lineage.  Each spelling comes from the `src/util/`
// module the backends emit from.

import {
  AUDIT_ENTRY_MEMBERS,
  AUDIT_ENTRY_TYPE,
  AUDIT_FIELD_CHANGE_MEMBERS,
  AUDIT_FIELD_CHANGE_TYPE,
  type AuditWireMember,
} from "../../util/audit-names.js";
import { E2E_IF_MATCH_OPTION } from "../../util/e2e-call-options.js";
import { PAGED_QUERY_PARAMS } from "../../util/paged-query.js";
import { PROVENANCE_LINEAGE_MEMBERS as L } from "../../util/provenance-carrier.js";
import { Ty, wireOf } from "./ty.js";

const fields = (name: string, members: Record<string, Ty>): Ty =>
  Ty.record({ of: "fields", name, fields: members });

/** `api.<aggs>.all({ page, pageSize, sort, dir })`: the paged read's query. */
export const LIST_QUERY: Ty = fields(
  "__ListQuery__",
  Object.fromEntries(
    PAGED_QUERY_PARAMS.map((k) => [
      k,
      k === "sort" || k === "dir" ? Ty.prim("string") : Ty.prim("int"),
    ]),
  ),
);

/** A write's options argument: `{ ifMatch: <version> }`. */
export const CALL_OPTIONS: Ty = fields("__CallOptions__", {
  [E2E_IF_MATCH_OPTION]: Ty.prim("int"),
});

function auditRecord(name: string, members: readonly AuditWireMember[]): Ty {
  const out: Record<string, Ty> = {};
  for (const m of members) {
    const t = m.type === "changes" ? Ty.array(AUDIT_FIELD_CHANGE) : wireOf(Ty.prim(m.type));
    out[m.name] = m.optional ? Ty.opt(t) : t;
  }
  return fields(name, out);
}

const AUDIT_FIELD_CHANGE: Ty = auditRecord(AUDIT_FIELD_CHANGE_TYPE, AUDIT_FIELD_CHANGE_MEMBERS);

/** One entry of `api.<aggs>.history(id)`. */
export const AUDIT_ENTRY: Ty = auditRecord(AUDIT_ENTRY_TYPE, AUDIT_ENTRY_MEMBERS);

/** The lineage of a `provenanced` field whose wire value is `value`. */
export function provenanceLineage(value: Ty): Ty {
  return fields("ProvLineage", {
    [L.snapshotId]: Ty.prim("string"),
    [L.target]: fields("ProvTarget", {
      [L.targetType]: Ty.prim("string"),
      [L.targetField]: Ty.prim("string"),
    }),
    [L.inputs]: Ty.array(
      fields("ProvInput", { [L.inputPath]: Ty.prim("string"), [L.inputValue]: Ty.prim("json") }),
    ),
    [L.computedValue]: value,
  });
}

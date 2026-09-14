// Which persist-time stamps CANNOT tolerate a missing claim — the shared rule
// behind every backend's tenant write-path guard (finding F-018).
//
// The defect it closes: under `tenancy by user.<claim>`, `with tenantOwned`
// gives an aggregate a NOT NULL `tenant_id` column and an `onCreate` stamp that
// fills it from `currentUser.<claim>`.  A token that simply omits the claim —
// routine, since an IdP emits a tenant claim only for users who have a tenant —
// makes that stamp evaluate to null.  Reads survive it correctly (the tenancy
// filter binds NULL and matches nothing, which `docs/tenancy.md` promises is
// "an ordinary empty read on every backend … never a 500"), but a WRITE binds
// null into the NOT NULL column and the database raises.  What reaches the
// caller is an opaque `500 {"detail":"internal"}` naming nothing, at the one
// moment the answer — "your token has no tenantId" — is a single line.
//
// The rule generalises past tenancy: ANY claim-valued stamp into a
// non-optional column has the same failure, and the same one-line answer.  An
// OPTIONAL target (`tenantOwned`'s own `dataKey: string?`) is deliberately not
// guarded — null is a legal value there, and refusing it would break the
// claim-less signup bootstrap `docs/tenancy.md` documents.  A bare
// `currentUser` stamp (`createdBy := currentUser`) is not guarded either: it
// reads the principal's id, which is the token's `sub` and is always present.
//
// Pure IR, no host language in sight; each backend renders the guard in its own
// idiom at its own stamp site, and they all agree on WHICH stamps to guard.

import type { AggregateIR, ContextStampIR, ExprIR, FieldIR } from "../types/loom-ir.js";

/** One stamp that must refuse rather than write a null. */
export interface RequiredClaimStamp {
  /** The aggregate column being stamped (`tenantId`). */
  field: string;
  /** The principal claim the value is read from (`tenantId`) — named in the
   *  refusal so the operator is told exactly which claim their token lacks,
   *  rather than being handed a stack trace. */
  claim: string;
  /** True when the claim's declared type is `string`.  The typed backends can
   *  then add a blank-string check alongside the null one — an IdP that emits
   *  `"tenantId": ""` is as unusable as one that omits it — while a claim of any
   *  other type gets the null check alone, since `.isEmpty()` / `== ""` would
   *  not compile against it. */
  claimIsString: boolean;
}

/** The claim a `currentUser.<claim>` stamp value reads, or `null` when the
 *  value is anything else (a bare `currentUser`, `now()`, a literal, a deeper
 *  expression).  Only the single-hop member access on the principal is treated
 *  as a claim read: that is the shape every capability and hand-written
 *  `stamp` uses, and a more elaborate expression has no single claim to name. */
function claimReadBy(value: ExprIR): { claim: string; claimIsString: boolean } | null {
  if (value.kind !== "member") return null;
  const receiver = value.receiver;
  if (receiver.kind !== "ref" || receiver.refKind !== "current-user") return null;
  const t = value.memberType;
  const inner = t.kind === "optional" ? t.inner : t;
  return {
    claim: value.member,
    claimIsString: inner.kind === "primitive" && inner.name === "string",
  };
}

/**
 * The stamps of `agg` for `event` that read a principal claim into a
 * non-optional column — the ones a missing claim turns into a NOT NULL
 * violation, and that must therefore refuse first.
 *
 * Deduplicated by target field and ordered by it, so every backend emits its
 * guards in the same order and a golden stays stable.
 */
export function requiredClaimStamps(
  agg: Pick<AggregateIR, "fields"> & { contextStamps?: ContextStampIR[] },
  event: "create" | "update",
): RequiredClaimStamp[] {
  const optionalByName = new Map<string, boolean>();
  for (const f of agg.fields as FieldIR[]) {
    optionalByName.set(f.name, f.optional || f.type.kind === "optional");
  }
  const byField = new Map<string, RequiredClaimStamp>();
  for (const rule of agg.contextStamps ?? []) {
    if (rule.event !== event) continue;
    for (const a of rule.assignments) {
      const read = claimReadBy(a.value);
      if (read === null) continue;
      // Unknown field ⇒ not a column this generator can reason about; and an
      // optional column accepts null legitimately.
      if (optionalByName.get(a.field) !== false) continue;
      byField.set(a.field, { field: a.field, ...read });
    }
  }
  return [...byField.values()].sort((x, y) => (x.field < y.field ? -1 : x.field > y.field ? 1 : 0));
}

/** The union of {@link requiredClaimStamps} across several aggregates — what a
 *  backend emitting ONE shared stamp helper (node's `db/audit-stamp.ts`, .NET's
 *  interceptor) needs, since that helper runs for all of them. */
export function requiredClaimStampsAcross(
  aggs: readonly (Pick<AggregateIR, "fields"> & { contextStamps?: ContextStampIR[] })[],
  event: "create" | "update",
): RequiredClaimStamp[] {
  const byField = new Map<string, RequiredClaimStamp>();
  for (const agg of aggs) {
    for (const s of requiredClaimStamps(agg, event)) byField.set(s.field, s);
  }
  return [...byField.values()].sort((x, y) => (x.field < y.field ? -1 : x.field > y.field ? 1 : 0));
}

/** The refusal message every backend uses, so the answer reads the same
 *  whichever one is serving.  Deliberately names the claim, the column, and the
 *  fix — this string is what someone reads at 3am instead of `"internal"`. */
export function missingClaimMessage(stamp: RequiredClaimStamp): string {
  return (
    `Forbidden: the access token carries no "${stamp.claim}" claim, ` +
    `which this system stamps into ${stamp.field} on every write. ` +
    `Obtain a token whose "${stamp.claim}" claim is set.`
  );
}

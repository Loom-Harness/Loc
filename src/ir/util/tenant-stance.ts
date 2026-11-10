// Tenancy stance classification (tenancy.md).
//
// An aggregate's tenancy *stance* is a pure function of facts already on
// the IR — the `crossTenant` header flag, `tenantOwned` capability
// membership, and the system's `tenancy by … of <Registry>` declaration —
// so it is derived on demand (the `classifyPage` pattern in
// `page-kind.ts`), never stamped onto AggregateIR.

import type { AggregateIR, ExprIR, SystemIR, TypeIR } from "../types/loom-ir.js";

/** The prelude capability that marks an aggregate as tenant-scoped
 *  (`with tenantOwned` — see `src/macros/prelude.ts`). */
export const TENANT_OWNED_CAPABILITY = "tenantOwned";

/** The prelude capability that makes the tenant registry a tree
 *  (`implements tenantRegistry`).  It PROVIDES `parent: Self id?` (null =
 *  top-level org), used to manage sub-tenants; data visibility never follows
 *  the tree (D-TENANCY-FLAT).  Only the registry (the `of <Registry>` target)
 *  may carry it.  See `src/macros/prelude.ts`. */
const TENANT_REGISTRY_CAPABILITY = "tenantRegistry";

/** `contextFilterOrigins` marker for the DERIVED registry self-scope filter
 *  (tenancy.md): under `tenancy by
 *  user.<claim> of <Registry>`, enrichment appends `this.id ==
 *  currentUser.<claim>` to the registry's `contextFilters` — the
 *  `tenantId ≡ <Registry>.id` identity, never written by the author.  The
 *  origin marks provenance (and makes the enrichment pass idempotent); it is
 *  NOT a capability name, so a named `ignoring tenancy` clause is rejected by
 *  `loom.filter-bypass-unknown-capability` (only `ignoring *` — the
 *  deliberate, authored escape hatch that already drops `tenantOwned`'s
 *  filter — bypasses it). */
export const TENANCY_SELF_SCOPE_ORIGIN = "tenancy";

/** How the tenancy claim binds against the registry's id in the derived
 *  self-scope comparison (`this.id == currentUser.<claim>`):
 *
 *   - `"same"`   — a `guid` claim, the registry id's own scalar (every
 *                  identity is a guid); every backend compares directly.
 *   - `"guid-from-string"` — a `string` claim (the common JWT shape).  Each
 *                  backend PARSES the claim to a guid at the accessor site, yielding its null for a claim
 *                  that doesn't parse, so a malformed one reads empty rather
 *                  than 500-ing — see {@link guidFromStringSelfScope}.
 *   - `"mismatch"` — anything else (e.g. `tenantId: int`).
 *                  Enrichment derives NO filter and IR validation rejects it
 *                  (`loom.tenancy-claim-type-mismatch`). */
export type TenancyClaimBinding = "same" | "guid-from-string" | "mismatch";

export function tenancyClaimBinding(claimType: TypeIR | undefined): TenancyClaimBinding {
  if (claimType?.kind !== "primitive") return "mismatch";
  if (claimType.name === "guid") return "same";
  if (claimType.name === "string") return "guid-from-string";
  return "mismatch";
}

/** Build the derived registry self-scope predicate `this.id ==
 *  currentUser.<claim>` as fully-resolved ExprIR — the exact shapes the
 *  `tenantOwned` prelude filter lowers to (`member` over `this` /
 *  `current-user` ref against the `__User__` principal shape), so every
 *  backend's existing principal-capability-filter path renders it without
 *  re-resolving.  Types are truthful: the left side is the registry's id
 *  type, the right side the claim's DECLARED type — a `guid`-vs-`string`
 *  comparison is bound per backend at the accessor site (see
 *  {@link tenancyClaimBinding}). */
export function buildRegistrySelfScopeFilter(
  registry: Pick<AggregateIR, "name">,
  claimField: string,
  claimType: TypeIR,
): ExprIR {
  const idType: TypeIR = { kind: "id", targetName: registry.name };
  // Mirrors `USER_SHAPE_NAME` in `src/ir/lower/lower-types.ts` (the
  // synthetic principal entity every lowered `currentUser` ref carries).
  const userShape: TypeIR = { kind: "entity", name: "__User__" };
  return {
    kind: "binary",
    op: "==",
    left: {
      kind: "member",
      receiver: { kind: "this" },
      member: "id",
      receiverType: { kind: "entity", name: registry.name },
      memberType: idType,
    },
    right: {
      kind: "member",
      receiver: { kind: "ref", name: "currentUser", refKind: "current-user", type: userShape },
      member: claimField,
      receiverType: userShape,
      memberType: claimType,
    },
    leftType: idType,
    resultType: { kind: "primitive", name: "bool" },
  };
}

/** The claim member name when `e` is the `"guid-from-string"` registry
 *  self-scope comparison — `this.id == currentUser.<claim>` where the id's
 *  value type is `guid` and the claim is declared `string` (see
 *  {@link tenancyClaimBinding}).  `undefined` for every other shape.
 *
 *  This is the ONE comparison in the language whose principal side can FAIL TO
 *  PARSE at the accessor site: an authenticated token carrying `tenantId:
 *  "not-a-guid"` is an ordinary unauthorized read, but a bare parse throws
 *  (`IllegalArgumentException` / `Ecto.Query.CastError` / pg `invalid input
 *  syntax for type uuid`) and answers it with a 500.  Each backend gates its
 *  parse-to-NULL rendering on this predicate so a malformed claim degrades to
 *  the same empty result a foreign-but-well-formed one already gives — .NET's
 *  `Guid.TryParse(…) ? new <Agg>Id(g) : null` is the reference shape.
 *
 *  `idOnLeft` reports which operand carried `this.id`, so a backend that emits
 *  an infix comparison keeps the authored operand order. */
export function guidFromStringSelfScope(
  e: ExprIR,
): { claim: string; idOnLeft: boolean } | undefined {
  if (e.kind === "paren") return guidFromStringSelfScope(e.inner);
  if (e.kind !== "binary" || e.op !== "==") return undefined;
  const idOnLeft = isGuidSelfId(e.left);
  if (!idOnLeft && !isGuidSelfId(e.right)) return undefined;
  const claim = stringPrincipalClaim(idOnLeft ? e.right : e.left);
  return claim === undefined ? undefined : { claim, idOnLeft };
}

/** The tenancy claim field name when the SYSTEM's binding is
 *  `"guid-from-string"` — a `guid`-id registry keyed by a `string` claim (see
 *  {@link tenancyClaimBinding}) — else `undefined`.  The system-level twin of
 *  {@link guidFromStringSelfScope}: that one answers "does THIS comparison need
 *  the parse-to-null guard", this one answers "does this system need the
 *  accessor that performs it", which is what an auth-surface emitter asks
 *  before emitting one. */
export function guidFromStringTenancyClaim(
  sys: Pick<SystemIR, "tenancy" | "subdomains" | "user">,
): string | undefined {
  const claimField = sys.tenancy?.claimField;
  if (!claimField) return undefined;
  const registry = findAggregate(sys, sys.tenancy!.registryName);
  if (!registry) return undefined;
  const declared = sys.user?.fields.find((f) => f.name === claimField)?.type;
  const claimType = declared?.kind === "optional" ? declared.inner : declared;
  return tenancyClaimBinding(claimType) === "guid-from-string" ? claimField : undefined;
}

function findAggregate(sys: Pick<SystemIR, "subdomains">, name: string): AggregateIR | undefined {
  for (const mod of sys.subdomains) {
    for (const ctx of mod.contexts) {
      for (const agg of ctx.aggregates) {
        if (agg.name === name) return agg;
      }
    }
  }
  return undefined;
}

/** The `User` accessor name that yields {@link guidFromStringTenancyClaim}'s
 *  claim parsed to the registry's `guid` id type, or null when it is absent or
 *  MALFORMED — the fail-closed coercion every backend's registry self-scope
 *  binds through.  Derived from the claim name so it can't collide
 *  with the claim's own accessor. */
export function guidClaimAccessorName(claimField: string): string {
  return `${claimField}AsUuid`;
}

/** `this.id` typed as the aggregate's own (guid-valued) id. */
function isGuidSelfId(x: ExprIR): boolean {
  if (x.kind === "paren") return isGuidSelfId(x.inner);
  return (
    x.kind === "member" &&
    x.receiver.kind === "this" &&
    x.member === "id" &&
    x.memberType.kind === "id"
  );
}

/** `currentUser.<claim>` whose DECLARED type is `string` — the side that can
 *  hold a value the id's `guid` type cannot represent. */
function stringPrincipalClaim(x: ExprIR): string | undefined {
  if (x.kind === "paren") return stringPrincipalClaim(x.inner);
  if (
    x.kind === "member" &&
    x.receiver.kind === "ref" &&
    x.receiver.refKind === "current-user" &&
    x.memberType.kind === "primitive" &&
    x.memberType.name === "string"
  ) {
    return x.member;
  }
  return undefined;
}

/** The tenant-discriminator COLUMN the `tenantOwned` capability provides
 *  (`src/macros/prelude.ts`) — the flat tenant floor's LHS.
 *
 *  This is a ROW column name, owned by the capability and not the author's to
 *  choose, so it is a constant.  It is deliberately NOT the principal-side
 *  name: the claim the row is compared against is whatever `tenancy by
 *  user.<claim>` declared, which is a per-system fact and travels as an
 *  argument (see {@link buildTenantFloorFilter}).  The two coincide in every
 *  fixture that declares the claim as `tenantId`, which is exactly how they
 *  stayed conflated — see `tenancy-claim-name.ddd`. */
export const TENANT_OWNED_TENANT_ID_FIELD = "tenantId";

/** The flat tenant FLOOR predicate `this.tenantId == currentUser.<claim>` —
 *  the exact ExprIR shape the `tenantOwned` prelude capability filter lowers to
 *  (`src/macros/prelude.ts`), rebuilt here for the consumers that need the
 *  floor as a standalone predicate.  Every backend already renders this shape,
 *  so a consumer needs no new render code.
 *
 *  The two sides are NOT the same name: the left is the capability's row
 *  COLUMN ({@link TENANT_OWNED_TENANT_ID_FIELD}), the right is the system's
 *  declared `tenancy by user.<claim>` CLAIM.  `tenantClaim` is required rather
 *  than defaulted — a default is precisely how the principal side stayed
 *  pinned to `tenantId` on every backend. */
export function buildTenantFloorFilter(
  agg: Pick<AggregateIR, "name">,
  tenantClaim: string,
): ExprIR {
  const userShape: TypeIR = { kind: "entity", name: "__User__" };
  const stringType: TypeIR = { kind: "primitive", name: "string" };
  return {
    kind: "binary",
    op: "==",
    left: {
      kind: "member",
      receiver: { kind: "this" },
      member: TENANT_OWNED_TENANT_ID_FIELD,
      receiverType: { kind: "entity", name: agg.name },
      memberType: stringType,
    },
    right: {
      kind: "member",
      receiver: { kind: "ref", name: "currentUser", refKind: "current-user", type: userShape },
      member: tenantClaim,
      receiverType: userShape,
      memberType: stringType,
    },
    leftType: stringType,
    resultType: { kind: "primitive", name: "bool" },
  };
}

/** The DENY carve-out predicate (deny-wins).  An
 *  `authz-filter` sentinel carrying a `deny` decision (no `currentUser`, so
 *  `exprUsesCurrentUser` is false → each backend routes it to its STATIC filter
 *  path, adding no principal parameter — this is what keeps a denied
 *  aggregate's read/write seam free of the unused-param trap).  Appended to a
 *  denied aggregate's read `contextFilters` (deny read) or set as its
 *  `writeScopeFilter` (deny write) in enrichment; every backend's filter
 *  translator special-cases {@link isDenyFilter} to its native always-false
 *  fragment (Drizzle contradiction / EF `false` / JPQL `1 = 0` /
 *  `cb.disjunction()` / SQLAlchemy contradiction / Ecto `fragment("false")`).
 *  A bare `literal: bool` node is deliberately NOT used — it is not a valid
 *  standalone predicate in Drizzle/Ecto/SQLAlchemy, which is why deny is a
 *  discriminated sentinel. */
export function buildDenyFilter(agg: Pick<AggregateIR, "name">): ExprIR {
  return {
    kind: "authz-filter",
    aggregate: agg.name,
    filter: { kind: "deny" },
  };
}

/** True when `e` is the DENY carve-out sentinel.  Each
 *  backend's filter translator gates its always-false fragment on this. */
export function isDenyFilter(e: ExprIR): boolean {
  return e.kind === "authz-filter" && e.filter.kind === "deny";
}

/** The PRINCIPAL member the tenant floor compares against — the system's
 *  declared `tenancy by user.<claim>`, falling back to
 *  {@link TENANT_OWNED_TENANT_ID_FIELD} when the system declares no tenancy
 *  (the status-quo shape; a `tenantOwned` aggregate without a tenancy
 *  declaration is a phase-⑦ diagnostic, not something to silently re-point).
 *
 *  The single source of truth every consumer reads instead of spelling
 *  `tenantId`: that constant is the ROW column the `tenantOwned` capability
 *  provides, and the two names coincide only when the claim happens to be
 *  called `tenantId`.  The capability's principal side is already the declared
 *  claim when it is spliced (`resolveTenancyClaim`); emitters that reference the
 *  principal directly — the realtime room key on all four SSE backends — read
 *  it off the derived plan. */
export function tenancyPrincipalClaim(sys: Pick<SystemIR, "tenancy"> | undefined): string {
  return sys?.tenancy?.claimField ?? TENANT_OWNED_TENANT_ID_FIELD;
}

export type TenantStance = "tenantOwned" | "crossTenant" | "registry" | "unscoped";

/** True when the aggregate implements the `tenantOwned` prelude capability
 *  (via `with`/`implements`, aggregate- or context-scope — the lowered
 *  `capabilities` identity record; never re-derived from member shapes). */
export function hasTenantOwned(agg: Pick<AggregateIR, "capabilities">): boolean {
  return (agg.capabilities ?? []).includes(TENANT_OWNED_CAPABILITY);
}

/** True when the aggregate carries the `tenantRegistry` prelude capability
 *  (the registry tree's `parent`).  Drives the structural checks: exactly one,
 *  on the `of` target. */
export function hasTenantRegistry(agg: Pick<AggregateIR, "capabilities">): boolean {
  return (agg.capabilities ?? []).includes(TENANT_REGISTRY_CAPABILITY);
}

/** Classify an aggregate's tenancy stance under its system.
 *
 *  Precedence: the registry role wins (the `of`-target is self-keyed —
 *  neither marker fits it; a *marked* registry is a dedicated diagnostic,
 *  `loom.tenancy-registry-marked`), then `tenantOwned`, then `crossTenant`.
 *  An aggregate carrying BOTH markers classifies as `tenantOwned` here —
 *  the contradiction itself is `loom.tenancy-conflicting-stance`, checked
 *  from the raw flags, not a stance. */
export function classifyTenantStance(
  agg: Pick<AggregateIR, "name" | "crossTenant" | "capabilities">,
  sys: Pick<SystemIR, "tenancy">,
): TenantStance {
  if (sys.tenancy && agg.name === sys.tenancy.registryName) return "registry";
  if (hasTenantOwned(agg)) return "tenantOwned";
  if (agg.crossTenant) return "crossTenant";
  return "unscoped";
}

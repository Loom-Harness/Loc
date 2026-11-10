// The authentication principal — the `user { ... }` block's identity.
//
// The principal is NOT a domain aggregate: it has no `aggregate User { }`
// declaration, so no `UserId` strong-id class is ever emitted and its id is
// whatever scalar the `user { id: <type> }` block declares.  Every generator
// names the projected principal record `User` (see the dotnet/java auth emits),
// and the built-in `auditable` capability references the principal id as
// `User id` — both go through this single name so a reference to the principal
// stays distinguishable from a (hypothetical) domain aggregate of the same name.
export const PRINCIPAL_TYPE_NAME = "User";

/** Principal members that no longer exist (D-TENANCY-FLAT): data visibility
 *  is flat, so the caller carries no materialized org path.  A read of one
 *  (unless the `user { }` block declares a claim of that name) is
 *  `loom.principal-member-removed`, whose text names the replacement. */
export const REMOVED_PRINCIPAL_MEMBERS: readonly string[] = ["orgPath", "rootOrg"];

/** The field the tenancy capabilities no longer provide (D-TENANCY-FLAT): rows
 *  carry `tenantId` only.  A reference that resolves to nothing under this name
 *  is `loom.tenancy-data-key-removed` rather than a generic unknown name. */
export const REMOVED_DATA_KEY_FIELD = "dataKey";

/** The built-in principal member `currentUser.isSystem` (ruling D1,
 *  `docs/decisions.md` D-REACTOR-SYSTEM-PRINCIPAL).  `false` for every request
 *  principal; `true` for the SYSTEM principal an event reactor (`create(e)` /
 *  `on(e)` workflow subscription, timer tick) runs as — a principal with no
 *  claims, scoped to the triggering event's tenant, whose `causedBy` names the
 *  originating user for audit and logs only.  A gate that should admit a
 *  reactor says so: `requires currentUser.isSystem || …`.
 *
 *  Not a `user { }` claim and never on the wire: every backend's request
 *  principal serializes exactly as before (`/auth/me` is unchanged). */
export const PRINCIPAL_IS_SYSTEM = "isSystem";

/** The system principal's runtime-only `causedBy` slot — the id of the user
 *  whose request raised the event a reactor runs for (null for a timer tick).
 *  For audit and logs ONLY (ruling D1): it is not a language member, and no
 *  gate can read it.  Reserved as a claim name alongside
 *  {@link PRINCIPAL_IS_SYSTEM} so it cannot collide in a generated User type. */
export const PRINCIPAL_CAUSED_BY = "causedBy";

/** The ambient OPERATING-scope accessor — a peer of `currentUser`.
 *  `currentUser` is the PRINCIPAL (identity, permissions, home org);
 *  `organizationContext` is the org the request operates IN.  Its members:
 *  {@link ORG_CONTEXT_ORG}, the operating org's id — the caller's home org
 *  (the tenancy claim), switched by a {@link ORG_CONTEXT_HEADER} naming a
 *  registry row the caller can read — and {@link ORG_CONTEXT_ANCESTORS}.
 *
 *  Two flat accessors on the surface, ONE execution-context frame underneath:
 *  lowering rewrites `organizationContext.org` to the derived principal
 *  member {@link PRINCIPAL_OPERATING_ORG}, so every backend's existing
 *  principal threading (the `current-user` ref) carries it with no new
 *  plumbing, and the value is set exactly once — by the switch gate. */
export const ORG_CONTEXT_ACCESSOR = "organizationContext";

/** `organizationContext.org` — the operating org's id. */
export const ORG_CONTEXT_ORG = "org";

/** `organizationContext.ancestors` — the operating org AND every org above it
 *  on the registry tree, typed `<Registry> id[]`.  Resolved once per request
 *  by the auth middleware (a recursive walk over the registry's `parent` with
 *  set semantics, so a cycle an author-written move creates terminates) and
 *  memoized on the principal as {@link PRINCIPAL_OPERATING_ANCESTORS}.  Needs
 *  the registry's table, so only a deployable that hosts the registry may read
 *  it (`loom.tenancy-registry-remote-unsupported`). */
export const ORG_CONTEXT_ANCESTORS = "ancestors";

/** The members `organizationContext` exposes. */
export const ORG_CONTEXT_MEMBERS: readonly string[] = [ORG_CONTEXT_ORG, ORG_CONTEXT_ANCESTORS];

/** The derived principal member `organizationContext.ancestors` lowers to —
 *  the operating org's ancestor set (itself included), resolved once per
 *  request.  Never read off the token, never on the wire. */
export const PRINCIPAL_OPERATING_ANCESTORS = "operatingAncestors";

/** The derived principal member `organizationContext.org` lowers to — the
 *  operating org id, resolved ONCE per request by the auth middleware's
 *  fail-closed switch gate: the caller's tenancy claim when the
 *  {@link ORG_CONTEXT_HEADER} is absent, the requested org when the caller can
 *  read that registry row through the registry's read scope, and a pre-body
 *  403 otherwise.  Never read off the token. */
export const PRINCIPAL_OPERATING_ORG = "operatingOrg";

/** The request header that carries a requested operating org — an org id
 *  (lower-cased: every backend matches headers case-insensitively).  A
 *  request-level fact: absent ⇒ the principal's own org, never a widening. */
export const ORG_CONTEXT_HEADER = "x-org-context";

/** The principal's id field — the field named `id`, else the first declared
 *  field of the `user { ... }` block.  A `currentUser` stamp / filter value
 *  resolves to `currentUser.<thisField>` (the principal id), mirroring the
 *  Java backend's `currentUser.id()`.  `null` when no `user {}` block (no
 *  principal at all).  Mirrors the dotnet `actorIdField` derivation. */
export function principalIdField(
  user: { fields: readonly { name: string }[] } | undefined,
): string | null {
  if (!user) return null;
  const field = user.fields.find((f) => f.name === "id") ?? user.fields[0];
  return field ? field.name : null;
}

/** Does `targetName` — the target of an `X id` reference — name the
 *  authentication PRINCIPAL rather than a domain aggregate?
 *
 *  `auditable`'s `createdBy`/`updatedBy: User id` reference the principal,
 *  which has NO `aggregate User` declaration.  Lowering normally collapses
 *  such a reference to the principal's declared id scalar
 *  (`lowerBase`'s `PRINCIPAL_TYPE_NAME` arm), but only when the system
 *  declares a `user { ... }` block — without one the reference survives into
 *  the IR as a dangling `{ kind: "id", targetName: "User" }`, and every
 *  consumer that assumes an `id` target is an aggregate then misreads it:
 *  the UI picker checks demand an aggregate that cannot exist, and the
 *  scaffold emits a detail/table link to a `/users/<id>` route nothing
 *  serves.
 *
 *  The disambiguation is the one {@link PRINCIPAL_TYPE_NAME} was introduced
 *  for: the name means the principal UNLESS the model really declares a
 *  domain aggregate of that name, in which case the reference resolves to
 *  that aggregate and is an ordinary one.  `hasAggregate` answers the
 *  latter — pass the caller's own aggregate registry so this stays a pure
 *  predicate over names.
 *
 *  NOTE this is a READ-SIDE guard over IR that already exists.  It does not
 *  make a principal-stamped aggregate valid without a principal: a
 *  `user {}`-less model is rejected by `loom.stamp-principal-without-auth`,
 *  which is where that belongs. */
export function isPrincipalIdTarget(
  targetName: string,
  hasAggregate: (name: string) => boolean,
): boolean {
  return targetName === PRINCIPAL_TYPE_NAME && !hasAggregate(PRINCIPAL_TYPE_NAME);
}

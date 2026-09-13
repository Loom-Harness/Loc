// Auto-generated.
// User-claim shape decoded from the inbound JWT.  The verifier
// hook (auth/verifier.ts) returns `UserClaims`; the auth middleware
// derives the request principal `User` from it (adding `orgPath` under
// tenancy).  Downstream route handlers / workflow handlers
// reference `User` via the magic `currentUser` identifier.
export interface UserClaims {
  id: string;
  tenantId: string;
  role: string;
}

export interface User extends UserClaims {
  /** The caller's tenant materialized path (`currentUser.orgPath`) —
   *  derived per-request from the tenancy claim, memoized on this
   *  request-scoped principal (multi-tenancy). */
  orgPath: string;
  /** The caller's ROOT-org segment (`currentUser.rootOrg`) — the first
   *  segment of `orgPath` (multi-tenancy).  Anchors the
   *  `global` read level's root-subtree widening. */
  rootOrg: string;
}

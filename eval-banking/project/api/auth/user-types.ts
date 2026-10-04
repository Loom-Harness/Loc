// Auto-generated.
// User-claim shape decoded from the inbound JWT.  The verifier
// hook (auth/verifier.ts) returns `UserClaims`; the auth middleware
// derives the request principal `User` from it (adding `orgPath` under
// tenancy).  Downstream route handlers / workflow handlers
// reference `User` via the magic `currentUser` identifier.
import * as Ids from "../domain/ids";

export interface UserClaims {
  id: string;
  role: string;
  customerId: Ids.CustomerId | null;
  permissions: string[];
}

export type User = UserClaims;

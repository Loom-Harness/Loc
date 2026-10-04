// Auto-generated.
import type { UserClaims } from "./user-types";

/** Verifier hook the user implements: decode the inbound request's
 *  JWT, return the populated claim shape on success, return null (or
 *  throw) to reject with a 401.  Register your implementation at app
 *  startup, BEFORE calling `serve(...)`.  The auth middleware derives
 *  the request principal (`User`, incl. `orgPath` under tenancy) from
 *  the returned claims. */
export type UserVerifier = (req: Request) => Promise<UserClaims | null> | UserClaims | null;

let registered: UserVerifier | null = null;

/** Register the verifier.  Calling more than once overwrites. */
export function registerUserVerifier(fn: UserVerifier): void {
  registered = fn;
}

/** Internal — called by the middleware on every authenticated request. */
export async function verifyUserOrThrow(req: Request): Promise<UserClaims> {
  if (!registered) {
    throw new Error(
      "No user verifier is registered.  Call registerUserVerifier(...) " +
        "with a function that decodes the request's JWT into a User " +
        "before serving.",
    );
  }
  const result = await registered(req);
  if (result === null || result === undefined) {
    throw new Error("unauthorized");
  }
  return result;
}

/** Verify the verifier was registered.  The HTTP composer calls this
 *  at startup so a missing registration surfaces as a clear error
 *  instead of a 401 storm on the first request. */
export function assertUserVerifierRegistered(): void {
  if (!registered) {
    throw new Error(
      "No user verifier is registered.  Call registerUserVerifier(...) " +
        "with a JWT-decoding function before booting the HTTP server.",
    );
  }
}

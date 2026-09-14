// Auto-generated.
import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";
import type { UserClaims } from "./user-types.ts";
import { registerUserVerifier } from "./verifier.ts";

// Resolved from the system `auth { oidc { … } }` block.  Env-bound values
// read process.env at boot; an empty issuer fails loudly at first verify.
const ISSUER = process.env.OIDC_ISSUER ?? "";

// Lazily discover the issuer's JWKS endpoint via the OIDC discovery
// document, then cache a remote JWK set (jose refreshes + caches keys).
// Only a SUCCESSFUL discovery is cached: a failed fetch resets the slot so
// the next request retries — caching the rejected promise would poison
// every later verify with a permanent 401 (e.g. one request racing the
// IdP's boot/realm import; caught live by the parity 403 test).
let jwksPromise: Promise<ReturnType<typeof createRemoteJWKSet>> | null = null;
async function getJwks(): Promise<ReturnType<typeof createRemoteJWKSet>> {
  if (!jwksPromise) {
    jwksPromise = (async () => {
      const base = ISSUER.replace(/\/$/, "");
      const res = await fetch(`${base}/.well-known/openid-configuration`);
      if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
      const doc = (await res.json()) as { jwks_uri: string };
      return createRemoteJWKSet(new URL(doc.jwks_uri));
    })();
    jwksPromise.catch(() => {
      jwksPromise = null;
    });
  }
  return jwksPromise;
}

/** The token from the `Authorization: Bearer` header, or the HttpOnly
 *  `session` cookie /auth/callback issues (the browser flow).  Null when
 *  neither is present.
 *
 *  The cookie arm is not a convenience: the browser NEVER sees the raw token
 *  (it is HttpOnly), so a same-origin fetch and — crucially — the realtime SSE
 *  stream can only present the cookie.  `EventSource` cannot set a header by
 *  construction, so a header-only verifier 401s every generated SPA's realtime
 *  connection.  The other four backends already read this cookie; the rule is
 *  stated once in the shared realtime plan (RULE 2,
 *  src/ir/util/realtime-rooms.ts). */
function bearer(req: Request): string | null {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  const match = header ? /^Bearer\s+(.+)$/i.exec(header) : null;
  if (match) return match[1]!;
  const cookies = req.headers.get("cookie");
  if (!cookies) return null;
  for (const pair of cookies.split(";")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    if (pair.slice(0, eq).trim() !== "session") continue;
    const value = decodeURIComponent(pair.slice(eq + 1).trim());
    return value.length > 0 ? value : null;
  }
  return null;
}

/** Read a dotted claim path (e.g. `realm_access.roles`) off a payload. */
function claim(payload: JWTPayload, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc !== null && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, payload);
}

/** Project verified claims onto the typed claim shape.  The auth middleware
 *  derives the request principal (incl. `orgPath` under tenancy) from this. */
function toUser(payload: JWTPayload): UserClaims {
  return {
    id: claim(payload, "sub") as string,
    email: claim(payload, "email") as string,
    orgId: claim(payload, "orgId") as string,
    role: claim(payload, "role") as string,
    permissions: claim(payload, "permissions") as string[],
  };
}

/** Generated OIDC verifier — validates signature (JWKS), issuer, and
 *  audience, then maps claims onto User.  Returns null to reject (→ 401). */
export const oidcVerifier = async (req: Request): Promise<UserClaims | null> => {
  const token = bearer(req);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, await getJwks(), { issuer: ISSUER });
    return toUser(payload);
  } catch {
    return null;
  }
};

/** Register the generated verifier.  Called from index.ts at boot,
 *  BEFORE `serve(...)`.  Override by registering your own afterwards. */
export function registerOidcVerifier(): void {
  registerUserVerifier(oidcVerifier);
}

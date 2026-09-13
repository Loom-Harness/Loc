// Auto-generated.
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { requestContext } from "../obs/als";
import type { User, UserClaims } from "./user-types";
import { verifyUserOrThrow } from "./verifier";

const BYPASS_PREFIXES = ["/health", "/ready", "/openapi.json", "/swagger", "/api/auth/login", "/api/auth/callback", "/api/auth/logout", "/api/auth/refresh"] as const;

/** Whether ANY route serves this path.  Installed by http/index.ts once every
 *  router is mounted (it owns the router that can answer), so it is null until
 *  then and the middleware simply authenticates as before.
 *
 *  The RFC puts ROUTING before authentication.  §15.5.4 names 404 as the code
 *  for an origin server that wishes to hide a resource's existence — 404 is the
 *  sanctioned concealment tool, not 401 — and §15.5.2 defines 401 as missing
 *  credentials FOR THE TARGET RESOURCE, which invites a retry that can never
 *  succeed when there is no such resource.  So a path nothing serves falls
 *  through to the 404 handler rather than being challenged.
 *
 *  Keyed on (METHOD, path), because that is what a router resolves.  Keying on
 *  the path alone answers 401 for a wrong VERB on a path that exists, which
 *  contradicts the same ladder: a method mismatch is a ROUTING outcome, so it
 *  belongs to the 405 handler, ahead of authentication.  Phoenix was already
 *  right here and node was not — the cross-backend recording is what said so.
 *  Disclosing the served methods to an anonymous caller is consistent with
 *  answering 404 honestly for an unknown path: concealment has its own
 *  sanctioned tool (§15.5.4) and this API does not use it. */
export type RouteProbe = (method: string, path: string) => boolean;
let routeProbe: RouteProbe | null = null;
export function registerRouteProbe(fn: RouteProbe): void {
  routeProbe = fn;
}

/** The caller's ROOT-org segment (`currentUser.rootOrg`): the first segment of
 *  the materialized `orgPath` (multi-tenancy). */
function rootOrgOf(orgPath: string): string {
  const i = orgPath.indexOf(".");
  return i === -1 ? orgPath : orgPath.slice(0, i);
}

/** Hono middleware that decodes the request's JWT into a User, attaches it
 *  to the ambient RequestContext (the one source of truth, readable by
 *  non-HTTP code via `requireCurrentUser()`), and also stashes it on the
 *  Hono request scope under "currentUser" for HTTP-layer reads.  Bypass
 *  list matches the .NET side — framework endpoints stay anonymous so
 *  smoke tests + the OpenAPI cross-check don't need tokens. */
/** RFC 7807 for a request that carried no valid credentials — the same envelope
 *  every other error on this API sends, rather than
 *  `{"error":"unauthorized"}` — a shape appearing nowhere else.
 *
 *  `WWW-Authenticate` is not decoration: RFC 9110 §15.5.2 makes it a MUST on
 *  every 401 ("at least one challenge applicable to the target resource"), and
 *  it is what tells a client HOW to authenticate rather than merely that it
 *  failed.  The challenge is the RFC 6750 §3 bearer form. */
function unauthorized(c: Context) {
  const detail = `no valid credentials for ${c.req.method} ${c.req.path}`;
  return c.body(
    JSON.stringify({
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
      detail,
      instance: c.req.path,
    }),
    401,
    {
      "content-type": "application/problem+json",
      "www-authenticate": 'Bearer realm="api", error="invalid_token"',
    },
  );
}

export const authMiddleware = createMiddleware<{
  Variables: { currentUser: User };
}>(async (c, next) => {
  const path = new URL(c.req.url).pathname;
  for (const prefix of BYPASS_PREFIXES) {
    if (path.startsWith(prefix)) {
      await next();
      return;
    }
  }
  // Route before authenticate — see registerRouteProbe above.
  if (routeProbe && !routeProbe(c.req.method, path)) {
    await next();
    return;
  }
  let claims: UserClaims;
  try {
    claims = await verifyUserOrThrow(c.req.raw);
  } catch {
    return unauthorized(c);
  }
  const orgPath = String(claims.tenantId ?? "");
  const user: User = { ...claims, orgPath, rootOrg: rootOrgOf(orgPath) };
  // Attach the principal to the ambient frame (read by non-HTTP code via
  // requireCurrentUser) and to the Hono context (read by route handlers
  // that hold `c`).
  const ctx = requestContext();
  if (ctx) ctx.currentUser = user;
  if (ctx) ctx.actorId = String(user.id);
  c.set("currentUser", user);
  await next();
});

/** The verified principal for the current request, read from the ambient
 *  RequestContext — the analogue of .NET's ICurrentUserAccessor.User.
 *  Throws when no principal is bound, so anonymous / bypassed paths must
 *  not call it. */
export function requireCurrentUser(): User {
  const user = requestContext()?.currentUser;
  if (user == null) {
    throw new Error(
      "currentUser is not available — ensure authMiddleware ran for this route.",
    );
  }
  return user as User;
}

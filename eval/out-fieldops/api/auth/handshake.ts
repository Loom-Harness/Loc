// Auto-generated.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

const ISSUER = process.env.OIDC_ISSUER ?? "";
const CLIENT_ID = process.env.OIDC_CLIENT_ID ?? "";
const SCOPES = "openid offline_access";
const REDIRECT_URI = process.env.OIDC_REDIRECT_URI ?? "http://localhost:3000/api/auth/callback";
const POST_LOGIN = process.env.OIDC_POST_LOGIN_REDIRECT ?? "/";

// HttpOnly cookie options shared by the session + refresh + transient PKCE
// cookies.  SameSite=Lax so the IdP's cross-site redirect back to /callback
// still carries them.
const COOKIE = { httpOnly: true, sameSite: "Lax", path: "/" } as const;

interface Endpoints {
  authorization_endpoint: string;
  token_endpoint: string;
}

let discoPromise: Promise<Endpoints> | null = null;
async function disco(): Promise<Endpoints> {
  if (!discoPromise) {
    discoPromise = (async () => {
      const base = ISSUER.replace(/\/$/, "");
      const res = await fetch(`${base}/.well-known/openid-configuration`);
      if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
      return (await res.json()) as Endpoints;
    })();
  }
  return discoPromise;
}

/** Base64url with no padding — the encoding PKCE (RFC 7636) mandates for the
 *  verifier and the challenge. */
function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The tokens an authorization-code / refresh exchange returns.  `refresh_token`
 *  is present only when the IdP grants one (the `offline_access` scope). */
interface TokenResponse {
  access_token: string;
  refresh_token?: string;
}

/** Persist the access token as the browser session and the refresh token (when
 *  present) for the /refresh rotation.  Both are HttpOnly — the SPA never sees
 *  the raw tokens, it only rides the session cookie as a Bearer. */
function storeTokens(c: Context, tokens: TokenResponse): void {
  setCookie(c, "session", tokens.access_token, COOKIE);
  if (tokens.refresh_token) setCookie(c, "refresh", tokens.refresh_token, COOKIE);
}

/** The /auth/* redirect handshake + session probe.  Mounted at "/auth"
 *  by createApp. */
export function authRoutes(): Hono {
  const app = new Hono();

  // Start the authorization-code flow — redirect to the IdP's login page.
  // PKCE (RFC 7636): mint a per-login code verifier, send only its SHA-256
  // challenge to the IdP, and stash the verifier in an HttpOnly cookie so the
  // /callback exchange can prove possession.  Unconditional (OAuth 2.1 makes
  // PKCE mandatory) — it costs nothing for confidential clients and closes the
  // authorization-code-interception hole for public ones.
  app.get("/login", async (c) => {
    const { authorization_endpoint } = await disco();
    const state = randomUUID();
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash("sha256").update(verifier).digest());
    setCookie(c, "oidc_state", state, COOKIE);
    setCookie(c, "oidc_verifier", verifier, COOKIE);
    const url = new URL(authorization_endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", CLIENT_ID);
    url.searchParams.set("redirect_uri", REDIRECT_URI);
    url.searchParams.set("scope", SCOPES);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return c.redirect(url.toString());
  });

  // Exchange the code for tokens and issue the local session.
  app.get("/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const verifier = getCookie(c, "oidc_verifier");
    if (!code || !state || state !== getCookie(c, "oidc_state") || !verifier) {
      return c.json({ error: "invalid_state" }, 400);
    }
    const { token_endpoint } = await disco();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    });
    const res = await fetch(token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) return c.json({ error: "token_exchange_failed" }, 401);
    const tokens = (await res.json()) as TokenResponse;
    // Session: stash the access token in an HttpOnly cookie; the SPA
    // forwards it as a Bearer that auth/oidc.ts verifies.  The refresh
    // token (when granted) rides its own HttpOnly cookie for /refresh.
    storeTokens(c, tokens);
    deleteCookie(c, "oidc_state", { path: "/" });
    deleteCookie(c, "oidc_verifier", { path: "/" });
    return c.redirect(POST_LOGIN);
  });

  // Silent renewal — exchange the stored refresh token for a fresh access
  // token WITHOUT another IdP round-trip, and ROTATE the refresh token (the
  // IdP hands back a new one; storeTokens overwrites the cookie so a stolen
  // token is single-use).  The SPA calls this on a 401 to extend the session.
  // Bypassed by the auth middleware — the caller has no valid access token yet.
  app.post("/refresh", async (c) => {
    const refresh = getCookie(c, "refresh");
    if (!refresh) return c.json({ error: "no_refresh_token" }, 401);
    const { token_endpoint } = await disco();
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: CLIENT_ID,
    });
    const res = await fetch(token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      // The refresh token is spent or revoked — clear both cookies so the
      // SPA falls back to a full /login rather than looping on a dead token.
      deleteCookie(c, "session", { path: "/" });
      deleteCookie(c, "refresh", { path: "/" });
      return c.json({ error: "refresh_failed" }, 401);
    }
    const tokens = (await res.json()) as TokenResponse;
    storeTokens(c, tokens);
    return c.json({ ok: true });
  });

  // Clear the local session.  The IdP's own session is ended at its
  // end-session endpoint, which the SPA can link to directly.
  app.get("/logout", (c) => {
    deleteCookie(c, "session", { path: "/" });
    deleteCookie(c, "refresh", { path: "/" });
    return c.redirect(POST_LOGIN);
  });

  // Session probe for the frontend guard — NOT bypassed, so the auth
  // middleware has already verified the principal (or returned 401) by
  // the time this runs.  Answers the declared `user { … }` shape as plain
  // JSON — the per-request derived members (orgPath / rootOrg) are server-side
  // scoping state, not part of the declared principal.
  app.get("/me", (c) => {
    const user = (c as unknown as { get(k: "currentUser"): Record<string, unknown> | undefined }).get(
      "currentUser",
    );
    if (!user) return c.json(null);
    return c.json({
      id: user.id ?? null,
      tenantId: user.tenantId ?? null,
      role: user.role ?? null,
    });
  });

  return app;
}

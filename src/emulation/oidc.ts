// Fake OIDC identity provider — what the generated backend's real verifier
// talks to when no real issuer is up.  It signs RS256 tokens with a WebCrypto key and
// serves the endpoints a Keycloak realm serves, under the issuer URL the
// deployable's compose env names (`OIDC_ISSUER`), so `iss`, `aud`, `exp` and
// the signature are all checked by the generated code, not assumed.
//
//   <issuer>/.well-known/openid-configuration   discovery
//   <issuer>/protocol/openid-connect/certs      JWKS (the signing key only)
//   <issuer>/protocol/openid-connect/auth       authorization (answered by `authorize`: the
//                                               preview's login page picks the persona)
//   <issuer>/protocol/openid-connect/token      grant_type=authorization_code (PKCE) | password | refresh_token
//   <issuer>/protocol/openid-connect/userinfo   the persona's profile claims
//   <issuer>/protocol/openid-connect/logout     end_session: back to
//                                               post_logout_redirect_uri
//
// The endpoint paths are the provider's `routes` (Keycloak's by default, the
// playground's realm shape); a host serving another layout passes its own.
// The authorization endpoint answers over HTTP too: it signs the
// `autoLogin` persona (or the one `login_hint` names) straight back in, or
// renders a login page with one button per persona plus a username/password
// form whose field ids are Keycloak's (`#username`, `#password`, `#kc-login`).
//
// A host routes endpoint requests to `serve` (the playground from a
// deployable's `fetch`, a Node host from a loopback server) and mints tokens
// directly with `mint`.  Personas are the users of the generated dev Keycloak
// realm, with the claims its protocol mappers put in a token (the playground's
// `web/src/backend/oidc-personas.ts` derives them).
//
// Each provider owns its signing keys, which `reset` keeps, so a token minted
// before a reset still verifies after it.
//
// Operations (the playground's infra ops of the same names):
//   configure { realms, personas }  the realms (issuer + client) and personas of this boot
//   personas {}                     the configured personas
//   mint { persona, claims?, issuer?, audience?, expiresIn?, signWith? }
//                                   a token set; `claims` merge over the persona's,
//                                   `signWith: "foreign"` signs with a key the JWKS
//                                   does not publish (a forged token)
//   authorize { url, persona }      sign `persona` in at an authorization URL; the
//                                   redirect back to the client, with a code
//   settings { accessTokenLifetime? }  seconds a token minted by a grant lives
//   grants {}                       the grants the token endpoint served, oldest first
//   http { method, url, headers, body }   an endpoint request from a deployable

import type { HttpRequestData, HttpResponseData } from "./http.js";

export interface OidcRealm {
  issuer: string;
  clientId: string;
  /** What the realm's audience mapper puts in an access token's `aud`; the
   *  client id when the realm maps none.  Empty: the token carries no `aud`. */
  audience: string;
  /** A confidential client's secret: the token endpoint then requires it
   *  (`client_secret_basic` or `client_secret_post`).  Absent: a public client. */
  clientSecret?: string;
}

/** Endpoint paths under the issuer. */
export interface OidcRoutes {
  authorize: string;
  token: string;
  userinfo: string;
  jwks: string;
  logout: string;
}

/** The paths a Keycloak realm serves. */
export const KEYCLOAK_ROUTES: OidcRoutes = {
  authorize: "/protocol/openid-connect/auth",
  token: "/protocol/openid-connect/token",
  userinfo: "/protocol/openid-connect/userinfo",
  jwks: "/protocol/openid-connect/certs",
  logout: "/protocol/openid-connect/logout",
};

export interface OidcProviderOptions {
  routes?: OidcRoutes;
  /** Milliseconds since the epoch; the host's clock by default. */
  now?: () => number;
}

export interface OidcPersona {
  username: string;
  /** The login page's and the password grant's password; any password signs
   *  the persona in when unset. */
  password?: string;
  /** The claims the realm's mappers put in an access token for this user
   *  (everything except `iss` / `aud` / `iat` / `exp` / `azp`). */
  claims: Record<string, unknown>;
}

export interface MintParams {
  persona: string;
  /** Merged over the persona's claims and the registered ones (`sub`,
   *  `tenantId`, … or `iss`). */
  claims?: Record<string, unknown>;
  /** Default: the first configured realm's. */
  issuer?: string;
  audience?: string;
  /** Seconds; negative mints an already expired token.  Default 3600. */
  expiresIn?: number;
  signWith?: "realm" | "foreign";
}

export interface TokenSet {
  access_token: string;
  id_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const DEFAULT_LIFETIME_S = 3600;

const b64url = (bytes: Uint8Array): string => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

interface SigningKey {
  kid: string;
  privateKey: CryptoKey;
  jwk: JsonWebKey & { kid: string; alg: string; use: string };
}

async function generateKey(kid: string): Promise<SigningKey> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pub = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    kid,
    privateKey: pair.privateKey,
    jwk: { kty: pub.kty, n: pub.n, e: pub.e, kid, alg: "RS256", use: "sig" },
  };
}

function pick(o: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): HttpResponseData => ({
  status,
  headers: {
    "content-type": "application/json",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    ...headers,
  },
  body: enc.encode(JSON.stringify(body)),
});

const html = (status: number, body: string): HttpResponseData => ({
  status,
  headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  body: enc.encode(body),
});

const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const oauthError = (status: number, error: string, description: string): HttpResponseData =>
  json(status, { error, error_description: description });

export function discovery(
  issuer: string,
  routes: OidcRoutes = KEYCLOAK_ROUTES,
): Record<string, unknown> {
  return {
    issuer,
    authorization_endpoint: `${issuer}${routes.authorize}`,
    token_endpoint: `${issuer}${routes.token}`,
    userinfo_endpoint: `${issuer}${routes.userinfo}`,
    jwks_uri: `${issuer}${routes.jwks}`,
    end_session_endpoint: `${issuer}${routes.logout}`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token", "password"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "profile", "email", "offline_access"],
    code_challenge_methods_supported: ["S256", "plain"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
    claims_supported: [
      "sub",
      "iss",
      "aud",
      "exp",
      "iat",
      "preferred_username",
      "email",
      "realm_access",
    ],
  };
}

async function s256(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier))));
}

/** The `sub` of a token this provider signed (signature not re-checked: the
 *  userinfo endpoint only reads its own tokens back). */
function subjectOf(jwt: string): string | null {
  try {
    const part = jwt.split(".")[1] ?? "";
    const bin = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(dec.decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))) as {
      sub?: unknown;
    };
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/** One grant the token endpoint served. */
export interface OidcGrant {
  grant: string;
  persona: string;
}

export interface OidcProvider {
  configure(params: { realms: OidcRealm[]; personas: OidcPersona[] }): void;
  realms(): OidcRealm[];
  personas(): OidcPersona[];
  mint(params: MintParams): Promise<TokenSet>;
  /** Sign `persona` in at an authorization URL; the redirect back to the client. */
  authorize(url: string, persona: string): string;
  /** Seconds a token minted by a grant lives, and the persona the authorization
   *  endpoint signs in without a login page (null: always the page); answers
   *  the current settings. */
  settings(params: { accessTokenLifetime?: number; autoLogin?: string | null }): {
    accessTokenLifetime: number;
    autoLogin: string | null;
  };
  /** The grants the token endpoint served, oldest first. */
  grants(): OidcGrant[];
  jwks(): Promise<{ keys: JsonWebKey[] }>;
  /** Sign a payload with the realm key (or a key the JWKS does not publish). */
  signJwt(payload: Record<string, unknown>, which?: "realm" | "foreign"): Promise<string>;
  /** Answer one endpoint request. */
  serve(req: HttpRequestData): Promise<HttpResponseData>;
  /** Forget realms, personas, codes, refresh tokens and grants; keep the keys. */
  reset(): void;
}

export function createOidcProvider(options: OidcProviderOptions = {}): OidcProvider {
  const routes = options.routes ?? KEYCLOAK_ROUTES;
  const nowMs = options.now ?? (() => Date.now());
  let realmKey: Promise<SigningKey> | null = null;
  let foreignKey: Promise<SigningKey> | null = null;
  const keyOf = (which: "realm" | "foreign"): Promise<SigningKey> => {
    if (which === "realm") {
      realmKey ??= generateKey("loom-playground");
      return realmKey;
    }
    foreignKey ??= generateKey("loom-playground");
    return foreignKey;
  };

  async function signJwt(
    payload: Record<string, unknown>,
    which: "realm" | "foreign" = "realm",
  ): Promise<string> {
    const key = await keyOf(which);
    const head = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT", kid: key.kid })));
    const body = b64url(enc.encode(JSON.stringify(payload)));
    const sig = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key.privateKey,
      enc.encode(`${head}.${body}`),
    );
    return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
  }

  let realms: OidcRealm[] = [];
  let personas: OidcPersona[] = [];
  /** Authorization codes awaiting their exchange (single use). */
  const codes = new Map<
    string,
    {
      persona: string;
      issuer: string;
      clientId: string;
      redirectUri: string;
      challenge: string | null;
      method: string;
    }
  >();
  /** Seconds a token minted by a token-endpoint grant lives. */
  let grantLifetime = DEFAULT_LIFETIME_S;
  /** The persona the authorization endpoint signs in without a login page. */
  let autoLogin: string | null = null;
  /** The grants the token endpoint served, oldest first. */
  const grants: OidcGrant[] = [];

  /** Refresh tokens still redeemable → who they were issued to.  Single use:
   *  redeeming one replaces it (rotation). */
  const refreshTokens = new Map<
    string,
    { persona: string; claims?: Record<string, unknown>; issuer: string }
  >();

  const randomToken = (): string => b64url(crypto.getRandomValues(new Uint8Array(32)));

  function realmFor(issuer: string | undefined): OidcRealm {
    const realm = issuer === undefined ? realms[0] : realms.find((r) => r.issuer === issuer);
    if (!realm)
      throw new Error(
        issuer
          ? `oidc: no realm with issuer ${issuer}`
          : "oidc: no realm is configured — boot a system with auth { oidc }.",
      );
    return realm;
  }

  function personaFor(username: string): OidcPersona {
    const p = personas.find((x) => x.username === username);
    if (!p)
      throw new Error(
        `oidc: no persona "${username}" (have: ${personas.map((x) => x.username).join(", ") || "none"})`,
      );
    return p;
  }

  async function mint(params: MintParams): Promise<TokenSet> {
    const realm = realmFor(params.issuer);
    const persona = personaFor(params.persona);
    const now = Math.floor(nowMs() / 1000);
    const lifetime = params.expiresIn ?? DEFAULT_LIFETIME_S;
    const claims = { ...persona.claims, ...(params.claims ?? {}) };
    const sign = params.signWith ?? "realm";
    const common = {
      iss: realm.issuer,
      iat: lifetime < 0 ? now + lifetime - 60 : now,
      exp: now + lifetime,
      azp: realm.clientId,
    };
    // `params.claims` win over everything, the registered claims included, so a
    // test can mint a token from another issuer.
    const access = await signJwt(
      {
        ...persona.claims,
        ...common,
        ...((params.audience ?? realm.audience) ? { aud: params.audience ?? realm.audience } : {}),
        typ: "Bearer",
        scope: "openid profile email",
        ...params.claims,
      },
      sign,
    );
    const id = await signJwt(
      {
        sub: claims.sub,
        ...pick(claims, [
          "preferred_username",
          "email",
          "email_verified",
          "name",
          "given_name",
          "family_name",
        ]),
        ...common,
        aud: realm.clientId,
        typ: "ID",
      },
      sign,
    );
    const refresh = randomToken();
    refreshTokens.set(refresh, {
      persona: persona.username,
      claims: params.claims,
      issuer: realm.issuer,
    });
    return {
      access_token: access,
      id_token: id,
      refresh_token: refresh,
      token_type: "Bearer",
      expires_in: lifetime,
      scope: "openid profile email",
    };
  }

  /** Sign `persona` in at the authorization URL `url` (what the client's
   *  `/login` redirected to): checks the request the way Keycloak does and
   *  answers the redirect back to the client — `redirect_uri?code=…&state=…`,
   *  or `?error=…` for a request it refuses. */
  function authorize(url: string, persona: string): string {
    const u = new URL(url);
    const realm = realms.find((r) => url.startsWith(`${r.issuer}${routes.authorize}`));
    if (!realm)
      throw new Error(`oidc: ${u.origin + u.pathname} is no realm's authorization endpoint`);
    const q = u.searchParams;
    const redirectUri = q.get("redirect_uri") ?? "";
    if (!redirectUri) throw new Error("oidc: the authorization request names no redirect_uri");
    const back = new URL(redirectUri);
    const state = q.get("state");
    if (state !== null) back.searchParams.set("state", state);
    const refuse = (error: string): string => {
      back.searchParams.set("error", error);
      return back.toString();
    };
    if (q.get("client_id") !== realm.clientId) return refuse("unauthorized_client");
    if (q.get("response_type") !== "code") return refuse("unsupported_response_type");
    personaFor(persona);
    const code = randomToken();
    codes.set(code, {
      persona,
      issuer: realm.issuer,
      clientId: realm.clientId,
      redirectUri,
      challenge: q.get("code_challenge"),
      method: q.get("code_challenge_method") ?? "plain",
    });
    back.searchParams.set("code", code);
    return back.toString();
  }

  /** The client a token request authenticates as — `client_secret_basic`
   *  (Authorization header) or `client_secret_post`/public (form) — or null
   *  when the realm's secret is required and missing or wrong. */
  function clientOf(
    realm: OidcRealm,
    form: URLSearchParams,
    authorization: string | undefined,
  ): string | null {
    let id = form.get("client_id");
    let secret = form.get("client_secret");
    const basic = /^Basic\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (basic) {
      const decoded = atob(basic);
      const colon = decoded.indexOf(":");
      id = decodeURIComponent(colon < 0 ? decoded : decoded.slice(0, colon));
      secret = colon < 0 ? "" : decodeURIComponent(decoded.slice(colon + 1));
    }
    if (realm.clientSecret !== undefined && secret !== realm.clientSecret) return null;
    return id ?? "";
  }

  /** The persona a username/password pair signs in as, or null. */
  function checkPassword(username: string, password: string | null): string | null {
    const p = personas.find((x) => x.username === username);
    if (!p) return null;
    if (p.password !== undefined && password !== p.password) return null;
    return p.username;
  }

  async function token(
    realm: OidcRealm,
    form: URLSearchParams,
    authorization: string | undefined,
  ): Promise<HttpResponseData> {
    const client = clientOf(realm, form, authorization);
    if (client === null) return oauthError(401, "invalid_client", "Invalid client credentials");
    const grant = form.get("grant_type");
    if (grant === "password") {
      const username = form.get("username") ?? "";
      if (!checkPassword(username, form.get("password")))
        return oauthError(401, "invalid_grant", "Invalid user credentials");
      grants.push({ grant: "password", persona: username });
      return json(
        200,
        await mint({ persona: username, issuer: realm.issuer, expiresIn: grantLifetime }),
      );
    }
    if (grant === "authorization_code") {
      const code = form.get("code") ?? "";
      const held = codes.get(code);
      codes.delete(code);
      if (!held || held.issuer !== realm.issuer)
        return oauthError(400, "invalid_grant", "Code not valid");
      if (form.get("redirect_uri") !== held.redirectUri)
        return oauthError(400, "invalid_grant", "Incorrect redirect_uri");
      if (client !== held.clientId) return oauthError(400, "invalid_client", "Client mismatch");
      if (held.challenge !== null) {
        const verifier = form.get("code_verifier") ?? "";
        const derived = held.method === "plain" ? verifier : await s256(verifier);
        if (!verifier || derived !== held.challenge) {
          return oauthError(400, "invalid_grant", "PKCE verification failed: Code mismatch");
        }
      }
      grants.push({ grant: "authorization_code", persona: held.persona });
      return json(
        200,
        await mint({ persona: held.persona, issuer: realm.issuer, expiresIn: grantLifetime }),
      );
    }
    if (grant === "refresh_token") {
      const presented = form.get("refresh_token") ?? "";
      const held = refreshTokens.get(presented);
      if (!held || held.issuer !== realm.issuer)
        return oauthError(400, "invalid_grant", "Token is not active");
      refreshTokens.delete(presented);
      grants.push({ grant: "refresh_token", persona: held.persona });
      return json(
        200,
        await mint({
          persona: held.persona,
          claims: held.claims,
          issuer: realm.issuer,
          expiresIn: grantLifetime,
        }),
      );
    }
    return oauthError(400, "unsupported_grant_type", `Unsupported grant_type ${grant ?? "(none)"}`);
  }

  /** The authorization endpoint over HTTP.  GET signs the `login_hint`
   *  persona, else the `autoLogin` one, straight back in (`prompt=login` always
   *  shows the page); otherwise, and on a failed submit, it renders the login
   *  page.  POST is that page's submit: a persona button, or username/password. */
  async function authorizeEndpoint(
    realm: OidcRealm,
    req: HttpRequestData,
  ): Promise<HttpResponseData> {
    const query =
      req.method === "POST"
        ? new URLSearchParams(dec.decode(req.body))
        : new URL(req.url).searchParams;
    const params = new URLSearchParams(
      [...query].filter(([k]) => !["persona", "username", "password"].includes(k)),
    );
    const authUrl = `${realm.issuer}${routes.authorize}?${params}`;
    const redirect = (persona: string): HttpResponseData => ({
      status: 302,
      headers: { location: authorize(authUrl, persona) },
      body: new Uint8Array(),
    });
    if (!params.get("redirect_uri"))
      return oauthError(400, "invalid_request", "Missing parameter: redirect_uri");
    let who: string | null = null;
    if (req.method === "POST") {
      const button = query.get("persona");
      who =
        button && personas.some((p) => p.username === button)
          ? button
          : checkPassword(query.get("username") ?? "", query.get("password") ?? "");
    } else if (params.get("prompt") !== "login") {
      const hint = params.get("login_hint");
      who = personas.some((p) => p.username === hint) ? hint : autoLogin;
      if (who !== null && !personas.some((p) => p.username === who)) who = null;
    }
    return who ? redirect(who) : loginPage(realm, params);
  }

  function loginPage(realm: OidcRealm, params: URLSearchParams): HttpResponseData {
    const hidden = [...params]
      .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
      .join("\n    ");
    const buttons = personas
      .map(
        (p) =>
          `<button type="submit" name="persona" value="${esc(p.username)}" data-testid="login-${esc(p.username)}">Sign in as ${esc(p.username)}</button>`,
      )
      .join("\n    ");
    return html(
      200,
      `<!doctype html>
<html><head><meta charset="utf-8"><title>Sign in</title></head>
<body>
  <h1>Sign in</h1>
  <form method="post" action="${esc(`${realm.issuer}${routes.authorize}`)}">
    ${hidden}
    <label for="username">Username</label> <input id="username" name="username" autocomplete="username">
    <label for="password">Password</label> <input id="password" name="password" type="password" autocomplete="current-password">
    <button type="submit" id="kc-login" data-testid="login-submit">Sign in</button>
    ${buttons}
  </form>
</body></html>`,
    );
  }

  /** Answer one endpoint request.  The issuer is the configured one the URL
   *  starts with. */
  async function serve(req: HttpRequestData): Promise<HttpResponseData> {
    const realm = realms
      .filter((r) => req.url === r.issuer || req.url.startsWith(`${r.issuer}/`))
      .sort((a, b) => b.issuer.length - a.issuer.length)[0];
    if (!realm) return oauthError(404, "not_found", `No realm is served at ${req.url}`);
    const path = new URL(req.url).pathname.slice(
      new URL(realm.issuer).pathname.replace(/\/$/, "").length,
    );
    switch (path) {
      case "/.well-known/openid-configuration":
        return json(200, discovery(realm.issuer, routes));
      case routes.jwks:
        return json(200, { keys: [(await keyOf("realm")).jwk] });
      case routes.token:
        if (req.method !== "POST") return oauthError(405, "invalid_request", "POST only");
        return token(realm, new URLSearchParams(dec.decode(req.body)), req.headers.authorization);
      case routes.authorize:
        return authorizeEndpoint(realm, req);
      case routes.logout: {
        const back = new URL(req.url).searchParams.get("post_logout_redirect_uri");
        if (back) return { status: 302, headers: { location: back }, body: new Uint8Array() };
        return html(200, "<!doctype html><title>Signed out</title><p>Signed out.</p>");
      }
      case routes.userinfo: {
        const bearer = /^Bearer (.+)$/i.exec(req.headers.authorization ?? "")?.[1];
        const sub = bearer ? subjectOf(bearer) : null;
        const persona = personas.find((p) => p.claims.sub === sub);
        if (!persona) return oauthError(401, "invalid_token", "Token verification failed");
        return json(
          200,
          pick(persona.claims, [
            "sub",
            "preferred_username",
            "email",
            "email_verified",
            "name",
            "given_name",
            "family_name",
          ]),
        );
      }
      default:
        return oauthError(404, "not_found", `No endpoint ${path} on ${realm.issuer}`);
    }
  }

  return {
    configure(p) {
      realms = [...p.realms];
      personas = [...p.personas];
    },
    realms: () => realms,
    personas: () => personas,
    mint,
    authorize,
    settings(p) {
      if (p.accessTokenLifetime !== undefined) grantLifetime = p.accessTokenLifetime;
      if (p.autoLogin !== undefined) autoLogin = p.autoLogin;
      return { accessTokenLifetime: grantLifetime, autoLogin };
    },
    grants: () => [...grants],
    jwks: async () => ({ keys: [(await keyOf("realm")).jwk] }),
    signJwt,
    serve,
    reset() {
      realms = [];
      personas = [];
      refreshTokens.clear();
      codes.clear();
      grants.length = 0;
      grantLifetime = DEFAULT_LIFETIME_S;
      autoLogin = null;
    },
  };
}

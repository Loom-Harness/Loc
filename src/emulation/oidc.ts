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
   *  client id when the realm maps none. */
  audience: string;
}

export interface OidcPersona {
  username: string;
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

const oauthError = (status: number, error: string, description: string): HttpResponseData =>
  json(status, { error, error_description: description });

export function discovery(issuer: string): Record<string, unknown> {
  const oc = `${issuer}/protocol/openid-connect`;
  return {
    issuer,
    authorization_endpoint: `${oc}/auth`,
    token_endpoint: `${oc}/token`,
    userinfo_endpoint: `${oc}/userinfo`,
    jwks_uri: `${oc}/certs`,
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
  /** Seconds a token minted by a grant lives; answers the current setting. */
  settings(params: { accessTokenLifetime?: number }): { accessTokenLifetime: number };
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

export function createOidcProvider(): OidcProvider {
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
    const now = Math.floor(Date.now() / 1000);
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
        aud: params.audience ?? realm.audience,
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
    const realm = realms.find((r) => url.startsWith(`${r.issuer}/protocol/openid-connect/auth`));
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

  async function token(realm: OidcRealm, form: URLSearchParams): Promise<HttpResponseData> {
    const grant = form.get("grant_type");
    if (grant === "password") {
      const username = form.get("username") ?? "";
      if (!personas.some((p) => p.username === username))
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
      if (form.get("client_id") !== held.clientId)
        return oauthError(400, "invalid_client", "Client mismatch");
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
        return json(200, discovery(realm.issuer));
      case "/protocol/openid-connect/certs":
        return json(200, { keys: [(await keyOf("realm")).jwk] });
      case "/protocol/openid-connect/token":
        if (req.method !== "POST") return oauthError(405, "invalid_request", "POST only");
        return token(realm, new URLSearchParams(dec.decode(req.body)));
      case "/protocol/openid-connect/userinfo": {
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
      return { accessTokenLifetime: grantLifetime };
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
    },
  };
}

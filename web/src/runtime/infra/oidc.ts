// Fake OIDC identity provider — what the generated backend's real verifier
// talks to in the preview.  It signs RS256 tokens with a WebCrypto key and
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
// A deployable's `fetch` reaches these through `../resource-fakes.ts`; the main
// thread mints tokens for the Auth panel with `mint`.  Personas are the users
// of the generated dev Keycloak realm, with the claims its protocol mappers put
// in a token (`web/src/backend/oidc-personas.ts` derives them).
//
// Ops:
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
//   tokens {}                       every token set issued (minted or served), oldest
//                                   first, and where the provider differs from Keycloak
//   http { method, url, headers, body }   an endpoint request from a deployable

import type { HttpRequestData, HttpResponseData, ResourceOp } from "./resource-types.js";
import type { InfraService } from "./service.js";

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
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
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

// The keys live as long as the infra worker: a reset (every boot) keeps them,
// so a token minted before a re-boot still verifies after it.
let realmKey: Promise<SigningKey> | null = null;
let foreignKey: Promise<SigningKey> | null = null;
const keyOf = (which: "realm" | "foreign"): Promise<SigningKey> =>
  which === "realm"
    ? (realmKey ??= generateKey("loom-playground"))
    : (foreignKey ??= generateKey("loom-playground"));

export async function signJwt(payload: Record<string, unknown>, which: "realm" | "foreign" = "realm"): Promise<string> {
  const key = await keyOf(which);
  const head = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT", kid: key.kid })));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

let realms: OidcRealm[] = [];
let personas: OidcPersona[] = [];
/** Authorization codes awaiting their exchange (single use). */
const codes = new Map<
  string,
  { persona: string; issuer: string; clientId: string; redirectUri: string; challenge: string | null; method: string }
>();
/** Seconds a token minted by a token-endpoint grant lives. */
let grantLifetime = DEFAULT_LIFETIME_S;
/** The grants the token endpoint served, oldest first. */
const grants: { grant: string; persona: string }[] = [];

/** Refresh tokens still redeemable → who they were issued to.  Single use:
 *  redeeming one replaces it (rotation). */
const refreshTokens = new Map<string, { persona: string; claims?: Record<string, unknown>; issuer: string }>();

const randomToken = (): string => b64url(crypto.getRandomValues(new Uint8Array(32)));

function realmFor(issuer: string | undefined): OidcRealm {
  const realm = issuer === undefined ? realms[0] : realms.find((r) => r.issuer === issuer);
  if (!realm) throw new Error(issuer ? `oidc: no realm with issuer ${issuer}` : "oidc: no realm is configured — boot a system with auth { oidc }.");
  return realm;
}

function personaFor(username: string): OidcPersona {
  const p = personas.find((x) => x.username === username);
  if (!p) throw new Error(`oidc: no persona "${username}" (have: ${personas.map((x) => x.username).join(", ") || "none"})`);
  return p;
}

export async function mint(params: MintParams): Promise<TokenSet> {
  const realm = realmFor(params.issuer);
  const persona = personaFor(params.persona);
  const now = Math.floor(Date.now() / 1000);
  const lifetime = params.expiresIn ?? DEFAULT_LIFETIME_S;
  const claims = { ...persona.claims, ...(params.claims ?? {}) };
  const sign = params.signWith ?? "realm";
  const common = { iss: realm.issuer, iat: lifetime < 0 ? now + lifetime - 60 : now, exp: now + lifetime, azp: realm.clientId };
  // `params.claims` win over everything, the registered claims included, so a
  // test can mint a token from another issuer.
  const access = await signJwt(
    { ...persona.claims, ...common, aud: params.audience ?? realm.audience, typ: "Bearer", scope: "openid profile email", ...params.claims },
    sign,
  );
  const id = await signJwt(
    {
      sub: claims.sub,
      ...pick(claims, ["preferred_username", "email", "email_verified", "name", "given_name", "family_name"]),
      ...common,
      aud: realm.clientId,
      typ: "ID",
    },
    sign,
  );
  const refresh = randomToken();
  refreshTokens.set(refresh, { persona: persona.username, claims: params.claims, issuer: realm.issuer });
  return { access_token: access, id_token: id, refresh_token: refresh, token_type: "Bearer", expires_in: lifetime, scope: "openid profile email" };
}

function pick(o: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): HttpResponseData => ({
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*", ...headers },
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
    claims_supported: ["sub", "iss", "aud", "exp", "iat", "preferred_username", "email", "realm_access"],
  };
}

async function s256(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier))));
}

/** Sign `persona` in at the authorization URL `url` (what the client's
 *  `/login` redirected to): checks the request the way Keycloak does and
 *  answers the redirect back to the client — `redirect_uri?code=…&state=…`,
 *  or `?error=…` for a request it refuses. */
export function authorize(url: string, persona: string): string {
  const u = new URL(url);
  const realm = realms.find((r) => url.startsWith(`${r.issuer}/protocol/openid-connect/auth`));
  if (!realm) throw new Error(`oidc: ${u.origin + u.pathname} is no realm's authorization endpoint`);
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
    if (!personas.some((p) => p.username === username)) return oauthError(401, "invalid_grant", "Invalid user credentials");
    grants.push({ grant: "password", persona: username });
    return json(200, await mint({ persona: username, issuer: realm.issuer, expiresIn: grantLifetime }));
  }
  if (grant === "authorization_code") {
    const code = form.get("code") ?? "";
    const held = codes.get(code);
    codes.delete(code);
    if (!held || held.issuer !== realm.issuer) return oauthError(400, "invalid_grant", "Code not valid");
    if (form.get("redirect_uri") !== held.redirectUri) return oauthError(400, "invalid_grant", "Incorrect redirect_uri");
    if (form.get("client_id") !== held.clientId) return oauthError(400, "invalid_client", "Client mismatch");
    if (held.challenge !== null) {
      const verifier = form.get("code_verifier") ?? "";
      const derived = held.method === "plain" ? verifier : await s256(verifier);
      if (!verifier || derived !== held.challenge) {
        return oauthError(400, "invalid_grant", "PKCE verification failed: Code mismatch");
      }
    }
    grants.push({ grant: "authorization_code", persona: held.persona });
    return json(200, await mint({ persona: held.persona, issuer: realm.issuer, expiresIn: grantLifetime }));
  }
  if (grant === "refresh_token") {
    const presented = form.get("refresh_token") ?? "";
    const held = refreshTokens.get(presented);
    if (!held || held.issuer !== realm.issuer) return oauthError(400, "invalid_grant", "Token is not active");
    refreshTokens.delete(presented);
    grants.push({ grant: "refresh_token", persona: held.persona });
    return json(
      200,
      await mint({ persona: held.persona, claims: held.claims, issuer: realm.issuer, expiresIn: grantLifetime }),
    );
  }
  return oauthError(400, "unsupported_grant_type", `Unsupported grant_type ${grant ?? "(none)"}`);
}

/** Answer one endpoint request.  The issuer is the configured one the URL
 *  starts with. */
export async function serve(req: HttpRequestData): Promise<HttpResponseData> {
  const realm = realms
    .filter((r) => req.url === r.issuer || req.url.startsWith(`${r.issuer}/`))
    .sort((a, b) => b.issuer.length - a.issuer.length)[0];
  if (!realm) return oauthError(404, "not_found", `No realm is served at ${req.url}`);
  const path = new URL(req.url).pathname.slice(new URL(realm.issuer).pathname.replace(/\/$/, "").length);
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
      return json(200, pick(persona.claims, ["sub", "preferred_username", "email", "email_verified", "name", "given_name", "family_name"]));
    }
    default:
      return oauthError(404, "not_found", `No endpoint ${path} on ${realm.issuer}`);
  }
}

/** The `sub` of a token this provider signed (signature not re-checked: the
 *  userinfo endpoint only reads its own tokens back). */
function subjectOf(jwt: string): string | null {
  try {
    const part = jwt.split(".")[1] ?? "";
    const bin = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(dec.decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))) as { sub?: unknown };
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/** One token set the provider issued: minted for the main thread, or served by
 *  the token endpoint to a deployable. */
export interface IssuedToken {
  seq: number;
  /** Epoch ms. */
  at: number;
  /** `mint`, or the grant type the token endpoint served. */
  source: "mint" | "password" | "authorization_code" | "refresh_token";
  persona: string;
  access_token: string;
  id_token: string;
  /** Epoch seconds. */
  expiresAt: number;
}

/** Where the provider knowingly differs from the dev Keycloak realm. */
export const OIDC_EMULATION_NOTES: readonly string[] = [
  "the authorization page is the preview's persona picker: no password check, no consent screen",
  "one signing key per browser session (no key rotation); a forged token is signed with a second, unpublished key",
  "no session or logout endpoint: signing out only drops the client's tokens",
];

/** The newest issued tokens kept for inspection. */
const ISSUED_KEPT = 100;
const issued: IssuedToken[] = [];
let issuedSeq = 0;

function logIssued(source: IssuedToken["source"], persona: string, set: TokenSet): void {
  const at = Date.now();
  issued.push({
    seq: ++issuedSeq,
    at,
    source,
    persona,
    access_token: set.access_token,
    id_token: set.id_token,
    expiresAt: Math.floor(at / 1000) + set.expires_in,
  });
  if (issued.length > ISSUED_KEPT) issued.splice(0, issued.length - ISSUED_KEPT);
}

export const oidcService: InfraService<ResourceOp> = {
  name: "oidc",
  async handle({ op, params }) {
    switch (op) {
      case "configure": {
        const p = params as { realms: OidcRealm[]; personas: OidcPersona[] };
        realms = [...p.realms];
        personas = [...p.personas];
        return { ok: true };
      }
      case "personas":
        return personas;
      case "realms":
        return realms;
      case "mint": {
        const p = params as MintParams;
        const set = await mint(p);
        logIssued("mint", p.persona, set);
        return set;
      }
      case "authorize": {
        const p = params as { url: string; persona: string };
        return { location: authorize(p.url, p.persona) };
      }
      case "settings": {
        const p = params as { accessTokenLifetime?: number };
        if (p.accessTokenLifetime !== undefined) grantLifetime = p.accessTokenLifetime;
        return { accessTokenLifetime: grantLifetime };
      }
      case "grants":
        return [...grants];
      case "jwks":
        return { keys: [(await keyOf("realm")).jwk] };
      case "tokens":
        return { tokens: [...issued], emulated: OIDC_EMULATION_NOTES };
      case "http": {
        const served = grants.length;
        const res = await serve(params as HttpRequestData);
        const grant = grants[served];
        if (res.status === 200 && grant) {
          logIssued(grant.grant as IssuedToken["source"], grant.persona, JSON.parse(dec.decode(res.body)) as TokenSet);
        }
        return res;
      }
      default:
        throw new Error(`oidc: unknown op "${op}"`);
    }
  },
  reset() {
    realms = [];
    personas = [];
    refreshTokens.clear();
    codes.clear();
    grants.length = 0;
    issued.length = 0;
    grantLifetime = DEFAULT_LIFETIME_S;
  },
};

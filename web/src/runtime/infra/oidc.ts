// Fake OIDC identity provider — what the generated backend's real verifier
// talks to in the preview.  It signs RS256 tokens with a WebCrypto key and
// serves the endpoints a Keycloak realm serves, under the issuer URL the
// deployable's compose env names (`OIDC_ISSUER`), so `iss`, `aud`, `exp` and
// the signature are all checked by the generated code, not assumed.
//
//   <issuer>/.well-known/openid-configuration   discovery
//   <issuer>/protocol/openid-connect/certs      JWKS (the signing key only)
//   <issuer>/protocol/openid-connect/token      grant_type=password | refresh_token
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
    end_session_endpoint: `${oc}/logout`,
    jwks_uri: `${oc}/certs`,
    response_types_supported: ["token"],
    grant_types_supported: ["refresh_token", "password"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "profile", "email", "offline_access"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
    claims_supported: ["sub", "iss", "aud", "exp", "iat", "preferred_username", "email", "realm_access"],
  };
}

async function token(realm: OidcRealm, form: URLSearchParams): Promise<HttpResponseData> {
  const grant = form.get("grant_type");
  if (grant === "password") {
    const username = form.get("username") ?? "";
    if (!personas.some((p) => p.username === username)) return oauthError(401, "invalid_grant", "Invalid user credentials");
    return json(200, await mint({ persona: username, issuer: realm.issuer }));
  }
  if (grant === "refresh_token") {
    const presented = form.get("refresh_token") ?? "";
    const held = refreshTokens.get(presented);
    if (!held || held.issuer !== realm.issuer) return oauthError(400, "invalid_grant", "Token is not active");
    refreshTokens.delete(presented);
    return json(200, await mint({ persona: held.persona, claims: held.claims, issuer: realm.issuer }));
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
      case "mint":
        return mint(params as MintParams);
      case "jwks":
        return { keys: [(await keyOf("realm")).jwk] };
      case "http":
        return serve(params as HttpRequestData);
      default:
        throw new Error(`oidc: unknown op "${op}"`);
    }
  },
  reset() {
    realms = [];
    personas = [];
    refreshTokens.clear();
  },
};

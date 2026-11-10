// The fake identity provider's setup for one boot, read from the generated
// tree: the realm(s) each backend trusts and the personas to sign in as.
//
//   - A realm is a backend's compose env — `OIDC_ISSUER`, `OIDC_CLIENT_ID`,
//     `OIDC_AUDIENCE` — with the audience the dev Keycloak realm's audience
//     mapper mints when the env sets none (the declared `audience:`).
//   - A persona is a user of the generated dev Keycloak realm
//     (`keycloak/realm.json`), with the claims Keycloak would put in its access
//     token: `sub`, the profile claims, `realm_access.roles`, and one claim per
//     user-attribute mapper.
//
// So a token the playground mints carries what the docker compose stack's
// Keycloak would mint for the same user, and the generated verifier reads it
// the same way.  Pure: files + env in, setup out.

import type { OidcPersona, OidcRealm } from "../runtime/infra/oidc.js";

interface FileLike {
  path: string;
  content: string | Uint8Array;
}

interface RealmMapper {
  protocolMapper?: string;
  config?: Record<string, string>;
}

interface RealmUser {
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  emailVerified?: boolean;
  realmRoles?: string[];
  attributes?: Record<string, string[]>;
}

interface RealmJson {
  realm?: string;
  clients?: { clientId: string; protocolMappers?: RealmMapper[] }[];
  users?: RealmUser[];
}

const REALM_FILE = /(^|\/)keycloak\/realm\.json$/;

export interface OidcSetup {
  realms: OidcRealm[];
  personas: OidcPersona[];
}

/** A UUID derived from `name` — Keycloak's `sub` is a UUID, and a verifier
 *  reading `id: guid` from `sub` rejects anything else.  Stable across boots,
 *  so rows a persona wrote stay theirs. */
export function personaSubject(name: string): string {
  const words: number[] = [];
  for (let seed = 0; seed < 4; seed++) {
    let h = (0x811c9dc5 ^ (seed * 0x9e3779b9)) >>> 0;
    for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193) >>> 0;
    words.push(h);
  }
  const hex = words.map((w) => w.toString(16).padStart(8, "0")).join("");
  // Version 4, RFC 4122 variant — the shape the generated `claimAs(…, "uuid")`
  // accepts.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Set `value` at a dotted claim path (`a.b` → `{ a: { b } }`), as Keycloak's
 *  mappers do. */
function setClaim(out: Record<string, unknown>, path: string, value: unknown): void {
  const segs = path.split(".");
  let node = out;
  for (const seg of segs.slice(0, -1)) {
    const next = node[seg];
    node = (node[seg] = next && typeof next === "object" && !Array.isArray(next) ? next : {}) as Record<string, unknown>;
  }
  node[segs.at(-1)!] = value;
}

function typed(raw: string, jsonType: string | undefined): unknown {
  switch (jsonType) {
    case "int":
    case "long": {
      const n = Number.parseInt(raw, 10);
      return Number.isNaN(n) ? raw : n;
    }
    case "boolean":
      return raw === "true";
    default:
      return raw;
  }
}

/** The access-token claims Keycloak mints for `user` under `mappers`. */
export function personaClaims(user: RealmUser, mappers: readonly RealmMapper[]): Record<string, unknown> {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  const claims: Record<string, unknown> = {
    sub: personaSubject(user.username),
    preferred_username: user.username,
    ...(user.email ? { email: user.email, email_verified: user.emailVerified ?? false } : {}),
    ...(name ? { name } : {}),
    ...(user.firstName ? { given_name: user.firstName } : {}),
    ...(user.lastName ? { family_name: user.lastName } : {}),
    realm_access: { roles: [...(user.realmRoles ?? [])] },
  };
  for (const m of mappers) {
    if (m.protocolMapper !== "oidc-usermodel-attribute-mapper" || !m.config) continue;
    if (m.config["access.token.claim"] === "false") continue;
    const attr = m.config["user.attribute"];
    const claim = m.config["claim.name"];
    const values = attr ? user.attributes?.[attr] : undefined;
    if (!claim || !values || values.length === 0) continue;
    const jsonType = m.config["jsonType.label"];
    setClaim(
      claims,
      claim,
      m.config.multivalued === "true" ? values.map((v) => typed(v, jsonType)) : typed(values[0]!, jsonType),
    );
  }
  return claims;
}

/** The `aud` the realm's audience mapper puts in an access token, or null. */
function mappedAudience(clientId: string, mappers: readonly RealmMapper[]): string | null {
  for (const m of mappers) {
    if (m.protocolMapper !== "oidc-audience-mapper" || !m.config) continue;
    if (m.config["included.custom.audience"]) return m.config["included.custom.audience"];
    if (m.config["included.client.audience"]) return m.config["included.client.audience"] || clientId;
  }
  return null;
}

/** The identity provider's setup for `slugs` (the booted backends), or null
 *  when the tree has no dev realm or no backend names an issuer. */
export function oidcSetup(
  files: readonly FileLike[],
  slugs: readonly string[],
  envOf: (slug: string) => Record<string, string>,
): OidcSetup | null {
  const file = files.find((f) => REALM_FILE.test(f.path));
  if (!file) return null;
  let realm: RealmJson;
  try {
    realm = JSON.parse(typeof file.content === "string" ? file.content : new TextDecoder().decode(file.content)) as RealmJson;
  } catch {
    return null;
  }
  const client = realm.clients?.[0];
  const mappers = client?.protocolMappers ?? [];
  const realms: OidcRealm[] = [];
  for (const slug of slugs) {
    const env = envOf(slug);
    const issuer = env.OIDC_ISSUER?.replace(/\/$/, "");
    if (!issuer || realms.some((r) => r.issuer === issuer)) continue;
    const clientId = env.OIDC_CLIENT_ID ?? client?.clientId ?? "";
    realms.push({
      issuer,
      clientId,
      audience: env.OIDC_AUDIENCE ?? mappedAudience(clientId, mappers) ?? clientId,
    });
  }
  if (realms.length === 0) return null;
  return {
    realms,
    personas: (realm.users ?? []).map((u) => ({ username: u.username, claims: personaClaims(u, mappers) })),
  };
}

/** The payload of a JWT, unverified — for showing what a token carries. */
export function jwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const part = jwt.split(".")[1] ?? "";
    const bin = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const out = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))) as unknown;
    return out && typeof out === "object" && !Array.isArray(out) ? (out as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

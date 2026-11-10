// The playground's fake OIDC identity provider (web/src/runtime/infra/oidc.ts)
// and the setup it boots with (web/src/backend/oidc-personas.ts): realms from
// the compose env, personas from the generated dev Keycloak realm.  Tokens are
// checked with `jose` — the library the generated Hono verifier uses — against
// the JWKS the provider serves.  The generated verifier itself runs against it
// in `web/e2e/oidc-identity-provider.spec.ts`.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createLocalJWKSet, type JSONWebKeySet, jwtVerify } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import { jwtPayload, oidcSetup, personaSubject } from "../../web/src/backend/oidc-personas.js";
import { bootPlan } from "../../web/src/build/boot-plan.js";
import { composeServiceEnv } from "../../web/src/build/deployables.js";
import { SYNC_SHA256 } from "../../web/src/engine/npm/esbuild-vfs-plugin.js";
import { CookieJar, followNavigation } from "../../web/src/preview/auth-navigation.js";
import { oidcService, type TokenSet } from "../../web/src/runtime/infra/oidc.js";
import type { HttpResponseData } from "../../web/src/runtime/infra/resource-types.js";
import type { DispatchResult, SerializedRequest } from "../../web/src/runtime/protocol.js";
import { isIssuerUrl } from "../../web/src/runtime/resource-fakes.js";
import { generateSystemFiles } from "../_helpers/generate.js";

const EXAMPLE = readFileSync(
  path.resolve(__dirname, "../../web/src/examples/oidc-auth-system.ddd"),
  "utf8",
);
const ISSUER = "http://host.docker.internal:8081/realms/desk";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function exampleSetup() {
  const files = await generateSystemFiles(EXAMPLE);
  const list = [...files].map(([p, content]) => ({ path: p, content }));
  const compose = files.get("docker-compose.yml") ?? "";
  return {
    list,
    compose,
    setup: oidcSetup(list, ["api"], (slug) => composeServiceEnv(compose, slug)),
  };
}

const call = <T>(op: string, params: unknown = {}): Promise<T> =>
  oidcService.handle({ op, params }, { client: null }) as Promise<T>;

const http = async (
  method: string,
  url: string,
  body = "",
  headers: Record<string, string> = {},
) => {
  const res = (await call<HttpResponseData>("http", {
    method,
    url,
    headers,
    body: new TextEncoder().encode(body),
  })) as HttpResponseData;
  return {
    status: res.status,
    json: JSON.parse(new TextDecoder().decode(res.body)) as Record<string, unknown>,
  };
};

async function verify(token: string, audience = "desk-api") {
  const { json } = await http("GET", `${ISSUER}/protocol/openid-connect/certs`);
  return jwtVerify(token, createLocalJWKSet(json as unknown as JSONWebKeySet), {
    issuer: ISSUER,
    audience,
  });
}

describe("oidcSetup — the realm and personas a boot hands the identity provider", () => {
  it("takes the issuer from the compose env and the audience from the realm's mapper", async () => {
    const { setup } = await exampleSetup();
    expect(setup?.realms).toEqual([{ issuer: ISSUER, clientId: "desk-app", audience: "desk-api" }]);
  });

  it("mints the claims Keycloak's mappers would: sub, realm roles, attribute claims", async () => {
    const { setup } = await exampleSetup();
    const admin = setup?.personas.find((p) => p.username === "demo-admin");
    expect(admin?.claims).toMatchObject({
      sub: personaSubject("demo-admin"),
      preferred_username: "demo-admin",
      email: "demo-admin@example.com",
      role: "admin",
      tenantId: "00000000-0000-4000-8000-00000000de40",
    });
    // `permissions` reads `realm_access.roles`: the permission is a realm role.
    expect((admin?.claims.realm_access as { roles: string[] }).roles).toContain(
      "support.closeNotes",
    );
    const demo = setup?.personas.find((p) => p.username === "demo");
    expect((demo?.claims.realm_access as { roles: string[] }).roles).not.toContain(
      "support.closeNotes",
    );
    // `id: guid` reads `sub`, which the verifier accepts only as a UUID.
    expect(String(admin?.claims.sub)).toMatch(UUID);
    expect(personaSubject("demo")).not.toBe(personaSubject("demo-admin"));
  });

  it("is null for a system without a dev realm", () => {
    expect(
      oidcSetup([{ path: "docker-compose.yml", content: "" }], ["api"], () => ({
        OIDC_ISSUER: ISSUER,
      })),
    ).toBeNull();
  });

  it("boots the OIDC verifier only on deployables that name an issuer, and only with a setup", async () => {
    const { setup } = await exampleSetup();
    const backends = [
      {
        slug: "api",
        entry: "api/http/index.ts",
        bundle: { ok: true, code: "", warnings: [] } as never,
      },
    ];
    const plan = { kind: "unversioned" } as never;
    const env = (slug: string): Record<string, string> => (slug === "api" ? { OIDC_ISSUER: ISSUER } : {});
    const place = () => ({ dataDir: ":memory:", island: null });
    const withIdp = bootPlan(backends, plan, [], place, env, [], setup).plan;
    expect(withIdp.backends[0]?.verifier).toBe("configured");
    expect(withIdp.oidc?.personas.map((p) => p.username)).toEqual(["demo", "demo-admin"]);
    const stub = bootPlan(backends, plan, [], place, env, [], null).plan;
    expect(stub.backends[0]?.verifier).toBeUndefined();
    expect(stub.oidc).toBeUndefined();
  });
});

describe("the identity provider's endpoints and tokens", () => {
  beforeEach(async () => {
    await oidcService.reset();
    const { setup } = await exampleSetup();
    await call("configure", setup);
  });

  it("serves discovery and a JWKS under the issuer, and nothing elsewhere", async () => {
    const disco = await http("GET", `${ISSUER}/.well-known/openid-configuration`);
    expect(disco.status).toBe(200);
    expect(disco.json).toMatchObject({
      issuer: ISSUER,
      jwks_uri: `${ISSUER}/protocol/openid-connect/certs`,
    });
    const jwks = await http("GET", disco.json.jwks_uri as string);
    expect(jwks.json.keys).toEqual([
      expect.objectContaining({ kty: "RSA", alg: "RS256", use: "sig" }),
    ]);
    expect(
      (await http("GET", "http://elsewhere.test/.well-known/openid-configuration")).status,
    ).toBe(404);
  });

  it("mints an access token the JWKS verifies, with the persona's claims", async () => {
    const set = await call<TokenSet>("mint", { persona: "demo-admin" });
    const { payload } = await verify(set.access_token);
    expect(payload).toMatchObject({
      sub: personaSubject("demo-admin"),
      tenantId: "00000000-0000-4000-8000-00000000de40",
      azp: "desk-app",
    });
    // The ID token is addressed to the client.
    expect((await verify(set.id_token, "desk-app")).payload.preferred_username).toBe("demo-admin");
  });

  it("mints tokens a verifier must reject: expired, forged, for another audience", async () => {
    const expired = await call<TokenSet>("mint", { persona: "demo", expiresIn: -120 });
    await expect(verify(expired.access_token)).rejects.toMatchObject({ code: "ERR_JWT_EXPIRED" });
    const forged = await call<TokenSet>("mint", { persona: "demo", signWith: "foreign" });
    await expect(verify(forged.access_token)).rejects.toMatchObject({
      code: "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
    });
    const other = await call<TokenSet>("mint", { persona: "demo", audience: "other-api" });
    await expect(verify(other.access_token)).rejects.toMatchObject({
      code: "ERR_JWT_CLAIM_VALIDATION_FAILED",
    });
  });

  it("merges claim overrides over the persona's, registered claims included", async () => {
    const set = await call<TokenSet>("mint", {
      persona: "demo",
      claims: { tenantId: "t-b", iss: "http://evil.test" },
    });
    expect(jwtPayload(set.access_token)).toMatchObject({
      tenantId: "t-b",
      iss: "http://evil.test",
    });
  });

  it("answers the password grant for a persona, and refuses an unknown user", async () => {
    const token = `${ISSUER}/protocol/openid-connect/token`;
    const ok = await http("POST", token, "grant_type=password&username=demo&password=demo");
    expect(ok.status).toBe(200);
    expect((await verify(ok.json.access_token as string)).payload.preferred_username).toBe("demo");
    const bad = await http("POST", token, "grant_type=password&username=nobody&password=x");
    expect(bad).toMatchObject({ status: 401, json: { error: "invalid_grant" } });
  });

  it("rotates refresh tokens: each one redeems once", async () => {
    const token = `${ISSUER}/protocol/openid-connect/token`;
    const first = await call<TokenSet>("mint", {
      persona: "demo-admin",
      claims: { tenantId: "t-x" },
    });
    const renewed = await http(
      "POST",
      token,
      `grant_type=refresh_token&refresh_token=${first.refresh_token}`,
    );
    expect(renewed.status).toBe(200);
    // The renewed token keeps the persona and its overrides.
    expect(jwtPayload(renewed.json.access_token as string)).toMatchObject({
      preferred_username: "demo-admin",
      tenantId: "t-x",
    });
    expect(renewed.json.refresh_token).not.toBe(first.refresh_token);
    const replay = await http(
      "POST",
      token,
      `grant_type=refresh_token&refresh_token=${first.refresh_token}`,
    );
    expect(replay).toMatchObject({ status: 400, json: { error: "invalid_grant" } });
  });

  it("keeps its signing key across a reset, so a token outlives a re-boot", async () => {
    const set = await call<TokenSet>("mint", { persona: "demo" });
    await oidcService.reset();
    await call("configure", (await exampleSetup()).setup);
    await expect(verify(set.access_token)).resolves.toBeTruthy();
  });
});

describe("isIssuerUrl — which requests a deployable hands the identity provider", () => {
  it("matches the issuer and the paths under it, not a sibling realm", () => {
    expect(isIssuerUrl(`${ISSUER}/protocol/openid-connect/certs`, ISSUER)).toBe(true);
    expect(isIssuerUrl(ISSUER, ISSUER)).toBe(true);
    expect(isIssuerUrl(`${ISSUER}-other/x`, ISSUER)).toBe(false);
    expect(isIssuerUrl(`${ISSUER}/x`, null)).toBe(false);
  });
});

const TOKEN = `${ISSUER}/protocol/openid-connect/token`;
const AUTH = `${ISSUER}/protocol/openid-connect/auth`;
const b64url = (b: Buffer): string =>
  b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function authUrl(params: Record<string, string>): string {
  const u = new URL(AUTH);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

describe("the authorization code flow (code + PKCE)", () => {
  beforeEach(async () => {
    await oidcService.reset();
    await call("configure", (await exampleSetup()).setup);
  });

  const verifier = "a-verifier-of-enough-length-for-pkce-0123456789";
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const redirect = "http://localhost:3000/api/auth/callback";
  const request = (extra: Record<string, string> = {}) =>
    authUrl({
      response_type: "code",
      client_id: "desk-app",
      redirect_uri: redirect,
      state: "st-1",
      code_challenge: challenge,
      code_challenge_method: "S256",
      ...extra,
    });
  const exchange = (code: string, v = verifier, uri = redirect) =>
    http(
      "POST",
      TOKEN,
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: uri,
        client_id: "desk-app",
        code_verifier: v,
      }).toString(),
    );

  it("redirects back with a code and the state, and exchanges the code once", async () => {
    const { location } = await call<{ location: string }>("authorize", {
      url: request(),
      persona: "demo-admin",
    });
    const back = new URL(location);
    expect(back.origin + back.pathname).toBe(redirect);
    expect(back.searchParams.get("state")).toBe("st-1");
    const code = back.searchParams.get("code") ?? "";
    const ok = await exchange(code);
    expect(ok.status).toBe(200);
    expect((await verify(ok.json.access_token as string)).payload.preferred_username).toBe(
      "demo-admin",
    );
    expect((await exchange(code)).json.error).toBe("invalid_grant");
    expect(await call("grants")).toEqual([{ grant: "authorization_code", persona: "demo-admin" }]);
  });

  it("refuses a code without the matching PKCE verifier or redirect_uri", async () => {
    const codeOf = async () =>
      new URL(
        (await call<{ location: string }>("authorize", { url: request(), persona: "demo" }))
          .location,
      ).searchParams.get("code") ?? "";
    expect((await exchange(await codeOf(), "the-wrong-verifier")).json).toMatchObject({
      error: "invalid_grant",
    });
    expect((await exchange(await codeOf(), verifier, "http://localhost:9/cb")).json).toMatchObject({
      error: "invalid_grant",
    });
  });

  it("answers an unknown client with an error redirect", async () => {
    const { location } = await call<{ location: string }>("authorize", {
      url: request({ client_id: "other" }),
      persona: "demo",
    });
    expect(new URL(location).searchParams.get("error")).toBe("unauthorized_client");
  });

  it("mints grant tokens with the configured lifetime", async () => {
    await call("settings", { accessTokenLifetime: 5 });
    const set = (await http("POST", TOKEN, "grant_type=password&username=demo&password=demo")).json;
    const p = jwtPayload(set.access_token as string) as { iat: number; exp: number };
    expect(p.exp - p.iat).toBe(5);
  });
});

describe("the node:crypto polyfill's createHash", () => {
  it("computes SHA-256 like Node", () => {
    const sha256 = new Function(`${SYNC_SHA256}; return sha256;`)() as (
      b: Uint8Array,
    ) => Uint8Array;
    for (const text of ["", "abc", "x".repeat(55), "x".repeat(56), "y".repeat(1000)]) {
      expect(Buffer.from(sha256(new TextEncoder().encode(text))).toString("hex")).toBe(
        createHash("sha256").update(text).digest("hex"),
      );
    }
  });
});

describe("CookieJar", () => {
  it("sets, replaces and deletes cookies the way a browser does", () => {
    const jar = new CookieJar();
    expect(jar.header()).toBeNull();
    jar.store(["session=a; Path=/; HttpOnly", "refresh=r1; Path=/; HttpOnly; SameSite=Lax"]);
    expect(jar.header()).toBe("session=a; refresh=r1");
    jar.store(["session=b; Path=/"]);
    expect(jar.header()).toBe("session=b; refresh=r1");
    jar.store(["session=; Max-Age=0; Path=/", "refresh=x; Expires=Thu, 01 Jan 1970 00:00:00 GMT"]);
    expect(jar.header()).toBeNull();
  });
});

describe("followNavigation — the sign-in redirect chain", () => {
  const res = (
    status: number,
    headers: Record<string, string> = {},
    setCookies?: string[],
  ): DispatchResult => ({
    ok: true,
    durationMs: 0,
    response: { status, statusText: "", headers, body: "", ...(setCookies ? { setCookies } : {}) },
  });

  it("walks login → the login page → callback → the app, and stops when the login page is cancelled", async () => {
    const seen: string[] = [];
    const dispatch = async (req: SerializedRequest): Promise<DispatchResult> => {
      const path = new URL(req.url).pathname;
      seen.push(path);
      if (path === "/api/auth/login")
        return res(302, { location: `${AUTH}?client_id=desk-app&state=s` });
      if (path === "/api/auth/callback")
        return res(302, { location: "http://localhost:3001/notes" });
      return res(404);
    };
    const deps = {
      dispatch,
      issuers: [ISSUER],
      apiBase: "/api",
      authorize: async (_url: string, persona: string) =>
        `http://localhost:3000/api/auth/callback?code=c-${persona}&state=s`,
    };
    expect(
      await followNavigation("/api/auth/login", { ...deps, choosePersona: async () => "demo" }),
    ).toEqual({
      kind: "app",
      path: "/notes",
    });
    expect(seen).toEqual(["/api/auth/login", "/api/auth/callback"]);
    expect(
      await followNavigation("/api/auth/login", { ...deps, choosePersona: async () => null }),
    ).toEqual({ kind: "cancelled" });
  });

  it("reports a backend error instead of landing on the app", async () => {
    const out = await followNavigation("/api/auth/callback?code=x", {
      dispatch: async () =>
        ({
          ...res(400),
          response: { ...res(400).response, body: '{"error":"invalid_state"}' },
        }) as DispatchResult,
      issuers: [ISSUER],
      apiBase: "/api",
      choosePersona: async () => "demo",
      authorize: async () => "",
    });
    expect(out).toMatchObject({ kind: "error" });
    expect((out as { message: string }).message).toContain("invalid_state");
  });
});

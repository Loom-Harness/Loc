// The playground's fake OIDC identity provider (web/src/runtime/infra/oidc.ts)
// and the setup it boots with (web/src/backend/oidc-personas.ts): realms from
// the compose env, personas from the generated dev Keycloak realm.  Tokens are
// checked with `jose` — the library the generated Hono verifier uses — against
// the JWKS the provider serves.  The generated verifier itself runs against it
// in `web/e2e/oidc-identity-provider.spec.ts`.

import { readFileSync } from "node:fs";
import path from "node:path";
import { createLocalJWKSet, type JSONWebKeySet, jwtVerify } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import { jwtPayload, oidcSetup, personaSubject } from "../../web/src/backend/oidc-personas.js";
import { bootPlan } from "../../web/src/build/boot-plan.js";
import { composeServiceEnv } from "../../web/src/build/deployables.js";
import { oidcService, type TokenSet } from "../../web/src/runtime/infra/oidc.js";
import type { HttpResponseData } from "../../web/src/runtime/infra/resource-types.js";
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
    const env = (slug: string) => (slug === "api" ? { OIDC_ISSUER: ISSUER } : {});
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

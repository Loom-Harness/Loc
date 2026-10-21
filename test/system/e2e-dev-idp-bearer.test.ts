// The generated e2e suite mints its own bearer token from the compose stack's
// bundled dev IdP.
//
// Once a system declares `auth { oidc }`, every backend verifies real JWTs and
// the `x-loom-dev-claims` stub is gone, so the emitted suite could only run if
// the person running it first minted a token by hand and exported
// `E2E_BEARER_TOKEN` — and for a hosted preset (google / auth0 / …) there was
// no local IdP to mint it from at all.  The stack now bundles a Keycloak realm
// for every provider, and the suite asks it for a token itself.
//
// The minting helper is exercised as BEHAVIOUR (evaluated with a stubbed
// `fetch`), not asserted as text: the property that matters is which requests
// it sends, and when it stands aside.

import ts from "typescript";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const SYS = (authBlock: string, extra = "") => `
  system Shop {
    user { id: string  role: string }
    ${authBlock}
    subdomain Sales {
      context Orders {
        aggregate Order with crudish {
          code: string
        }
        repository Orders for Order {}
      }
    }
    api OrdersApi from Sales
    storage pg { type: postgres }
    resource s { for: Orders, kind: state, use: pg }
    deployable d {
      platform: node
      contexts: [Orders]
      dataSources: [s]
      serves: OrdersApi
      port: 4000
      auth: required
    }
    test e2e "creates an order" against d {
      let o = api.orders.create({ code: "A1" })
      let read = api.orders.getById(o)
      expect(read.code).toBe("A1")
    }
    ${extra}
  }
`;

const GOOGLE = `auth { enforcement: opt  provider: google  oidc { clientId: env("OIDC_CLIENT_ID") } }`;
const AUTH0 = `auth { enforcement: opt  provider: auth0  oidc { issuer: "https://shop.eu.auth0.com/"  clientId: env("OIDC_CLIENT_ID") } }`;

async function e2eFor(authBlock: string): Promise<string> {
  const e2e = (await generateSystemFiles(SYS(authBlock))).get("e2e/Shop.e2e.test.ts");
  expect(e2e, "no e2e suite emitted").toBeDefined();
  return e2e!;
}

describe("the bundled dev IdP covers hosted presets", () => {
  for (const [name, block] of [
    ["google", GOOGLE],
    ["auth0", AUTH0],
  ] as const) {
    it(`${name}: compose bundles the realm and repoints the backend at it`, async () => {
      const files = await generateSystemFiles(SYS(block));
      const compose = files.get("docker-compose.yml")!;
      expect(compose).toContain("keycloak:");
      expect(compose).toContain('OIDC_ISSUER: "http://host.docker.internal:8081/realms/shop"');
      expect(files.has("keycloak/realm.json")).toBe(true);
    });
  }

  it("the backend still reads the declared issuer when the env does not override it", async () => {
    const oidc = (await generateSystemFiles(SYS(AUTH0))).get("d/auth/oidc.ts")!;
    expect(oidc).toContain('process.env.OIDC_ISSUER ?? "https://shop.eu.auth0.com/"');
  });
});

describe("emission", () => {
  it("a suite against an OIDC backend mints before every test body", async () => {
    const e2e = await e2eFor(GOOGLE);
    expect(e2e).toContain(
      'const __DEV_IDP_TOKEN_URL = process.env.E2E_OIDC_TOKEN_URL ?? "http://localhost:8081/realms/shop/protocol/openid-connect/token";',
    );
    expect(e2e).toContain('process.env.E2E_OIDC_CLIENT_ID ?? "shop-app"');
    expect(e2e).toContain("const token = process.env.E2E_BEARER_TOKEN || __devIdpBearer;");
    // Before the reset: the reset request itself carries the principal.
    const body = e2e.slice(e2e.indexOf('it("creates an order'));
    expect(body.indexOf("await __ensureBearer();")).toBeGreaterThan(-1);
    expect(body.indexOf("await __ensureBearer();")).toBeLessThan(
      body.indexOf("await __resetState(base);"),
    );
  });

  it("a suite with no auth block carries no minting code", async () => {
    const e2e = await e2eFor("");
    expect(e2e).not.toContain("__ensureBearer");
    expect(e2e).not.toContain("__devIdpBearer");
    expect(e2e).toContain("const token = process.env.E2E_BEARER_TOKEN;");
  });
});

interface MintRun {
  readonly urls: string[];
  readonly bodies: string[];
  readonly authorization?: string;
  readonly thrown?: unknown;
}

/** Evaluate the emitted minting helper + `__authHeaders` against a scripted
 *  token endpoint, then report what was sent and the header the suite would
 *  attach to its next request. */
async function driveMint(
  e2e: string,
  env: Record<string, string>,
  responses: { status: number; body: string }[],
): Promise<MintRun> {
  const start = e2e.indexOf("const __DEV_IDP_TOKEN_URL");
  const end = e2e.indexOf("\n// ── Test isolation");
  expect(start, "the suite must define the minting helper").toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const src = ts.transpileModule(e2e.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const KEYS = [
    "E2E_BEARER_TOKEN",
    "E2E_DEV_CLAIMS",
    "E2E_DEV_IDP",
    "E2E_OIDC_TOKEN_URL",
    "E2E_OIDC_CLIENT_ID",
  ];
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);

  const urls: string[] = [];
  const bodies: string[] = [];
  const g = globalThis as unknown as { fetch: unknown };
  const realFetch = g.fetch;
  let i = 0;
  g.fetch = async (url: string, init?: { body?: unknown }) => {
    urls.push(String(url));
    bodies.push(String(init?.body ?? ""));
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return { ok: r.status < 400, status: r.status, text: async () => r.body };
  };
  let authorization: string | undefined;
  let thrown: unknown;
  try {
    // biome-ignore lint/security/noGlobalEval: this repo's own emitted source, produced in-process.
    const run = eval(
      `(async () => { ${src}; await __ensureBearer(); await __ensureBearer(); return __authHeaders(); })`,
    ) as () => Promise<Record<string, string>>;
    authorization = (await run()).authorization;
  } catch (err) {
    thrown = err;
  } finally {
    g.fetch = realFetch;
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
  return { urls, bodies, authorization, thrown };
}

const TOKEN_OK = { status: 200, body: JSON.stringify({ access_token: "minted-jwt" }) };

describe("minting behaviour", () => {
  it("mints once by password grant and the suite sends it as the bearer", async () => {
    const run = await driveMint(await e2eFor(GOOGLE), {}, [TOKEN_OK]);
    expect(run.thrown).toBeUndefined();
    expect(run.urls).toEqual(["http://localhost:8081/realms/shop/protocol/openid-connect/token"]);
    const form = new URLSearchParams(run.bodies[0]);
    expect(form.get("grant_type")).toBe("password");
    expect(form.get("client_id")).toBe("shop-app");
    expect(form.get("username")).toBe("demo");
    expect(run.authorization).toBe("Bearer minted-jwt");
  });

  it("an explicit E2E_BEARER_TOKEN wins and nothing is minted", async () => {
    const run = await driveMint(await e2eFor(GOOGLE), { E2E_BEARER_TOKEN: "given" }, [TOKEN_OK]);
    expect(run.urls).toEqual([]);
    expect(run.authorization).toBe("Bearer given");
  });

  it("a dev-stub principal (E2E_DEV_CLAIMS) or E2E_DEV_IDP=off stands it aside", async () => {
    const envs: Record<string, string>[] = [
      { E2E_DEV_CLAIMS: '{"id":"u"}' },
      { E2E_DEV_IDP: "off" },
    ];
    for (const env of envs) {
      const run = await driveMint(await e2eFor(GOOGLE), env, [TOKEN_OK]);
      expect(run.urls, JSON.stringify(env)).toEqual([]);
      expect(run.authorization, JSON.stringify(env)).toBeUndefined();
    }
  });

  it("retries while the realm is still importing (404), then mints", async () => {
    const run = await driveMint(await e2eFor(GOOGLE), {}, [
      { status: 404, body: "Realm does not exist" },
      TOKEN_OK,
    ]);
    expect(run.thrown).toBeUndefined();
    expect(run.urls).toHaveLength(2);
    expect(run.authorization).toBe("Bearer minted-jwt");
  });

  it("a rejected grant fails at once, naming the endpoint and the remedies", async () => {
    const run = await driveMint(await e2eFor(GOOGLE), {}, [
      { status: 401, body: '{"error":"invalid_grant"}' },
    ]);
    expect(run.urls).toHaveLength(1);
    expect(String(run.thrown)).toContain(
      "Could not mint a bearer token from the dev IdP at http://localhost:8081/",
    );
    expect(String(run.thrown)).toContain("E2E_BEARER_TOKEN");
  });
});

// The emulated OIDC provider (src/emulation/oidc.ts) behind its Node host
// (test/support/fakes/oidc.mjs), and the code-flow driver (oidc-code-flow.mjs),
// asserted against REAL sockets.
//
// The booted behavioural legs run the driver against every generated backend,
// but a driver that cannot tell a broken handshake from a working one would
// keep them green regardless.  So the driver is proven here against two tiny
// hand-written handshakes: a correct one (every step passes) and ones with a
// single defect each — no state check, an ignored PKCE verifier, no refresh
// rotation — which must each fail the step that names it.  The issuer's own
// protocol rules (PKCE, single-use codes, rotation, client auth, the login
// form) are asserted directly.

import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { type FakeOidc, start } from "../support/fakes/oidc.mjs";
import { probeCodeFlow } from "../support/oidc-code-flow.mjs";

const live: { stop(): Promise<void> }[] = [];
afterEach(async () => {
  while (live.length) await live.pop()?.stop();
});

const KC = "/protocol/openid-connect";
const AGENT_SUB = "00000000-0000-0000-0000-000000000000";
const PERSONAS = [
  {
    username: "agent",
    claims: { sub: AGENT_SUB, realm_access: { roles: "agent" }, email: "agent@example.com" },
  },
  {
    username: "visitor",
    password: "visitor",
    claims: { sub: "00000000-0000-0000-0000-0000000000ff", realm_access: { roles: "visitor" } },
  },
];
const pkceChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

async function issuer(opts: Partial<Parameters<typeof start>[0]> = {}): Promise<FakeOidc> {
  const o = await start({ personas: PERSONAS, autoLogin: "agent", ...opts });
  live.push(o);
  return o;
}

const form = (o: Record<string, string>) => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(o).toString(),
});

/** Run /authorize (auto-login) and return the code it redirects back with. */
async function authorize(
  o: FakeOidc,
  challenge: string | null,
  redirectUri = "http://app.test/cb",
) {
  const u = new URL(`${o.issuer}${KC}/auth`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", o.clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", "s1");
  if (challenge) {
    u.searchParams.set("code_challenge", challenge);
    u.searchParams.set("code_challenge_method", "S256");
  }
  const r = await fetch(u, { redirect: "manual" });
  expect(r.status).toBe(302);
  const back = new URL(r.headers.get("location") ?? "");
  expect(back.searchParams.get("state")).toBe("s1");
  return back.searchParams.get("code") ?? "";
}

function verifyJwt(jwks: { keys: object[] }, token: string) {
  const [h, p, s] = token.split(".");
  const key = createPublicKey({ key: jwks.keys[0] as never, format: "jwk" });
  const ok = verify("RSA-SHA256", Buffer.from(`${h}.${p}`), key, Buffer.from(s, "base64url"));
  return { ok, payload: JSON.parse(Buffer.from(p, "base64url").toString("utf8")) };
}

describe("fake OIDC issuer", () => {
  it("serves discovery + JWKS, and its tokens verify against them", async () => {
    const o = await issuer();
    const disco = await (await fetch(`${o.issuer}/.well-known/openid-configuration`)).json();
    expect(disco.issuer).toBe(o.issuer);
    expect(disco.authorization_endpoint).toBe(`${o.issuer}${KC}/auth`);
    expect(disco.end_session_endpoint).toBe(`${o.issuer}${KC}/logout`);
    const jwks = await (await fetch(disco.jwks_uri)).json();
    const { ok, payload } = verifyJwt(jwks, await o.mint("agent"));
    expect(ok).toBe(true);
    expect(payload).toMatchObject({
      iss: o.issuer,
      sub: "00000000-0000-0000-0000-000000000000",
      realm_access: { roles: "agent" },
    });
    expect(payload.aud).toBeUndefined();
    expect(o.env).toEqual({ OIDC_ISSUER: o.issuer, OIDC_CLIENT_ID: "loom-behavioural" });
  });

  it("authorization_code + PKCE S256: the right verifier redeems once, a wrong one never", async () => {
    const o = await issuer();
    const verifier = randomBytes(32).toString("base64url");
    const code = await authorize(o, pkceChallenge(verifier));
    const exchange = (c: string, v: string) =>
      fetch(
        `${o.issuer}${KC}/token`,
        form({
          grant_type: "authorization_code",
          code: c,
          code_verifier: v,
          client_id: o.clientId,
          redirect_uri: "http://app.test/cb",
        }),
      );
    expect((await exchange(code, "wrong")).status).toBe(400);
    // The failed attempt spent the code.
    expect((await exchange(code, verifier)).status).toBe(400);
    const code2 = await authorize(o, pkceChallenge(verifier));
    const ok = await exchange(code2, verifier);
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.token_type).toBe("Bearer");
    expect(typeof body.refresh_token).toBe("string");
    expect((await exchange(code2, verifier)).status).toBe(400);
    expect(o.observe()).toEqual([
      {
        grant: "authorization_code",
        principal: "agent",
        sub: "00000000-0000-0000-0000-000000000000",
      },
    ]);
  });

  it("refresh tokens rotate: each redeems exactly once", async () => {
    const o = await issuer();
    const pw = await (
      await fetch(
        `${o.issuer}${KC}/token`,
        form({
          grant_type: "password",
          username: "agent",
          password: "agent",
          client_id: o.clientId,
        }),
      )
    ).json();
    const refresh = (t: string) =>
      fetch(
        `${o.issuer}${KC}/token`,
        form({ grant_type: "refresh_token", refresh_token: t, client_id: o.clientId }),
      );
    const first = await refresh(pw.refresh_token);
    expect(first.status).toBe(200);
    expect((await refresh(pw.refresh_token)).status).toBe(400);
    expect((await refresh((await first.json()).refresh_token)).status).toBe(200);
    expect(o.observe().map((r) => r.grant)).toEqual(["password", "refresh_token", "refresh_token"]);
  });

  it("enforces a configured client secret and the redirect_uri binding", async () => {
    const o = await issuer({ clientSecret: "s3cret" });
    const code = await authorize(o, null);
    const tok = (extra: Record<string, string>) =>
      fetch(
        `${o.issuer}${KC}/token`,
        form({ grant_type: "authorization_code", code, client_id: o.clientId, ...extra }),
      );
    expect((await tok({ redirect_uri: "http://app.test/cb", client_secret: "nope" })).status).toBe(
      401,
    );
    expect(
      (await tok({ redirect_uri: "http://elsewhere/cb", client_secret: "s3cret" })).status,
    ).toBe(400);
  });

  it("renders a login form when auto-login is off, and its submit grants a code", async () => {
    const o = await issuer({ autoLogin: null });
    const q = new URLSearchParams({
      response_type: "code",
      client_id: o.clientId,
      redirect_uri: "http://app.test/cb",
      state: "x",
    });
    const page = await fetch(`${o.issuer}${KC}/auth?${q}`, { redirect: "manual" });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('data-testid="login-visitor"');
    const submit = await fetch(`${o.issuer}${KC}/auth`, {
      ...form({ ...Object.fromEntries(q), username: "visitor", password: "visitor" }),
      redirect: "manual",
    });
    expect(submit.status).toBe(302);
    const back = new URL(submit.headers.get("location") ?? "");
    expect(back.origin + back.pathname).toBe("http://app.test/cb");
    expect(back.searchParams.get("state")).toBe("x");
    expect(back.searchParams.get("code")).toBeTruthy();
    // A wrong password re-renders the page instead of signing anyone in.
    const wrong = await fetch(`${o.issuer}${KC}/auth`, {
      ...form({ ...Object.fromEntries(q), username: "visitor", password: "nope" }),
      redirect: "manual",
    });
    expect(wrong.status).toBe(200);
  });

  it("accepts client_secret_basic and ends the session at the logout endpoint", async () => {
    const o = await issuer({ clientSecret: "s3cret" });
    const verifier = randomBytes(32).toString("base64url");
    const code = await authorize(o, pkceChallenge(verifier));
    const basic = Buffer.from(`${o.clientId}:s3cret`).toString("base64");
    const r = await fetch(`${o.issuer}${KC}/token`, {
      ...form({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: "http://app.test/cb",
      }),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${basic}`,
      },
    });
    expect(r.status).toBe(200);
    const out = await fetch(
      `${o.issuer}${KC}/logout?post_logout_redirect_uri=http%3A%2F%2Fapp.test%2F`,
      {
        redirect: "manual",
      },
    );
    expect(out.status).toBe(302);
    expect(out.headers.get("location")).toBe("http://app.test/");
  });

  it("answers /userinfo for a token it issued and 401 otherwise", async () => {
    const o = await issuer();
    const ok = await fetch(`${o.issuer}${KC}/userinfo`, {
      headers: { authorization: `Bearer ${await o.mint("agent")}` },
    });
    expect(await ok.json()).toMatchObject({
      sub: "00000000-0000-0000-0000-000000000000",
      email: "agent@example.com",
    });
    expect(
      (await fetch(`${o.issuer}${KC}/userinfo`, { headers: { authorization: "Bearer junk" } }))
        .status,
    ).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// The driver against a hand-written handshake with switchable defects.

type Defect = "none" | "no-state-check" | "ignore-verifier" | "no-rotation";

async function backend(
  o: FakeOidc,
  defect: Defect,
): Promise<{ base: string; stop(): Promise<void> }> {
  const cookies = (h: string | undefined) =>
    Object.fromEntries(
      (h ?? "")
        .split(";")
        .filter(Boolean)
        .map((p) => p.trim().split("=") as [string, string]),
    );
  const tokenCall = async (params: Record<string, string>) => {
    const r = await fetch(`${o.issuer}${KC}/token`, form({ client_id: o.clientId, ...params }));
    return r.ok ? r.json() : null;
  };
  let lastRefresh = "";
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://b");
    const c = cookies(req.headers.cookie);
    const redirectUri = "http://localhost:3000/api/auth/callback";
    if (url.pathname === "/api/auth/login") {
      const state = randomBytes(8).toString("hex");
      const verifier = randomBytes(32).toString("base64url");
      const a = new URL(`${o.issuer}${KC}/auth`);
      for (const [k, v] of Object.entries({
        response_type: "code",
        client_id: o.clientId,
        redirect_uri: redirectUri,
        state,
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
      }))
        a.searchParams.set(k, v);
      res.writeHead(302, {
        location: a.toString(),
        "set-cookie": [`oidc_state=${state}; Path=/`, `oidc_verifier=${verifier}; Path=/`],
      });
      return res.end();
    }
    if (url.pathname === "/api/auth/callback") {
      if (defect !== "no-state-check" && url.searchParams.get("state") !== c.oidc_state) {
        res.writeHead(400);
        return res.end("bad state");
      }
      const verifier = defect === "ignore-verifier" ? "not-the-verifier" : c.oidc_verifier;
      const t = await tokenCall({
        grant_type: "authorization_code",
        code: url.searchParams.get("code") ?? "",
        code_verifier: verifier,
        redirect_uri: redirectUri,
      });
      if (!t) {
        res.writeHead(502);
        return res.end("exchange failed");
      }
      lastRefresh = t.refresh_token;
      res.writeHead(302, {
        location: "/",
        "set-cookie": [`session=${t.access_token}; Path=/`, `refresh=${t.refresh_token}; Path=/`],
      });
      return res.end();
    }
    if (url.pathname === "/api/auth/refresh") {
      const t = await tokenCall({ grant_type: "refresh_token", refresh_token: c.refresh ?? "" });
      // The "no-rotation" defect keeps answering from the first refresh token's grant.
      if (!t && !(defect === "no-rotation" && c.refresh === lastRefresh)) {
        res.writeHead(401);
        return res.end();
      }
      const session = t?.access_token ?? c.session;
      res.writeHead(200, {
        "set-cookie": [
          `session=${session}; Path=/`,
          ...(t ? [`refresh=${t.refresh_token}; Path=/`] : []),
        ],
      });
      return res.end("{}");
    }
    if (url.pathname === "/api/auth/me") {
      const r = await fetch(`${o.issuer}${KC}/userinfo`, {
        headers: { authorization: `Bearer ${c.session ?? ""}` },
      });
      if (!r.ok) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end("null");
      }
      // userinfo answered, so the token is live; the role is an access-token
      // claim, read from the token itself as a verifier would.
      const claims = JSON.parse(
        Buffer.from((c.session ?? "").split(".")[1] ?? "", "base64url").toString("utf8"),
      );
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ id: claims.sub, role: claims.realm_access?.roles }));
    }
    res.writeHead(404);
    return res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  const handle = {
    base: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((r) => server.close(() => r())),
  };
  live.push(handle);
  return handle;
}

const run = async (defect: Defect) => {
  const o = await issuer();
  const b = await backend(o, defect);
  const results = await probeCodeFlow({
    request: (p, init) => fetch(b.base + p, { ...init, redirect: "manual" }),
    oidc: o,
    checkMe: (me) =>
      (me as { role?: string }).role === "agent"
        ? null
        : `role ${JSON.stringify((me as { role?: string }).role)}`,
  });
  return Object.fromEntries(
    results.map((r) => [r.name.replace(/^oidc code flow: /, ""), r.status]),
  );
};

describe("probeCodeFlow", () => {
  it("passes every step against a correct handshake", async () => {
    expect(await run("none")).toEqual({
      "callback refuses a state that does not match the state cookie": "pass",
      "callback exchanges the code and sets a session": "pass",
      "/me answers the logged-in principal from the session cookie": "pass",
      "refresh rotates the session": "pass",
      "a spent refresh token is refused on replay": "pass",
    });
  });

  it("fails the state step when the callback skips its state check", async () => {
    const r = await run("no-state-check");
    expect(r["callback refuses a state that does not match the state cookie"]).toBe("fail");
  });

  it("fails the exchange when the backend does not prove PKCE possession", async () => {
    const r = await run("ignore-verifier");
    expect(r["callback exchanges the code and sets a session"]).toBe("fail");
  });

  it("fails the replay step when a spent refresh token still renews the session", async () => {
    const r = await run("no-rotation");
    expect(r["a spent refresh token is refused on replay"]).toBe("fail");
  });
});

// The authorization-code round trip a browser makes against a generated
// backend's OIDC handshake, driven headlessly against the fake issuer
// (./oidc.mjs):
//
//   GET <auth>/login        → 3xx to the issuer's authorization_endpoint, with
//                             the state + PKCE cookies set
//   GET <issuer>/authorize  → 302 back to the redirect_uri with ?code&state
//   GET <auth>/callback     → the backend exchanges the code (PKCE verifier)
//                             and sets its session cookie
//   GET <auth>/me           → the declared principal, read from that session
//   POST <auth>/refresh     → a rotated session; the spent refresh token is
//                             refused on replay
//
// plus the negative arm the handshake exists for: a callback whose `state`
// does not match the state cookie is refused and sets no session.
//
// The backend is reached through `request(path, init)`, which must NOT follow
// redirects (`fetch(base + path, { ...init, redirect: "manual" })` for a booted
// server, `app.fetch(new Request(origin + path, init))` in-process).  The
// redirect_uri's origin is whatever the backend's default names; only its
// path + query are replayed against `request`, the way a browser on the
// public origin would land there.
//
// Returns one result row per step in the behavioural tier's shape
// (`{ tier, name, status: "pass" | "fail", error? }`).

// "probe": a harness probe, not a DSL test — kept out of the Definition-of-Done
// rollup like the tier's other probes.
const TIER = "probe";

/** A minimal cookie jar: name → value, honouring deletions. */
function makeJar() {
  const jar = new Map();
  return {
    absorb(res) {
      const lines = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
      for (const line of lines) {
        const [pair, ...attrs] = line.split(";");
        const eq = pair.indexOf("=");
        if (eq < 0) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        const expired = attrs.some((a) => {
          const [k, v] = a.split("=").map((x) => x?.trim());
          if (/^max-age$/i.test(k)) return Number(v) <= 0;
          if (/^expires$/i.test(k)) return Date.parse(v) <= Date.now();
          return false;
        });
        if (expired || value === "") jar.delete(name);
        else jar.set(name, value);
      }
    },
    header() {
      return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    names() {
      return [...jar.keys()];
    },
    get(name) {
      return jar.get(name);
    },
    clone() {
      const c = makeJar();
      for (const [k, v] of jar) c.set(k, v);
      return c;
    },
    set(name, value) {
      jar.set(name, value);
    },
  };
}

const isRedirect = (s) => s >= 300 && s < 400;
const pathOf = (loc) => {
  const u = new URL(loc, "http://backend.invalid");
  return u.pathname + u.search;
};

/**
 * Drive the code flow and report each step.
 *
 * @param {object} args
 * @param {(path: string, init?: RequestInit) => Promise<Response>} args.request
 * @param {{ issuer: string, principals: Record<string,{sub:string}> }} args.oidc  the fake issuer
 * @param {string} [args.authBase]     the backend's auth route prefix (default "/api/auth")
 * @param {string} [args.principal]    the principal /authorize logs in (default "agent")
 * @param {(me: any) => string|null} [args.checkMe]  extra assertion on the /me body
 */
export async function probeCodeFlow({ request, oidc, authBase = "/api/auth", principal = "agent", checkMe }) {
  const out = [];
  const pass = (name) => out.push({ tier: TIER, name: `oidc code flow: ${name}`, status: "pass" });
  const fail = (name, error) => out.push({ tier: TIER, name: `oidc code flow: ${name}`, status: "fail", error });
  const expectedSub = oidc.principals[principal]?.sub;

  /** /login → issuer → back; resolves to the callback path and the jar. */
  async function startLogin(label) {
    const jar = makeJar();
    const login = await request(`${authBase}/login`, { method: "GET" });
    jar.absorb(login);
    const loc = login.headers.get("location") ?? "";
    if (!isRedirect(login.status) || !loc.startsWith(`${oidc.issuer}/`)) {
      fail(`${label}: /login redirects to the issuer`, `GET ${authBase}/login → ${login.status} location=${JSON.stringify(loc)}`);
      return null;
    }
    const authz = new URL(loc);
    authz.searchParams.set("login_hint", principal);
    const back = await fetch(authz, { redirect: "manual" });
    const cb = back.headers.get("location") ?? "";
    if (back.status !== 302 || !/[?&]code=/.test(cb)) {
      fail(`${label}: the issuer redirects back with a code`, `${back.status} ${cb || (await back.text()).slice(0, 200)}`);
      return null;
    }
    return { jar, callback: pathOf(cb) };
  }

  // ── Negative arm: a forged `state` is refused and sets no session. ──────────
  {
    const name = "callback refuses a state that does not match the state cookie";
    const started = await startLogin("forged state");
    if (started) {
      const forged = started.callback.replace(/([?&]state=)[^&]*/, "$1forged-state");
      const withState = /[?&]state=/.test(forged) ? forged : `${forged}&state=forged-state`;
      const res = await request(withState, { method: "GET", headers: { cookie: started.jar.header() } });
      const before = started.jar.get("session");
      started.jar.absorb(res);
      const sessionSet = started.jar.get("session") !== before && started.jar.get("session") !== undefined;
      const me = await request(`${authBase}/me`, { method: "GET", headers: { cookie: started.jar.header() } });
      const meBody = await me.text();
      const authenticated = me.status === 200 && meBody.includes(expectedSub ?? "\u0000");
      if (sessionSet || authenticated) {
        fail(name, `forged-state callback → ${res.status} and established a session (cookies: ${started.jar.names().join(",")})`);
      } else {
        pass(name);
      }
    }
  }

  // ── The real round trip. ───────────────────────────────────────────────────
  const started = await startLogin("code flow");
  if (!started) return out;
  const { jar, callback } = started;
  const cbRes = await request(callback, { method: "GET", headers: { cookie: jar.header() } });
  jar.absorb(cbRes);
  if (!(isRedirect(cbRes.status) || (cbRes.status >= 200 && cbRes.status < 300))) {
    fail("callback exchanges the code and sets a session", `${cbRes.status} ${(await cbRes.text()).slice(0, 300)}`);
    return out;
  }
  pass("callback exchanges the code and sets a session");

  const readMe = async (j) => {
    const r = await request(`${authBase}/me`, { method: "GET", headers: { cookie: j.header(), accept: "application/json" } });
    const text = await r.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* reported below */
    }
    return { status: r.status, body, text };
  };
  const checkPrincipal = (label, me) => {
    if (me.status !== 200 || !me.body || typeof me.body !== "object") {
      fail(label, `GET ${authBase}/me → ${me.status} ${me.text.slice(0, 200)}`);
      return false;
    }
    if (me.body.id !== expectedSub) {
      fail(label, `principal id ${JSON.stringify(me.body.id)} != ${JSON.stringify(expectedSub)}`);
      return false;
    }
    const extra = checkMe?.(me.body) ?? null;
    if (extra) {
      fail(label, extra);
      return false;
    }
    pass(label);
    return true;
  };
  if (!checkPrincipal("/me answers the logged-in principal from the session cookie", await readMe(jar))) return out;

  // ── Refresh rotation. ──────────────────────────────────────────────────────
  const spent = jar.clone();
  const refreshed = await request(`${authBase}/refresh`, { method: "POST", headers: { cookie: jar.header() } });
  jar.absorb(refreshed);
  if (refreshed.status < 200 || refreshed.status >= 300) {
    fail("refresh rotates the session", `POST ${authBase}/refresh → ${refreshed.status} ${(await refreshed.text()).slice(0, 200)}`);
    return out;
  }
  if (!checkPrincipal("refresh rotates the session", await readMe(jar))) return out;
  const replay = await request(`${authBase}/refresh`, { method: "POST", headers: { cookie: spent.header() } });
  if (replay.status >= 200 && replay.status < 300) {
    fail("a spent refresh token is refused on replay", `replayed refresh → ${replay.status}`);
  } else {
    pass("a spent refresh token is refused on replay");
  }
  return out;
}

/** `request` for a booted HTTP backend at `base` (no redirect following). */
export const httpRequest = (base) => (path, init = {}) => fetch(base + path, { ...init, redirect: "manual" });

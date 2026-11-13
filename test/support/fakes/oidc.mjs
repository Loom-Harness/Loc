// Node host for the emulated OIDC provider (src/emulation/oidc.ts): one
// loopback HTTP server that hands every request to the provider's `serve` and
// writes its answer back.  The protocol — discovery, JWKS, the authorization
// endpoint (auto-login or login page), the token endpoint's grants, userinfo,
// end_session — is the provider's, the same one the playground runs.
//
// Kit contract: `start(opts)` → `{ env, observe(), reset(), stop() }`, plus the
// issuer's own handles (`issuer`, `principals`, `mint`, `setAutoLogin`).
// `env` names the variables the generated backends already read.  `observe()`
// is the provider's grant log in issue order, `{ grant, principal, sub }` per
// token the token endpoint handed out — no token, code or timestamp.

import { createServer } from "node:http";
import { createOidcProvider } from "../../../out/emulation/oidc.js";

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}

/**
 * Start the issuer on a loopback port.
 *
 * @param {object} opts
 * @param {import("../../../out/emulation/oidc.js").OidcPersona[]} opts.personas
 *        each persona's `claims.sub` is its subject
 * @param {string} [opts.clientId]      → OIDC_CLIENT_ID (default "loom-behavioural")
 * @param {string} [opts.clientSecret]  → OIDC_CLIENT_SECRET; the token endpoint then requires it
 * @param {string} [opts.audience]      `aud` of minted tokens → OIDC_AUDIENCE (default: none)
 * @param {string|null} [opts.autoLogin] persona the authorization endpoint signs
 *        in without a login page (default: none — the page is shown)
 * @param {import("../../../out/emulation/oidc.js").OidcRoutes} [opts.routes]
 * @param {string} [opts.host]          bind address (default 127.0.0.1)
 * @param {number} [opts.port]
 */
export async function start(opts) {
  const host = opts.host ?? "127.0.0.1";
  const clientId = opts.clientId ?? "loom-behavioural";
  const audience = opts.audience ?? "";
  const provider = createOidcProvider(opts.routes ? { routes: opts.routes } : {});

  const server = createServer(async (req, res) => {
    try {
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
      }
      const answer = await provider.serve({
        method: req.method ?? "GET",
        url: `${issuer}${req.url ?? "/"}`,
        headers,
        body: await readBody(req),
      });
      res.writeHead(answer.status, answer.headers);
      res.end(Buffer.from(answer.body));
    } catch (err) {
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(err?.stack ?? err));
    }
  });
  await new Promise((resolve) => server.listen(opts.port ?? 0, host, resolve));
  const port = server.address().port;
  const issuer = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`;

  const realm = {
    issuer,
    clientId,
    audience,
    ...(opts.clientSecret ? { clientSecret: opts.clientSecret } : {}),
  };
  const configure = () => {
    provider.configure({ realms: [realm], personas: opts.personas });
    provider.settings({ autoLogin: opts.autoLogin ?? null });
  };
  configure();

  const principals = Object.fromEntries(
    opts.personas.map((p) => [p.username, { sub: String(p.claims.sub) }]),
  );

  return {
    issuer,
    port,
    clientId,
    provider,
    /** username → `{ sub }`, what the code-flow driver expects back from /me. */
    principals,
    env: {
      OIDC_ISSUER: issuer,
      OIDC_CLIENT_ID: clientId,
      ...(opts.clientSecret ? { OIDC_CLIENT_SECRET: opts.clientSecret } : {}),
      ...(audience ? { OIDC_AUDIENCE: audience } : {}),
    },
    /** An access token for `persona` (not logged as a grant). */
    async mint(persona, claims) {
      return (await provider.mint({ persona, ...(claims ? { claims } : {}) })).access_token;
    },
    setAutoLogin(persona) {
      provider.settings({ autoLogin: persona });
    },
    observe() {
      return provider
        .grants()
        .map((g) => ({ grant: g.grant, principal: g.persona, sub: principals[g.persona]?.sub }));
    },
    reset() {
      provider.reset();
      configure();
    },
    stop: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

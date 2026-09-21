// EVALUATOR TOOL (not generated). A minimal OIDC discovery + JWKS issuer so we
// can mint tokens with exact claims and test the generated verifier / tenancy
// filters. Uses `jose` from the generated api's own node_modules.
import http from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const PORT = Number(process.env.IDP_PORT ?? 9099);
const ISSUER = `http://127.0.0.1:${PORT}`;

const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const jwk = { ...(await exportJWK(publicKey)), kid: "eval-key-1", alg: "RS256", use: "sig" };

export async function mint(claims, opts = {}) {
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "eval-key-1" })
    .setIssuedAt()
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? "clinica-app")
    .setExpirationTime(opts.exp ?? "2h")
    .sign(privateKey);
}

const server = http.createServer((req, res) => {
  if (req.url === "/.well-known/openid-configuration") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ issuer: ISSUER, jwks_uri: `${ISSUER}/jwks` }));
  }
  if (req.url === "/jwks") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ keys: [jwk] }));
  }
  if (req.url?.startsWith("/mint?")) {
    const q = new URL(req.url, ISSUER).searchParams;
    const claims = JSON.parse(q.get("claims") ?? "{}");
    return mint(claims, { audience: q.get("aud") ?? undefined }).then((t) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(t);
    });
  }
  res.writeHead(404);
  res.end();
});
server.listen(PORT, "127.0.0.1", () => console.log(`idp on ${ISSUER}`));

import * as http from "node:http";
import { expect } from "vitest";

// ---------------------------------------------------------------------------
// Path-spelling probe for `auth: required` backends, shared by the native
// `*-oidc-e2e` legs.
//
// WHAT IT PROVES.  The auth gate must decide on exactly the path the router
// dispatches.  A gate that reads the RAW request path (prefix test on
// `getRequestURI()`, on `new URL(req.url).pathname`) while the router matches
// the DECODED one lets `/%61pi/tickets` skip authentication yet still reach the
// tickets controller — an anonymous read, and an anonymous write on POST.  And
// a bypass prefix (`/health`, the OIDC handshake routes) matches only its
// canonical spelling: an encoded or dot-segmented spelling of one is gated.
//
// Requests go out through `node:http` with the path verbatim: `fetch` (WHATWG
// URL) would resolve `..` and `.` segments client-side, so the server would
// never see the spelling under test.
//
// A spelling the router does not serve may answer 400/404 — it reached no
// handler.  What no spelling may do is answer 2xx (a handler ran for an
// anonymous caller).  The spellings every backend's router decodes onto the
// protected route must answer exactly 401.
// ---------------------------------------------------------------------------

function rawRequest(base: string, method: string, rawPath: string, body?: string): Promise<number> {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: url.hostname,
        port: url.port,
        method,
        path: rawPath,
        headers: body
          ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) }
          : {},
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Asserts every spelling of the protected collection route `/api/<segment>`
 *  is gated for an anonymous caller. */
export async function expectEveryPathSpellingGated(base: string, segment: string): Promise<void> {
  const enc = (s: string) => `%${s.charCodeAt(0).toString(16)}${s.slice(1)}`;
  const route = `/api/${segment}`;
  // Control: the canonical bypass and protected spellings.
  expect(await rawRequest(base, "GET", "/health"), "GET /health").toBe(200);
  expect(await rawRequest(base, "GET", route), `GET ${route}`).toBe(401);

  const mustBe401 = [`/%61pi/${segment}`, `/api/${enc(segment)}`, `/%61%70%69/${segment}`];
  for (const p of mustBe401) {
    expect(await rawRequest(base, "GET", p), `GET ${p}`).toBe(401);
  }
  expect(await rawRequest(base, "POST", `/%61pi/${segment}`, "{}"), `POST /%61pi/${segment}`).toBe(
    401,
  );

  const neverReachesHandler = [
    `/api;x/${segment}`,
    `/api/${segment};x`,
    `//api/${segment}`,
    `/api//${segment}`,
    `/./api/${segment}`,
    `/x/../api/${segment}`,
    `/health/../api/${segment}`,
    `/%68ealth/../api/${segment}`,
    `/health/%2e%2e/api/${segment}`,
    `/api/auth/login/../../${segment}`,
    `/api/auth/%6cogin/../../${segment}`,
    `/api/auth/login/%2e%2e/%2e%2e/${segment}`,
    `/API/${segment}`,
  ];
  for (const p of neverReachesHandler) {
    const status = await rawRequest(base, "GET", p);
    expect([400, 401, 404], `GET ${p} answered ${status}`).toContain(status);
  }
}

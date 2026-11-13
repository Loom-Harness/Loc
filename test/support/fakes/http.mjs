// In-process HTTP transport for the emulation core's restApi mock — the fake
// behind a `storage <x> { type: restApi }`.  Every request is handed to the
// core `HttpMock`, which logs it and answers it (an echo of the request, or
// sample data when a spec is registered), exactly as the playground's
// `httpMock` service does.  The backend reaches it through the
// `<RESOURCE>_URL` base-URL override every emitted restApi client reads before
// its baked-in `baseUrl`.
//
// `observe()` is the mock's `log()`, normalised for the golden: `{ method,
// path, body }`, where `path` keeps the query string and `body` is the JSON
// body reduced to what does not vary per run — the sorted key list of an
// object, the value of a scalar, `null` for an empty body.  The list is
// sorted, so an asynchronous call site (an event reactor) cannot reorder it.

import { createServer } from "node:http";
import { createHttpMock } from "./emulation.mjs";
import { resourceEnvUrlVar } from "./resource-env.mjs";

/** The run-stable projection of a recorded request body. */
export function bodyShape(raw) {
  if (raw === "") return null;
  let v;
  try {
    v = JSON.parse(raw);
  } catch {
    return { unparsed: raw.length };
  }
  if (v !== null && typeof v === "object" && !Array.isArray(v)) return { keys: Object.keys(v).sort() };
  if (Array.isArray(v)) return { items: v.length };
  return v;
}

/**
 * Start the recorder.
 *
 * @param {{ storage?: { name: string }, resources?: { name: string }[], mock?: object }} [opts]
 *   `mock` — serve this core `HttpMock` instead of a fresh one.
 */
export async function start(opts = {}) {
  const mock = opts.mock ?? createHttpMock();
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const url = `http://${req.headers.host ?? "127.0.0.1"}${req.url ?? "/"}`;
      try {
        const r = await mock.request({ method: req.method ?? "GET", url, body: Buffer.concat(chunks).toString("utf8") });
        res.writeHead(r.status, { "content-type": "application/json" });
        res.end(r.body === undefined ? "" : JSON.stringify(r.body));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err?.message ?? err) }));
      }
    });
  });
  // Clients that pool connections (MailKit-style HttpClient, Java's HttpClient)
  // would otherwise hold the server open past stop().
  server.keepAliveTimeout = 1000;
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const env = {};
  for (const r of opts.resources ?? []) env[resourceEnvUrlVar(r.name)] = url;
  return {
    kind: "http",
    env,
    url,
    /** The core mock this transport serves. */
    mock,
    observe() {
      const key = (c) => JSON.stringify([c.method, c.path, c.body]);
      return mock
        .log()
        .map((e) => {
          const u = new URL(e.url);
          return { method: e.method, path: u.pathname + u.search, body: bodyShape(e.body ?? "") };
        })
        .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    },
    reset() {
      mock.reset();
    },
    async stop() {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(() => r()));
    },
  };
}

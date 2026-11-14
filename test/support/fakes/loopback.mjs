// A loopback HTTP server that hands every request to an emulation-core model
// as plain `HttpRequestData` and writes its `HttpResponseData` back — the one
// transport the in-process fakes share.  Header names arrive lower-cased, as
// the core expects.

import { createServer } from "node:http";

/**
 * @param {(req: { method: string, url: string, headers: Record<string,string>, body: Uint8Array }) =>
 *   { status: number, headers: Record<string,string>, body: Uint8Array } |
 *   Promise<{ status: number, headers: Record<string,string>, body: Uint8Array }>} handle
 * @returns {Promise<{ url: string, stop(): Promise<void> }>}
 */
export async function serveLoopback(handle) {
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
      try {
        const out = await handle({
          method: req.method ?? "GET",
          url: `http://${req.headers.host ?? "127.0.0.1"}${req.url ?? "/"}`,
          headers,
          body: new Uint8Array(Buffer.concat(chunks)),
        });
        res.writeHead(out.status, out.headers);
        res.end(Buffer.from(out.body));
      } catch (err) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end(String(err?.message ?? err));
      }
    });
  });
  // Clients that pool connections would otherwise hold the server open past stop().
  server.keepAliveTimeout = 1000;
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async stop() {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(() => r()));
    },
  };
}

/** A captured mail as the golden records it — the same shape the Mailpit
 *  sidecar reports, so every mailer's `effects.mail` compares alike. */
export function mailEffects(list) {
  const key = (e) => JSON.stringify([e.to, e.subject, e.text, e.from]);
  return list
    .map(({ from, to, subject, text }) => ({ from, to: [...to].sort(), subject, text: text.replace(/\r\n/g, "\n").replace(/\s+$/, "") }))
    .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

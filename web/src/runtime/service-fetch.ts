// The deployable worker's `fetch`: a request to another deployable's compose
// address (`http://<slug>:<port>`) is handed to that deployable's in-browser
// app; every other URL goes to the real network.  Pure — the worker supplies
// `forward` (a message to the main thread, which owns every worker) and the
// root vitest suite drives it directly.
//
// Routing is by hostname: a compose service name is unique in the stack and
// its port is the container's own, which the browser has no use for.

import type { DispatchResult, SerializedRequest } from "./protocol.js";

export type Forward = (host: string, request: SerializedRequest) => Promise<DispatchResult>;

export function serviceFetch(
  hosts: ReadonlySet<string>,
  forward: Forward,
  real: typeof fetch,
): typeof fetch {
  return async (input, init) => {
    const probe = new Request(input, init);
    const url = new URL(probe.url);
    if (url.protocol !== "http:" || !hosts.has(url.hostname)) {
      return real(input, init);
    }
    const body =
      probe.method === "GET" || probe.method === "HEAD" ? null : await probe.text();
    const headers: Record<string, string> = {};
    probe.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const out = await forward(url.hostname, {
      method: probe.method,
      url: probe.url,
      headers,
      body,
    });
    if (!out.ok) throw new TypeError(`fetch ${probe.url}: ${out.message}`);
    const { status, statusText, headers: h, body: text } = out.response;
    // Null-body statuses forbid a body (see SerializedResponse).
    const nullBody = status === 204 || status === 205 || status === 304;
    return new Response(nullBody ? null : text, { status, statusText, headers: h });
  };
}

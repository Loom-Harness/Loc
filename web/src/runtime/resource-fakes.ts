// A deployable worker's side of the resource fakes — facades that hold no
// state.  Everything stateful lives in the infra worker (`infra/`); this
// file only carries requests there:
//
//   - `globalThis.__loomInfra.call(service, op, params)` — what the bundle-time
//     facades (`node:fs`, `nodemailer`, `@sendgrid/mail`; see
//     `engine/npm/resource-facades.ts`) call.
//   - a `fetch` wrapper that hands SigV4-signed S3 / SES requests (the real
//     `@aws-sdk/client-*` run unchanged) to the fake endpoints, and
//     `__loomInfra.restFetch` for `restApi` resources.

import type { InfraPort } from "./infra-port.js";
import type { HttpResponseData } from "./infra/resource-types.js";

const SIGV4 = /Credential=[^/]+\/\d{8}\/[^/]+\/(s3|ses)\/aws4_request/;

/** Which fake (if any) a signed AWS request belongs to: the Authorization
 *  header, or `X-Amz-Credential` for a presigned URL. */
export function awsServiceOf(url: URL, headers: Headers): "s3" | "ses" | null {
  const scope = headers.get("authorization") ?? url.searchParams.get("X-Amz-Credential")?.replace(/^/, "Credential=");
  const m = scope ? SIGV4.exec(scope) : null;
  return m ? (m[1] as "s3" | "ses") : null;
}

export interface ResourceFakes {
  call<T = unknown>(service: string, op: string, params?: unknown): Promise<T>;
  restFetch(input: URL | string, init?: RequestInit): Promise<Response>;
}

declare global {
  // eslint-disable-next-line no-var
  var __loomInfra: ResourceFakes | undefined;
}

/** The line to the infra worker: the `InfraPort` the engine handed this
 *  deployable at `start`.  A re-boot or Reset brings a fresh port. */
let port: InfraPort | null = null;

function call<T = unknown>(service: string, op: string, params: unknown = {}): Promise<T> {
  if (!port) return Promise.reject(new Error("Resource fakes are not connected to the infra worker."));
  return port.call<T>({ service, op, params } as Parameters<InfraPort["call"]>[0]);
}

async function viaFake(
  service: string,
  method: string,
  url: string,
  headers: Headers,
  body: BodyInit | null | undefined,
): Promise<Response> {
  const bytes = body == null ? new Uint8Array() : new Uint8Array(await new Response(body).arrayBuffer());
  const hdr: Record<string, string> = {};
  headers.forEach((v, k) => {
    hdr[k.toLowerCase()] = v;
  });
  const res = await call<HttpResponseData>(service, "http", { method, url, headers: hdr, body: bytes });
  const bodyless = res.status === 204 || res.status === 304;
  return new Response(bodyless ? null : (res.body as unknown as BodyInit), { status: res.status, headers: res.headers });
}

/** Compose hosts of in-browser deployables (`service-fetch.ts` routes them). */
let routedHosts: ReadonlySet<string> = new Set();

export function setRoutedHosts(hosts: ReadonlySet<string>): void {
  routedHosts = hosts;
}

const fakes: ResourceFakes = {
  call,
  async restFetch(input, init) {
    // A URL that resolves to another in-browser deployable is that
    // deployable's to answer; only an external API is mocked.
    if (routedHosts.has(new URL(String(input)).hostname)) return globalThis.fetch(input, init);
    const res = await call<{ status: number; body: unknown }>("httpMock", "request", {
      method: init?.method ?? "GET",
      url: String(input),
    });
    return new Response(res.body === null ? null : JSON.stringify(res.body), {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  },
};

let prepared = false;

/** Wrap `fetch` and publish the facade object.  Runs at worker start-up, before
 *  any bundle is imported, so an SDK that captures `fetch` at module load sees
 *  the wrapper. */
export function prepareResourceFakes(): void {
  if (prepared) return;
  prepared = true;
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input), self.location.href);
    const headers = new Headers(init?.headers ?? req?.headers);
    const service = awsServiceOf(url, headers);
    if (!service) return realFetch(input, init);
    const method = init?.method ?? req?.method ?? "GET";
    const body = init?.body ?? (req && method !== "GET" && method !== "HEAD" ? await req.clone().arrayBuffer() : null);
    return viaFake(service, method, url.href, headers, body);
  }) as typeof fetch;
  globalThis.__loomInfra = fakes;
}

/** Point the fakes at the infra worker (`null`: not attached).  Every boot. */
export function connectResourceFakes(infra: InfraPort | null): void {
  port = infra;
}

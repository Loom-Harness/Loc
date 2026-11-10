// Cookies across the in-browser backend's `fetch` boundary.
//
// A browser's `Request` and `Response` constructors filter forbidden header
// names: a `Cookie` request header and a `Set-Cookie` response header are
// silently dropped.  A deployed backend reads the session cookie the generated
// `/api/auth/callback` sets, and sets it in the first place, so in the preview
// both must survive.  A `Headers` object built on its own (guard "none") keeps
// every name, so the deployable worker's global `Request` and `Response` are
// subclasses that carry one of those instead of the filtered headers — for the
// request the worker builds and for every copy the app makes of it (Hono's body
// middleware rebuilds the request; its context rebuilds the response after the
// handler appends `Set-Cookie`).

function cookieOf(headers: HeadersInit | undefined): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get("cookie");
  const entries = Array.isArray(headers) ? headers : Object.entries(headers);
  return entries.find(([k]) => k.toLowerCase() === "cookie")?.[1] ?? null;
}

function setCookiesOf(headers: HeadersInit | undefined): string[] {
  if (!headers) return [];
  if (headers instanceof Headers) return headers.getSetCookie();
  const entries = Array.isArray(headers) ? headers : Object.entries(headers);
  return entries.filter(([k]) => k.toLowerCase() === "set-cookie").map(([, v]) => v);
}

let installed = false;

/** Replace the global `Request` and `Response` with subclasses whose
 *  `headers` keep `Cookie` / `Set-Cookie`.  Runs at worker start-up, before
 *  any bundle is imported. */
export function keepCookieHeaders(): void {
  if (installed) return;
  installed = true;
  const NativeRequest = globalThis.Request;
  const NativeResponse = globalThis.Response;

  class CookieKeepingRequest extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(input, init);
      const cookie =
        init?.headers !== undefined ? cookieOf(init.headers) : input instanceof NativeRequest ? input.headers.get("cookie") : null;
      if (cookie === null || super.headers.get("cookie") === cookie) return;
      const headers = new Headers(super.headers);
      headers.set("cookie", cookie);
      Object.defineProperty(this, "headers", { value: headers });
    }
  }

  class CookieKeepingResponse extends NativeResponse {
    constructor(body?: BodyInit | null, init?: ResponseInit) {
      super(body, init);
      // Always swapped, not only when `init` carries cookies: Hono creates a
      // context's response before the handler runs and appends `Set-Cookie`
      // to its headers afterwards.
      const headers = new Headers(super.headers);
      headers.delete("set-cookie");
      for (const c of setCookiesOf(init?.headers)) headers.append("set-cookie", c);
      Object.defineProperty(this, "headers", { value: headers });
    }
  }

  globalThis.Request = CookieKeepingRequest as typeof Request;
  globalThis.Response = CookieKeepingResponse as typeof Response;
}

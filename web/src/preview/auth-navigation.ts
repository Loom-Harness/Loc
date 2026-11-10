// The generated frontend's sign-in, sign-out and session cookies, in the
// preview.
//
// Under `auth: ui` the generated app signs in by NAVIGATING to the backend's
// `/api/auth/login`, which redirects to the identity provider's login page,
// which redirects back to `/api/auth/callback`; the callback sets HttpOnly
// session cookies and redirects to the app.  None of those hops can happen as
// real navigations in the preview: the backend and the identity provider live
// in workers, not at URLs the iframe could load.  So the iframe cancels a
// navigation into the runtime base (the Navigation API, `iframe-html.ts`) and
// hands its path here, and `followNavigation` walks the redirect chain:
//
//   - a backend path is dispatched to the backend app (cookies from the jar);
//   - the identity provider's authorization endpoint shows the login page in
//     the preview (pick a persona) and asks the provider for the code redirect;
//   - anything else is the app: the preview reloads it at that route.
//
// The browser keeps no cookies for responses it never received, so the
// preview's dispatcher keeps them in a `CookieJar` and sends them with every
// request the app makes — which is what the generated client's
// `credentials: "include"` would do.  Pure: no DOM, no workers.

import type { DispatchResult, SerializedRequest } from "../runtime/protocol.js";

/** Cookies by name, as one browser origin would hold them for the backend. */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  /** The `cookie` request header, or null when the jar is empty. */
  header(): string | null {
    if (this.cookies.size === 0) return null;
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  /** Apply `Set-Cookie` values: set, or delete on `Max-Age<=0` / a past
   *  `Expires` / an empty value. */
  store(setCookies: readonly string[]): void {
    for (const raw of setCookies) {
      const [pair = "", ...attrs] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      let expired = value === "";
      for (const a of attrs) {
        const [k = "", v = ""] = a.split("=").map((x) => x.trim());
        if (k.toLowerCase() === "max-age" && Number(v) <= 0) expired = true;
        if (k.toLowerCase() === "expires" && Date.parse(v) <= Date.now()) expired = true;
      }
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  has(name: string): boolean {
    return this.cookies.has(name);
  }

  clear(): void {
    this.cookies.clear();
  }
}

export type NavigationOutcome =
  /** Show the app at `path` (an app route, e.g. `/`). */
  | { kind: "app"; path: string }
  /** The user closed the login page: stay where the app was. */
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

export interface NavigationDeps {
  /** Send a request to the backend the app targets (the jar applied). */
  dispatch(req: SerializedRequest): Promise<DispatchResult>;
  /** The identity provider's issuers. */
  issuers: readonly string[];
  /** Show the login page; the persona picked, or null when cancelled. */
  choosePersona(issuer: string): Promise<string | null>;
  /** The identity provider's redirect after signing `persona` in at the
   *  authorization URL. */
  authorize(url: string, persona: string): Promise<string>;
  /** The backend's route prefix (`/api`). */
  apiBase: string;
}

const MAX_HOPS = 10;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Follow the navigation to the backend path `path` until it lands on the app. */
export async function followNavigation(path: string, deps: NavigationDeps): Promise<NavigationOutcome> {
  let next = path;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const target = classify(next, deps);
    if (target.kind === "app") return { kind: "app", path: target.path };
    if (target.kind === "idp") {
      if (!/\/protocol\/openid-connect\/auth(\?|$)/.test(next)) {
        return { kind: "error", message: `The identity provider has no page at ${next}.` };
      }
      const persona = await deps.choosePersona(target.issuer);
      if (persona === null) return { kind: "cancelled" };
      next = await deps.authorize(next, persona);
      continue;
    }
    const out = await deps.dispatch({
      method: "GET",
      url: `http://localhost${target.path}`,
      headers: {},
      body: null,
    });
    if (!out.ok) return { kind: "error", message: out.message };
    const { status, headers, body } = out.response;
    const location = headers.location;
    if (status >= 300 && status < 400 && location) {
      next = location;
      continue;
    }
    if (status >= 400) return { kind: "error", message: `${target.path} answered ${status}: ${body.slice(0, 300)}` };
    // A backend page that is not a redirect: the app takes over at its root.
    return { kind: "app", path: "/" };
  }
  return { kind: "error", message: `More than ${MAX_HOPS} redirects from ${path}.` };
}

type Target = { kind: "backend"; path: string } | { kind: "idp"; issuer: string } | { kind: "app"; path: string };

function classify(url: string, deps: NavigationDeps): Target {
  const issuer = deps.issuers.find((i) => url === i || url.startsWith(`${i}/`) || url.startsWith(`${i}?`));
  if (issuer) return { kind: "idp", issuer };
  const underApi = (p: string): boolean => p === deps.apiBase || p.startsWith(`${deps.apiBase}/`);
  if (url.startsWith("/")) {
    const u = new URL(url, "http://localhost");
    return underApi(u.pathname) ? { kind: "backend", path: u.pathname + u.search } : { kind: "app", path: u.pathname + u.search };
  }
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { kind: "app", path: "/" };
  }
  // The backend's own address (`OIDC_REDIRECT_URI` is `http://localhost:<port>/api/auth/callback`).
  if (LOOPBACK.has(u.hostname) && underApi(u.pathname)) return { kind: "backend", path: u.pathname + u.search };
  // The frontend's address (`OIDC_POST_LOGIN_REDIRECT`), or anywhere else: the app.
  return { kind: "app", path: LOOPBACK.has(u.hostname) ? u.pathname + u.search : "/" };
}

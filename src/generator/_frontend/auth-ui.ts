// Frontend auth files (D-AUTH-OIDC, `auth: ui`).
//
// Emitted into a frontend deployable that opts in via `auth: ui` (and whose
// target backend is `auth: required`).  The session client (`AUTH_SESSION_TS`)
// is framework-neutral TS, shared verbatim across frameworks; the guard
// component is framework-shaped (`AUTH_GATE_TSX` for React, `AUTH_GATE_VUE`
// + a provide/inject `useSession` composable for Vue, `AUTH_GATE_SVELTE` for
// Svelte).  Each is pack-agnostic — inline styles, no design-system imports —
// so a single file works under every design pack.  The guard probes the
// backend's
// `/auth/me` session route (which works for both the OIDC verifier and
// the in-browser playground dev stub) and gates the app on a verified
// session; "Sign in" redirects to the backend's `/auth/login` (→ IdP).
//
// The guard renders NO "Sign out" control of its own: an overlay floating
// over the page would sit on top of table rows and form buttons.  Sign out is
// app-shell chrome — each design pack's `app-shell.hbs` places it in its
// header/toolbar (gated on the `authUi` view-model flag), so it lands where
// that pack's users expect an account action.
//
// `session.ts` is shared verbatim by every framework (it only touches the
// api client + config, whose relative paths are identical across React, Vue,
// and Svelte).

import { authGateMessage, chromeKey } from "../_walker/i18n-chrome.js";

/** The `t(key, default)` call a session-view string reads under i18n.  The key
 *  and English default come from `SESSION_VIEW_CHROME`, so the emitted default
 *  equals the catalog entry. */
function sessionT(name: string): string {
  return `t(${JSON.stringify(chromeKey(name))}, ${JSON.stringify(authGateMessage(name))})`;
}

/** The session view's loading and sign-in strings in one framework's text
 *  syntax: `wrap` turns a `t(…)` call into that framework's binding; an app
 *  that ships no i18n runtime carries the literal English instead. */
function sessionTexts(
  i18n: boolean,
  wrap: (call: string) => string,
): { loading: string; signIn: string } {
  return i18n
    ? { loading: wrap(sessionT("sessionLoading")), signIn: wrap(sessionT("signIn")) }
    : { loading: authGateMessage("sessionLoading"), signIn: authGateMessage("signIn") };
}

/** The forbidden view a `requires`-gated page falls back to, in one framework's
 *  text syntax — same contract as {@link sessionTexts}: `wrap` turns a `t(…)`
 *  call into the binding; an app with no i18n runtime carries the literal
 *  English. */
export function forbiddenTexts(
  i18n: boolean,
  wrap: (call: string) => string,
): { title: string; body: string } {
  return i18n
    ? { title: wrap(sessionT("forbiddenTitle")), body: wrap(sessionT("forbiddenBody")) }
    : { title: authGateMessage("forbiddenTitle"), body: authGateMessage("forbiddenBody") };
}

/** `src/auth/session.ts` — session probe + sign-in/out redirects. */
export const AUTH_SESSION_TS = `// Auto-generated.
import { ApiError, api } from "../api/client";
import { API_BASE_URL } from "../api/config";

export type SessionUser = Record<string, unknown>;

/** Redirect to the backend's login, which 302s to the IdP's hosted login
 *  page.  No login form is shipped — the IdP owns credentials. */
export function signIn(): void {
  window.location.href = \`\${API_BASE_URL}/auth/login\`;
}

/** Redirect to the backend's logout, clearing the local session. */
export function signOut(): void {
  window.location.href = \`\${API_BASE_URL}/auth/logout\`;
}

/** Probe the current session.  Returns the verified user claims, or null
 *  when unauthenticated (HTTP 401). */
export async function fetchSession(): Promise<SessionUser | null> {
  try {
    const me = await api.get("/auth/me");
    return me !== null && typeof me === "object" ? (me as SessionUser) : null;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}
`;

/** `src/auth/AuthGate.tsx` — the route guard + session context. */
export function authGateTsx(i18n = false): string {
  const text = sessionTexts(i18n, (call) => `{${call}}`);
  return `// Auto-generated.
import { type CSSProperties, type ReactNode, createContext, useContext, useEffect, useState } from "react";
import { type SessionUser, fetchSession, signIn, signOut } from "./session";
${i18n ? 'import { t } from "../i18n";\n' : ""}
interface Session {
  user: SessionUser;
  signOut: () => void;
}

const SessionContext = createContext<Session | null>(null);

/** Access the verified session from inside the guarded app. */
export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within <AuthGate>");
  return ctx;
}

type State =
  | { kind: "loading" }
  | { kind: "anon" }
  | { kind: "authed"; user: SessionUser };

/** Gates the app on a verified session.  Probes /auth/me on mount: shows a
 *  spinner while loading, a Sign in screen (redirecting to the IdP) when
 *  unauthenticated, and the app once authenticated. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    fetchSession()
      .then((user) => {
        if (active) setState(user ? { kind: "authed", user } : { kind: "anon" });
      })
      .catch(() => {
        if (active) setState({ kind: "anon" });
      });
    return () => {
      active = false;
    };
  }, []);

  if (state.kind === "loading") {
    return <div style={centered}>${text.loading}</div>;
  }
  if (state.kind === "anon") {
    return (
      <div style={centered}>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ marginBottom: 16 }}>${text.signIn}</h1>
          <button type="button" style={primaryButton} onClick={signIn}>
            ${text.signIn}
          </button>
        </div>
      </div>
    );
  }
  return (
    <SessionContext.Provider value={{ user: state.user, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

const centered: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "100vh",
};
const primaryButton: CSSProperties = {
  padding: "8px 20px",
  fontSize: 16,
  cursor: "pointer",
};
`;
}

// ---------------------------------------------------------------------------
// Vue guard (`auth: ui` on a `platform: vue` deployable).
//
// Structural mirror of the React `AuthGate.tsx` above: probes /auth/me on
// mount, shows a spinner while loading, a full-screen "Sign in" screen
// (redirecting to the IdP) when unauthenticated, and the app once
// authenticated.  Pack-agnostic — plain `<button>`/`<div>` + inline
// styles, no Vuetify / shadcn-vue imports — so the one file works under
// every Vue design pack.  Vue `:style` does not auto-append `px`, so the
// dimensioned values carry explicit units (unlike the numeric React form).
// ---------------------------------------------------------------------------

/** `src/auth/useSession.ts` — the provide/inject session context. */
export const AUTH_USE_SESSION_VUE = `// Auto-generated.
import { type InjectionKey, type Ref, inject, provide } from "vue";
import type { SessionUser } from "./session";

export interface Session {
  /** The verified user claims — null until the session probe resolves. */
  user: Ref<SessionUser | null>;
  signOut: () => void;
}

const sessionKey: InjectionKey<Session> = Symbol("loom-session");

/** Provide the session to descendants — called once by <AuthGate>. */
export function provideSession(session: Session): void {
  provide(sessionKey, session);
}

/** Access the verified session from inside the guarded app. */
export function useSession(): Session {
  const ctx = inject(sessionKey);
  if (!ctx) throw new Error("useSession must be used within <AuthGate>");
  return ctx;
}
`;

/** \`src/auth/AuthGate.vue\` — the route guard + session provider. */
export function authGateVue(i18n = false): string {
  const text = sessionTexts(i18n, (call) => `{{ ${call} }}`);
  return `<!-- Auto-generated. -->
<script setup lang="ts">
import { type CSSProperties, onMounted, ref } from "vue";
import { type SessionUser, fetchSession, signIn, signOut } from "./session";
import { provideSession } from "./useSession";
${i18n ? 'import { t } from "../lib/locale";\n' : ""}
type State = { kind: "loading" } | { kind: "anon" } | { kind: "authed" };

const state = ref<State>({ kind: "loading" });
const user = ref<SessionUser | null>(null);

// Expose the verified session to the guarded app via provide/inject.
provideSession({ user, signOut });

onMounted(async () => {
  try {
    const u = await fetchSession();
    if (u) {
      user.value = u;
      state.value = { kind: "authed" };
    } else {
      state.value = { kind: "anon" };
    }
  } catch {
    state.value = { kind: "anon" };
  }
});

const centered: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "100vh",
};
const primaryButton: CSSProperties = {
  padding: "8px 20px",
  fontSize: "16px",
  cursor: "pointer",
};
</script>

<template>
  <div v-if="state.kind === 'loading'" :style="centered">${text.loading}</div>
  <div v-else-if="state.kind === 'anon'" :style="centered">
    <div style="text-align: center">
      <h1 style="margin-bottom: 16px">${text.signIn}</h1>
      <button type="button" :style="primaryButton" @click="signIn">${text.signIn}</button>
    </div>
  </div>
  <slot v-else />
</template>
`;
}

// ---------------------------------------------------------------------------
// Svelte 5 sibling (`auth: ui` on a svelte frontend).  The session client
// (`AUTH_SESSION_TS`) is reused VERBATIM — it's framework-neutral TS whose
// relative imports (`../api/client`, `../api/config`) resolve the same from
// `src/lib/auth/session.ts` as they do from React's `src/auth/session.ts`.
// Only the guard component is framework-shaped: this is the runes-based
// analogue of `AUTH_GATE_TSX`, pack-agnostic (inline styles, no design
// imports) so one file works under every svelte design pack.
// ---------------------------------------------------------------------------

/** `src/lib/auth/AuthGate.svelte` — the route guard + session context. */
export function authGateSvelte(i18n = false): string {
  const text = sessionTexts(i18n, (call) => `{${call}}`);
  return `<!-- Auto-generated.  Do not edit by hand. -->
<script lang="ts" module>
  import { getContext, setContext } from "svelte";
  import type { SessionUser } from "./session";

  const SESSION_KEY = Symbol("loom.session");

  export interface Session {
    readonly user: SessionUser;
    signOut: () => void;
  }

  /** Access the verified session from inside the guarded app. */
  export function useSession(): Session {
    const ctx = getContext<Session | undefined>(SESSION_KEY);
    if (!ctx) throw new Error("useSession must be used within <AuthGate>");
    return ctx;
  }

  /** Provide the verified session to descendants.  Called once from the
   *  gate during init; the getter keeps it live as the probe resolves. */
  export function provideSession(value: Session): void {
    setContext(SESSION_KEY, value);
  }
</script>

<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  // SessionUser is imported in the module script above (shared scope).
  import { fetchSession, signIn, signOut } from "./session";
${i18n ? '  import { t } from "$lib/locale.svelte";\n' : ""}
  let { children }: { children: Snippet } = $props();

  type State =
    | { kind: "loading" }
    | { kind: "anon" }
    | { kind: "authed"; user: SessionUser };

  let state = $state<State>({ kind: "loading" });

  onMount(() => {
    let active = true;
    fetchSession()
      .then((user) => {
        if (active) state = user ? { kind: "authed", user } : { kind: "anon" };
      })
      .catch(() => {
        if (active) state = { kind: "anon" };
      });
    return () => {
      active = false;
    };
  });

  provideSession({
    get user(): SessionUser {
      return state.kind === "authed" ? state.user : {};
    },
    signOut,
  });
</script>

{#if state.kind === "loading"}
  <div style="display:flex;align-items:center;justify-content:center;min-height:100vh">${text.loading}</div>
{:else if state.kind === "anon"}
  <div style="display:flex;align-items:center;justify-content:center;min-height:100vh">
    <div style="text-align:center">
      <h1 style="margin-bottom:16px">${text.signIn}</h1>
      <button type="button" style="padding:8px 20px;font-size:16px;cursor:pointer" onclick={signIn}>
        ${text.signIn}
      </button>
    </div>
  </div>
{:else}
  {@render children()}
{/if}
`;
}

// ---------------------------------------------------------------------------
// Angular sibling (`auth: ui` on a `platform: angular` deployable).  Unlike
// the JSX/markup frameworks, the framework-neutral `session.ts` is NOT reused:
// its relative imports (`../api/client`, `../api/config`) resolve from
// `src/auth/` on React, but the Angular auth files live one level deeper at
// `src/app/auth/`, and — more importantly — the idiomatic Angular shape is a
// root `@Injectable` SessionService that owns the probe (so a future page
// guard can `inject()` it and read `user()`).  The service uses the
// fetch-backed `HttpClient` already provided in `app.config.ts`, sending the
// session cookie via `withCredentials`.  `signIn` / `signOut` redirect to the
// backend's `/auth/login` / `/auth/logout` (→ IdP), reusing the shared
// `API_BASE_URL` from `src/api/config.ts`.  The guard component
// (`AuthGateComponent`) is pack-agnostic — plain elements + inline styles, no
// Material imports — so the one file works under every Angular design pack.
// ---------------------------------------------------------------------------

/** `src/api/auth-interceptor.ts` — the `HttpClient` twin of `client.ts`'s
 *  silent renewal: a 401 on an API call POSTs `/auth/refresh` once (concurrent
 *  401s share one in-flight refresh), then retries the original request once.
 *  A still-401 surfaces unchanged so the auth gate falls back to sign-in. */
export const AUTH_REFRESH_INTERCEPTOR_ANGULAR = `// Auto-generated.
import { HttpClient, HttpErrorResponse, type HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { type Observable, catchError, finalize, shareReplay, switchMap, throwError } from "rxjs";
import { API_BASE_URL } from "./config";

let refreshInFlight: Observable<unknown> | null = null;

export const authRefreshInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(API_BASE_URL)) return next(req);
  const http = inject(HttpClient);
  const withSession = req.clone({ withCredentials: true });
  return next(withSession).pipe(
    catchError((err: unknown) => {
      if (
        !(err instanceof HttpErrorResponse) ||
        err.status !== 401 ||
        req.url === \`\${API_BASE_URL}/auth/refresh\` ||
        req.url === \`\${API_BASE_URL}/auth/me\`
      ) {
        return throwError(() => err);
      }
      refreshInFlight ??= http
        .post(\`\${API_BASE_URL}/auth/refresh\`, null, { withCredentials: true })
        .pipe(
          finalize(() => {
            refreshInFlight = null;
          }),
          shareReplay(1),
        );
      // A failed refresh surfaces the ORIGINAL 401.
      return refreshInFlight.pipe(
        catchError(() => throwError(() => err)),
        switchMap(() => next(withSession)),
      );
    }),
  );
};
`;

/** `src/app/auth/session.service.ts` — the root session service: probe +
 *  sign-in/out redirects + the exposed `user` signal a page guard reads. */
export const AUTH_SESSION_SERVICE_ANGULAR = `// Auto-generated.
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { Injectable, inject, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { API_BASE_URL } from "../../api/config";

export type SessionUser = Record<string, unknown>;

/** The session state machine: probing on init, then anon / authed. */
export type SessionState =
  | { kind: "loading" }
  | { kind: "anon" }
  | { kind: "authed"; user: SessionUser };

/** Root session service.  Owns the /auth/me probe and exposes the verified
 *  user as a signal so a future page guard can \`inject(SessionService)\` and
 *  read \`user()\` without re-probing. */
@Injectable({ providedIn: "root" })
export class SessionService {
  private readonly http = inject(HttpClient);

  private readonly state = signal<SessionState>({ kind: "loading" });

  /** The current probe state — read by the AuthGate. */
  readonly snapshot = this.state.asReadonly();

  /** The verified user claims, or null until the probe authenticates.
   *  Exposed for a future page guard. */
  readonly user = signal<SessionUser | null>(null);

  /** Probe the current session.  Resolves to the verified claims, or null
   *  when unauthenticated (HTTP 401).  Drives \`snapshot\` + \`user\`. */
  async probe(): Promise<SessionUser | null> {
    try {
      const me = await firstValueFrom(
        this.http.get<unknown>(\`\${API_BASE_URL}/auth/me\`, { withCredentials: true }),
      );
      const u = me !== null && typeof me === "object" ? (me as SessionUser) : null;
      this.user.set(u);
      this.state.set(u ? { kind: "authed", user: u } : { kind: "anon" });
      return u;
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 401) {
        this.user.set(null);
        this.state.set({ kind: "anon" });
        return null;
      }
      this.user.set(null);
      this.state.set({ kind: "anon" });
      throw err;
    }
  }

  /** Redirect to the backend's login, which 302s to the IdP's hosted login
   *  page.  No login form is shipped — the IdP owns credentials. */
  signIn(): void {
    window.location.href = \`\${API_BASE_URL}/auth/login\`;
  }

  /** Redirect to the backend's logout, clearing the local session. */
  signOut(): void {
    window.location.href = \`\${API_BASE_URL}/auth/logout\`;
  }
}
`;

/** \`src/app/auth/auth-gate.component.ts\` — the route guard.  Probes the
 *  session on init, shows a spinner while loading, a full-screen Sign in
 *  screen when unauthenticated, and projects the app (\`<ng-content>\`)
 *  once authenticated.  Pack-agnostic. */
export function authGateAngular(i18n = false): string {
  const text = sessionTexts(i18n, (call) => `{{ ${call} }}`);
  return `// Auto-generated.
import { Component, type OnInit, inject } from "@angular/core";
import { SessionService } from "./session.service";
${i18n ? 'import { t } from "../../lib/locale";\n' : ""}
/** Gates the app on a verified session.  Probes /auth/me on init via the
 *  root SessionService: shows a spinner while loading, a Sign in screen
 *  (redirecting to the IdP) when unauthenticated, and projects the app once
 *  authenticated. */
@Component({
  selector: "app-auth-gate",
  imports: [],
  template: \`
    @switch (session.snapshot().kind) {
      @case ("loading") {
        <div style="display:flex;align-items:center;justify-content:center;min-height:100vh">
          ${text.loading}
        </div>
      }
      @case ("anon") {
        <div style="display:flex;align-items:center;justify-content:center;min-height:100vh">
          <div style="text-align:center">
            <h1 style="margin-bottom:16px">${text.signIn}</h1>
            <button
              type="button"
              style="padding:8px 20px;font-size:16px;cursor:pointer"
              (click)="session.signIn()"
            >
              ${text.signIn}
            </button>
          </div>
        </div>
      }
      @default {
        <ng-content />
      }
    }
  \`,
})
export class AuthGateComponent implements OnInit {
  readonly session = inject(SessionService);
${i18n ? "  protected readonly t = t;\n" : ""}
  ngOnInit(): void {
    void this.session.probe().catch(() => {
      // Network/probe failure falls back to the Sign in screen
      // (SessionService already set state to anon).
    });
  }
}
`;
}

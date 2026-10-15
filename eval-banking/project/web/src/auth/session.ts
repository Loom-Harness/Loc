// Auto-generated.
import { ApiError, api } from "../api/client";
import { API_BASE_URL } from "../api/config";

export type SessionUser = Record<string, unknown>;

/** Redirect to the backend's login, which 302s to the IdP's hosted login
 *  page.  No login form is shipped — the IdP owns credentials. */
export function signIn(): void {
  window.location.href = `${API_BASE_URL}/auth/login`;
}

/** Redirect to the backend's logout, clearing the local session. */
export function signOut(): void {
  window.location.href = `${API_BASE_URL}/auth/logout`;
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

// Auto-generated.
import { type CSSProperties, type ReactNode, createContext, useContext, useEffect, useState } from "react";
import { type SessionUser, fetchSession, signIn, signOut } from "./session";

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
    return <div style={centered}>Loading…</div>;
  }
  if (state.kind === "anon") {
    return (
      <div style={centered}>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ marginBottom: 16 }}>Sign in</h1>
          <button type="button" style={primaryButton} onClick={signIn}>
            Sign in
          </button>
        </div>
      </div>
    );
  }
  return (
    <SessionContext.Provider value={{ user: state.user, signOut }}>
      {children}
      <button type="button" style={signOutButton} onClick={signOut}>
        Sign out
      </button>
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
const signOutButton: CSSProperties = {
  position: "fixed",
  bottom: 12,
  right: 12,
  zIndex: 1000,
  padding: "6px 12px",
  cursor: "pointer",
};

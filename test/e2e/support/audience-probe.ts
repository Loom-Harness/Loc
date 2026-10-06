import type { ChildProcess } from "node:child_process";
import * as net from "node:net";
import { expect } from "vitest";

// ---------------------------------------------------------------------------
// OIDC audience enforcement probe (CR1-b / P0-4), shared by the four native
// `*-oidc-e2e` legs.
//
// WHAT IT PROVES, AND WHY IT NEEDS A SECOND PROCESS.  All five backends resolve
// the token audience as "the declared `audience:`, overridden by the
// OIDC_AUDIENCE env var, empty ⇒ skip the `aud` check".  The `.ddd` fixtures
// these legs generate declare no `audience:`, so their primary backend runs
// with the check OFF — which is exactly the state every other assertion in
// those suites needs (the seeded Keycloak token must be accepted).
//
// So the audience row cannot be another request against that process: env is
// fixed at boot.  It boots ONE MORE instance of the SAME built artifact on its
// own port with OIDC_AUDIENCE set to a value the token's `aud` cannot carry,
// and asserts the SAME real token is now rejected.  That is a differential, not
// a bare 401: the primary answers 200 for it two assertions earlier.
//
// `/health` is asserted first, and it is on every backend's auth bypass list —
// so a 401 from `/auth/me` means "the audience check rejected the token", not
// "the process never came up", which is the failure mode that would otherwise
// let this row pass while proving nothing.
// ---------------------------------------------------------------------------

/** An audience no IdP would mint for this stack — the token's `aud` cannot
 *  carry it, so a backend that READS OIDC_AUDIENCE must reject the token, and
 *  one that ignores it (node, before this) accepts it. */
export const WRONG_AUDIENCE = "loom-audience-that-no-token-carries";

export async function freeTcpPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, () => {
      const addr = srv.address();
      if (typeof addr === "object" && addr) {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close();
        reject(new Error("could not pick a free port"));
      }
    });
  });
}

export interface AudienceProbeOptions {
  /** Boot one more instance of the already-built backend on `port`, merging
   *  `extraEnv` (which carries OIDC_AUDIENCE) over the same environment the
   *  primary got. */
  start: (port: number, extraEnv: Record<string, string>) => ChildProcess;
  /** A real access token from the IdP — the one the primary backend accepts. */
  token: string;
  /** Boot budget for this second instance (JVM/.NET need more than tsx). */
  readyTimeoutMs?: number;
}

/** Boot a second instance with OIDC_AUDIENCE set to an audience the token does
 *  not carry, and assert the generated verifier rejects the token. */
export async function expectAudienceEnforced(opts: AudienceProbeOptions): Promise<void> {
  const port = await freeTcpPort();
  const base = `http://127.0.0.1:${port}`;
  let proc: ChildProcess | undefined;
  let log = "";
  try {
    proc = opts.start(port, { OIDC_AUDIENCE: WRONG_AUDIENCE });
    proc.stdout?.on("data", (d: Buffer) => {
      log += d.toString();
    });
    proc.stderr?.on("data", (d: Buffer) => {
      log += d.toString();
    });

    // It BOOTED — /health is on every backend's auth bypass list, so this
    // separates "the audience check rejected the token" from "nothing is
    // listening", the failure mode that would make the 401 below meaningless.
    const deadline = Date.now() + (opts.readyTimeoutMs ?? 120_000);
    let ready = false;
    while (Date.now() < deadline && !ready) {
      try {
        const r = await fetch(`${base}/health`);
        ready = r.ok && ((await r.json()) as { status?: string }).status === "ok";
      } catch {
        /* not up yet */
      }
      if (!ready) await new Promise((r) => setTimeout(r, 2_000));
    }
    expect(ready, `audience-strict backend never became healthy:\n${log}`).toBe(true);

    // The SAME token the primary answered 200 for is now rejected, because its
    // `aud` does not carry OIDC_AUDIENCE.  A backend with no audience wiring
    // (node, before CR1-b) answers 200 here.
    const res = await fetch(`${base}/api/auth/me`, {
      headers: { authorization: `Bearer ${opts.token}` },
    });
    expect(
      res.status,
      `OIDC_AUDIENCE=${WRONG_AUDIENCE} did not reject a token minted for a ` +
        `different audience — the generated verifier is ignoring the variable.\n${log}`,
    ).toBe(401);
  } finally {
    if (proc?.pid) {
      try {
        process.kill(-proc.pid, "SIGKILL");
      } catch {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
  }
}

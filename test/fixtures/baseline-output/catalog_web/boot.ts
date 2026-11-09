// Auto-generated.
// The deployable's start-up sequence.  The deployed server (index.ts) runs it
// between migrations and `serve()`; the browser playground's runtime worker
// runs the same function against PGlite.  Start-up wiring belongs here, never
// in index.ts, so the two hosts cannot drift apart.
import { createApp } from "./http/index";

/** How the host wants the app booted.  Every option defaults to the deployed
 *  behaviour; the browser playground sets them because it has no IdP, no
 *  broker and no second Postgres connection. */
export interface BootOptions {
  /** `"configured"` (default): the verifier the model declares — OIDC for an
   *  `auth { oidc }` block, otherwise the dev stub, which answers only when
   *  LOOM_DEV_AUTH=1.  `"dev-stub"`: always the dev stub, switched on. */
  verifier?: "configured" | "dev-stub";
  /** `"external"` (default): broker drivers from LOOM_CHANNEL_*_URL and
   *  pg-boss for `cron:` timers.  `"in-process"`: one in-memory transport for
   *  every channel binding and an in-process `cron:` loop — no durability,
   *  no retry, no cross-replica single-fire. */
  infra?: "external" | "in-process";
}

/** The booted app and the teardown of everything boot started. */
export interface BootedApp {
  app: ReturnType<typeof createApp>;
  /** Stop the relay, the timers and the channel consumers / transports. */
  stop(): Promise<void>;
}

export async function bootApp(
  db: Parameters<typeof createApp>[0],
  _opts: BootOptions = {},
): Promise<BootedApp> {
  const app = createApp(db);
  return {
    app,
    async stop() {},
  };
}

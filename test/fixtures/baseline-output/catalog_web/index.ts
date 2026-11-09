// Auto-generated.
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { serve } from "@hono/node-server";
import * as schema from "./db/schema";
import { bootApp } from "./boot";
import { baseLogger } from "./obs/log";
import { shutdownTracing } from "./obs/tracing";

// Persistence connection — owned by the drizzle PersistenceAdapter
// (DATABASE_URL guard → pg pool → pool-error logging → drizzle db).
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required.  Set it in the environment " +
      "(e.g. postgres://user:pass@host:5432/db).",
  );
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
// Surface pool-level connection errors on the structured stream — a
// dropped backend connection (DB restart, network blip) emits 'error'
// on the pool, not per-query.  Without this hook the failure surfaces
// only as the NEXT request's 503 from /ready or a 500 from an
// aggregate route; logging here gives ops the heads-up + the cause.
pool.on("error", (err) => {
  baseLogger.warn({
    event: "db_disconnected",
    reason: err instanceof Error ? err.message : String(err),
  });
});
const db = drizzle(pool, { schema });

const port = Number(process.env.PORT ?? 3000);
baseLogger.info({ event: "server_starting", port, env: process.env.NODE_ENV ?? "development" });

// Start-up sequence (boot.ts): seeds, verifier, dispatchers, channel
// consumers, outbox relay, timers — resolved before the port opens.
const { app, stop } = await bootApp(db);
const server = serve({ fetch: app.fetch, port });
baseLogger.info({ event: "server_listening", port });

// Graceful shutdown — stop what boot started, close the HTTP server (stops
// accepting, drains in-flight), then close the database.  Without this
// SIGTERM drops in-flight work and leaves connections lingering.  Both
// SIGTERM (orchestrator) and SIGINT (Ctrl-C) are handled.
async function shutdown(signal: string): Promise<void> {
  baseLogger.info({ event: "server_shutdown", signal });
  await stop();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  baseLogger.info({ event: "server_drained" });
  // Flush buffered OTel spans to the collector before exit (no-op when no
  // OTLP endpoint is configured).
  await shutdownTracing();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

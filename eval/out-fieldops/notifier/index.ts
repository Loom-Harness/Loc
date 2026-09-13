// Auto-generated.
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { serve } from "@hono/node-server";
import * as schema from "./db/schema";
import { createApp } from "./http/index";
import { createInProcessDispatcher } from "./http/workflows";
import { channelPublishTee, createChannelTransports, startChannelConsumers } from "./http/channels";
import { migrate } from "drizzle-orm/node-postgres/migrator";
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

// Apply pending schema migrations before serving traffic.  Drizzle's
// runtime migrator reads db/migrations/meta/_journal.json + each
// referenced .sql file, tracking state in `__drizzle_migrations`;
// idempotent across boots.  Bracketed with the catalog migration
// lifecycle events (observability.md) — drizzle's migrator runs the
// whole batch in one opaque call, so there's no per-migration
// `migration_applied` seam (Hono limitation; Python/.NET emit it).
baseLogger.info({ event: "migrations_starting" });
try {
  await migrate(db, { migrationsFolder: "./db/migrations" });
  baseLogger.info({ event: "migrations_complete" });
} catch (err) {
  baseLogger.error({ event: "migration_failed", error: err instanceof Error ? err.message : String(err) });
  throw err;
}
// In-process event dispatcher — shared with the timer scheduler
// (scheduling.md): tick events dispatch through the same routing sagas use.
const inProcessEvents = createInProcessDispatcher(db);
// Broker transport (channels.md): one shared redis connection set
// per LOOM_CHANNEL_*_URL.  The publish tee routes broker-bound events to
// the broker (co-located consumers receive them via the subscription, not
// a local shortcut); the consumer loop feeds received envelopes into the
// same in-process dispatcher local reactors use.
const channelTransports = createChannelTransports();
const app = createApp(db, channelPublishTee(channelTransports, inProcessEvents));
const stopChannelConsumers = await startChannelConsumers(channelTransports, inProcessEvents);
const server = serve({ fetch: app.fetch, port });
baseLogger.info({ event: "server_listening", port });

// Graceful shutdown — close the HTTP server (stops accepting,
// drains in-flight), then close the pg pool.  Without this SIGTERM
// drops in-flight work and leaves pg connections lingering.  Both
// SIGTERM (orchestrator) and SIGINT (Ctrl-C) are handled.
async function shutdown(signal: string): Promise<void> {
  baseLogger.info({ event: "server_shutdown", signal });
  await stopChannelConsumers();
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

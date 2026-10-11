// Auto-generated.
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { serve } from "@hono/node-server";
import * as schema from "./db/schema";
import { createApp } from "./http/index";
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
// A database that is not reachable YET (refused / DNS / starting up) is
// retried up to 10 attempts with capped exponential backoff, so a
// late db no longer kills the container on first boot.
const BOOT_DB_RETRYABLE = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "57P03", // cannot_connect_now — "the database system is starting up"
]);
// The connection-shaped link of the error chain (drizzle wraps the driver
// error as `cause`), rendered for the retry log — undefined when none is.
function bootDbUnreachableReason(err: unknown): string | undefined {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && BOOT_DB_RETRYABLE.has(code)) {
      return `${code}: ${e.message}`;
    }
    if (/Connection terminated/i.test(e.message)) return e.message;
  }
  return undefined;
}
baseLogger.info({ event: "migrations_starting" });
for (let attempt = 1, maxAttempts = 10; ; attempt++) {
  try {
    await migrate(db, { migrationsFolder: "./db/migrations" });
    baseLogger.info({ event: "migrations_complete" });
    break;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const reason = bootDbUnreachableReason(err);
    if (attempt < maxAttempts && reason !== undefined) {
      const delay_ms = Math.min(500 * 2 ** (attempt - 1), 10000);
      baseLogger.warn({ event: "db_connect_retry", attempt, max_attempts: maxAttempts, delay_ms, error: reason });
      await new Promise((resolve) => setTimeout(resolve, delay_ms));
      continue;
    }
    baseLogger.error({ event: "migration_failed", error: message });
    throw err;
  }
}
const app = createApp(db);
const server = serve({ fetch: app.fetch, port });
baseLogger.info({ event: "server_listening", port });

// Graceful shutdown — close the HTTP server (stops accepting,
// drains in-flight), then close the pg pool.  Without this SIGTERM
// drops in-flight work and leaves pg connections lingering.  Both
// SIGTERM (orchestrator) and SIGINT (Ctrl-C) are handled.
async function shutdown(signal: string): Promise<void> {
  baseLogger.info({ event: "server_shutdown", signal });
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

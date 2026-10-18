// ---------------------------------------------------------------------------
// Boot-time database-connect retry policy — shared by all five backends.
//
// The generated compose stack orders every app service after the `db`
// healthcheck, but that only covers the first `docker compose up`: a db that
// restarts, a stack run outside compose (k8s, a hand-started container, a
// managed Postgres still provisioning), or Postgres' own "the database system
// is starting up" window all hand the backend a refused connection at the one
// moment it cannot recover from — the boot migration run.  Each backend now
// retries THAT step (only connection-shaped failures; a failing migration is
// never retried) with capped exponential backoff, logging the catalog
// `db_connect_retry` event per attempt, and gives up after `maxAttempts` so a
// database that never appears still fails boot loudly (compose's
// `restart: unless-stopped` then takes over).
//
// One policy object so the five emitters cannot drift on the numbers.
// ---------------------------------------------------------------------------

export const BOOT_DB_RETRY = {
  /** Total attempts, the first one included. */
  maxAttempts: 10,
  /** Delay before the 2nd attempt; doubles per attempt. */
  baseDelayMs: 500,
  /** Cap on a single delay. */
  maxDelayMs: 10_000,
} as const;

/** Delay (ms) slept after failed attempt `attempt` (1-based). */
export function bootDbRetryDelayMs(attempt: number): number {
  return Math.min(BOOT_DB_RETRY.baseDelayMs * 2 ** (attempt - 1), BOOT_DB_RETRY.maxDelayMs);
}

/** Wall-clock budget of the whole retry schedule (sum of every delay), for
 *  a backend whose driver takes a single timeout instead of a loop (Java's
 *  Hikari `initialization-fail-timeout`). */
export function bootDbRetryBudgetMs(): number {
  let total = 0;
  for (let a = 1; a < BOOT_DB_RETRY.maxAttempts; a++) total += bootDbRetryDelayMs(a);
  return total;
}

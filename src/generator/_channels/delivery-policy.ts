// Channel delivery policy — the retry / backoff numbers every backend's
// broker client and outbox relay share.
//
// These are decisions, not shapes: how long a consumer waits before it
// redials a broker that dropped, is the same answer on every backend.  The
// broker client wiring that acts on it stays idiomatic per backend (amqplib,
// amqp-client, AMQP for Elixir, …); only the numbers live here, so the
// emitters cannot drift on them.

/** A broker client whose connection dropped redials with capped exponential
 *  backoff, and re-attaches every subscription once it is back. */
export const CHANNEL_RECONNECT = {
  /** Delay after the first failed redial; doubles per failed attempt. */
  baseDelayMs: 500,
  /** Cap on a single delay. */
  maxDelayMs: 15_000,
} as const;

/** The transactional-outbox relay every backend runs: a poll of the pending
 *  rows (undispatched, not dead), oldest first.
 *
 *  - A row whose delivery fails spends one attempt; at `maxAttempts` it is
 *    stamped dead and leaves the poll.
 *  - A publish that fails because the BROKER is unreachable is not the row's
 *    fault: the pass halts there, no attempt is spent, and the next pass waits
 *    `relayBackoffMs(failures)`.  A pass that fails on the database backs off
 *    the same way.  So an outage of any length delays rows and dead-letters
 *    none of them. */
export const OUTBOX_RELAY = {
  /** Delay between two passes that both succeeded. */
  intervalMs: 500,
  /** Attempts a row may spend before it is dead-lettered. */
  maxAttempts: 5,
  /** Rows taken per pass. */
  batchSize: 50,
  /** Cap on the delay after consecutive failed passes. */
  maxBackoffMs: 30_000,
  /** Failed passes past which the delay stops doubling. */
  maxBackoffDoublings: 6,
} as const;

/** Delay (ms) before the next pass after `failures` consecutive failed passes
 *  (0 = the last pass succeeded). */
export function relayBackoffMs(failures: number): number {
  if (failures <= 0) return OUTBOX_RELAY.intervalMs;
  return Math.min(
    OUTBOX_RELAY.intervalMs * 2 ** Math.min(failures, OUTBOX_RELAY.maxBackoffDoublings),
    OUTBOX_RELAY.maxBackoffMs,
  );
}

/** A broker consumer whose handler keeps failing: the delivery is retried
 *  (republished with an attempt header) and, at `maxAttempts`, parked in the
 *  channel's dead-letter queue. */
export const CHANNEL_CONSUMER = {
  maxAttempts: 5,
} as const;

/** The flags of every RabbitMQ exchange and queue Loom declares, on every
 *  backend and in the broker's boot-time definitions.  A redeclare whose flags
 *  differ from the existing object is refused (`406 PRECONDITION_FAILED
 *  inequivalent arg`), and RabbitMQ 4.1 records a definitions row that omits a
 *  flag as `undefined`, which matches no client's declare — so the definitions
 *  spell every flag out, and the clients declare with exactly these. */
export const RABBIT_DECLARE = {
  exchange: { durable: true, auto_delete: false, internal: false },
  queue: { durable: true, auto_delete: false, exclusive: false },
} as const;

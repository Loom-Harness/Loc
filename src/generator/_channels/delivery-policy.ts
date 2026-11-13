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
